import { readFile } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import * as p from '@clack/prompts';
import {
  computeGitBlobSha,
  fetchFileContent,
  fetchRepoTree,
  getBlobSha,
  getGitHubToken,
  type RepoTree,
} from './blob.ts';
import { cloneRepo, cleanupClone, isGitUrl, type ClonedRepo } from './git.ts';
import { parseOwnerRepo } from './source-parser.ts';
import { getInstalledPath, writeRuleFile } from './installer.ts';
import { getAllGlobalLocked, addToGlobalLock } from './steering-lock.ts';
import { readLocalLock, addToLocalLock } from './local-lock.ts';
import { parseManifest } from './manifest.ts';
import { MANIFEST_FILE } from './constants.ts';
import { parseContent } from './convert/parse/index.ts';
import { renderRules } from './convert/convert.ts';
import { c, info, warn } from './ui.ts';
import type { AgentFormat } from './convert/types.ts';

interface UpdateOptions {
  global: boolean;
  workspace: boolean;
  yes: boolean;
}

type Status = 'up-to-date' | 'update-available' | 'error' | 'not-installed';

interface CheckItem {
  name: string;
  global: boolean;
  source: string;
  sourceType: 'github' | 'local' | 'git';
  steeringFilePath: string;
  ref?: string;
  sourceFormat: AgentFormat;
  targetFormat: AgentFormat;
  /** Stored source hash from the lock; null/undefined for legacy hashless entries. */
  storedHash?: string | null;
  /** Stored source package version from the lock, if any. */
  storedVersion?: string;
}

