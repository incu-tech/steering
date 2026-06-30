import { readFile } from 'fs/promises';
import { basename } from 'path';
import { detectFormat } from '../detect.ts';
import type { AgentFormat, CanonicalRule } from '../types.ts';
import { parseKiro } from './kiro.ts';
import { parsePaths } from './claude-code.ts';
import { parseCursor } from './cursor.ts';
import { parseCopilot } from './copilot.ts';
import { parseAgentsMd } from './agents-md.ts';
import { parseCline } from './cline.ts';

/** Thrown when a file's format can't be auto-detected and none was supplied. */
export class FormatDetectionError extends Error {
  constructor(public readonly filePath: string) {
    super(
      `Could not detect the format of ${filePath}. ` +
        `Specify it explicitly with --from <format>.`
    );
    this.name = 'FormatDetectionError';
  }
}

/** Derive a rule name (no extension) from a file path for a given format. */
export function ruleNameFromPath(filePath: string, format: AgentFormat): string {
  const b = basename(filePath);
  if (format === 'agents-md') return b.replace(/\.md$/i, '').toLowerCase();
  if (format === 'copilot' && /\.instructions\.md$/i.test(b)) {
    return b.replace(/\.instructions\.md$/i, '');
  }
  return b.replace(/\.(mdc|md)$/i, '');
}

/** Dispatch raw content to the right parser for a known format. */
export function parseContent(content: string, format: AgentFormat, name: string): CanonicalRule[] {
  switch (format) {
    case 'kiro':
      return parseKiro(content, name);
    case 'claude-code':
    case 'opencode':
      return parsePaths(content, name);
    case 'cursor':
    case 'windsurf':
      return parseCursor(content, name);
    case 'copilot':
      return parseCopilot(content, name);
    case 'agents-md':
      return parseAgentsMd(content, name);
    case 'cline':
      return parseCline(content, name);
  }
}

export interface ParseFileResult {
  format: AgentFormat;
  rules: CanonicalRule[];
}

/**
 * Read and parse a file into one or more canonical rules. Auto-detects the
 * format from the path + content unless `from` is given.
 */
export async function parseRules(filePath: string, from?: AgentFormat): Promise<ParseFileResult> {
  const content = await readFile(filePath, 'utf-8');
  const format = from ?? detectFormat(filePath, content).format;
  if (!format) throw new FormatDetectionError(filePath);
  return { format, rules: parseContent(content, format, ruleNameFromPath(filePath, format)) };
}

/**
 * Convenience wrapper matching the documented library API: parse a file and
 * return its first canonical rule. (For `AGENTS.md` with multiple sections, use
 * `parseRules` to get every rule.)
 */
export async function parseRule(filePath: string, from?: AgentFormat): Promise<CanonicalRule> {
  const { rules } = await parseRules(filePath, from);
  return rules[0]!;
}
