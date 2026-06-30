import { describe, it, expect } from 'vitest';
import { parseManifest } from '../src/manifest.ts';

describe('parseManifest', () => {
  it('parses a valid manifest', () => {
    const { manifest, errors } = parseManifest(
      JSON.stringify({
        name: 'my-standards',
        version: '1.0.0',
        steering: [{ name: 'security', description: 'sec', file: 'steering/security.md' }],
      })
    );
    expect(errors).toEqual([]);
    expect(manifest?.name).toBe('my-standards');
    expect(manifest?.steering).toHaveLength(1);
    expect(manifest?.steering[0]).toEqual({
      name: 'security',
      description: 'sec',
      file: 'steering/security.md',
    });
  });

  it('rejects invalid JSON', () => {
    const { manifest, errors } = parseManifest('{ not json');
    expect(manifest).toBeNull();
    expect(errors[0]).toMatch(/not valid JSON/);
  });

  it('requires a kebab-case name', () => {
    const { errors } = parseManifest(JSON.stringify({ name: 'My Standards', steering: [] }));
    expect(errors.some((e) => /kebab-case/.test(e))).toBe(true);
  });

  it('requires a non-empty steering array', () => {
    const { errors } = parseManifest(JSON.stringify({ name: 'ok', steering: [] }));
    expect(errors.some((e) => /at least one entry/.test(e))).toBe(true);
  });

  it('rejects entries missing name or file', () => {
    const { errors } = parseManifest(
      JSON.stringify({ name: 'ok', steering: [{ description: 'x' }] })
    );
    expect(errors.some((e) => /missing a "name"/.test(e))).toBe(true);
  });

  it('rejects path traversal in file', () => {
    const { errors } = parseManifest(
      JSON.stringify({ name: 'ok', steering: [{ name: 'x', file: '../../etc/passwd' }] })
    );
    expect(errors.some((e) => /\.\./.test(e))).toBe(true);
  });

  it('rejects duplicate steering names', () => {
    const { errors } = parseManifest(
      JSON.stringify({
        name: 'ok',
        steering: [
          { name: 'a', file: 'a.md' },
          { name: 'a', file: 'b.md' },
        ],
      })
    );
    expect(errors.some((e) => /duplicate/.test(e))).toBe(true);
  });
});
