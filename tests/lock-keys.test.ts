import { describe, it, expect } from 'vitest';
import { keysForName, upsertByFormat, removeByName, findEntry } from '../src/lock-keys.ts';
import type { AgentFormat } from '../src/convert/types.ts';

interface E {
  name: string;
  source: string;
  targetFormat?: AgentFormat;
}
const e = (name: string, targetFormat?: AgentFormat): E => ({ name, source: 's', targetFormat });

describe('keysForName', () => {
  it('matches the bare key and composite keys on the @ separator', () => {
    const s: Record<string, E> = {
      security: e('security'),
      'security-extra': e('security-extra'),
      'foo@kiro': e('foo', 'kiro'),
    };
    expect(keysForName(s, 'security').sort()).toEqual(['security']); // NOT security-extra
    expect(keysForName(s, 'foo')).toEqual(['foo@kiro']);
  });
});

describe('upsertByFormat', () => {
  it('single format → bare key (no churn)', () => {
    const s: Record<string, E> = {};
    upsertByFormat(s, e('security', 'kiro'));
    expect(Object.keys(s)).toEqual(['security']);
  });

  it('replacing the same format keeps the bare key', () => {
    const s: Record<string, E> = {};
    upsertByFormat(s, e('security', 'cursor'));
    upsertByFormat(s, { ...e('security', 'cursor'), source: 's2' });
    expect(Object.keys(s)).toEqual(['security']);
    expect(s.security!.source).toBe('s2');
  });

  it('1→2 formats re-keys both to composite', () => {
    const s: Record<string, E> = {};
    upsertByFormat(s, e('security', 'kiro'));
    upsertByFormat(s, e('security', 'cursor'));
    expect(Object.keys(s).sort()).toEqual(['security@cursor', 'security@kiro']);
    expect(s['security@kiro']!.targetFormat).toBe('kiro');
    expect(s['security@cursor']!.targetFormat).toBe('cursor');
  });

  it('treats a missing targetFormat as kiro', () => {
    const s: Record<string, E> = {};
    upsertByFormat(s, e('security')); // no targetFormat
    upsertByFormat(s, e('security', 'cursor'));
    expect(Object.keys(s).sort()).toEqual(['security@cursor', 'security@kiro']);
  });
});

describe('removeByName', () => {
  it('removes all formats when format omitted', () => {
    const s: Record<string, E> = {};
    upsertByFormat(s, e('security', 'kiro'));
    upsertByFormat(s, e('security', 'cursor'));
    const removed = removeByName(s, 'security');
    expect(removed.map((r) => r.targetFormat).sort()).toEqual(['cursor', 'kiro']);
    expect(Object.keys(s)).toEqual([]);
  });

  it('removes one format and re-normalizes survivor to a bare key', () => {
    const s: Record<string, E> = {};
    upsertByFormat(s, e('security', 'kiro'));
    upsertByFormat(s, e('security', 'cursor'));
    const removed = removeByName(s, 'security', 'cursor');
    expect(removed).toHaveLength(1);
    expect(Object.keys(s)).toEqual(['security']); // back to bare
    expect(s.security!.targetFormat).toBe('kiro');
  });

  it('no-op for an unknown name', () => {
    const s: Record<string, E> = { security: e('security') };
    expect(removeByName(s, 'missing')).toEqual([]);
    expect(Object.keys(s)).toEqual(['security']);
  });
});

describe('findEntry', () => {
  it('finds by (name, format) across bare and composite keys', () => {
    const s: Record<string, E> = {};
    upsertByFormat(s, e('security', 'kiro'));
    expect(findEntry(s, 'security', 'kiro')?.name).toBe('security');
    upsertByFormat(s, e('security', 'cursor'));
    expect(findEntry(s, 'security', 'cursor')?.targetFormat).toBe('cursor');
    expect(findEntry(s, 'security', 'windsurf')).toBeUndefined();
  });
});

// A single-file format's `name` is always the same fixed value ("agents-md"'s
// docs/output is fixed regardless of what any entry's `name` field says), so —
// unlike every other format — `source` is what actually tells two of its
// entries apart. These pin the fix for the "second source overwrites the
// first source's lock entry" bug (issue #8).
const src = (name: string, source: string): E => ({ name, source, targetFormat: 'agents-md' });

