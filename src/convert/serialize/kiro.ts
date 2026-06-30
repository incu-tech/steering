import { assemble } from '../yaml.ts';
import type { CanonicalRule } from '../types.ts';

/** Serialize a canonical rule to Kiro steering format. */
export function serializeKiro(rule: CanonicalRule): string {
  const data: Record<string, unknown> = { inclusion: rule.inclusion };

  if (rule.inclusion === 'fileMatch' && rule.filePatterns?.length) {
    data.fileMatchPattern =
      rule.filePatterns.length === 1 ? rule.filePatterns[0] : rule.filePatterns;
  }
  if (rule.inclusion === 'auto' && rule.description) {
    data.description = rule.description;
  }

  return assemble(data, rule.body);
}
