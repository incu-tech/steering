import { assemble } from '../yaml.ts';
import type { CanonicalRule } from '../types.ts';

/**
 * Serialize a canonical rule to a frontmatter-less flat format (AGENTS.md,
 * Cline). Only the body is emitted; activation conditions, if any, are carried
 * as a leading comment by the degradation layer before this runs.
 */
export function serializePlain(rule: CanonicalRule): string {
  return assemble({}, rule.body);
}
