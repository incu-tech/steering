import { getAllGlobalLocked } from './steering-lock.ts';
import { readLocalLock } from './local-lock.ts';
import { c, info } from './ui.ts';
import type { AgentFormat } from './convert/types.ts';

interface ListOptions {
  global: boolean;
  workspace: boolean;
  all: boolean;
}

interface ListEntry {
  name: string;
  source?: string;
  targetFormat: AgentFormat;
}

function parseListOptions(args: string[]): ListOptions {
  const options: ListOptions = { global: false, workspace: false, all: false };
  for (const arg of args) {
    if (arg === '--global' || arg === '-g') options.global = true;
    else if (arg === '--workspace') options.workspace = true;
    else if (arg === '--all') options.all = true;
  }
  if (!options.global && !options.workspace && !options.all) options.workspace = true;
  return options;
}

function printScope(title: string, entries: ListEntry[]): void {
  info(`${c.bold(title)}`);
  if (entries.length === 0) {
    info(c.dim('  (none)'));
    info('');
    return;
  }
  const pad = Math.max(...entries.map((e) => e.name.length));
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const from = e.source ? c.dim(`from ${e.source}`) : '';
    info(`  ${c.green('✓')} ${e.name.padEnd(pad)}  ${c.dim(`[${e.targetFormat}]`)}  ${from}`);
  }
  info('');
}

export async function runList(args: string[]): Promise<void> {
  const options = parseListOptions(args);
  const cwd = process.cwd();

  const showWorkspace = options.workspace || options.all;
  const showGlobal = options.global || options.all;

  if (showWorkspace) {
    const lock = await readLocalLock(cwd);
    const entries: ListEntry[] = Object.values(lock.steering).map((e) => ({
      name: e.name,
      source: e.source,
      targetFormat: e.targetFormat ?? 'kiro',
    }));
    printScope('Workspace steering files:', entries);
  }

  if (showGlobal) {
    const locked = await getAllGlobalLocked();
    const entries: ListEntry[] = Object.values(locked).map((e) => ({
      name: e.name,
      source: e.source,
      targetFormat: e.targetFormat ?? 'kiro',
    }));
    printScope('Global steering files:', entries);
  }
}
