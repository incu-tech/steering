import { parseFrontmatter } from '../../frontmatter.ts';
import { toPatternArray } from '../glob-util.ts';
import type { CanonicalRule } from '../types.ts';

/**
 * Parse a Cursor (`.mdc`) or Windsurf rule. Both derive four inclusion modes
 * from `alwaysApply` / `globs` / `description` (docs/prds/000-initial/PRD-converter.md §2.2, §8):
 *
 *   1. alwaysApply: true                     → always (wins even with globs)
 *   2. globs present and non-empty           → fileMatch
 *   3. globs present but empty ("")          → always   (§8 edge)
 *   4. no globs + description                → auto
 *   5. nothing                               → manual
 */
export function parseCursor(content: string, name: string): CanonicalRule[] {
  const { data, content: body } = parseFrontmatter(content);

  const globsPresent = data.globs !== undefined && data.globs !== null;
  const patterns = toPatternArray(data.globs);
  const hasDescription = typeof data.description === 'string' && data.description.trim() !== '';
  const description = hasDescription ? (data.description as string) : undefined;

  if (data.alwaysApply === true) {
    return [{ name, inclusion: 'always', body, ...(description ? { description } : {}) }];
  }
  if (patterns.length > 0) {
    return [
      { name, inclusion: 'fileMatch', filePatterns: patterns, body, ...(description ? { description } : {}) },
    ];
  }
  if (globsPresent) {
    // globs: "" — explicitly empty is treated as always (§8).
    return [{ name, inclusion: 'always', body, ...(description ? { description } : {}) }];
  }
  if (hasDescription) {
    return [{ name, inclusion: 'auto', description, body }];
  }
  return [{ name, inclusion: 'manual', body }];
}
