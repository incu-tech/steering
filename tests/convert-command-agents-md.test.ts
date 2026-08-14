import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { runConvert } from '../src/convert-command.ts';

/**
 * Regression coverage for the `steering convert` gap found in the #9 review:
 * `add`/`update`/`remove` all merge into AGENTS.md via its own marker block per
 * source, but `convert` (a separate, lock-free path) still did a raw `writeFile`
 * straight over the same shared file — converting a second source destroyed the
 * first source's block (and any hand-written content) the moment anyone ran
 * `steering convert --to agents-md` against a file others had already installed.
 */

const RULE = (body: string): string => `---\ninclusion: always\n---\n\n# Rule\n\n${body}\n`;

describe('runConvert — AGENTS.md merges instead of overwriting', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'steering-convert-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(workDir, { recursive: true, force: true });
  });

  it('converting a second source keeps the first source in the shared AGENTS.md', async () => {
    const srcA = join(workDir, 'a.md');
    const srcB = join(workDir, 'b.md');
    await writeFile(srcA, RULE('Content from A.'), 'utf-8');
    await writeFile(srcB, RULE('Content from B.'), 'utf-8');
    const target = join(workDir, 'target');

    await runConvert([srcA, '--to', 'agents-md', '--out', target]);
    await runConvert([srcB, '--to', 'agents-md', '--out', target]);

    const content = await readFile(join(target, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('Content from A.');
    expect(content).toContain('Content from B.');
  });

  it('re-converting the same source replaces only its own block', async () => {
    const src = join(workDir, 'a.md');
    await writeFile(src, RULE('v1'), 'utf-8');
    const target = join(workDir, 'target');

    await runConvert([src, '--to', 'agents-md', '--out', target]);
    await writeFile(src, RULE('v2'), 'utf-8');
    await runConvert([src, '--to', 'agents-md', '--out', target]);

    const content = await readFile(join(target, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('v2');
    expect(content).not.toContain('v1');
    expect(content.match(/steering:begin/g)).toHaveLength(1); // no duplicate block
  });

  it('does not need --force for the single-file target (nothing destructive to confirm)', async () => {
    const srcA = join(workDir, 'a.md');
    const srcB = join(workDir, 'b.md');
    await writeFile(srcA, RULE('Content from A.'), 'utf-8');
    await writeFile(srcB, RULE('Content from B.'), 'utf-8');
    const target = join(workDir, 'target');

    await runConvert([srcA, '--to', 'agents-md', '--out', target]);
    // No --force here — must not skip B silently the way the old "already
    // exists, overwrite?" non-interactive path would have.
    await runConvert([srcB, '--to', 'agents-md', '--out', target]);

    const content = await readFile(join(target, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('Content from A.');
    expect(content).toContain('Content from B.');
  });
});
