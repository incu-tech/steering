import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, readdir, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { runAdd, parseAddOptions, type AddOptions } from '../src/add.ts';
import { runRemove } from '../src/remove.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/sample-package', import.meta.url));

function opts(overrides: Partial<AddOptions> = {}): AddOptions {
  return {
    list: false,
    steeringNames: [],
    all: false,
    global: false,
    yes: false,
    dryRun: false,
    agents: [],
    allAgents: false,
    allFormats: false,
    ...overrides,
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe('parseAddOptions', () => {
  it('parses flags and source', () => {
    const { source, options } = parseAddOptions([
      'org/repo',
      '-s',
      'security',
      '-s',
      'arch',
      '-g',
      '-y',
    ]);
    expect(source).toBe('org/repo');
    expect(options.steeringNames).toEqual(['security', 'arch']);
    expect(options.global).toBe(true);
    expect(options.yes).toBe(true);
  });

  it('parses --all and --dry-run', () => {
    const { options } = parseAddOptions(['org/repo', '--all', '--dry-run']);
    expect(options.all).toBe(true);
    expect(options.dryRun).toBe(true);
  });
});

describe('runAdd (local source → workspace)', () => {
  let dir: string;
  const origCwd = process.cwd();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'steering-add-'));
    await mkdir(join(dir, '.kiro'), { recursive: true }); // mark as a Kiro workspace
    process.chdir(dir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(origCwd);
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('installs all files and writes a minimal local lock', async () => {
    await runAdd(FIXTURE, opts({ all: true, yes: true }));

    const installed = await readdir(join(dir, '.kiro', 'steering'));
    expect(installed.sort()).toEqual(['java-conventions.md', 'security.md']);

    const security = await readFile(join(dir, '.kiro', 'steering', 'security.md'), 'utf-8');
    expect(security).toMatch(/Security Standards/);

    const lock = JSON.parse(await readFile(join(dir, 'steering-lock.json'), 'utf-8'));
    expect(lock.version).toBe(1);
    expect(Object.keys(lock.steering).sort()).toEqual(['java-conventions', 'security']);
    // Local lock is minimal: name + source + path only, no hash/timestamp.
    expect(lock.steering.security).toEqual({
      name: 'security',
      source: FIXTURE,
      steeringFilePath: 'steering/security.md',
    });
  });

  it('installs only the selected file with -s', async () => {
    await runAdd(FIXTURE, opts({ steeringNames: ['security'], yes: true }));
    const installed = await readdir(join(dir, '.kiro', 'steering'));
    expect(installed).toEqual(['security.md']);
  });

  it('dry-run writes nothing', async () => {
    await runAdd(FIXTURE, opts({ all: true, yes: true, dryRun: true }));
    expect(await exists(join(dir, '.kiro', 'steering'))).toBe(false);
    expect(await exists(join(dir, 'steering-lock.json'))).toBe(false);
  });
});

describe('runAdd (auto-detect target by parent dir)', () => {
  let dir: string;
  const origCwd = process.cwd();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'steering-detect-'));
    // Only the parent agent dir exists — no .cursor/rules subdir yet.
    await mkdir(join(dir, '.cursor'), { recursive: true });
    process.chdir(dir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(origCwd);
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('detects cursor from .cursor/ and converts kiro→cursor', async () => {
    await runAdd(FIXTURE, opts({ all: true, yes: true }));

    const installed = (await readdir(join(dir, '.cursor', 'rules'))).sort();
    expect(installed).toEqual(['java-conventions.mdc', 'security.mdc']);

    const lock = JSON.parse(await readFile(join(dir, 'steering-lock.json'), 'utf-8'));
    expect(lock.steering.security).toMatchObject({ sourceFormat: 'kiro', targetFormat: 'cursor' });
  });
});