interface CheckResult extends CheckItem {
  status: Status;
  /** Remote source hash (github blob SHA / local sha256), when computed. */
  remoteHash?: string;
  /** Source package version fetched from the remote, when recomputed. */
  newVersion?: string;
  /** Converted content to write on update. */
  newContent?: string;
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function parseOptions(args: string[]): UpdateOptions {
  const options: UpdateOptions = { global: false, workspace: false, yes: false };
  for (const arg of args) {
    if (arg === '--global' || arg === '-g') options.global = true;
    else if (arg === '--workspace' || arg === '-p') options.workspace = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
  }
  if (!options.global && !options.workspace) {
    options.global = true;
    options.workspace = true;
  }
  return options;
}

function inferSourceType(source: string): 'github' | 'local' | 'git' {
  // The hashless workspace lock records no source type. A git remote stores its
  // clone URL as `source`; "owner/repo" is GitHub shorthand; anything else is a path.
  if (isGitUrl(source)) return 'git';
  return parseOwnerRepo(source) ? 'github' : 'local';
}

/** Convert raw source content into the installed file's content for this item. */
function reconstructContent(sourceContent: string, item: CheckItem): string | null {
  // Identity install: written verbatim by `add`, so compare/rewrite raw bytes.
  if (item.sourceFormat === item.targetFormat) return sourceContent;
  // Parse with the lock's name so the rule name matches what `add` installed
  // (manifest-named entries differ from the file basename).
  const rules = parseContent(sourceContent, item.sourceFormat, item.name);
  const docs = renderRules(rules, item.targetFormat, item.name);
  const doc = docs.find((d) => d.name === item.name) ?? docs[0];
  return doc?.content ?? null;
}

/** Build the list of items to check from the relevant lock files. */
async function collectItems(options: UpdateOptions, cwd: string): Promise<CheckItem[]> {
  const items: CheckItem[] = [];

  if (options.global) {
    const locked = await getAllGlobalLocked();
    // The lock key may be composite (`name@format`); the entry carries the real name.
    for (const entry of Object.values(locked)) {
      items.push({
        name: entry.name,
        global: true,
        source: entry.source,
        sourceType:
          (entry.sourceType as 'github' | 'local' | 'git') || inferSourceType(entry.source),
        steeringFilePath: entry.steeringFilePath,
        ref: entry.ref,
        sourceFormat: entry.sourceFormat ?? 'kiro',
        targetFormat: entry.targetFormat ?? 'kiro',
        storedHash: entry.steeringFileHash,
        storedVersion: entry.sourceVersion,
      });
    }
  }

  if (options.workspace) {
    const lock = await readLocalLock(cwd);
    for (const entry of Object.values(lock.steering)) {
      items.push({
        name: entry.name,
        global: false,
        source: entry.source,
        sourceType: inferSourceType(entry.source),
        steeringFilePath: entry.steeringFilePath,
        sourceFormat: entry.sourceFormat ?? 'kiro',
        targetFormat: entry.targetFormat ?? 'kiro',
        storedHash: entry.steeringFileHash,
        storedVersion: entry.sourceVersion,
      });
    }
  }

  return items;
}

/** Read the currently-installed file's content, or null if missing. */
async function readInstalled(item: CheckItem, cwd: string): Promise<string | null> {
  try {
    return await readFile(
      getInstalledPath(item.name, item.global, cwd, item.targetFormat),
      'utf-8'
    );
  } catch {
    return null;
  }
}

/** Fetch the raw source content for an item. `cloneDir` is required for git items. */
async function fetchSource(
  item: CheckItem,
  tree: RepoTree | null,
  cloneDir?: string
): Promise<string | null> {
  if (item.sourceType === 'github') {
    if (!tree) return null;
    return fetchFileContent(item.source, item.steeringFilePath, tree.branch, getGitHubToken());
  }
  if (item.sourceType === 'git') {
    if (!cloneDir) return null;
    try {
      return await readFile(join(cloneDir, item.steeringFilePath), 'utf-8');
    } catch {
      return null;
    }
  }
  try {
    return await readFile(`${item.source}/${item.steeringFilePath}`, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Best-effort source package version: reads `steering.json` at the repo root and
 * returns its `version`. Used to refresh the lock's recorded version on update.
 * Sources installed from a subpath keep their previously-recorded version (the
 * lock doesn't store the subpath), and manifest-less sources return undefined.
 */
async function fetchManifestVersion(
  item: CheckItem,
  tree: RepoTree | null,
  cloneDir?: string
): Promise<string | undefined> {
  let raw: string | null = null;
  try {
    if (item.sourceType === 'github') {
      if (!tree) return undefined;
      raw = await fetchFileContent(item.source, MANIFEST_FILE, tree.branch, getGitHubToken());
    } else if (item.sourceType === 'git') {
      if (!cloneDir) return undefined;
      raw = await readFile(join(cloneDir, MANIFEST_FILE), 'utf-8');
    } else {
      raw = await readFile(`${item.source}/${MANIFEST_FILE}`, 'utf-8');
    }
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  return parseManifest(raw).manifest?.version;
}

/**
 * Source-side change-detection hash for the lock short-circuit. GitHub reads the
 * blob SHA from the tree (no download); git/local hash the fetched content (git
 * blob SHA vs sha256), matching how each was installed.
 */
async function remoteHashFor(
  item: CheckItem,
  tree: RepoTree | null,
  cloneDir?: string
): Promise<string | null> {
  if (item.sourceType === 'github') return getBlobSha(tree!, item.steeringFilePath);
  const content = await fetchSource(item, tree, cloneDir);
  if (content === null) return null;
  return item.sourceType === 'git' ? computeGitBlobSha(content) : sha256(content);
}

/** Resolve status + converted content for each item, caching repo trees. */
async function checkItems(items: CheckItem[], cwd: string): Promise<CheckResult[]> {
  const treeCache = new Map<string, RepoTree | null>();
  // Clone once per (source, ref) and reuse across all files from that source;
  // cleaned up in the finally below (OQ5).
  const cloneCache = new Map<string, ClonedRepo | null>();
  // One manifest-version lookup per (source, ref); only populated when at least
  // one file from that source has an update, so unchanged sources cost nothing.
  const versionCache = new Map<string, string | undefined>();
  const results: CheckResult[] = [];

  try {
    for (const item of items) {
      let tree: RepoTree | null = null;
      let cloneDir: string | undefined;

      if (item.sourceType === 'github') {
        const cacheKey = `${item.source}@${item.ref ?? ''}`;
        if (!treeCache.has(cacheKey)) {
          treeCache.set(cacheKey, await fetchRepoTree(item.source, item.ref, getGitHubToken));
        }
        tree = treeCache.get(cacheKey) ?? null;
        if (!tree) {
          results.push({ ...item, status: 'error' });
          continue;
        }
      } else if (item.sourceType === 'git') {
        const cacheKey = `${item.source}@${item.ref ?? ''}`;
        if (!cloneCache.has(cacheKey)) {
          cloneCache.set(cacheKey, await cloneRepo(item.source, item.ref).catch(() => null));
        }
        const cloned = cloneCache.get(cacheKey) ?? null;
        if (!cloned) {
          results.push({ ...item, status: 'error' });
          continue;
        }
        cloneDir = cloned.dir;
      }

      const cacheKey = `${item.source}@${item.ref ?? ''}`;
      const versionFor = async (): Promise<string | undefined> => {
        if (!versionCache.has(cacheKey)) {
          versionCache.set(cacheKey, await fetchManifestVersion(item, tree, cloneDir));
        }
        return versionCache.get(cacheKey);
      };

      // Both locks store the source hash → cheap short-circuit (no content
      // download / conversion) when the source is unchanged. Legacy hashless
      // workspace entries fall through to the download-and-diff path below.
      if (item.storedHash) {
        const remoteHash = await remoteHashFor(item, tree, cloneDir);
        if (!remoteHash) {
          results.push({ ...item, status: 'error' });
          continue;
        }
        const changed = remoteHash !== item.storedHash;
        results.push({
          ...item,
          ref: tree?.branch ?? item.ref,
          remoteHash,
          newVersion: changed ? await versionFor() : undefined,
          status: changed ? 'update-available' : 'up-to-date',
        });
        continue;
      }

      // Workspace (hashless): download source, convert, diff against installed.
      const installed = await readInstalled(item, cwd);
      if (installed === null) {
        results.push({ ...item, status: 'not-installed' });
        continue;
      }
      const sourceContent = await fetchSource(item, tree, cloneDir);
      if (sourceContent === null) {
        results.push({ ...item, status: 'error' });
        continue;
      }
      const newContent = reconstructContent(sourceContent, item);
      if (newContent === null) {
        results.push({ ...item, status: 'error' });
        continue;
      }
      const changed = newContent !== installed;
      results.push({
        ...item,
        ref: tree?.branch ?? item.ref,
        newContent,
        remoteHash:
          item.sourceType === 'github'
            ? (getBlobSha(tree!, item.steeringFilePath) ?? undefined)
            : item.sourceType === 'git'
              ? computeGitBlobSha(sourceContent)
              : sha256(sourceContent),
        newVersion: changed ? await versionFor() : undefined,
        status: changed ? 'update-available' : 'up-to-date',
      });
    }
  } finally {
    for (const cloned of cloneCache.values()) {
      if (cloned) await cleanupClone(cloned.dir);
    }
  }

  return results;
}

function printResults(results: CheckResult[]): void {
  const bySource = new Map<string, CheckResult[]>();
  for (const r of results) {
    const arr = bySource.get(r.source) ?? [];
    arr.push(r);
    bySource.set(r.source, arr);
  }

  for (const [source, group] of bySource) {
    info(`  ${c.bold(source)}`);
    const pad = Math.max(...group.map((r) => r.name.length));
    for (const r of group) {
      const scope = r.global ? c.dim('(global)') : c.dim('(workspace)');
      let label: string;
      switch (r.status) {
        case 'up-to-date':
          label = c.dim('— up to date');
          break;
        case 'update-available':
          label = c.yellow('— update available');
          break;
        case 'not-installed':
          label = c.red('— installed file missing');
          break;
        default:
          label = c.red('— could not check');
      }
      info(`    ${r.name.padEnd(pad)}  ${label} ${scope}`);
    }
  }
}

export async function runCheck(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const cwd = process.cwd();
  info('Checking for updates...');
  const items = await collectItems(options, cwd);
  if (items.length === 0) {
    info(c.dim('  No steering files installed.'));
    return;
  }
  const results = await checkItems(items, cwd);
  printResults(results);

  const updates = results.filter((r) => r.status === 'update-available').length;
  info('');
  if (updates === 0) info('Everything is up to date.');
  else
    info(
      `${c.yellow(String(updates))} update${updates === 1 ? '' : 's'} available. Run ${c.cyan('steering update')}.`
    );
}

export async function runUpdate(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const cwd = process.cwd();
  info('Checking for updates...');
  const items = await collectItems(options, cwd);
  const results = await checkItems(items, cwd);
  const toUpdate = results.filter((r) => r.status === 'update-available');

  if (toUpdate.length === 0) {
    info('Everything is up to date.');
    return;
  }

  printResults(results.filter((r) => r.status !== 'up-to-date'));

  if (!options.yes && process.stdout.isTTY && process.stdin.isTTY) {
    const ok = await p.confirm({
      message: `Update ${toUpdate.length} steering file${toUpdate.length === 1 ? '' : 's'}?`,
      initialValue: true,
    });
    if (p.isCancel(ok) || !ok) {
      info('Cancelled.');
      return;
    }
  }

  let updated = 0;
  for (const r of toUpdate) {
    // Reuse converted content from the check pass, or compute it now (global
    // short-circuit path didn't download the source).
    let content = r.newContent;
    if (content === undefined) {
      let tree: RepoTree | null = null;
      let cloned: ClonedRepo | null = null;
      if (r.sourceType === 'github') tree = await fetchRepoTree(r.source, r.ref, getGitHubToken);
      else if (r.sourceType === 'git') cloned = await cloneRepo(r.source, r.ref).catch(() => null);
      const sourceContent = await fetchSource(r, tree, cloned?.dir);
      if (cloned) await cleanupClone(cloned.dir);
      if (sourceContent === null) {
        warn(`Could not download ${r.name}; skipping.`);
        continue;
      }
      content = reconstructContent(sourceContent, r) ?? undefined;
    }
    if (content === undefined) {
      warn(`Could not convert ${r.name}; skipping.`);
      continue;
    }

    await writeRuleFile(r.targetFormat, r.name, content, r.global, cwd);

    const newHash = r.remoteHash ?? r.storedHash ?? '';
    const newVersion = r.newVersion ?? r.storedVersion;

    if (r.global) {
      await addToGlobalLock({
        name: r.name,
        source: r.source,
        sourceType: r.sourceType,
        ref: r.ref,
        steeringFilePath: r.steeringFilePath,
        steeringFileHash: newHash,
        ...(newVersion ? { sourceVersion: newVersion } : {}),
        sourceFormat: r.sourceFormat,
        targetFormat: r.targetFormat,
        scope: 'global',
      });
    } else {
      // Refresh the workspace lock's recorded source hash/version. Mirror `add`:
      // only record formats when conversion is involved (keeps kiro→kiro small).
      const isNativeKiro = r.sourceFormat === 'kiro' && r.targetFormat === 'kiro';
      await addToLocalLock(
        {
          name: r.name,
          source: r.source,
          steeringFilePath: r.steeringFilePath,
          ...(newHash ? { steeringFileHash: newHash } : {}),
          ...(newVersion ? { sourceVersion: newVersion } : {}),
          ...(isNativeKiro ? {} : { sourceFormat: r.sourceFormat, targetFormat: r.targetFormat }),
        },
        cwd
      );
    }

    info(`${c.green('✓')} Updated ${r.name}`);
    updated++;
  }

  info('');
  info(`Updated ${c.bold(String(updated))} steering file${updated === 1 ? '' : 's'}.`);
}
