import { describe, it, expect } from 'vitest';
import { parseSource, getOwnerRepo, parseOwnerRepo } from '../src/source-parser.ts';

describe('parseSource', () => {
  it('parses GitHub shorthand', () => {
    const s = parseSource('incu/kiro-steering');
    expect(s.type).toBe('github');
    expect(getOwnerRepo(s)).toBe('incu/kiro-steering');
  });

  it('parses a full GitHub URL', () => {
    const s = parseSource('https://github.com/org/repo');
    expect(s.type).toBe('github');
    expect(getOwnerRepo(s)).toBe('org/repo');
  });

  it('parses a GitHub tree URL with subpath', () => {
    const s = parseSource('https://github.com/org/monorepo/tree/main/packages/kiro-steering');
    expect(s.type).toBe('github');
    expect(s.ref).toBe('main');
    expect(s.subpath).toBe('packages/kiro-steering');
  });

  it('parses owner/repo@name filter', () => {
    const s = parseSource('incu/kiro-steering@security');
    expect(s.type).toBe('github');
    expect(s.steeringFilter).toBe('security');
  });

  it('parses local relative paths', () => {
    const s = parseSource('./my-local-steering');
    expect(s.type).toBe('local');
    expect(s.localPath).toMatch(/my-local-steering$/);
  });

  it('parses GitLab URLs', () => {
    const s = parseSource('https://gitlab.com/org/repo');
    expect(s.type).toBe('gitlab');
  });

  it('parses raw git SSH URLs', () => {
    const s = parseSource('git@github.com:org/repo.git');
    expect(getOwnerRepo(s)).toBe('org/repo');
  });

  it('rejects path traversal in subpaths', () => {
    expect(() => parseSource('https://github.com/o/r/tree/main/../../etc')).toThrow(/traversal/);
  });
});

describe('parseOwnerRepo', () => {
  it('splits owner/repo', () => {
    expect(parseOwnerRepo('a/b')).toEqual({ owner: 'a', repo: 'b' });
  });
  it('returns null for non owner/repo strings', () => {
    expect(parseOwnerRepo('a/b/c')).toBeNull();
    expect(parseOwnerRepo('justaname')).toBeNull();
  });
});
