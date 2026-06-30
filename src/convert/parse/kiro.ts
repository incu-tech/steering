import { parseFrontmatter } from '../../frontmatter.ts';
import { INCLUSION_MODES, type InclusionMode } from '../../types.ts';
import { toPatternArray } from '../glob-util.ts';
import type { CanonicalRule } from '../types.ts';

/**
 * Parse a Kiro steering file. Kiro is the canonical format, so this is the most
 * direct mapping: the `inclusion` field maps 1:1, `fileMatchPattern` becomes a
 * single-element `filePatterns`, and `description` carries `auto` intent.
 */
export function parseKiro(content: string, name: string): CanonicalRule[] {
  const { data, content: body } = parseFrontmatter(content);

  const rawInclusion = data.inclusion;
  let inclusion: InclusionMode = 'always';
  if (typeof rawInclusion === 'string' && INCLUSION_MODES.includes(rawInclusion as InclusionMode)) {
    inclusion = rawInclusion as InclusionMode;
  }

  const rule: CanonicalRule = { name, inclusion, body };

  if (inclusion === 'fileMatch') {
    const patterns = toPatternArray(data.fileMatchPattern);
    if (patterns.length > 0) rule.filePatterns = patterns;
  }
  if (typeof data.description === 'string' && data.description.trim() !== '') {
    rule.description = data.description;
  }

  return [rule];
}
