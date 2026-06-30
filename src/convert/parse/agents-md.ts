import { sanitizeName } from '../output-paths.ts';
import type { CanonicalRule } from '../types.ts';

const H2 = /^##\s+(.+?)\s*$/;

/**
 * Parse an `AGENTS.md` (or any frontmatter-less flat file) into one or more
 * canonical rules, all `always` (docs/prds/000-initial/PRD-converter.md §7, §8):
 *
 *   - No `##` sections           → a single rule named after the file.
 *   - One or more `##` sections  → one rule per section, named from the heading.
 *     Content before the first `##` (the preamble), when non-empty, becomes its
 *     own rule named after the file.
 *
 * Each section keeps its `## Heading` line in the body so serialization is
 * lossless both back to `AGENTS.md` and out to per-file formats.
 */
export function parseAgentsMd(content: string, name: string): CanonicalRule[] {
  const lines = content.split('\n');
  const headingIdx = lines.findIndex((l) => H2.test(l));

  // No H2 headings → a single flat rule.
  if (headingIdx === -1) {
    return [{ name, inclusion: 'always', body: content }];
  }

  const rules: CanonicalRule[] = [];
  const used = new Set<string>();

  const uniqueName = (base: string): string => {
    const slug = sanitizeName(base) || 'rule';
    let candidate = slug;
    let n = 2;
    while (used.has(candidate)) candidate = `${slug}-${n++}`;
    used.add(candidate);
    return candidate;
  };

  const preamble = lines.slice(0, headingIdx).join('\n').trim();
  if (preamble !== '') {
    rules.push({ name: uniqueName(name), inclusion: 'always', body: preamble });
  }

  // Split the remainder into H2 blocks.
  let current: { title: string; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    rules.push({
      name: uniqueName(current.title),
      inclusion: 'always',
      body: current.lines.join('\n').trim(),
    });
  };

  for (const line of lines.slice(headingIdx)) {
    const m = line.match(H2);
    if (m) {
      flush();
      current = { title: m[1]!, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();

  return rules;
}
