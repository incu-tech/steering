/**
 * Generic git access layer. Unlike the GitHub path (which reads through the
 * GitHub API), any git remote — GitLab, Bitbucket, self-hosted, SSH or raw
 * `.git` HTTP URLs — is supported by shallow-cloning into a temp dir and reusing
 * the local discovery logic. Auth is delegated to the user's own git setup
 * (SSH agent / credential helper); we never prompt.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const execFileAsync = promisify(execFile);

/** Cap git's stdout so a pathological remote can't exhaust memory. */
const MAX_BUFFER = 16 * 1024 * 1024;

/** Never let git block on an interactive credential prompt — fail fast instead. */
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' } as NodeJS.ProcessEnv;

/** A user-facing clone failure. `resolve.ts` turns this into a polished message. */
export class GitCloneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitCloneError';
  }
}

export interface ClonedRepo {
  /** Absolute path of the temp working tree. Caller must `cleanupClone` it. */
  dir: string;
  /** Resolved branch/ref the tree is checked out at (best-effort). */
  branch: string;
}

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: GIT_ENV,
    maxBuffer: MAX_BUFFER,
  });
  return stdout.trim();
}

/**
 * Shallow-clone `url` into a fresh temp dir. When `ref` is a branch or tag it's
 * fetched directly; when it's a commit SHA (no `--branch` match) we fall back to
 * a full clone + checkout. `--` separates the URL/dir from options so a URL that
 * starts with `-` can't be read as a flag.
 */
export async function cloneRepo(url: string, ref?: string): Promise<ClonedRepo> {
  const dir = await mkdtemp(join(tmpdir(), 'steering-git-'));
  try {
    if (ref) {
      try {
        await git(['clone', '--depth', '1', '--single-branch', '--branch', ref, '--', url, dir]);
      } catch {
        // `ref` may be a commit SHA rather than a branch/tag: clone then check out.
        await git(['clone', '--', url, dir]);
        await git(['checkout', ref], dir);
      }
    } else {
      await git(['clone', '--depth', '1', '--single-branch', '--', url, dir]);
    }
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw new GitCloneError(err instanceof Error ? err.message : String(err));
  }

  let branch = ref ?? '';
  if (!branch) {
    try {
      branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir);
    } catch {
      branch = 'HEAD';
    }
  }
  return { dir, branch };
}

/** Remove a cloned working tree. Best-effort; never throws. */
export async function cleanupClone(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Heuristic: does this lock `source` string denote a git remote (vs. an
 * "owner/repo" GitHub shorthand or a local path)? Used by `update` on the
 * hashless workspace lock, which doesn't record a source type.
 */
export function isGitUrl(source: string): boolean {
  return (
    source.startsWith('git@') ||
    source.startsWith('ssh://') ||
    source.startsWith('http://') ||
    source.startsWith('https://') ||
    source.endsWith('.git')
  );
}
