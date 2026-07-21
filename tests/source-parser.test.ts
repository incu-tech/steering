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

  it('parses a self-hosted .git HTTPS URL as generic git', () => {
    const s = parseSource('https://git.example.com/team/repo.git');
    expect(s.type).toBe('git');
    expect(s.url).toBe('https://git.example.com/team/repo.git');
  });

  it('parses a non-GitHub SSH URL as generic git', () => {
    const s = parseSource('git@bitbucket.org:team/repo.git');
    expect(s.type).toBe('git');
    expect(getOwnerRepo(s)).toBe('team/repo');
  });

  it('parses a colon-less SSH URL with a GitLab tree path (not GitHub)', () => {
    const s = parseSource(
      'git@git.interbanking.com.ar/ib/ia-specs/kiro-specs/-/tree/master/backup-config-inicial/.kiro/steering'
    );
    expect(s.type).toBe('git');
    expect(s.url).toBe('git@git.interbanking.com.ar:ib/ia-specs/kiro-specs.git');
    expect(s.ref).toBe('master');
    expect(s.subpath).toBe('backup-config-inicial/.kiro/steering');
  });

  it('parses an ssh:// URL as generic git', () => {
    const s = parseSource('ssh://git@host/group/repo.git');
    expect(s.type).toBe('git');
    expect(s.url).toBe('ssh://git@host/group/repo.git');
  });

  it('routes a gitlab.com SSH URL to the gitlab type', () => {
    const s = parseSource('git@gitlab.com:team/repo.git');
    expect(s.type).toBe('gitlab');
    expect(s.url).toBe('git@gitlab.com:team/repo.git');
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
