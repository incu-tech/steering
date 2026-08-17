import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { runConvert } from '../src/convert-command.ts';
import { runAdd, type AddOptions } from '../src/add.ts';

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

  /**
   * The block id must be the source the USER named, not each expanded input
   * file: `add` keys a local source's block by its resolved directory, so
   * keying by file produced a second, identical block for a source already
   * installed — duplicated rules in a block no lock entry tracks, which no
   * `steering remove` could ever clean up.
   */
  it('converting a source already installed via add replaces its block instead of duplicating it', async () => {
    const src = join(workDir, 'rules');
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'sec.md'), RULE('Be safe.'), 'utf-8');

    const origCwd = process.cwd();
    process.chdir(workDir);
    try {
      await runAdd(src, {
        list: false,
        steeringNames: [],
        all: true,
        global: false,
        yes: true,
        dryRun: false,
        agents: ['agents-md'],
        allAgents: false,
        allFormats: false,
      } as AddOptions);
      await runConvert([src, '--to', 'agents-md']);

      const content = await readFile(join(workDir, 'AGENTS.md'), 'utf-8');
      expect(content.match(/steering:begin/g)).toHaveLength(1);
      expect(content.match(/Be safe\./g)).toHaveLength(1);
    } finally {
      process.chdir(origCwd);
    }
  });

  /**
   * Every input file resolves to the same fixed AGENTS.md and now shares one
   * block id, so the run has to aggregate them into a single document — writing
   * per file would have each one replace the previous one's block, leaving only
   * the last. This is what `planInstall` already does on the `add` side.
   */
  it('aggregates every rule file in a directory source into one block', async () => {
    const src = join(workDir, 'rules');
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'a.md'), RULE('Rule A body.'), 'utf-8');
    await writeFile(join(src, 'b.md'), RULE('Rule B body.'), 'utf-8');
    const target = join(workDir, 'target');

    await runConvert([src, '--to', 'agents-md', '--out', target]);

    const content = await readFile(join(target, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('Rule A body.');
    expect(content).toContain('Rule B body.');
    expect(content.match(/steering:begin/g)).toHaveLength(1);
  });

  it('re-converting a directory source is a no-op on disk', async () => {
    const src = join(workDir, 'rules');
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'a.md'), RULE('Rule A body.'), 'utf-8');
    await writeFile(join(src, 'b.md'), RULE('Rule B body.'), 'utf-8');
    const target = join(workDir, 'target');

    await runConvert([src, '--to', 'agents-md', '--out', target]);
    const first = await readFile(join(target, 'AGENTS.md'), 'utf-8');
    await runConvert([src, '--to', 'agents-md', '--out', target]);
    const second = await readFile(join(target, 'AGENTS.md'), 'utf-8');

    expect(second).toBe(first);
  });
});
