import { isAbsolute, resolve } from 'path';
import type { ParsedSource } from './types.ts';

/**
 * Source parsing ported from vercel-labs/skills (src/source-parser.ts).
 * Handles GitHub shorthand/URLs, GitLab URLs, raw git URLs, local paths and
 * `#ref` / `@name` fragments. The `@name` / fragment filter is surfaced as
 * `steeringFilter` (renamed from skills' `skillFilter`).
 */

/**
 * Extract owner/repo (or group/subgroup/repo for GitLab) from a parsed source
 * for lock-file tracking and telemetry. Returns null for local/unparseable.
 */
export function getOwnerRepo(parsed: ParsedSource): string | null {
  if (parsed.type === 'local') {
    return null;
  }

  const sshMatch = parsed.url.match(/^git@[^:]+:(.+)$/);
  if (sshMatch) {
    const path = sshMatch[1]!.replace(/\.git$/, '');
    return path.includes('/') ? path : null;
  }

  if (parsed.url.startsWith('ssh://')) {
    try {
      const url = new URL(parsed.url);
      const path = url.pathname.slice(1).replace(/\.git$/, '');
      return path.includes('/') ? path : null;
    } catch {
      return null;
    }
  }

  if (!parsed.url.startsWith('http://') && !parsed.url.startsWith('https://')) {
    return null;
  }

  try {
    const url = new URL(parsed.url);
    const path = url.pathname.slice(1).replace(/\.git$/, '');
    if (path.includes('/')) {
      return path;
    }
  } catch {
    // Invalid URL
  }

  return null;
}

/**
 * Extract owner and repo from an "owner/repo" string. Returns null if invalid.
 */
export function parseOwnerRepo(ownerRepo: string): { owner: string; repo: string } | null {
  const match = ownerRepo.match(/^([^/]+)\/([^/]+)$/);
  if (match) {
    return { owner: match[1]!, repo: match[2]! };
  }
  return null;
}

/**
 * Check whether a GitHub repository is private.
 * Returns true if private, false if public, null if it can't be determined.
 */
export async function isRepoPrivate(owner: string, repo: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { private?: boolean };
    return data.private === true;
  } catch {
    return null;
  }
}

/**
 * Reject subpaths containing ".." segments that could escape the repo root.
 */
export function sanitizeSubpath(subpath: string): string {
  const normalized = subpath.replace(/\\/g, '/');
  for (const segment of normalized.split('/')) {
    if (segment === '..') {
      throw new Error(
        `Unsafe subpath: "${subpath}" contains path traversal segments. ` +
          `Subpaths must not contain ".." components.`
      );
    }
  }
  return subpath;
}

function isLocalPath(input: string): boolean {
  return (
    isAbsolute(input) ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    input === '.' ||
    input === '..' ||
    /^[a-zA-Z]:[/\\]/.test(input)
  );
}

interface FragmentRefResult {
  inputWithoutFragment: string;
  ref?: string;
  steeringFilter?: string;
}

function decodeFragmentValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function looksLikeGitSource(input: string): boolean {
  if (input.startsWith('github:') || input.startsWith('gitlab:') || input.startsWith('git@')) {
    return true;
  }
  if (/^ssh:\/\/.+\.git(?:$|[/?])/i.test(input)) {
    return true;
  }
  if (input.startsWith('http://') || input.startsWith('https://')) {
    try {
      const parsed = new URL(input);
      const pathname = parsed.pathname;
      if (parsed.hostname === 'github.com') {
        return /^\/[^/]+\/[^/]+(?:\.git)?(?:\/tree\/[^/]+(?:\/.*)?)?\/?$/.test(pathname);
      }
      if (parsed.hostname === 'gitlab.com') {
        return /^\/.+?\/[^/]+(?:\.git)?(?:\/-\/tree\/[^/]+(?:\/.*)?)?\/?$/.test(pathname);
      }
    } catch {
      // Fall through.
    }
  }
  if (/^https?:\/\/.+\.git(?:$|[/?])/i.test(input)) {
    return true;
  }
  return (
    !input.includes(':') &&
    !input.startsWith('.') &&
    !input.startsWith('/') &&
    /^([^/]+)\/([^/]+)(?:\/(.+)|@(.+))?$/.test(input)
  );
}

