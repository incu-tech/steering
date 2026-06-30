import { describe, it, expect } from 'vitest';
import { computeGitBlobSha, getBlobSha, findMarkdownPaths, type RepoTree } from '../src/blob.ts';

describe('computeGitBlobSha', () => {
  // These are the canonical SHAs produced by `git hash-object`.
  it('matches git for empty content', () => {
    expect(computeGitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });

  it('matches git for "hello\\n"', () => {
    expect(computeGitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});

const tree: RepoTree = {
  sha: 'root',
  branch: 'main',
  tree: [
    { path: 'steering.json', type: 'blob', sha: 'aaa' },
    { path: 'steering', type: 'tree', sha: 'dir' },
    { path: 'steering/security.md', type: 'blob', sha: 'bbb' },
    { path: 'steering/java-conventions.md', type: 'blob', sha: 'ccc' },
    { path: 'steering/nested/deep.md', type: 'blob', sha: 'ddd' },
    { path: 'README.md', type: 'blob', sha: 'eee' },
  ],
};

describe('getBlobSha', () => {
  it('returns the blob sha at a path', () => {
    expect(getBlobSha(tree, 'steering/security.md')).toBe('bbb');
  });
  it('returns null for missing paths and for tree entries', () => {
    expect(getBlobSha(tree, 'steering/missing.md')).toBeNull();
    expect(getBlobSha(tree, 'steering')).toBeNull(); // it's a tree, not a blob
  });
});

describe('findMarkdownPaths', () => {
  it('finds all markdown under a prefix', () => {
    const paths = findMarkdownPaths(tree, 'steering');
    expect(paths).toContain('steering/security.md');
    expect(paths).toContain('steering/java-conventions.md');
    expect(paths).toContain('steering/nested/deep.md');
    expect(paths).not.toContain('README.md');
  });
  it('finds root markdown with no prefix', () => {
    expect(findMarkdownPaths(tree)).toContain('README.md');
  });
});
