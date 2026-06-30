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
