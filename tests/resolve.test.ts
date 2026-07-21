import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { resolveSource, ResolveError } from '../src/resolve.ts';
import { computeGitBlobSha } from '../src/blob.ts';

/**
 * Build a throwaway local git repo with steering files and commit it, so the
 * generic-git resolver can clone it over a filesystem path. Hermetic — no network.
 */
async function makeGitRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'steering-src-'));
  const git = (args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  await mkdir(join(dir, 'steering'), { recursive: true });
  await writeFile(join(dir, 'steering', 'security.md'), '# Security\n\nUse HTTPS everywhere.\n');
  await writeFile(join(dir, 'steering', 'style.md'), '---\ninclusion: always\n---\n\n# Style\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  return dir;
}

describe('resolveSource — generic git (clone)', () => {
  const repos: string[] = [];
  afterAll(async () => {
    for (const r of repos) await rm(r, { recursive: true, force: true });
  });

  it('clones a git remote and discovers steering files with git-blob-SHA hashes', async () => {
    const repo = await makeGitRepo();
    repos.push(repo);

    const resolved = await resolveSource({ type: 'git', url: repo });

    expect(resolved.sourceType).toBe('git');
    expect(resolved.sourceId).toBe(repo);
    expect(resolved.files.map((f) => f.name).sort()).toEqual(['security', 'style']);

    const sec = resolved.files.find((f) => f.name === 'security')!;
    // The hash is the real git blob SHA of the file content (40 hex), matching
    // what the GitHub tree yields — so check/update stay host-agnostic.
    expect(sec.hash).toMatch(/^[a-f0-9]{40}$/);
    expect(sec.hash).toBe(computeGitBlobSha(sec.content));
  });

  it('applies a single-name filter (owner/repo@name syntax)', async () => {
    const repo = await makeGitRepo();
    repos.push(repo);

    const resolved = await resolveSource({ type: 'git', url: repo, steeringFilter: 'security' });

    expect(resolved.files).toHaveLength(1);
    expect(resolved.files[0]!.name).toBe('security');
  });

  it('throws a ResolveError when the remote cannot be cloned', async () => {
    await expect(
      resolveSource({ type: 'git', url: join(tmpdir(), 'does-not-exist-steering-xyz.git') })
    ).rejects.toBeInstanceOf(ResolveError);
  });
});
