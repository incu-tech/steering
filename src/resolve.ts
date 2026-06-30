import { stat } from 'fs/promises';
import { getGitHubToken, fetchRepoTree } from './blob.ts';
import {
  discoverSteering,
  filterByName,
  gitHubFileSource,
  localFileSource,
} from './steering.ts';
import { getOwnerRepo, isRepoPrivate, parseOwnerRepo } from './source-parser.ts';
import type { AgentFormat } from './convert/types.ts';
import type { ParsedSource, SteeringFile } from './types.ts';

/** A user-facing error whose message is already polished for printing. */
export class ResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolveError';
  }
}

export interface ResolvedSource {
  /** Normalized label for lock files / display ("owner/repo" or local path). */
  sourceId: string;
  /** "github" | "local". */
  sourceType: 'github' | 'local';
  /** Original URL/path used to install. */
  sourceUrl: string;
  /** Branch the files were read from (github only). */
  ref?: string;
  files: SteeringFile[];
}

/**
 * Resolve a parsed source into installable steering files.
 *
 * v1 supports GitHub and local paths. GitLab/raw-git/well-known parse cleanly
 * but are rejected here with a clear message — `check`/`update` are defined
 * around GitHub tree SHAs, so other hosts need a model the PRD doesn't specify.
 */
export async function resolveSource(
  parsed: ParsedSource,
  from?: AgentFormat
): Promise<ResolvedSource> {
  if (parsed.type === 'local') {
    return resolveLocal(parsed, from);
  }
  if (parsed.type === 'github') {
    return resolveGitHub(parsed, from);
  }
  throw new ResolveError(
    `${parsed.type} sources are not supported yet — steering v1 supports GitHub and local paths.\n` +
      `  Try:  npx steering add owner/repo   or   npx steering add ./local-path`
  );
}

async function resolveLocal(parsed: ParsedSource, from?: AgentFormat): Promise<ResolvedSource> {
  const root = parsed.localPath!;
  try {
    const s = await stat(root);
    if (!s.isDirectory()) {
      throw new ResolveError(`Local source is not a directory: ${root}`);
    }
  } catch (err) {
    if (err instanceof ResolveError) throw err;
    throw new ResolveError(`Local path not found: ${root}`);
  }

  const source = localFileSource(root);
  let files = await discoverSteering(source, parsed.subpath, from);
  if (parsed.steeringFilter) files = filterByName(files, parsed.steeringFilter);

  if (files.length === 0) {
    throw new ResolveError(
      `No steering files found in ${root}.\n` +
        `  Expected a steering.json manifest, a steering/ directory, or .md files.`
    );
  }

  return { sourceId: root, sourceType: 'local', sourceUrl: root, files };
}

async function resolveGitHub(parsed: ParsedSource, from?: AgentFormat): Promise<ResolvedSource> {
  const ownerRepo = getOwnerRepo(parsed);
  if (!ownerRepo) {
    throw new ResolveError(`Could not parse a GitHub owner/repo from: ${parsed.url}`);
  }

  // Lazy, memoized token: env vars are silent; `gh` is only invoked on demand
  // (rate-limit or private-repo) and its result is reused for content fetches.
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
  let resolvedToken: string | null | undefined = envToken ?? undefined;
  const getToken = (): string | null => {
    if (resolvedToken === undefined) resolvedToken = getGitHubToken();
    return resolvedToken;
  };

  const tree = await fetchRepoTree(ownerRepo, parsed.ref, getToken);
  if (!tree) {
    await throwGitHubFetchError(ownerRepo, parsed.ref);
  }

  const contentToken = resolvedToken === undefined ? envToken : resolvedToken;
  const source = gitHubFileSource(ownerRepo, tree!, contentToken);

  let files = await discoverSteering(source, parsed.subpath, from);
  if (parsed.steeringFilter) files = filterByName(files, parsed.steeringFilter);

  if (files.length === 0) {
    throw new ResolveError(
      `No steering files found in ${ownerRepo}${parsed.subpath ? `/${parsed.subpath}` : ''}.\n` +
        `  Expected a steering.json manifest, a steering/ directory, or .md files.`
    );
  }

  return {
    sourceId: ownerRepo,
    sourceType: 'github',
    sourceUrl: parsed.url,
    ref: tree!.branch,
    files,
  };
}

async function throwGitHubFetchError(ownerRepo: string, ref?: string): Promise<never> {
  const parts = parseOwnerRepo(ownerRepo);
  const hasToken = !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);

  if (parts) {
    const priv = await isRepoPrivate(parts.owner, parts.repo);
    if (priv === true || (priv === null && !hasToken)) {
      throw new ResolveError(
        `This repo requires authentication. Set GITHUB_TOKEN or run \`gh auth login\`.`
      );
    }
  }

  throw new ResolveError(
    `Could not fetch ${ownerRepo}${ref ? `#${ref}` : ''}. ` +
      `The repo or branch may not exist, or GitHub may be unreachable.`
  );
}
