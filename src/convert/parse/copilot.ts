import { parseFrontmatter } from '../../frontmatter.ts';
import { toPatternArray } from '../glob-util.ts';
import type { CanonicalRule } from '../types.ts';

/**
 * Parse a GitHub Copilot instructions file (`*.instructions.md`):
 *   - no `applyTo`            → always
 *   - `applyTo` glob string   → fileMatch (comma-separated globs are split)
 */
export function parseCopilot(content: string, name: string): CanonicalRule[] {
  const { data, content: body } = parseFrontmatter(content);
  const patterns = toPatternArray(data.applyTo);

  if (patterns.length === 0) {
    return [{ name, inclusion: 'always', body }];
  }
  return [{ name, inclusion: 'fileMatch', filePatterns: patterns, body }];
}
