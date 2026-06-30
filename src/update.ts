import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import * as p from '@clack/prompts';
import {
  fetchFileContent,
  fetchRepoTree,
  getBlobSha,
  getGitHubToken,
  type RepoTree,
} from './blob.ts';
import { parseOwnerRepo } from './source-parser.ts';
import { getInstalledPath, writeRuleFile } from './installer.ts';
import { getAllGlobalLocked, addToGlobalLock } from './steering-lock.ts';
import { readLocalLock } from './local-lock.ts';
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
  sourceType: 'github' | 'local';
  steeringFilePath: string;
  ref?: string;
  sourceFormat: AgentFormat;
  targetFormat: AgentFormat;
  /** Stored source hash (global lock only); null/undefined for hashless workspace. */
  storedHash?: string | null;
}

interface CheckResult extends CheckItem {
  status: Status;
  /** Remote source hash (github blob SHA / local sha256), when computed. */
  remoteHash?: string;
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

function inferSourceType(source: string): 'github' | 'local' {
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
        sourceType: (entry.sourceType as 'github' | 'local') || inferSourceType(entry.source),
        steeringFilePath: entry.steeringFilePath,
        ref: entry.ref,
        sourceFormat: entry.sourceFormat ?? 'kiro',
        targetFormat: entry.targetFormat ?? 'kiro',
        storedHash: entry.steeringFileHash,
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

/** Fetch the raw source content for an item. */
async function fetchSource(item: CheckItem, tree: RepoTree | null): Promise<string | null> {
  if (item.sourceType === 'github') {
    if (!tree) return null;
    return fetchFileContent(item.source, item.steeringFilePath, tree.branch, getGitHubToken());
  }
  try {
    return await readFile(`${item.source}/${item.steeringFilePath}`, 'utf-8');
  } catch {
    return null;
  }
}

/** Resolve status + converted content for each item, caching repo trees. */
async function checkItems(items: CheckItem[], cwd: string): Promise<CheckResult[]> {
  const treeCache = new Map<string, RepoTree | null>();
  const results: CheckResult[] = [];

  for (const item of items) {
    let tree: RepoTree | null = null;
    if (item.sourceType === 'github') {
      const cacheKey = `${item.source}@${item.ref ?? ''}`;
      tree = treeCache.get(cacheKey) ?? null;
      if (!treeCache.has(cacheKey)) {
        tree = await fetchRepoTree(item.source, item.ref, getGitHubToken);
        treeCache.set(cacheKey, tree);
      }
      if (!tree) {
        results.push({ ...item, status: 'error' });
        continue;
      }
    }

    // Global lock stores the source hash → cheap short-circuit (no content
    // download / conversion) when the source is unchanged.
    if (item.global && item.storedHash) {
      const remoteHash =
        item.sourceType === 'github'
          ? getBlobSha(tree!, item.steeringFilePath)
          : await fetchSource(item, tree).then((c) => (c === null ? null : sha256(c)));
      if (!remoteHash) {
        results.push({ ...item, status: 'error' });
        continue;
      }
      results.push({
        ...item,
        ref: tree?.branch ?? item.ref,
        remoteHash,
        status: remoteHash === item.storedHash ? 'up-to-date' : 'update-available',
      });
      continue;
    }

    // Workspace (hashless): download source, convert, diff against installed.
    const installed = await readInstalled(item, cwd);
    if (installed === null) {
      results.push({ ...item, status: 'not-installed' });
      continue;
    }
    const sourceContent = await fetchSource(item, tree);
    if (sourceContent === null) {
      results.push({ ...item, status: 'error' });
      continue;
    }
    const newContent = reconstructContent(sourceContent, item);
    if (newContent === null) {
      results.push({ ...item, status: 'error' });
      continue;
    }
    results.push({
      ...item,
      ref: tree?.branch ?? item.ref,
      newContent,
      remoteHash:
        item.sourceType === 'github'
          ? (getBlobSha(tree!, item.steeringFilePath) ?? undefined)
          : sha256(sourceContent),
      status: newContent === installed ? 'up-to-date' : 'update-available',
    });
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
      if (r.sourceType === 'github') tree = await fetchRepoTree(r.source, r.ref, getGitHubToken);
      const sourceContent = await fetchSource(r, tree);
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

    if (r.global) {
      await addToGlobalLock({
        name: r.name,
        source: r.source,
        sourceType: r.sourceType,
        ref: r.ref,
        steeringFilePath: r.steeringFilePath,
        steeringFileHash: r.remoteHash ?? r.storedHash ?? '',
        sourceFormat: r.sourceFormat,
        targetFormat: r.targetFormat,
        scope: 'global',
      });
    }
    // Workspace lock is hash-free and stable — nothing to rewrite.

    info(`${c.green('✓')} Updated ${r.name}`);
    updated++;
  }

  info('');
  info(`Updated ${c.bold(String(updated))} steering file${updated === 1 ? '' : 's'}.`);
}
