import { getFormatSpec } from './formats.ts';
import type { AgentFormat } from './types.ts';

/**
 * A single-file format (AGENTS.md today) holds every source's rules in ONE physical
 * file — `add`/`update`/`remove` used to write/delete that whole file per source,
 * so a second source (or a user's own hand-written content) was silently destroyed
 * the next time any source touched it. These marker comments give each source its
 * own block, so writing/removing one source's content never disturbs another's.
 */
const OPEN = '<!-- steering:begin';
const CLOSE = '<!-- steering:end';

/**
 * The id only needs to round-trip (it's never parsed as anything but an opaque
 * marker), but it's embedded inside an HTML comment, so a literal `-->` inside it
 * would terminate the comment early and corrupt the file — split any occurrence
 * with a zero-width space (code point escaped, not typed literally, so it can't
 * be silently dropped by an editor/formatter) so the marker stays intact either way.
 */
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
function markerId(sourceId: string): string {
  return sourceId.replace(/-->/g, `--${ZERO_WIDTH_SPACE}>`).trim();
}

function beginLine(sourceId: string): string {
  return `${OPEN} ${markerId(sourceId)} -->`;
}

function endLine(sourceId: string): string {
  return `${CLOSE} ${markerId(sourceId)} -->`;
}

/**
 * Remove `sourceId`'s existing block from `text`, if present — every other line
 * (other sources' blocks, hand-written content) is returned verbatim. A begin
 * marker with no matching end is left untouched rather than guessed at, so a
 * hand-edited or corrupted file is never silently mangled.
 */
export function stripBlock(text: string, sourceId: string): string {
  const lines = text.split('\n');
  const begin = beginLine(sourceId);
  const end = endLine(sourceId);
  const start = lines.indexOf(begin);
  if (start === -1) return text;

  let stop = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === end) {
      stop = i;
      break;
    }
  }
  if (stop === -1) return text;

  lines.splice(start, stop - start + 1);
  return lines.join('\n');
}

/**
 * Replace `sourceId`'s block in `existing` with freshly rendered `content` (or
 * drop the block entirely when `content` is blank — nothing left to contribute),
 * leaving every other source's block and any content outside all blocks
 * untouched. Idempotent: writing the same source's same content twice produces
 * the same file both times — re-running just replaces that one block in place
 * of appending a duplicate.
 */
export function mergeSingleFileBlock(existing: string, sourceId: string, content: string): string {
  const withoutOwnBlock = stripBlock(existing, sourceId).trim();
  const trimmed = content.trim();
  if (!trimmed) return withoutOwnBlock ? `${withoutOwnBlock}\n` : '';

  const block = `${beginLine(sourceId)}\n${trimmed}\n${endLine(sourceId)}`;
  return withoutOwnBlock ? `${withoutOwnBlock}\n\n${block}\n` : `${block}\n`;
}

/** True when `format` aggregates every installed source into one shared file. */
export function isSingleFileFormat(format: AgentFormat): boolean {
  return getFormatSpec(format).single;
}
