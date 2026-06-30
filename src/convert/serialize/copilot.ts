import { assemble } from '../yaml.ts';
import type { CanonicalRule } from '../types.ts';

/**
 * Serialize a canonical rule to GitHub Copilot format. `applyTo` is a single
 * glob string; multiple patterns are expected to have been truncated to one by
 * the degradation layer. `always` produces no frontmatter.
 */
export function serializeCopilot(rule: CanonicalRule): string {
  const data: Record<string, unknown> = {};
  if (rule.inclusion === 'fileMatch' && rule.filePatterns?.length) {
    data.applyTo = rule.filePatterns[0];
  }
  return assemble(data, rule.body);
}
