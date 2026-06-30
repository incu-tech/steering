import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { GLOBAL_LOCK_FILE } from './constants.ts';
import { upsertByFormat, removeByName, findEntry } from './lock-keys.ts';
import type { AgentFormat } from './convert/types.ts';

const CURRENT_VERSION = 4;

/**
 * One installed steering file in the global lock (`~/.steering/steering-lock.json`).
 * Forked from skills' SkillLockEntry; `skillFolderHash` → `steeringFileHash`
 * (a single git blob SHA for GitHub sources, or a content SHA-256 for local).
 */
export interface SteeringLockEntry {
  name: string;
  /** Normalized source identifier (e.g. "incu/kiro-steering"). */
  source: string;
  /** Source provider: "github" | "local". */
  sourceType: string;
  /** Original URL/path used to install (for re-fetching updates). */
  sourceUrl?: string;
  /** Branch or tag ref used for installation. */
  ref?: string;
  /** Path of the `.md` within the source repo (e.g. "steering/security.md"). */
  steeringFilePath: string;
  /** Change-detection hash of the SOURCE file (git blob SHA for github, sha256 for local). */
  steeringFileHash: string;
  /** Detected format of the source file. */
  sourceFormat: AgentFormat;
  /** Format the file was installed as (determines its on-disk path/extension). */
  targetFormat: AgentFormat;
  /** Always "global" for this lock. */
  scope: 'global';
  installedAt: string;
  updatedAt: string;
}

export interface SteeringLockFile {
  version: number;
  steering: Record<string, SteeringLockEntry>;
}

export function getGlobalLockPath(): string {
  return GLOBAL_LOCK_FILE;
}

function createEmpty(): SteeringLockFile {
  return { version: CURRENT_VERSION, steering: {} };
}

export async function readGlobalLock(): Promise<SteeringLockFile> {
  try {
    const content = await readFile(getGlobalLockPath(), 'utf-8');
    const parsed = JSON.parse(content) as SteeringLockFile;
    if (typeof parsed.version !== 'number' || !parsed.steering) return createEmpty();
    if (parsed.version < CURRENT_VERSION) return createEmpty();
    return parsed;
  } catch {
    return createEmpty();
  }
}

export async function writeGlobalLock(lock: SteeringLockFile): Promise<void> {
  const path = getGlobalLockPath();
  await mkdir(dirname(path), { recursive: true });
  const sorted: Record<string, SteeringLockEntry> = {};
  for (const key of Object.keys(lock.steering).sort()) {
    sorted[key] = lock.steering[key]!;
  }
  await writeFile(
    path,
    JSON.stringify({ version: lock.version, steering: sorted }, null, 2) + '\n'
  );
}

export async function addToGlobalLock(
  entry: Omit<SteeringLockEntry, 'installedAt' | 'updatedAt'>
): Promise<void> {
  const lock = await readGlobalLock();
  const now = new Date().toISOString();
  // Preserve installedAt for this exact (name, format) — not just the name,
  // since the same name may be installed under several formats.
  const existing = findEntry(lock.steering, entry.name, entry.targetFormat);
  upsertByFormat(lock.steering, {
    ...entry,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
  });
  await writeGlobalLock(lock);
}

/**
 * Remove a name from the global lock — every format, or only `format` if given.
 * Returns the removed entries so the caller can delete their on-disk files.
 */
export async function removeFromGlobalLock(
  name: string,
  format?: AgentFormat
): Promise<SteeringLockEntry[]> {
  const lock = await readGlobalLock();
  const removed = removeByName(lock.steering, name, format);
  if (removed.length) await writeGlobalLock(lock);
  return removed;
}

export async function getAllGlobalLocked(): Promise<Record<string, SteeringLockEntry>> {
  return (await readGlobalLock()).steering;
}
