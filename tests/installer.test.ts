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
