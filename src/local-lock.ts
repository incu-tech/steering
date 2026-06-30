import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { LOCAL_LOCK_FILE } from './constants.ts';
import { upsertByFormat, removeByName } from './lock-keys.ts';
import type { AgentFormat } from './convert/types.ts';

const CURRENT_VERSION = 1;

/**
 * One steering file in the project lock (`steering-lock.json`).
 *
 * Intentionally minimal and hash/timestamp-free (unlike skills' local lock) to
 * minimize git merge conflicts: two branches adding different files produce
 * non-overlapping keys that git auto-merges. Change detection at `check`/`update`
 * time recomputes the git blob SHA from the installed file instead of storing it.
 */
export interface LocalLockEntry {
  name: string;
  /** Where it came from: "owner/repo", a URL, or a local path. */
  source: string;
  /** Path of the `.md` within the source repo. */
  steeringFilePath: string;
  /**
   * Stable conversion metadata. Intentionally hash-free (unlike the global
   * lock) so the committed file doesn't churn on every upstream change — `check`
   * re-converts the source and diffs against the installed file. Optional for
   * backward compatibility with v1 (Kiro-only) locks; absent ⇒ kiro→kiro.
   */
  sourceFormat?: AgentFormat;
  targetFormat?: AgentFormat;
}

export interface LocalLockFile {
  version: number;
  steering: Record<string, LocalLockEntry>;
}

export function getLocalLockPath(cwd: string = process.cwd()): string {
  return join(cwd, LOCAL_LOCK_FILE);
}

function createEmpty(): LocalLockFile {
  return { version: CURRENT_VERSION, steering: {} };
}

export async function readLocalLock(cwd?: string): Promise<LocalLockFile> {
  try {
    const content = await readFile(getLocalLockPath(cwd), 'utf-8');
    const parsed = JSON.parse(content) as LocalLockFile;
    if (typeof parsed.version !== 'number' || !parsed.steering) return createEmpty();
    return parsed;
  } catch {
    return createEmpty();
  }
}

export async function writeLocalLock(lock: LocalLockFile, cwd?: string): Promise<void> {
  const sorted: Record<string, LocalLockEntry> = {};
  for (const key of Object.keys(lock.steering).sort()) {
    sorted[key] = lock.steering[key]!;
  }
  await writeFile(
    getLocalLockPath(cwd),
    JSON.stringify({ version: lock.version, steering: sorted }, null, 2) + '\n',
    'utf-8'
  );
}

export async function addToLocalLock(entry: LocalLockEntry, cwd?: string): Promise<void> {
  const lock = await readLocalLock(cwd);
  upsertByFormat(lock.steering, entry);
  await writeLocalLock(lock, cwd);
}

/**
 * Remove a name from the local lock — every format, or only `format` if given.
 * Returns the removed entries so the caller can delete their on-disk files.
 */
export async function removeFromLocalLock(
  name: string,
  cwd?: string,
  format?: AgentFormat
): Promise<LocalLockEntry[]> {
  const lock = await readLocalLock(cwd);
  const removed = removeByName(lock.steering, name, format);
  if (removed.length) await writeLocalLock(lock, cwd);
  return removed;
}