function parseFragmentRef(input: string): FragmentRefResult {
  const hashIndex = input.indexOf('#');
  if (hashIndex < 0) {
    return { inputWithoutFragment: input };
  }
  const inputWithoutFragment = input.slice(0, hashIndex);
  const fragment = input.slice(hashIndex + 1);
  if (!fragment || !looksLikeGitSource(inputWithoutFragment)) {
    return { inputWithoutFragment: input };
  }
  const atIndex = fragment.indexOf('@');
  if (atIndex === -1) {
    return { inputWithoutFragment, ref: decodeFragmentValue(fragment) };
  }
  const ref = fragment.slice(0, atIndex);
  const steeringFilter = fragment.slice(atIndex + 1);
  return {
    inputWithoutFragment,
    ref: ref ? decodeFragmentValue(ref) : undefined,
    steeringFilter: steeringFilter ? decodeFragmentValue(steeringFilter) : undefined,
  };
}

function appendFragmentRef(input: string, ref?: string, steeringFilter?: string): string {
  if (!ref) {
    return input;
  }
  return `${input}#${ref}${steeringFilter ? `@${steeringFilter}` : ''}`;
}

/**
 * Parse an SSH / scp-style git remote *before* the GitHub-shorthand matchers, so a
 * colon-less `git@host/group/repo` (or a GitLab web path pasted with a `git@`
 * prefix) is cloned over SSH instead of being mistaken for `owner/repo` on GitHub.
 * Handles `git@host:path`, `git@host/path`, and `ssh://git@host[:port]/path`, and
 * peels off a GitLab `/-/tree/<ref>/<subpath>` (or `/tree/<ref>/<subpath>`) suffix.
 * Returns a cloneable SSH URL — the resolver installs it via `git clone`.
 */
function parseGitAtSource(
  input: string,
  fragmentRef?: string,
  fragmentFilter?: string
): ParsedSource | null {
  let userHost: string;
  let pathPart: string;
  let scheme: 'ssh' | 'scp';

  const sshUrl = input.match(/^ssh:\/\/([^/]+)\/(.+)$/);
  if (sshUrl) {
    userHost = sshUrl[1]!;
    pathPart = sshUrl[2]!;
    scheme = 'ssh';
  } else {
    // scp-style: `git@host:path` (canonical) or `git@host/path` (web-path paste).
    const scp = input.match(/^(git@[^/:]+)[:/](.+)$/);
    if (!scp) return null;
    userHost = scp[1]!;
    pathPart = scp[2]!;
    scheme = 'scp';
  }

  let repoPath = pathPart;
  let ref = fragmentRef;
  let subpath: string | undefined;
  const treeMatch =
    pathPart.match(/^(.+?)\/-\/tree\/([^/]+)(?:\/(.+))?$/) ||
    pathPart.match(/^(.+?)\/tree\/([^/]+)(?:\/(.+))?$/);
  if (treeMatch) {
    repoPath = treeMatch[1]!;
    ref = treeMatch[2] || fragmentRef;
    subpath = treeMatch[3];
  }

  repoPath = repoPath.replace(/\/+$/, '').replace(/\.git$/, '');
  if (!repoPath) return null;

  const url =
    scheme === 'ssh' ? `ssh://${userHost}/${repoPath}.git` : `${userHost}:${repoPath}.git`;

  return {
    type: /gitlab/i.test(userHost) ? 'gitlab' : 'git',
    url,
    ...(ref ? { ref } : {}),
    ...(subpath ? { subpath: sanitizeSubpath(subpath) } : {}),
    ...(fragmentFilter ? { steeringFilter: fragmentFilter } : {}),
  };
}

