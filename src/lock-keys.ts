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
 * Readers never parse keys back — they use `entry.name` / `entry.targetFormat`.
 * Keys exist only to keep the record unique. The `@` separator is safe because
 * `sanitizeName` strips `@` from on-disk names; lock names are kebab-case ids in
 * practice (manifest-validated), so `name@…` is unambiguous.
 */
const SEP = '@';

type FormatScoped = { name: string; targetFormat?: AgentFormat };

/** Effective target format of an entry (absent ⇒ kiro, per the minimal local lock). */
function formatOf(entry: FormatScoped): AgentFormat {
  return entry.targetFormat ?? 'kiro';
}

/** Keys belonging to a name: the bare key or any `name@<format>` key. */
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
  byFormat: Map<AgentFormat, E>
): void {
  const composite = byFormat.size > 1;
  for (const [fmt, entry] of byFormat) {
    steering[composite ? `${name}${SEP}${fmt}` : name] = entry;
  }
}

/**
 * Insert or replace `entry` (by its target format) under `entry.name`, keeping
 * the bare/composite invariant. Entries for the same name in *other* formats are
 * preserved untouched (and re-keyed if the count crosses 1↔2).
 */
export function upsertByFormat<E extends FormatScoped>(
  steering: Record<string, E>,
  entry: E
): void {
  const name = entry.name;
  const keys = keysForName(steering, name);

  const byFormat = new Map<AgentFormat, E>();
  for (const k of keys) byFormat.set(formatOf(steering[k]!), steering[k]!);
  byFormat.set(formatOf(entry), entry); // add or replace this format

  for (const k of keys) delete steering[k];
  rewrite(steering, name, byFormat);
}

/**
 * Remove entries for `name`: every format when `format` is omitted, otherwise
 * only the matching one. Remaining entries are re-normalized (a lone survivor
 * goes back to a bare key). Returns the removed entries so the caller can delete
 * their on-disk files.
 */
export function removeByName<E extends FormatScoped>(
  steering: Record<string, E>,
  name: string,
  format?: AgentFormat
): E[] {
  const keys = keysForName(steering, name);
  const removed: E[] = [];
  const remaining = new Map<AgentFormat, E>();

  for (const k of keys) {
    const entry = steering[k]!;
    if (format === undefined || formatOf(entry) === format) removed.push(entry);
    else remaining.set(formatOf(entry), entry);
    delete steering[k];
  }

  rewrite(steering, name, remaining);
  return removed;
}

/** Find the existing entry for a given (name, format), if any. */
export function findEntry<E extends FormatScoped>(
  steering: Record<string, E>,
  name: string,
  format: AgentFormat
): E | undefined {
  for (const k of keysForName(steering, name)) {
    if (formatOf(steering[k]!) === format) return steering[k];
  }
  return undefined;
}
