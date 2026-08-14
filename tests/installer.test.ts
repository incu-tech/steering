import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  sanitizeName,
  getTargetDir,
  getInstalledPath,
  writeSteeringFile,
  removeSteeringFile,
  writeSourceRuleFile,
  writeMergedFile,
  removeSourceRuleFile,
  isInstalled,
  listInstalledNames,
} from '../src/installer.ts';
import { WORKSPACE_STEERING_DIR } from '../src/constants.ts';
import type { SteeringFile } from '../src/types.ts';

function makeFile(name: string, content = '# x'): SteeringFile {
  return {
    name,
    description: '',
    repoPath: `steering/${name}.md`,
    content,
    sourceFormat: 'kiro',
    rules: [{ name, inclusion: 'always', body: content }],
    inclusion: 'always',
    hash: 'h',
    warnings: [],
  };
}

describe('sanitizeName', () => {
  it('strips extension, path separators and traversal', () => {
    expect(sanitizeName('security.md')).toBe('security');
    expect(sanitizeName('../../evil')).toBe('evil');
    expect(sanitizeName('a/b/c')).toBe('a-b-c');
    expect(sanitizeName('Java Conventions')).toBe('java-conventions');
  });
});

describe('installer (workspace scope)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'steering-test-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves the workspace target dir', () => {
    expect(getTargetDir(false, dir)).toBe(join(dir, WORKSPACE_STEERING_DIR));
  });

  it('writes, detects, lists and removes a steering file', async () => {
    expect(await isInstalled('security', false, dir)).toBe(false);

    const written = await writeSteeringFile(makeFile('security', '# Security'), false, dir);
    expect(written).toBe(getInstalledPath('security', false, dir));
    expect(await readFile(written, 'utf-8')).toBe('# Security');
    expect(await isInstalled('security', false, dir)).toBe(true);

    expect(await listInstalledNames(false, dir)).toEqual(['security']);

    expect(await removeSteeringFile('security', false, dir)).toBe(true);
    expect(await isInstalled('security', false, dir)).toBe(false);
    expect(await removeSteeringFile('security', false, dir)).toBe(false);
  });
});

describe('writeSourceRuleFile / removeSourceRuleFile (single-file formats)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'steering-test-single-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('two sources installing to agents-md do not clobber each other', async () => {
    await writeSourceRuleFile('agents-md', 'agents', '# Rule A', 'owner/a', false, dir);
    await writeSourceRuleFile('agents-md', 'agents', '# Rule B', 'owner/b', false, dir);

    const content = await readFile(getInstalledPath('agents', false, dir, 'agents-md'), 'utf-8');
    expect(content).toContain('# Rule A');
    expect(content).toContain('# Rule B');
  });

  it('re-installing the same source replaces only its own content', async () => {
    await writeSourceRuleFile('agents-md', 'agents', '# Rule A v1', 'owner/a', false, dir);
    await writeSourceRuleFile('agents-md', 'agents', '# Rule B', 'owner/b', false, dir);
    await writeSourceRuleFile('agents-md', 'agents', '# Rule A v2', 'owner/a', false, dir);

    const content = await readFile(getInstalledPath('agents', false, dir, 'agents-md'), 'utf-8');
    expect(content).toContain('# Rule A v2');
    expect(content).not.toContain('Rule A v1');
    expect(content).toContain('# Rule B');
  });

  it('removing one source keeps the other source installed', async () => {
    await writeSourceRuleFile('agents-md', 'agents', '# Rule A', 'owner/a', false, dir);
    await writeSourceRuleFile('agents-md', 'agents', '# Rule B', 'owner/b', false, dir);

    const removed = await removeSourceRuleFile('agents', 'owner/a', false, dir, 'agents-md');
    expect(removed).toBe(true);

    const path = getInstalledPath('agents', false, dir, 'agents-md');
    expect(await isInstalled('agents', false, dir, 'agents-md')).toBe(true);
    const content = await readFile(path, 'utf-8');
    expect(content).not.toContain('Rule A');
    expect(content).toContain('# Rule B');
  });

  it('removing the last source deletes the shared file', async () => {
    await writeSourceRuleFile('agents-md', 'agents', '# Rule A', 'owner/a', false, dir);
    await removeSourceRuleFile('agents', 'owner/a', false, dir, 'agents-md');
    expect(await isInstalled('agents', false, dir, 'agents-md')).toBe(false);
  });

  it('a multi-file format behaves exactly like writeRuleFile/removeSteeringFile', async () => {
    await writeSourceRuleFile('kiro', 'security', '# Security', 'owner/a', false, dir);
    expect(await isInstalled('security', false, dir, 'kiro')).toBe(true);
    expect(await removeSourceRuleFile('security', 'owner/a', false, dir, 'kiro')).toBe(true);
    expect(await isInstalled('security', false, dir, 'kiro')).toBe(false);
  });

  it('flags legacyContentDetected the first time a source merges into a pre-existing marker-less file, never again after', async () => {
    const target = getInstalledPath('agents', false, dir, 'agents-md');
    await mkdir(dir, { recursive: true });
    await writeFile(target, '# Hand-written notes, no steering markers\n', 'utf-8');

    const first = await writeSourceRuleFile(
      'agents-md',
      'agents',
      '# Rule A',
      'owner/a',
      false,
      dir
    );
    expect(first.legacyContentDetected).toBe(true);

    const second = await writeSourceRuleFile(
      'agents-md',
      'agents',
      '# Rule A v2',
      'owner/a',
      false,
      dir
    );
    expect(second.legacyContentDetected).toBe(false); // markers exist now — no longer "legacy"
  });

  it('does not flag legacyContentDetected for a brand-new file or one that already has markers', async () => {
    const fresh = await writeSourceRuleFile(
      'agents-md',
      'agents',
      '# Rule A',
      'owner/a',
      false,
      dir
    );
    expect(fresh.legacyContentDetected).toBe(false);

    const secondSource = await writeSourceRuleFile(
      'agents-md',
      'agents',
      '# Rule B',
      'owner/b',
      false,
      dir
    );
    expect(secondSource.legacyContentDetected).toBe(false);
  });

  it('removeSourceRuleFile returns false (and does not rewrite the file) when the source has no block yet', async () => {
    const target = getInstalledPath('agents', false, dir, 'agents-md');
    await mkdir(dir, { recursive: true });
    const legacyContent = '# Legacy content, no markers for owner/a\n';
    await writeFile(target, legacyContent, 'utf-8');

    const removed = await removeSourceRuleFile('agents', 'owner/a', false, dir, 'agents-md');
    expect(removed).toBe(false);
    expect(await readFile(target, 'utf-8')).toBe(legacyContent); // untouched, not "successfully" rewritten
  });

  it('propagates a non-ENOENT read error instead of treating it as an empty file', async () => {
    // A directory in place of the expected file triggers EISDIR on read — a real,
    // non-ENOENT error a caller must not silently swallow as "nothing here yet".
    const target = getInstalledPath('agents', false, dir, 'agents-md');
    await mkdir(target, { recursive: true });

    await expect(
      writeSourceRuleFile('agents-md', 'agents', '# Rule A', 'owner/a', false, dir)
    ).rejects.toThrow();
  });

  it('writeMergedFile (the primitive `convert` also uses) merges at an arbitrary explicit path', async () => {
    const target = join(dir, 'custom', 'AGENTS.md');
    await writeMergedFile(target, '# Rule A', 'owner/a');
    await writeMergedFile(target, '# Rule B', 'owner/b');
    const content = await readFile(target, 'utf-8');
    expect(content).toContain('# Rule A');
    expect(content).toContain('# Rule B');
  });
});
