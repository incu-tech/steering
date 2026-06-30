import { basename } from 'path';
import { parseFrontmatter } from '../frontmatter.ts';
import type { AgentFormat } from './types.ts';

export interface DetectionResult {
  format: AgentFormat | null;
  /** Other plausible formats when the signal is ambiguous (e.g. claude-code vs opencode). */
  alternatives: AgentFormat[];
}

/** Path-segment markers, most specific first. */
const DIR_MARKERS: Array<[needle: string, format: AgentFormat]> = [
  ['.github/instructions/', 'copilot'],
  ['.kiro/steering/', 'kiro'],
  ['.cursor/rules/', 'cursor'],
  ['.windsurf/rules/', 'windsurf'],
  ['.claude/rules/', 'claude-code'],
  ['.opencode/rules/', 'opencode'],
  ['.clinerules/', 'cline'],
];

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Detect the format of a rule file from its path and (optionally) content.
 * Signals are checked strongest-first: directory marker → filename → extension
 * → frontmatter shape. `alternatives` is populated when a signal can't fully
 * disambiguate (the caller should fall back to `--from` or a prompt).
 *
 * @see docs/prds/000-initial/PRD-converter.md §7
 */
export function detectFormat(filePath: string, content?: string): DetectionResult {
  const path = normalize(filePath);
  const base = basename(path);

  // 1. Directory markers.
  for (const [needle, format] of DIR_MARKERS) {
    if (path.includes(needle)) return { format, alternatives: [] };
  }

  // 2. Filename.
  if (base === 'AGENTS.md') return { format: 'agents-md', alternatives: [] };
  if (base === '.cursorrules') return { format: 'cursor', alternatives: [] };
  if (base === '.windsurfrules') return { format: 'windsurf', alternatives: [] };

  // 3. Extension.
  if (base.toLowerCase().endsWith('.instructions.md')) return { format: 'copilot', alternatives: [] };
  if (base.toLowerCase().endsWith('.mdc')) return { format: 'cursor', alternatives: ['windsurf'] };

  // 4. Frontmatter shape.
  if (content !== undefined) {
    const { data } = parseFrontmatter(content);
    if ('inclusion' in data) return { format: 'kiro', alternatives: [] };
    if ('applyTo' in data) return { format: 'copilot', alternatives: [] };
    if ('alwaysApply' in data || 'globs' in data) return { format: 'cursor', alternatives: ['windsurf'] };
    if ('paths' in data) return { format: 'claude-code', alternatives: ['opencode'] };
  }

  return { format: null, alternatives: [] };
}
