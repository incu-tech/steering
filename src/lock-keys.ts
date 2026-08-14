import { getFormatSpec } from './convert/formats.ts';
import type { AgentFormat } from './convert/types.ts';

/**
 * Lock key scheme for multi-target installs.
 *
 * A steering `name` installed to a single format is keyed **bare** (`security`);
 * the same `name` installed to multiple formats is keyed **composite**
 * (`security@kiro`, `security@cursor`). This keeps the common single-target lock
 * byte-identical to the historical shape (no churn) while allowing one name to
 * live in several agents at once.
 *
 * A single-file format (`agents-md`) breaks the "one name, one identity per
 * format" assumption that composite key relies on: every source shares the same
 * fixed `name` ("agents"), so — unlike a multi-file format, where re-adding a
 * named rule from a new source is a deliberate replace — TWO sources sharing a
 * single-file format's name are two entries to keep side by side, not one to
 * overwrite (see docs/architecture or the #8 issue this fixes). For those
 * formats only, the grouping unit inside a name bucket is `(format, source)`
 * instead of `format` alone, and the on-disk suffix becomes `name@format@source`
 * when more than one source shares that format.
 *
 * Readers never parse keys back — they use `entry.name` / `entry.targetFormat` /
 * `entry.source`. Keys exist only to keep the record unique. The `@` separator
 * is safe because `sanitizeName` strips `@` from on-disk names; lock names are
 * kebab-case ids in practice (manifest-validated), so `name@…` is unambiguous.
 */
const SEP = '@';

type FormatScoped = { name: string; targetFormat?: AgentFormat; source?: string };

/** Effective target format of an entry (absent ⇒ kiro, per the minimal local lock). */
function formatOf(entry: FormatScoped): AgentFormat {
  return entry.targetFormat ?? 'kiro';
}

/**
 * True when `format` needs `source` to identify an entry uniquely. Only a
 * single-file format does — its `name` is always the same fixed value, so
 * `source` is the only thing that tells two of its entries apart.
 */
function needsSourceKey(format: AgentFormat): boolean {
  return getFormatSpec(format).single;
}

/** The (format[, source]) identity `entry` groups under — the unit `rewrite` treats as one slot. */
function groupKeyOf(entry: FormatScoped): string {
  const fmt = formatOf(entry);
  return needsSourceKey(fmt) ? `${fmt}${SEP}${entry.source ?? ''}` : fmt;
}

/** Keys belonging to a name: the bare key or any `name@…` key. */
export function keysForName<E extends FormatScoped>(
  steering: Record<string, E>,
  name: string
): string[] {
  const prefix = name + SEP;
  return Object.keys(steering).filter((k) => k === name || k.startsWith(prefix));
}

/** Re-key every entry for `name` so the bare-vs-composite invariant holds. */
function rewrite<E extends FormatScoped>(
  steering: Record<string, E>,
  name: string,
  byGroup: Map<string, E>
): void {
  const composite = byGroup.size > 1;
  for (const [group, entry] of byGroup) {
    steering[composite ? `${name}${SEP}${group}` : name] = entry;
  }
}

/**
 * Insert or replace `entry` under `entry.name`, keyed by its (format[, source])
 * slot — a bundled single-file format keeps a separate slot per source; every
 * other format keeps today's one-slot-per-format behavior untouched. Entries
 * for the same name in *other* slots are preserved (and re-keyed if the count
 * crosses 1↔2).
 */
export function upsertByFormat<E extends FormatScoped>(
  steering: Record<string, E>,
  entry: E
): void {
  const name = entry.name;
  const keys = keysForName(steering, name);

  const byGroup = new Map<string, E>();
  for (const k of keys) byGroup.set(groupKeyOf(steering[k]!), steering[k]!);
  byGroup.set(groupKeyOf(entry), entry); // add or replace this (format[, source]) slot

  for (const k of keys) delete steering[k];
  rewrite(steering, name, byGroup);
}

/**
 * Remove entries for `name`: every slot when `format` is omitted, only
 * `format`'s slot(s) when given, and — when `source` is also given — only
 * the entry whose *actual* source matches, regardless of format. `source` is
 * never vacuously satisfied: an entry from an unrelated source is left alone
 * even if its format doesn't otherwise need `source` to disambiguate (fixes
 * an over-deletion bug where `--source X` on a bare `name` — no `--agent` —
 * removed every other format's entry for that name too, no matter what
 * source they actually came from). Remaining entries are re-normalized (a
 * lone survivor goes back to a bare key). Returns the removed entries so the
 * caller can delete their on-disk files.
 */
export function removeByName<E extends FormatScoped>(
  steering: Record<string, E>,
  name: string,
  format?: AgentFormat,
  source?: string
): E[] {
  const keys = keysForName(steering, name);
  const removed: E[] = [];
  const remaining = new Map<string, E>();

  for (const k of keys) {
    const entry = steering[k]!;
    const entryFormat = formatOf(entry);
    const matchesFormat = format === undefined || entryFormat === format;
    const matchesSource = source === undefined || entry.source === source;
    if (matchesFormat && matchesSource) removed.push(entry);
    else remaining.set(groupKeyOf(entry), entry);
    delete steering[k];
  }

  rewrite(steering, name, remaining);
  return removed;
}

/**
 * Find the existing entry for a given (name, format[, source]) — `source` only
 * disambiguates for a single-file format; for any other format it's ignored,
 * matching `upsertByFormat`'s one-slot-per-format behavior.
 */
export function findEntry<E extends FormatScoped>(
  steering: Record<string, E>,
  name: string,
  format: AgentFormat,
  source?: string
): E | undefined {
  for (const k of keysForName(steering, name)) {
    const entry = steering[k]!;
    if (formatOf(entry) !== format) continue;
    if (source !== undefined && needsSourceKey(format) && entry.source !== source) continue;
    return entry;
  }
  return undefined;
}
