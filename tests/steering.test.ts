import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import {
  discoverSteering,
  localFileSource,
  filterByName,
  ManifestError,
} from '../src/steering.ts';

function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

describe('discoverSteering (local)', () => {
  it('discovers files from a steering.json manifest', async () => {
    const files = await discoverSteering(localFileSource(fixture('sample-package')));
    const names = files.map((f) => f.name).sort();
    expect(names).toEqual(['java-conventions', 'security']);

    const security = files.find((f) => f.name === 'security')!;
    expect(security.inclusion).toBe('always');
    expect(security.description).toMatch(/OWASP/);
    expect(security.repoPath).toBe('steering/security.md');
    expect(security.hash).toMatch(/^[a-f0-9]{64}$/); // sha256 for local sources

    const java = files.find((f) => f.name === 'java-conventions')!;
    expect(java.inclusion).toBe('fileMatch');
    expect(java.warnings).toEqual([]);
  });

  it('falls back to the steering/ directory when no manifest exists', async () => {
    const files = await discoverSteering(localFileSource(fixture('no-manifest')));
    const names = files.map((f) => f.name).sort();
    expect(names).toEqual(['bad-frontmatter', 'style']);
  });

  it('surfaces frontmatter warnings without failing', async () => {
    const files = await discoverSteering(localFileSource(fixture('no-manifest')));
    const bad = files.find((f) => f.name === 'bad-frontmatter')!;
    expect(bad.inclusion).toBe('always'); // fell back
    expect(bad.warnings[0]).toMatch(/invalid inclusion mode 'always_on'/);
  });

  it('filters by name', async () => {
    const files = await discoverSteering(localFileSource(fixture('sample-package')));
    const filtered = filterByName(files, 'security');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.name).toBe('security');
  });

  it('throws ManifestError when a manifest references a missing file', async () => {
    const source = {
      read: async (p: string) =>
        p === 'steering.json'
          ? JSON.stringify({ name: 'x', steering: [{ name: 'a', file: 'steering/missing.md' }] })
          : null,
      listMarkdown: async () => [],
      hash: () => 'h',
    };
    await expect(discoverSteering(source)).rejects.toBeInstanceOf(ManifestError);
  });
});
