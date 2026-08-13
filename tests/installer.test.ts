import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  sanitizeName,
  getTargetDir,
  getInstalledPath,
  writeSteeringFile,
  removeSteeringFile,
  writeSourceRuleFile,
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
});
