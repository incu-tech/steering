import { assemble } from '../yaml.ts';
import type { CanonicalRule } from '../types.ts';

/**
 * Serialize a canonical rule to Claude Code / OpenCode format (`paths` array).
 * `always` produces no frontmatter; `fileMatch` lists every pattern. Other modes
 * are expected to have been degraded to `always` already (see degradation.ts).
 */
export function serializePaths(rule: CanonicalRule): string {
  const data: Record<string, unknown> = {};
  if (rule.inclusion === 'fileMatch' && rule.filePatterns?.length) {
    data.paths = rule.filePatterns;
  }
  return assemble(data, rule.body);
}
