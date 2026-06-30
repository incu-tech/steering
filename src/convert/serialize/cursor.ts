import { assemble } from '../yaml.ts';
import type { CanonicalRule } from '../types.ts';

/**
 * Serialize a canonical rule to Cursor / Windsurf format. Frontmatter key order
 * is fixed (`description`, `globs`, `alwaysApply`) for deterministic output:
 *
 *   always    → alwaysApply: true
 *   fileMatch → globs + alwaysApply: false
 *   auto      → description + alwaysApply: false (no globs)
 *   manual    → no frontmatter
 */
export function serializeCursor(rule: CanonicalRule): string {
  if (rule.inclusion === 'manual') {
    return assemble({}, rule.body);
  }

  const data: Record<string, unknown> = {};
  if (rule.description && (rule.inclusion === 'auto' || rule.inclusion === 'always')) {
    data.description = rule.description;
  }
  if (rule.inclusion === 'fileMatch' && rule.filePatterns?.length) {
    data.globs = rule.filePatterns.length === 1 ? rule.filePatterns[0] : rule.filePatterns;
  }
  data.alwaysApply = rule.inclusion === 'always';

  return assemble(data, rule.body);
}
