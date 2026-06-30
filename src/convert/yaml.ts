import { stringify } from 'yaml';

/**
 * Render a YAML frontmatter block from a data object, or "" when empty. Output
 * is byte-deterministic for a given input: key order follows the object's
 * insertion order (so serializers control it explicitly) and line wrapping is
 * disabled so long globs aren't reflowed unpredictably.
 *
 * Determinism matters: workspace `check` re-converts the source and compares the
 * result byte-for-byte against the installed file (see docs/prds/000-initial/PLAN.md §6, D8).
 */
export function frontmatterBlock(data: Record<string, unknown>): string {
  if (Object.keys(data).length === 0) return '';
  const yaml = stringify(data, { lineWidth: 0 }).replace(/\n+$/, '');
  return `---\n${yaml}\n---\n`;
}

/**
 * Assemble a frontmatter block and a markdown body into a final document.
 * Normalizes spacing (one blank line after frontmatter, single trailing
 * newline) so the same canonical rule always yields identical bytes.
 */
export function assemble(data: Record<string, unknown>, body: string): string {
  const cleanBody = body.replace(/^\n+/, '').replace(/\s+$/, '');
  const tail = cleanBody === '' ? '' : `${cleanBody}\n`;
  const fm = frontmatterBlock(data);
  if (!fm) return tail;
  return tail === '' ? fm : `${fm}\n${tail}`;
}
