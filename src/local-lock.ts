import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { LOCAL_LOCK_FILE } from './constants.ts';
import { upsertByFormat, removeByName } from './lock-keys.ts';
import type { AgentFormat } from './convert/types.ts';

const CURRENT_VERSION = 2;

/**
 * One steering file in the project lock (`steering-lock.json`).
 *
 * Kept small (no timestamps) so the committed file stays merge-friendly: two
 * branches adding different files produce non-overlapping keys that git
 * auto-merges. Records the SOURCE change-detection hash (`steeringFileHash`) so
 * `check`/`update` can tell a source changed without re-downloading and
 * re-converting every file. v1 locks omit the hash; entries without it fall back
 * to the download-and-diff path until the next `update` rewrites them.
 */
export interface LocalLockEntry {
  name: string;
  /** Where it came from: "owner/repo", a URL, or a local path. */
  source: string;
  /** Path of the `.md` within the source repo. */
  steeringFilePath: string;
  /**
   * Change-detection hash of the SOURCE file (git blob SHA for github/git,
   * sha256 for local) at install/update time. Lets `check` compare against the
   * remote hash cheaply. Optional for backward compatibility with v1 locks.
   */
  steeringFileHash?: string;
  /**
   * Version of the source package (`steering.json` `version`) at install/update
   * time, when the source has a manifest. Informational; absent otherwise.
   */
  sourceVersion?: string;
  /**
   * Stable conversion metadata. Optional for backward compatibility with v1
   * (Kiro-only) locks; absent ⇒ kiro→kiro.
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
