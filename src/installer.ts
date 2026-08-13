import { mkdir, writeFile, readFile, readdir, unlink, access } from 'fs/promises';
import { dirname } from 'path';
import { getFormatDir, getOutputPath, sanitizeName } from './convert/output-paths.ts';
import { getFormatSpec } from './convert/formats.ts';
import { isSingleFileFormat, mergeSingleFileBlock, stripBlock } from './convert/merge.ts';
import type { AgentFormat } from './convert/types.ts';
import type { SteeringFile } from './types.ts';

// Re-exported so existing imports (`installer.sanitizeName`) keep working; the
// canonical implementation now lives in convert/output-paths.ts.
export { sanitizeName };

/**
 * Resolve the directory rule files install into for a given scope and format.
 * `format` defaults to Kiro to keep the original (single-agent) call sites valid.
 */
export function getTargetDir(
  global: boolean,
  cwd: string = process.cwd(),
  format: AgentFormat = 'kiro'
): string {
  return getFormatDir(format, global, cwd);
}

/** Absolute path of an installed rule file for a given format. */
export function getInstalledPath(
  name: string,
  global: boolean,
  cwd?: string,
  format: AgentFormat = 'kiro'
): string {
  return getOutputPath(format, name, global, cwd);
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** True if a rule file with this name is already installed in the scope. */
export async function isInstalled(
  name: string,
  global: boolean,
  cwd?: string,
  format: AgentFormat = 'kiro'
): Promise<boolean> {
  return fileExists(getInstalledPath(name, global, cwd, format));
}

/** Write rendered content for a rule to its format-specific path. */
export async function writeRuleFile(
  format: AgentFormat,
  name: string,
  content: string,
  global: boolean,
  cwd?: string
): Promise<string> {
  const target = getOutputPath(format, name, global, cwd);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf-8');
  return target;
}

/**
 * Write one source's rendered content for a format. For a single-file format
 * (AGENTS.md) this MERGES: only `sourceId`'s own marker block is replaced, so a
 * second source's earlier install (or a user's own hand-written content in the
 * same file) is never clobbered — the old behavior (`writeRuleFile`, a plain
 * overwrite) destroyed every other source's contribution each time `add`/
 * `update` ran for a different source. Multi-file formats are unaffected:
 * this is exactly `writeRuleFile`.
 */
export async function writeSourceRuleFile(
  format: AgentFormat,
  name: string,
  content: string,
  sourceId: string,
  global: boolean,
  cwd?: string
): Promise<string> {
  if (!isSingleFileFormat(format)) return writeRuleFile(format, name, content, global, cwd);

  const target = getOutputPath(format, name, global, cwd);
  const existing = await readFile(target, 'utf-8').catch(() => '');
  const merged = mergeSingleFileBlock(existing, sourceId, content);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, merged, 'utf-8');
  return target;
}

/**
 * Legacy helper: write a steering file's raw content to the Kiro path. Retained
 * for the Kiro identity path; conversion-aware callers use `writeRuleFile`.
 */
export async function writeSteeringFile(
  file: SteeringFile,
  global: boolean,
  cwd?: string
): Promise<string> {
  return writeRuleFile('kiro', file.name, file.content, global, cwd);
}

/** Remove an installed rule file. Returns true if a file was deleted. */
export async function removeSteeringFile(
  name: string,
  global: boolean,
  cwd?: string,
  format: AgentFormat = 'kiro'
): Promise<boolean> {
  try {
    await unlink(getInstalledPath(name, global, cwd, format));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove one source's block from a single-file format's target (AGENTS.md),
 * deleting the file only when stripping that block leaves it empty; for a
 * multi-file format this is exactly `removeSteeringFile`. The old behavior
 * (`removeSteeringFile` on a single-file format) `unlink`'d the whole shared
 * file — removing one source destroyed every other source's contribution too.
 */
export async function removeSourceRuleFile(
  name: string,
  sourceId: string,
  global: boolean,
  cwd?: string,
  format: AgentFormat = 'kiro'
): Promise<boolean> {
  if (!isSingleFileFormat(format)) return removeSteeringFile(name, global, cwd, format);

  const target = getInstalledPath(name, global, cwd, format);
  let existing: string;
  try {
    existing = await readFile(target, 'utf-8');
  } catch {
    return false;
  }

  const stripped = stripBlock(existing, sourceId).trim();
  if (stripped) {
    await writeFile(target, `${stripped}\n`, 'utf-8');
  } else {
    await unlink(target).catch(() => {});
  }
  return true;
}

/** List installed rule names (without extension) for a format in a scope. */
export async function listInstalledNames(
  global: boolean,
  cwd?: string,
  format: AgentFormat = 'kiro'
): Promise<string[]> {
  const spec = getFormatSpec(format);
  const ext = spec.ext.toLowerCase();
  try {
    const entries = await readdir(getFormatDir(format, global, cwd), { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(ext))
      .map((e) => e.name.slice(0, e.name.length - spec.ext.length))
      .sort();
  } catch {
    return [];
  }
}