describe('runAdd (multi-target)', () => {
  let dir: string;
  const origCwd = process.cwd();
  const origHome = process.env.HOME;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'steering-multi-'));
    process.chdir(dir);
    // Redirect global installs into the sandbox so a misroute can't touch ~/.
    process.env.HOME = dir;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(async () => {
    process.chdir(origCwd);
    process.env.HOME = origHome;
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('installs to two agents with --agent repeated; lock uses composite keys', async () => {
    await runAdd(FIXTURE, opts({ all: true, yes: true, agents: ['cursor', 'kiro'] }));

    expect((await readdir(join(dir, '.cursor', 'rules'))).sort()).toEqual([
      'java-conventions.mdc',
      'security.mdc',
    ]);
    expect((await readdir(join(dir, '.kiro', 'steering'))).sort()).toEqual([
      'java-conventions.md',
      'security.md',
    ]);

    const lock = JSON.parse(await readFile(join(dir, 'steering-lock.json'), 'utf-8'));
    expect(Object.keys(lock.steering).sort()).toEqual([
      'java-conventions@cursor',
      'java-conventions@kiro',
      'security@cursor',
      'security@kiro',
    ]);
    // kiro→kiro entry stays minimal (no format fields); cursor entry records them.
    expect(lock.steering['security@kiro']).toEqual({
      name: 'security',
      source: FIXTURE,
      steeringFilePath: 'steering/security.md',
    });
    expect(lock.steering['security@cursor']).toMatchObject({ targetFormat: 'cursor' });
  });

  it('auto-detects and installs to all present agents in non-TTY', async () => {
    await mkdir(join(dir, '.cursor'), { recursive: true });
    await mkdir(join(dir, '.kiro'), { recursive: true });
    await runAdd(FIXTURE, opts({ all: true, yes: true }));

    expect(await exists(join(dir, '.cursor', 'rules', 'security.mdc'))).toBe(true);
    expect(await exists(join(dir, '.kiro', 'steering', 'security.md'))).toBe(true);
  });

  it('remove <name> drops all formats; --agent narrows + re-normalizes the lock', async () => {
    await runAdd(FIXTURE, opts({ all: true, yes: true, agents: ['cursor', 'kiro'] }));

    // Remove only the cursor copy of security.
    await runRemove(['security'], { global: false, yes: true, agent: 'cursor' });
    expect(await exists(join(dir, '.cursor', 'rules', 'security.mdc'))).toBe(false);
    expect(await exists(join(dir, '.kiro', 'steering', 'security.md'))).toBe(true);
    let lock = JSON.parse(await readFile(join(dir, 'steering-lock.json'), 'utf-8'));
    // The surviving security entry re-normalizes to a bare key.
    expect(lock.steering.security).toMatchObject({ name: 'security' });
    expect(lock.steering['security@kiro']).toBeUndefined();

    // Remove java-conventions from every format at once.
    await runRemove(['java-conventions'], { global: false, yes: true });
    expect(await exists(join(dir, '.cursor', 'rules', 'java-conventions.mdc'))).toBe(false);
    expect(await exists(join(dir, '.kiro', 'steering', 'java-conventions.md'))).toBe(false);
    lock = JSON.parse(await readFile(join(dir, 'steering-lock.json'), 'utf-8'));
    expect(Object.keys(lock.steering)).toEqual(['security']);
  });
});

describe('runAdd (empty workspace, no agent detected)', () => {
  let home: string;
  let project: string;
  const origCwd = process.cwd();
  const origHome = process.env.HOME;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'steering-scope-'));
    project = join(home, 'project');
    await mkdir(project, { recursive: true });
    process.chdir(project);
    // Redirect global installs into the sandbox so a misroute can't touch ~/.
    process.env.HOME = home;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(async () => {
    process.chdir(origCwd);
    process.env.HOME = origHome;
    vi.restoreAllMocks();
    await rm(home, { recursive: true, force: true });
  });

  it('non-interactive install stays in the workspace instead of going global', async () => {
    await runAdd(FIXTURE, opts({ all: true, yes: true }));

    // Falls back to Kiro in the cwd, with a workspace lock.
    const installed = (await readdir(join(project, '.kiro', 'steering'))).sort();
    expect(installed).toEqual(['java-conventions.md', 'security.md']);
    expect(await exists(join(project, 'steering-lock.json'))).toBe(true);

    // Nothing escaped to the (sandboxed) home dir.
    expect(await exists(join(home, '.kiro'))).toBe(false);
    expect(await exists(join(home, '.steering'))).toBe(false);
  });

  it('--global still installs globally without prompting', async () => {
    await runAdd(FIXTURE, opts({ all: true, yes: true, global: true }));

    expect((await readdir(join(home, '.kiro', 'steering'))).sort()).toEqual([
      'java-conventions.md',
      'security.md',
    ]);
    expect(await exists(join(home, '.steering', 'steering-lock.json'))).toBe(true);
    expect(await exists(join(project, '.kiro'))).toBe(false);
  });
});
