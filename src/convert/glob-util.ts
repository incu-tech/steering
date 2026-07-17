/**
 * Normalize a frontmatter glob value (string, comma-separated string, or array)
 * into a clean array of non-empty patterns. Shared by every parser: Cursor
 * `globs`, Claude/OpenCode `paths`, and Copilot `applyTo` all accept these
 * shapes.
 */
export function toPatternArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const raw: string[] = Array.isArray(value)
    ? value.map((v) => String(v))
    : typeof value === 'string'
      ? splitOutsideBraces(value)
      : [String(value)];
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Split a comma-separated pattern list on commas that sit outside brace
 * expansions, so a single glob like `**\/*.{ts,tsx}` stays whole.
 */
function splitOutsideBraces(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (const ch of value) {
    if (ch === '{') depth++;
    else if (ch === '}' && depth > 0) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}
