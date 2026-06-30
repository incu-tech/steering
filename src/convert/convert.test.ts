import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, readdir, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseContent } from './parse/index.ts';
import { serializeRule } from './serialize/index.ts';
import { convertRuleToFormat, convert } from './convert.ts';
import type { CanonicalRule } from './types.ts';

const canon = (content: string, fmt: Parameters<typeof parseContent>[1], name: string): CanonicalRule =>
  parseContent(content, fmt, name)[0]!;

describe('acceptance', () => {
  it('Test 1 — round-trip kiro→claude-code→kiro (canonical equality)', () => {
    const kiro = '---\ninclusion: always\n---\n# Security\n\nrules here';
    const r1 = canon(kiro, 'kiro', 'security');
    const claude = convertRuleToFormat(r1, 'claude-code').content;
    const r2 = canon(claude, 'claude-code', 'security');
    const kiro2 = convertRuleToFormat(r2, 'kiro').content;
    const r3 = canon(kiro2, 'kiro', 'security');
    expect({ inclusion: r3.inclusion, body: r3.body.trim() }).toEqual({
      inclusion: 'always',
      body: r1.body.trim(),
    });
  });

  it('Test 2 — fileMatch kiro→cursor preserves globs + alwaysApply:false', () => {
    const r = canon('---\ninclusion: fileMatch\nfileMatchPattern: "**/*.java"\n---\nx', 'kiro', 'java');
    const out = serializeRule(r, 'cursor');
    expect(out).toContain('globs: "**/*.java"');
    expect(out).toContain('alwaysApply: false');
  });

  it('Test 3 — manual→claude-code degrades with warning, no throw, no paths', () => {
    const r = canon('---\ninclusion: manual\n---\nx', 'kiro', 'incident');
    const { content, warnings } = convertRuleToFormat(r, 'claude-code');
    expect(content).not.toContain('paths');
    expect(warnings.some((w) => w.type === 'unsupported_mode')).toBe(true);
  });

  it('Test 4 — multiple paths→copilot uses first + warns on dropped', () => {
    const r = canon('---\npaths:\n  - "src/api/**/*.ts"\n  - "src/api/**/*.test.ts"\n---\nx', 'claude-code', 'api');
    const { content, warnings } = convertRuleToFormat(r, 'copilot');
    expect(content).toContain('applyTo: src/api/**/*.ts');
    expect(content).not.toContain('test.ts');
    expect(warnings.some((w) => w.type === 'patterns_truncated')).toBe(true);
  });

  it('Test 5 — AGENTS.md→kiro splits into multiple always files', () => {
    const rules = parseContent('## Security\n\nsec\n\n## Style\n\nstyle', 'agents-md', 'agents');
    expect(rules.map((r) => r.name)).toEqual(['security', 'style']);
    for (const r of rules) {
      expect(serializeRule(r, 'kiro')).toContain('inclusion: always');
    }
  });

  it('Test 6 — auto-detects --from kiro from path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conv-'));
    try {
      // No --from given: format is auto-detected from the frontmatter signal.
      const file = join(dir, 'security.md');
      await writeFile(file, '---\ninclusion: always\n---\n# x', 'utf-8');
      const results = await convert({ source: file, targetFormat: 'cursor', outputDir: join(dir, 'out'), dryRun: true });
      expect(results[0]!.targetFormat).toBe('cursor');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('convert (IO)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conv-io-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes converted file to the output dir', async () => {
    const file = join(dir, 'security.md');
    await writeFile(file, '---\ninclusion: fileMatch\nfileMatchPattern: "**/*.java"\n---\n# Sec', 'utf-8');
    const out = join(dir, 'out');
    const results = await convert({ source: file, targetFormat: 'cursor', outputDir: out, from: 'kiro' });
    expect(results).toHaveLength(1);
    const written = await readFile(results[0]!.outputPath, 'utf-8');
    expect(written).toContain('globs: "**/*.java"');
    expect(results[0]!.outputPath.endsWith('security.mdc')).toBe(true);
  });

  it('Test 7 — dry-run writes nothing', async () => {
    const file = join(dir, 'security.md');
    await writeFile(file, '---\ninclusion: always\n---\n# Sec', 'utf-8');
    const out = join(dir, 'out');
    const results = await convert({ source: file, targetFormat: 'claude-code', outputDir: out, from: 'kiro', dryRun: true });
    await expect(access(results[0]!.outputPath)).rejects.toBeTruthy();
  });

  it('AGENTS.md source splits into multiple files for a multi-file target', async () => {
    const file = join(dir, 'AGENTS.md');
    await writeFile(file, '## Security\n\nsec\n\n## Style\n\nstyle', 'utf-8');
    const out = join(dir, 'out');
    await convert({ source: file, targetFormat: 'kiro', outputDir: out });
    const files = (await readdir(out)).sort();
    expect(files).toEqual(['security.md', 'style.md']);
  });
});
