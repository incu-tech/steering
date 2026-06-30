import { homedir } from 'os';
import { join } from 'path';
import { getFormatSpec } from './formats.ts';
import type { AgentFormat } from './types.ts';

/**
 * Sanitize a rule name into a safe flat filename component. Strips path
 * separators and traversal so a hostile source can't write outside the target
 * directory. (Canonical home for what `installer.ts` historically defined.)
 */
export function sanitizeName(name: string): string {
  return name
    .replace(/\.md$/i, '')
    .replace(/[/\\]+/g, '-')
    .replace(/\.\.+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/-+/g, '-')
    .toLowerCase();
}

/** Resolve the directory a format installs into for a given scope. */
export function getFormatDir(
  format: AgentFormat,
  global: boolean,
  cwd: string = process.cwd()
): string {
  const spec = getFormatSpec(format);
  const root = global ? homedir() : cwd;
  return spec.dir ? join(root, spec.dir) : root;
}

/** On-disk filename (with extension) for a rule in a given format. */
export function getOutputBasename(format: AgentFormat, name: string): string {
  const spec = getFormatSpec(format);
  if (spec.fixedName) return spec.fixedName;
  return `${sanitizeName(name)}${spec.ext}`;
}

/** Absolute path a rule installs to for a given format and scope. */
export function getOutputPath(
  format: AgentFormat,
  name: string,
  global: boolean,
  cwd: string = process.cwd()
): string {
  return join(getFormatDir(format, global, cwd), getOutputBasename(format, name));
}
