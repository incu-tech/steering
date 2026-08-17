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
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
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
 * Split on either line-ending style. A lone `\n` split (the old behavior) left a
 * trailing `\r` on every line of a CRLF file, so no line ever equaled a marker
 * built without one — every `add`/`update` on such a file appended a fresh
 * duplicate block forever, and `stripBlock` could never find one to remove.
 */
function splitLines(text: string): string[] {
  return text.split(/\r\n|\n/);
}

/** The 0-based [start, stop] line indices of `sourceId`'s block in `lines`, or `null` if it has
 * none (including a begin marker with no matching end — left alone rather than guessed at, so a
 * hand-edited or corrupted file is never silently mangled further). */
function findBlock(lines: string[], sourceId: string): [start: number, stop: number] | null {
  const start = lines.indexOf(beginLine(sourceId));
  if (start === -1) return null;
  const stop = lines.indexOf(endLine(sourceId), start + 1);
  return stop === -1 ? null : [start, stop];
}

/**
 * Remove `sourceId`'s existing block from `text`, if present — every other line
 * (other sources' blocks, hand-written content) is returned verbatim.
 */
export function stripBlock(text: string, sourceId: string): string {
  const lines = splitLines(text);
  const block = findBlock(lines, sourceId);
  if (!block) return text;
  const [start, stop] = block;
  lines.splice(start, stop - start + 1);
  return lines.join('\n');
}

/**
 * Replace `sourceId`'s block in `existing` with freshly rendered `content` (or
 * drop the block entirely when `content` is blank — nothing left to contribute).
 * Every other source's block, and any content outside all blocks, is untouched
 * — including its POSITION: an existing block is replaced exactly where it was
 * (so a user's own content below the block keeps its place; only a brand-new
 * block is appended at the end, since there's no prior position to preserve).
 * Idempotent: writing the same source's same content twice produces the same
 * file both times.
 */
export function mergeSingleFileBlock(existing: string, sourceId: string, content: string): string {
  const trimmed = content.trim();
  const lines = splitLines(existing);
  const block = findBlock(lines, sourceId);

  if (block) {
    const [start, stop] = block;
    const replacement = trimmed ? [beginLine(sourceId), trimmed, endLine(sourceId)] : [];
    lines.splice(start, stop - start + 1, ...replacement);
    const joined = lines.join('\n').trim();
    return joined ? `${joined}\n` : '';
  }

  if (!trimmed) {
    const asIs = lines.join('\n').trim();
    return asIs ? `${asIs}\n` : '';
  }
  const newBlock = `${beginLine(sourceId)}\n${trimmed}\n${endLine(sourceId)}`;
  const base = lines.join('\n').trim();
  return base ? `${base}\n\n${newBlock}\n` : `${newBlock}\n`;
}

/** `sourceId`'s own block content in `text` (trimmed, markers stripped), or `undefined` if it has
 * none yet. Lets a caller diff against just what IT owns instead of the whole shared file — the
 * whole file also holds every other source's block, which a single source's freshly-rendered
 * content can never equal. */
export function getBlockContent(text: string, sourceId: string): string | undefined {
  const lines = splitLines(text);
  const block = findBlock(lines, sourceId);
  if (!block) return undefined;
  const [start, stop] = block;
  return lines
    .slice(start + 1, stop)
    .join('\n')
    .trim();
}

/** True when `text` has at least one steering marker block, for ANY source. Used to tell a fully
 * legacy file (written before this marker scheme existed — nothing to find a specific source's
 * block in) apart from one that simply doesn't have THIS source's block yet. */
export function hasAnyMarkerBlock(text: string): boolean {
  return splitLines(text).some((l) => l.startsWith(OPEN));
}

/** True when `format` aggregates every installed source into one shared file. */
export function isSingleFileFormat(format: AgentFormat): boolean {
  return getFormatSpec(format).single;
}