describe('upsertByFormat — single-file format keys by (format, source)', () => {
  it('one source → bare key, same as any other format', () => {
    const s: Record<string, E> = {};
    upsertByFormat(s, src('agents', 'owner/repo-a'));
    expect(Object.keys(s)).toEqual(['agents']);
  });

  it('two DIFFERENT sources of the same single-file format are two entries, not one replacing the other', () => {
    const s: Record<string, E> = {};
    upsertByFormat(s, src('agents', 'owner/repo-a'));
    upsertByFormat(s, src('agents', 'owner/repo-b'));
    expect(Object.keys(s)).toHaveLength(2);
    const sources = Object.values(s)
      .map((v) => v.source)
      .sort();
    expect(sources).toEqual(['owner/repo-a', 'owner/repo-b']);
  });

  it('re-adding the SAME source replaces its own entry in place (no growth)', () => {
    const s: Record<string, E> = {};
    upsertByFormat(s, src('agents', 'owner/repo-a'));
    upsertByFormat(s, src('agents', 'owner/repo-b'));
    upsertByFormat(s, src('agents', 'owner/repo-a')); // re-install source A
    expect(Object.keys(s)).toHaveLength(2); // still just A and B, not 3
  });

  it('a multi-file format is unaffected: re-adding the same name from a new source still replaces (deliberate)', () => {
    const s: Record<string, E> = {};
    upsertByFormat(s, e('security', 'kiro'));
    upsertByFormat(s, { ...e('security', 'kiro'), source: 'owner/repo-b' });
    expect(Object.keys(s)).toEqual(['security']); // one entry, not two
    expect(s.security!.source).toBe('owner/repo-b');
  });
});

describe('removeByName — source-aware for single-file formats', () => {
  it('omitting source removes every source sharing the name (bulk, backward compatible)', () => {
    const s: Record<string, E> = {};
    upsertByFormat(s, src('agents', 'owner/repo-a'));
    upsertByFormat(s, src('agents', 'owner/repo-b'));
    const removed = removeByName(s, 'agents');
    expect(removed).toHaveLength(2);
    expect(Object.keys(s)).toEqual([]);
  });

  it('passing source removes only that one, leaving the other', () => {
    const s: Record<string, E> = {};
    upsertByFormat(s, src('agents', 'owner/repo-a'));
    upsertByFormat(s, src('agents', 'owner/repo-b'));
    const removed = removeByName(s, 'agents', 'agents-md', 'owner/repo-a');
    expect(removed).toHaveLength(1);
    expect(removed[0]!.source).toBe('owner/repo-a');
    expect(Object.keys(s)).toEqual(['agents']); // re-normalized to bare — one survivor
    expect(s.agents!.source).toBe('owner/repo-b');
  });

  it('a source filter narrows a multi-file format too — never vacuously matches', () => {
    const s: Record<string, E> = { security: e('security', 'kiro') }; // source: 's'
    // An unrelated source must NOT match, even though `kiro` never needs
    // `source` to disambiguate entries (pins the over-deletion fix).
    expect(removeByName(s, 'security', 'kiro', 'some-unrelated-source')).toHaveLength(0);
    expect(Object.keys(s)).toEqual(['security']); // untouched

    const removed = removeByName(s, 'security', 'kiro', 's'); // the entry's actual source
    expect(removed).toHaveLength(1);
    expect(Object.keys(s)).toEqual([]);
  });

  it('a source filter without a format only removes the entries actually from that source, whatever their format', () => {
    // Reproduces the over-deletion bug: `--source X` with no `--agent` used to
    // remove every non-single-file-format entry for `name` regardless of its
    // real source, because the source check was vacuous for those formats.
    const s: Record<string, E> = {};
    upsertByFormat(s, { ...e('security', 'kiro'), source: 'owner/repo-a' });
    upsertByFormat(s, { ...e('security', 'cursor'), source: 'owner/repo-b' });

    const removed = removeByName(s, 'security', undefined, 'owner/repo-a');
    expect(removed).toHaveLength(1);
    expect(removed[0]!.targetFormat).toBe('kiro');
    // The cursor entry came from an unrelated source — it must survive.
    expect(Object.keys(s)).toEqual(['security']);
    expect(s.security!.targetFormat).toBe('cursor');
    expect(s.security!.source).toBe('owner/repo-b');
  });
});

describe('findEntry — source-aware for single-file formats', () => {
  it('disambiguates by source when given', () => {
    const s: Record<string, E> = {};
    upsertByFormat(s, src('agents', 'owner/repo-a'));
    upsertByFormat(s, src('agents', 'owner/repo-b'));
    expect(findEntry(s, 'agents', 'agents-md', 'owner/repo-a')?.source).toBe('owner/repo-a');
    expect(findEntry(s, 'agents', 'agents-md', 'owner/repo-b')?.source).toBe('owner/repo-b');
  });

  it('without a source, returns whichever entry is found first (caller should pass source when it matters)', () => {
    const s: Record<string, E> = {};
    upsertByFormat(s, src('agents', 'owner/repo-a'));
    expect(findEntry(s, 'agents', 'agents-md')?.source).toBe('owner/repo-a');
  });
});
