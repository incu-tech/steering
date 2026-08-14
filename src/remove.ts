import * as p from '@clack/prompts';
import { getInstalledPath, removeSteeringFile, removeSourceRuleFile } from './installer.ts';
import { getAllGlobalLocked, removeFromGlobalLock } from './steering-lock.ts';
import { readLocalLock, removeFromLocalLock } from './local-lock.ts';
import { c, fail, info, isInteractive, success, warn } from './ui.ts';
import { AGENT_FORMATS, type AgentFormat } from './convert/types.ts';

interface RemoveOptions {
  global: boolean;
  yes: boolean;
  /** Restrict removal to a single agent format (otherwise all formats). */
  agent?: AgentFormat;
  /**
   * Restrict removal to entries whose source matches exactly (most useful
   * for a single-file format like agents-md, where several sources can share
   * one name — e.g. `--source owner/repo-a` — but it narrows any format's
   * entries by their actual source, not just single-file ones).
   */
  source?: string;
}

export function parseRemoveOptions(args: string[]): { names: string[]; options: RemoveOptions } {
  const options: RemoveOptions = { global: false, yes: false };
  const names: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--global' || arg === '-g') options.global = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--agent') {
      const v = args[++i];
      if (!v || !(AGENT_FORMATS as string[]).includes(v)) {
        fail(`Invalid --agent format "${v ?? ''}". Valid: ${AGENT_FORMATS.join(', ')}`);
      }
      options.agent = v as AgentFormat;
    } else if (arg === '--source') {
      const v = args[++i];
      if (!v || v.startsWith('-')) {
        fail(`Missing value for --source. Usage: --source <source>`);
      }
      options.source = v;
    } else if (!arg.startsWith('-')) names.push(arg);
  }
  return { names, options };
}

export interface InstalledEntry {
  name: string;
  source: string;
  targetFormat?: AgentFormat;
}

/** Every installed (name, source, format) triple in a scope, straight from the lock. */
async function installedEntries(global: boolean, cwd: string): Promise<InstalledEntry[]> {
  const entries = global
    ? Object.values(await getAllGlobalLocked())
    : Object.values((await readLocalLock(cwd)).steering);
  return entries.map((e) => ({ name: e.name, source: e.source, targetFormat: e.targetFormat }));
}

// Separator for an interactive-picker choice that disambiguates by source (a
// name shared by several sources — only possible for a single-file format).
// A NUL byte (code point escaped, never typed literally, so it can't be
// silently dropped or normalized by an editor/formatter) can't appear in a
// lock name or a real source string, so splitting back is unambiguous.
const SOURCE_SEP = String.fromCodePoint(0);

/**
 * Build the interactive picker's choices: a name backed by exactly one
 * DISTINCT source is one plain choice (today's behavior, unchanged) — even
 * when that source installed to several formats (e.g. `kiro` + `cursor`),
 * which is one logical install, not several. Only a name backed by several
 * DIFFERENT sources (single-file format) becomes one choice per source, so
 * the user removes a specific one instead of all of them at once by
 * accident. Distinct sources are sorted for a deterministic picker order.
 */
export function pickerChoices(entries: InstalledEntry[]): { value: string; label: string }[] {
  const byName = new Map<string, InstalledEntry[]>();
  for (const e of entries) {
    const arr = byName.get(e.name) ?? [];
    arr.push(e);
    byName.set(e.name, arr);
  }
  const choices: { value: string; label: string }[] = [];
  for (const [name, group] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    const sources = [...new Set(group.map((e) => e.source))].sort((a, b) => a.localeCompare(b));
    if (sources.length === 1) {
      choices.push({ value: name, label: name });
    } else {
      for (const source of sources) {
        choices.push({ value: `${name}${SOURCE_SEP}${source}`, label: `${name} <- ${source}` });
      }
    }
  }
  return choices;
}

/** Split a picker choice's value back into its name and (if disambiguated) source. */
function parseTarget(target: string): { name: string; source?: string } {
  const i = target.indexOf(SOURCE_SEP);
  return i === -1 ? { name: target } : { name: target.slice(0, i), source: target.slice(i + 1) };
}

export async function runRemove(names: string[], options: RemoveOptions): Promise<void> {
  const cwd = process.cwd();
  const { global } = options;
  let targets = names;

  // No names given → interactive selection (or guidance in non-TTY).
  if (targets.length === 0) {
    const entries = await installedEntries(global, cwd);
    if (entries.length === 0) {
      info('No steering files installed.');
      return;
    }
    if (!isInteractive()) {
      const installed = [...new Set(entries.map((e) => e.name))].sort((a, b) => a.localeCompare(b));
      fail(`Specify which steering file(s) to remove. Installed: ${installed.join(', ')}`);
    }
    const choice = await p.multiselect({
      message: `Select steering files to remove (${global ? 'global' : 'workspace'})`,
      options: pickerChoices(entries),
      required: true,
    });
    if (p.isCancel(choice)) {
      info('Cancelled.');
      return;
    }
    targets = choice as string[];
  }

  if (!options.yes && isInteractive()) {
    const scope = options.agent ? ` from ${options.agent}` : '';
    const ok = await p.confirm({
      message: `Remove ${targets.length} steering file${targets.length === 1 ? '' : 's'}${scope}?`,
      initialValue: false,
    });
    if (p.isCancel(ok) || !ok) {
      info('Cancelled.');
      return;
    }
  }

  let removed = 0;
  for (const target of targets) {
    const { name, source: pickedSource } = parseTarget(target);
    // A picker choice's own source (disambiguated there) wins; otherwise fall
    // back to a `--source` given on the command line, if any.
    const source = pickedSource ?? options.source;

    // Drop the lock entries first; each removed entry tells us which on-disk
    // file (per target format) to delete.
    const entries = global
      ? await removeFromGlobalLock(name, options.agent, source)
      : await removeFromLocalLock(name, cwd, options.agent, source);

    if (entries.length === 0) {
      const where = options.agent ? ` in ${options.agent}` : '';
      warn(`Not found: ${name}${where}`);
      continue;
    }

    for (const entry of entries) {
      const format = entry.targetFormat ?? 'kiro';
      const deleted = await removeSourceRuleFile(name, entry.source, global, cwd, format);
      if (!deleted) {
        warn(
          `Lock entry removed but file was missing: ${getInstalledPath(name, global, cwd, format)}`
        );
      }
      success(`Removed ${name} ${c.dim(`[${format}]`)}`);
      removed++;
    }
  }

  info('');
  info(`Removed ${c.bold(String(removed))} steering file${removed === 1 ? '' : 's'}.`);
}
