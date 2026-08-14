import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { runAdd, type AddOptions } from '../src/add.ts';
import { runCheck, runUpdate } from '../src/update.ts';
import { readLocalLock, writeLocalLock } from '../src/local-lock.ts';

/**
 * Regression coverage for the hashless-diff bug found in the #9 review: `check`/
 * `update` compared a single source's bare rendered content against the WHOLE
 * AGENTS.md file (every source's block plus any hand-written content), which a
 * single source's own content could never equal — `check` reported "update
 * available" forever, and the first `update` rewrote the file on every single
 * run even when nothing had actually changed.
 */

function opts(overrides: Partial<AddOptions> = {}): AddOptions {
  return {
    list: false,
    steeringNames: [],
    all: true,
    global: false,
    yes: true,
    dryRun: false,
    agents: ['agents-md'],
    allAgents: false,
    allFormats: false,
    ...overrides,
  };
}

const RULE = (body: string): string => `---\ninclusion: always\n---\n\n# Security\n\n${body}\n`;

describe('update/check — AGENTS.md hashless diff converges', () => {
  let dir: string;
  let sourceDir: string;
  const origCwd = process.cwd();
  const logs: string[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'steering-update-agentsmd-'));
    sourceDir = await mkdtemp(join(tmpdir(), 'steering-update-src-'));
    await mkdir(join(sourceDir, 'steering'), { recursive: true });
    await writeFile(join(sourceDir, 'steering/security.md'), RULE('Do the secure thing.'), 'utf-8');
    process.chdir(dir);
    logs.length = 0;
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(origCwd);
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
  });

  /** Drop `steeringFileHash` from every local-lock entry, simulating a legacy v1 (hashless) lock —
   * the state that fell into the broken whole-file-diff path this fix addresses. */
  async function simulateHashlessLock(): Promise<void> {
    const lock = await readLocalLock(dir);
    for (const entry of Object.values(lock.steering)) delete entry.steeringFileHash;
    await writeLocalLock(lock, dir);
  }

  it('reports up-to-date instead of perpetually "update available"', async () => {
    await runAdd(sourceDir, opts());
    await simulateHashlessLock();

    await runCheck(['--workspace']);

    const output = logs.join('\n');
    expect(output).toContain('Everything is up to date.');
    expect(output).not.toContain('update available');
  });

  it('a genuine upstream change is detected, applied once, and then converges (no perpetual rewrite)', async () => {
    await runAdd(sourceDir, opts());
    await simulateHashlessLock();

    await writeFile(
      join(sourceDir, 'steering/security.md'),
      RULE('Do the EVEN MORE secure thing.'),
      'utf-8'
    );

    await runUpdate(['--workspace', '--yes']);
    const afterFirstUpdate = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
    expect(afterFirstUpdate).toContain('EVEN MORE secure');
    expect(afterFirstUpdate.match(/steering:begin/g)).toHaveLength(1); // no duplicate block

    // Nothing changed upstream since — a second update must be a true no-op,
    // not another rewrite (which the old whole-file comparison always was).
    await runUpdate(['--workspace', '--yes']);
    const afterSecondUpdate = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
    expect(afterSecondUpdate).toBe(afterFirstUpdate);
  });
});
