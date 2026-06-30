import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import { parseManifest } from './manifest.ts';
import { validateKiroFrontmatter } from './frontmatter.ts';
import { sanitizeSubpath } from './source-parser.ts';
import { MANIFEST_FILE, STEERING_SUBDIR } from './constants.ts';
import {
  fetchFileContent,
  findMarkdownPaths,
  getBlobSha,
  type RepoTree,
} from './blob.ts';
import { detectFormat } from './convert/detect.ts';
import { parseContent } from './convert/parse/index.ts';
import type { AgentFormat, CanonicalRule } from './convert/types.ts';
import type { SteeringFile } from './types.ts';

/**
 * Thrown when a `steering.json` is present but invalid. Carries the full list
 * of validation problems so the CLI can print them and exit.
 */
export class ManifestError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Invalid steering.json:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    this.name = 'ManifestError';
  }
}

/**
 * Abstraction over "a place files live" so the discovery algorithm is shared
 * between GitHub repo trees and local directories.
 */
export interface FileSource {
  /** Read a repo-relative file, or null if it doesn't exist. */
  read(repoPath: string): Promise<string | null>;
  /** List `.md` files directly inside a repo-relative directory (non-recursive). */
  listMarkdown(dirPrefix: string): Promise<string[]>;
  /** Change-detection hash for a file. */
  hash(repoPath: string, content: string): string;
}

function joinRepoPath(...parts: string[]): string {
  return parts
    .filter((p) => p !== '')
    .join('/')
    .replace(/\/+/g, '/');
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s_]+/g, '-');
}

async function toSteeringFile(
  source: FileSource,
  name: string,
  description: string,
  repoPath: string,
  from?: AgentFormat
): Promise<SteeringFile | null> {
  const content = await source.read(repoPath);
  if (content === null) return null;

  const sourceFormat = from ?? detectFormat(repoPath, content).format ?? 'kiro';
  // Use the steering file's id as the rule name so manifest-named entries keep
  // their id on disk (split formats like AGENTS.md derive their own names).
  const rules: CanonicalRule[] = parseContent(content, sourceFormat, name);

  // Kiro frontmatter validation stays advisory and Kiro-specific.
  const warnings = sourceFormat === 'kiro' ? validateKiroFrontmatter(content, basename(repoPath)).warnings : [];

  return {
    name,
    description,
    repoPath,
    content,
    sourceFormat,
    rules,
    inclusion: rules[0]?.inclusion ?? 'always',
    hash: source.hash(repoPath, content),
    warnings,
  };
}

/**
 * Discover steering files from a source, following the PRD precedence:
 *   1. `steering.json` manifest at the (sub)root → use its `steering` array
 *   2. fallback: `.md` files in the `steering/` directory
 *   3. last resort: `.md` files at the (sub)root
 *
 * @throws {ManifestError} if a manifest exists but fails validation.
 */
export async function discoverSteering(
  source: FileSource,
  subpath?: string,
  from?: AgentFormat
): Promise<SteeringFile[]> {
  const base = subpath ? sanitizeSubpath(subpath.replace(/\\/g, '/')).replace(/\/?$/, '') : '';

  // 1. Manifest
  const manifestRaw = await source.read(joinRepoPath(base, MANIFEST_FILE));
  if (manifestRaw !== null) {
    const { manifest, errors } = parseManifest(manifestRaw);
    if (!manifest) throw new ManifestError(errors);

    const results: SteeringFile[] = [];
    for (const entry of manifest.steering) {
      const repoPath = joinRepoPath(base, entry.file);
      const file = await toSteeringFile(source, entry.name, entry.description ?? '', repoPath, from);
      if (!file) {
        throw new ManifestError([
          `steering.json lists "${entry.name}" → ${entry.file}, but that file was not found`,
        ]);
      }
      results.push(file);
    }
    return results;
  }

  // 2. steering/ directory
  const steeringDirFiles = await source.listMarkdown(joinRepoPath(base, STEERING_SUBDIR));
  const candidatePaths =
    steeringDirFiles.length > 0
      ? steeringDirFiles
      : // 3. root .md files
        await source.listMarkdown(base);

  const results: SteeringFile[] = [];
  for (const repoPath of candidatePaths) {
    const name = basename(repoPath, '.md');
    const file = await toSteeringFile(source, name, '', repoPath, from);
    if (file) results.push(file);
  }
  return results;
}

/** Filter discovered files by a single-name filter (from `owner/repo@name`). */
export function filterByName(files: SteeringFile[], filter: string): SteeringFile[] {
  const target = normalizeName(filter);
  return files.filter((f) => normalizeName(f.name) === target);
}

// ─── FileSource implementations ───

/** A local directory on disk. */
export function localFileSource(rootDir: string): FileSource {
  return {
    async read(repoPath) {
      try {
        return await readFile(join(rootDir, repoPath), 'utf-8');
      } catch {
        return null;
      }
    },
    async listMarkdown(dirPrefix) {
      try {
        const entries = await readdir(join(rootDir, dirPrefix), { withFileTypes: true });
        return entries
          .filter((e) => {
            const n = e.name.toLowerCase();
            return e.isFile() && (n.endsWith('.md') || n.endsWith('.mdc'));
          })
          .map((e) => joinRepoPath(dirPrefix, e.name))
          .sort();
      } catch {
        return [];
      }
    },
    hash(_repoPath, content) {
      return sha256(content);
    },
  };
}

/** A GitHub repo, read through the Trees + Contents APIs. */
export function gitHubFileSource(
  ownerRepo: string,
  tree: RepoTree,
  token: string | null
): FileSource {
  return {
    async read(repoPath) {
      return fetchFileContent(ownerRepo, repoPath, tree.branch, token);
    },
    async listMarkdown(dirPrefix) {
      const prefix = dirPrefix ? dirPrefix.replace(/\/?$/, '/') : '';
      return findMarkdownPaths(tree, dirPrefix)
        .filter((p) => {
          const rest = prefix ? p.slice(prefix.length) : p;
          return rest.length > 0 && !rest.includes('/'); // direct children only
        })
        .sort();
    },
    hash(repoPath, content) {
      return getBlobSha(tree, repoPath) ?? sha256(content);
    },
  };
}
