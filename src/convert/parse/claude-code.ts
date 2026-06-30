import { parseFrontmatter } from '../../frontmatter.ts';
import { toPatternArray } from '../glob-util.ts';
import type { CanonicalRule } from '../types.ts';

/**
 * Parse a Claude Code (or OpenCode) rule. Both use a `paths` array:
 *   - no `paths` / empty       → always
 *   - one or more `paths`      → fileMatch
 * There is no native representation of `manual` or `auto`.
 */
export function parsePaths(content: string, name: string): CanonicalRule[] {
  const { data, content: body } = parseFrontmatter(content);
  const patterns = toPatternArray(data.paths);

  if (patterns.length === 0) {
    return [{ name, inclusion: 'always', body }];
  }
  return [{ name, inclusion: 'fileMatch', filePatterns: patterns, body }];
}