export function parseSource(input: string): ParsedSource {
  if (isLocalPath(input)) {
    const resolvedPath = resolve(input);
    return { type: 'local', url: resolvedPath, localPath: resolvedPath };
  }

  const {
    inputWithoutFragment,
    ref: fragmentRef,
    steeringFilter: fragmentFilter,
  } = parseFragmentRef(input);
  input = inputWithoutFragment;

  // SSH / scp remotes are unambiguous and must win over the GitHub shorthand.
  const sshLike = parseGitAtSource(input, fragmentRef, fragmentFilter);
  if (sshLike) return sshLike;

  const githubPrefixMatch = input.match(/^github:(.+)$/);
  if (githubPrefixMatch) {
    return parseSource(appendFragmentRef(githubPrefixMatch[1]!, fragmentRef, fragmentFilter));
  }

  const gitlabPrefixMatch = input.match(/^gitlab:(.+)$/);
  if (gitlabPrefixMatch) {
    return parseSource(
      appendFragmentRef(`https://gitlab.com/${gitlabPrefixMatch[1]!}`, fragmentRef, fragmentFilter)
    );
  }

  const githubTreeWithPathMatch = input.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/);
  if (githubTreeWithPathMatch) {
    const [, owner, repo, ref, subpath] = githubTreeWithPathMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ref: ref || fragmentRef,
      subpath: subpath ? sanitizeSubpath(subpath) : subpath,
    };
  }

  const githubTreeMatch = input.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)$/);
  if (githubTreeMatch) {
    const [, owner, repo, ref] = githubTreeMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ref: ref || fragmentRef,
    };
  }

  const githubRepoMatch = input.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (githubRepoMatch) {
    const [, owner, repo] = githubRepoMatch;
    const cleanRepo = repo!.replace(/\.git$/, '');
    return {
      type: 'github',
      url: `https://github.com/${owner}/${cleanRepo}.git`,
      ...(fragmentRef ? { ref: fragmentRef } : {}),
      ...(fragmentFilter ? { steeringFilter: fragmentFilter } : {}),
    };
  }

  const gitlabTreeWithPathMatch = input.match(/^(https?):\/\/([^/]+)\/(.+?)\/-\/tree\/([^/]+)\/(.+)/);
  if (gitlabTreeWithPathMatch) {
    const [, protocol, hostname, repoPath, ref, subpath] = gitlabTreeWithPathMatch;
    if (hostname !== 'github.com' && repoPath) {
      return {
        type: 'gitlab',
        url: `${protocol}://${hostname}/${repoPath.replace(/\.git$/, '')}.git`,
        ref: ref || fragmentRef,
        subpath: subpath ? sanitizeSubpath(subpath) : subpath,
      };
    }
  }

  const gitlabTreeMatch = input.match(/^(https?):\/\/([^/]+)\/(.+?)\/-\/tree\/([^/]+)$/);
  if (gitlabTreeMatch) {
    const [, protocol, hostname, repoPath, ref] = gitlabTreeMatch;
    if (hostname !== 'github.com' && repoPath) {
      return {
        type: 'gitlab',
        url: `${protocol}://${hostname}/${repoPath.replace(/\.git$/, '')}.git`,
        ref: ref || fragmentRef,
      };
    }
  }

  const gitlabRepoMatch = input.match(/gitlab\.com\/(.+?)(?:\.git)?\/?$/);
  if (gitlabRepoMatch) {
    const repoPath = gitlabRepoMatch[1]!;
    if (repoPath.includes('/')) {
      return {
        type: 'gitlab',
        url: `https://gitlab.com/${repoPath}.git`,
        ...(fragmentRef ? { ref: fragmentRef } : {}),
      };
    }
  }

  // GitHub shorthand with @name filter: owner/repo@security
  const atMatch = input.match(/^([^/]+)\/([^/@]+)@(.+)$/);
  if (atMatch && !input.includes(':') && !input.startsWith('.') && !input.startsWith('/')) {
    const [, owner, repo, filter] = atMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ...(fragmentRef ? { ref: fragmentRef } : {}),
      steeringFilter: fragmentFilter || filter,
    };
  }

  // GitHub shorthand: owner/repo or owner/repo/subpath
  const shorthandMatch = input.match(/^([^/]+)\/([^/]+)(?:\/(.+?))?\/?$/);
  if (shorthandMatch && !input.includes(':') && !input.startsWith('.') && !input.startsWith('/')) {
    const [, owner, repo, subpath] = shorthandMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ...(fragmentRef ? { ref: fragmentRef } : {}),
      subpath: subpath ? sanitizeSubpath(subpath) : subpath,
      ...(fragmentFilter ? { steeringFilter: fragmentFilter } : {}),
    };
  }

  if (isWellKnownUrl(input)) {
    return { type: 'well-known', url: input };
  }

  return {
    type: 'git',
    url: input,
    ...(fragmentRef ? { ref: fragmentRef } : {}),
  };
}

function isWellKnownUrl(input: string): boolean {
  if (!input.startsWith('http://') && !input.startsWith('https://')) {
    return false;
  }
  try {
    const parsed = new URL(input);
    const excludedHosts = ['github.com', 'gitlab.com', 'raw.githubusercontent.com'];
    if (excludedHosts.includes(parsed.hostname)) {
      return false;
    }
    if (input.endsWith('.git')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
