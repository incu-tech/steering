import { parse as parseYaml } from 'yaml';
import { INCLUSION_MODES, type InclusionMode } from './types.ts';

/**
 * Minimal frontmatter parser. Only supports YAML (the `---` delimiter).
 * Does NOT support `---js` / `---javascript` to avoid the eval()-based RCE
 * that exists in gray-matter's built-in JS engine. Ported from
 * vercel-labs/skills (src/frontmatter.ts).
 */
export function parseFrontmatter(raw: string): {
  data: Record<string, unknown>;
  content: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };
  let data: Record<string, unknown>;
  try {
    data = (parseYaml(match[1]!) as Record<string, unknown>) ?? {};
  } catch {
    // Malformed YAML — surface as "no frontmatter" rather than throwing.
    data = {};
  }
  return { data, content: match[2] ?? '' };
}

export interface FrontmatterValidation {
  /** Effective inclusion mode (defaults to "always" when absent/invalid). */
  inclusion: InclusionMode;
  /** Non-fatal warnings. Empty when the frontmatter is valid. */
  warnings: string[];
}

/**
 * Validate Kiro steering frontmatter. Per the PRD this is advisory: invalid
 * frontmatter produces warnings but never blocks installation. When `inclusion`
 * is missing or invalid we fall back to Kiro's default of "always".
 *
 * @param fileLabel - filename used in warning messages (e.g. "security.md")
 */
export function validateKiroFrontmatter(raw: string, fileLabel: string): FrontmatterValidation {
  const { data } = parseFrontmatter(raw);
  const warnings: string[] = [];

  const rawInclusion = data.inclusion;
  let inclusion: InclusionMode = 'always';

  if (rawInclusion === undefined || rawInclusion === null) {
    // No frontmatter / no inclusion field → Kiro defaults to "always".
    inclusion = 'always';
  } else if (typeof rawInclusion !== 'string' || !INCLUSION_MODES.includes(rawInclusion as InclusionMode)) {
    warnings.push(
      `${fileLabel}: invalid inclusion mode '${String(rawInclusion)}'. Valid values: ${INCLUSION_MODES.join(', ')}`
    );
    inclusion = 'always';
  } else {
    inclusion = rawInclusion as InclusionMode;
  }

  if (inclusion === 'fileMatch') {
    const pattern = data.fileMatchPattern;
    if (typeof pattern !== 'string' || pattern.trim() === '') {
      warnings.push(
        `${fileLabel}: inclusion is 'fileMatch' but 'fileMatchPattern' is missing. Add e.g. fileMatchPattern: "**/*.java"`
      );
    }
  }

  return { inclusion, warnings };
}
