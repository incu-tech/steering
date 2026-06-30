/**
 * GitHub access layer. Forked from vercel-labs/skills (src/blob.ts), but the
 * skills.sh download API is removed: steering installs single `.md` files, so
 * we read content through GitHub's authenticated Contents API and derive the
 * change-detection hash from the blob SHA already present in the repo tree.
 */

import { execSync } from 'child_process';
import { createHash } from 'crypto';
import pc from 'picocolors';

/** Timeout for individual HTTP fetches (ms). */
const FETCH_TIMEOUT = 10_000;

/**
 * Issue a request, retrying once on a network/timeout failure (PRD §9).
 * Each attempt gets a fresh request (and timeout signal). HTTP error
 * *statuses* (404/403/...) are not retried — only thrown errors are.
 */
async function fetchWithRetry(makeRequest: () => Promise<Response>): Promise<Response> {
  try {
    return await makeRequest();
  } catch {
    return await makeRequest();
  }
}

// ─── GitHub auth ───

let _ghWarningShown = false;

/** For tests only. */
export function resetGhAuthWarning(): void {
  _ghWarningShown = false;
}

/**
 * Resolve a GitHub token. Order: GITHUB_TOKEN → GH_TOKEN → `gh auth token`.
 * The `gh` subprocess is a last resort (some corporate endpoint-security tools
 * flag it), so it prints a one-time warning before running.
 */
export function getGitHubToken(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;

  if (!_ghWarningShown) {
    process.stderr.write(
      `${pc.yellow('│')}  ${pc.dim(`Using your ${pc.cyan('gh')} login for GitHub access. Set ${pc.cyan('GITHUB_TOKEN')} to skip this.`)}\n`
    );
    _ghWarningShown = true;
  }
  try {
    const token = execSync('gh auth token', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (token) return token;
  } catch {
    // gh not installed or not authenticated
  }
  return null;
}

// ─── GitHub Trees API ───

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export interface RepoTree {
  sha: string;
  branch: string;
  tree: TreeEntry[];
}

let _rateLimitedThisSession = false;

/** For tests only. */
export function resetRepoTreeAuthState(): void {
  _rateLimitedThisSession = false;
}

interface BranchFetchResult {
  tree: RepoTree | null;
  rateLimited: boolean;
  /** True when GitHub returned 401/403/404 in a way that auth could fix. */
  needsAuth: boolean;
}

async function fetchTreeBranch(
  ownerRepo: string,
  branch: string,
  token: string | null
): Promise<BranchFetchResult> {
  try {
    const url = `https://api.github.com/repos/${ownerRepo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'steering-cli',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetchWithRetry(() =>
      fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT) })
    );

    if (response.ok) {
      const data = (await response.json()) as { sha: string; tree: TreeEntry[] };
      return { tree: { sha: data.sha, branch, tree: data.tree }, rateLimited: false, needsAuth: false };
    }

    const rateLimited =
      response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0';
    // A 404 on a repo that may exist privately, or a 401, is auth-fixable.
    const needsAuth = !token && (response.status === 404 || response.status === 401 || rateLimited);
    return { tree: null, rateLimited, needsAuth };
  } catch {
    return { tree: null, rateLimited: false, needsAuth: false };
  }
}

/**
 * Fetch the recursive tree for a GitHub repo. Tries `ref` (or HEAD/main/master).
 * Auth is lazy: unauthenticated first, falling back to a token only if GitHub
 * rate-limits us or the repo looks private (404/401).
 */
export async function fetchRepoTree(
  ownerRepo: string,
  ref?: string,
  getToken?: () => string | null
): Promise<RepoTree | null> {
  const branches = ref ? [ref] : ['HEAD', 'main', 'master'];

  if (_rateLimitedThisSession && getToken) {
    const token = getToken();
    if (!token) return null;
    for (const branch of branches) {
      const result = await fetchTreeBranch(ownerRepo, branch, token);
      if (result.tree) return result.tree;
    }
    return null;
  }

  let needsAuth = false;
  let rateLimited = false;
  for (const branch of branches) {
    const result = await fetchTreeBranch(ownerRepo, branch, null);
    if (result.tree) return result.tree;
    if (result.rateLimited) {
      rateLimited = true;
      break;
    }
    if (result.needsAuth) needsAuth = true;
  }

  if ((!needsAuth && !rateLimited) || !getToken) return null;

  if (rateLimited) _rateLimitedThisSession = true;
  const token = getToken();
  if (!token) return null;

  for (const branch of branches) {
    const result = await fetchTreeBranch(ownerRepo, branch, token);
    if (result.tree) return result.tree;
  }
  return null;
}

// ─── Blob helpers ───

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.?\//, '');
}

/**
 * Return the git blob SHA for a file path within a repo tree, or null if the
 * file isn't present. This is the steering change-detection unit (a flat `.md`
 * file's natural hash), already contained in the tree we fetched — no extra
 * API call.
 */
export function getBlobSha(tree: RepoTree, filePath: string): string | null {
  const target = normalizePath(filePath);
  const entry = tree.tree.find((e) => e.type === 'blob' && normalizePath(e.path) === target);
  return entry?.sha ?? null;
}

/**
 * Compute the git blob SHA of content, matching what `getBlobSha` reads from
 * the tree: sha1 of `blob <byteLength>\0<content>`. Lets us detect updates for
 * workspace installs (whose hashless lock recomputes this from the file on disk)
 * without an extra API call.
 */
export function computeGitBlobSha(content: string): string {
  const body = Buffer.from(content, 'utf-8');
  const header = Buffer.from(`blob ${body.length}\0`, 'utf-8');
  return createHash('sha1').update(Buffer.concat([header, body])).digest('hex');
}

/** True for rule files we discover: `.md` and Cursor's `.mdc`. */
function isRuleFile(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.mdc');
}

/** List all rule (`.md`/`.mdc`) blob paths in the tree, optionally by prefix. */
export function findMarkdownPaths(tree: RepoTree, prefix?: string): string[] {
  const normPrefix = prefix ? normalizePath(prefix).replace(/\/?$/, '/') : '';
  return tree.tree
    .filter((e) => e.type === 'blob' && isRuleFile(e.path))
    .map((e) => normalizePath(e.path))
    .filter((p) => (normPrefix ? p.startsWith(normPrefix) : true));
}

/** True if a blob exists at the given path. */
export function hasBlob(tree: RepoTree, filePath: string): boolean {
  return getBlobSha(tree, filePath) !== null;
}

/**
 * Fetch a file's raw content via the GitHub Contents API. Unlike
 * raw.githubusercontent.com, this works for private repos when a token is
 * supplied — the headline enterprise use case. A token is used eagerly when
 * available so private fetches don't 404.
 */
export async function fetchFileContent(
  ownerRepo: string,
  filePath: string,
  ref: string,
  token: string | null
): Promise<string | null> {
  try {
    const encodedPath = normalizePath(filePath)
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    const url = `https://api.github.com/repos/${ownerRepo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.raw',
      'User-Agent': 'steering-cli',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetchWithRetry(() =>
      fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT) })
    );
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}
