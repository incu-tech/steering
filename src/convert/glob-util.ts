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
      ? value.split(',')
      : [String(value)];
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}
