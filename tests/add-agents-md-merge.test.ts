import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { runAdd, type AddOptions } from '../src/add.ts';
import { runRemove } from '../src/remove.ts';

/**
 * Regression coverage for the AGENTS.md clobbering bug: `add`/`remove` used to
 * treat the single shared file as belonging to whichever source touched it
 * last, so a second `steering add` (or a `steering remove` of either one)
 * destroyed the other source's content. `writeSourceRuleFile`/
 * `removeSourceRuleFile` (src/installer.ts) fix this by giving each source its
 * own marker block; this exercises the fix through the real `add`/`remove` CLI
 * paths end-to-end, not just the merge function in isolation.
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

async function makeLocalSource(root: string, ruleName: string, body: string): Promise<string> {
  const src = join(root, ruleName);
  await mkdir(src, { recursive: true });
  await writeFile(join(src, `${ruleName}.md`), body, 'utf-8');
  return src;
}

describe('runAdd/runRemove — AGENTS.md does not clobber across sources', () => {
  let dir: string;
  let sources: string;
  const origCwd = process.cwd();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'steering-agentsmd-'));
    sources = await mkdtemp(join(tmpdir(), 'steering-agentsmd-src-'));
    process.chdir(dir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(origCwd);
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
    await rm(sources, { recursive: true, force: true });
  });

  it('installing a second source keeps the first source in AGENTS.md', async () => {
    const a = await makeLocalSource(sources, 'rule-a', '# Rule A\nContent from source A.\n');
    const b = await makeLocalSource(sources, 'rule-b', '# Rule B\nContent from source B.\n');

    await runAdd(a, opts());
    await runAdd(b, opts());

    const content = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('Content from source A.');
    expect(content).toContain('Content from source B.');
  });

  it('re-adding the first source updates its own content without dropping the second', async () => {
    const a = await makeLocalSource(sources, 'rule-a', '# Rule A v1\n');
    const b = await makeLocalSource(sources, 'rule-b', '# Rule B\n');

    await runAdd(a, opts());
    await runAdd(b, opts());

    // Re-installing from the SAME local path is the same sourceId (a local
    // source's identity is its resolved path) — its block gets replaced in
    // place, not duplicated or left stale.
    await writeFile(join(a, 'rule-a.md'), '# Rule A v2\n', 'utf-8');
    await runAdd(a, opts());

    const content = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('# Rule A v2');
    expect(content).not.toContain('# Rule A v1');
    expect(content).toContain('# Rule B');
  });

  it('removing the only installed source deletes AGENTS.md rather than leaving an orphaned empty file', async () => {
    const a = await makeLocalSource(sources, 'rule-a', '# Rule A\n');
    await runAdd(a, opts());
    // Single-file lock entries are keyed by the fixed doc name ("agents"), not the
    // source's own rule name — see the note below on the multi-source lock gap.
    await runRemove(['agents'], { global: false, yes: true, agent: 'agents-md' });

    await expect(readFile(join(dir, 'AGENTS.md'), 'utf-8')).rejects.toThrow();
  });

  // Known, separate limitation (tracked as a follow-up, not fixed by this change):
  // the local lock keys single-file entries by (name, targetFormat) only — see
  // `lock-keys.ts`. That's correct for a MULTI-file format, where `name` is the
  // rule's own identity and re-adding it from a new source is meant to replace
  // the old lock entry. For a SINGLE-file format every source shares the same
  // fixed `name` ("agents"), so a second `add` overwrites the first source's
  // lock entry outright — `remove`/`update` can then only see whichever source
  // was installed LAST. The on-disk merge fixed here means that entry's block is
  // still the only one it ever destroys — a real, self-contained improvement
  // over unconditionally deleting the whole file — but an earlier source's block
  // is left orphaned in the file with no lock entry pointing back to it. Fixing
  // that needs `lock-keys.ts` to key single-file entries by (name, targetFormat,
  // source) instead, which is a larger, separate change.
  it('removing the (only lock-tracked) most-recently-added source strips just its own block, leaving an earlier orphaned block physically intact', async () => {
    const a = await makeLocalSource(sources, 'rule-a', '# Rule A\n');
    const b = await makeLocalSource(sources, 'rule-b', '# Rule B\n');

    await runAdd(a, opts());
    await runAdd(b, opts()); // the lock now tracks only source B ("rule-b")

    await runRemove(['agents'], { global: false, yes: true, agent: 'agents-md' });

    const content = await readFile(join(dir, 'AGENTS.md'), 'utf-8');
    expect(content).not.toContain('# Rule B'); // the lock-tracked source WAS removed correctly
    expect(content).toContain('# Rule A'); // pre-existing content was not destroyed either
  });
});
