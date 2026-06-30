import type { CanonicalRule } from '../types.ts';

/**
 * Parse a Cline rule (`.clinerules/*.md`). Cline has no frontmatter and combines
 * every rule file; each file is therefore a single `always` rule.
 */
export function parseCline(content: string, name: string): CanonicalRule[] {
  return [{ name, inclusion: 'always', body: content }];
}
