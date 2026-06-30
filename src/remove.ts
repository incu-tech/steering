import * as p from '@clack/prompts';
import { getInstalledPath, removeSteeringFile } from './installer.ts';
import { getAllGlobalLocked, removeFromGlobalLock } from './steering-lock.ts';
import { readLocalLock, removeFromLocalLock } from './local-lock.ts';
import { c, fail, info, isInteractive, success, warn } from './ui.ts';
import { AGENT_FORMATS, type AgentFormat } from './convert/types.ts';

interface RemoveOptions {
  global: boolean;
  yes: boolean;
  /** Restrict removal to a single agent format (otherwise all formats). */
  agent?: AgentFormat;
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
    } else if (!arg.startsWith('-')) names.push(arg);
  }
  return { names, options };
}

/** Unique installed steering names in a scope (from the lock). */
async function installedNames(global: boolean, cwd: string): Promise<string[]> {
  const entries = global
    ? Object.values(await getAllGlobalLocked())
    : Object.values((await readLocalLock(cwd)).steering);
  return [...new Set(entries.map((e) => e.name))].sort();
}

export async function runRemove(names: string[], options: RemoveOptions): Promise<void> {
  const cwd = process.cwd();
  const { global } = options;
  let targets = names;

  // No names given → interactive selection (or guidance in non-TTY).
  if (targets.length === 0) {
    const installed = await installedNames(global, cwd);
    if (installed.length === 0) {
      info('No steering files installed.');
      return;
    }
    if (!isInteractive()) {
      fail(`Specify which steering file(s) to remove. Installed: ${installed.join(', ')}`);
    }
    const choice = await p.multiselect({
      message: `Select steering files to remove (${global ? 'global' : 'workspace'})`,
      options: installed.map((n) => ({ value: n, label: n })),
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
  for (const name of targets) {
    // Drop the lock entries first; each removed entry tells us which on-disk
    // file (per target format) to delete.
    const entries = global
      ? await removeFromGlobalLock(name, options.agent)
      : await removeFromLocalLock(name, cwd, options.agent);

    if (entries.length === 0) {
      const where = options.agent ? ` in ${options.agent}` : '';
      warn(`Not found: ${name}${where}`);
      continue;
    }

    for (const entry of entries) {
      const format = entry.targetFormat ?? 'kiro';
      const deleted = await removeSteeringFile(name, global, cwd, format);
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
