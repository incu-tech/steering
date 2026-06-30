import { describe, it, expect } from 'vitest';
import { serializeRule } from './serialize/index.ts';
import type { CanonicalRule } from './types.ts';

const base: CanonicalRule = { name: 'x', inclusion: 'always', body: '# Body' };

describe('serialize: kiro', () => {
  it('emits inclusion + fileMatchPattern (single string)', () => {
    const out = serializeRule({ ...base, inclusion: 'fileMatch', filePatterns: ['**/*.java'] }, 'kiro');
    expect(out).toContain('inclusion: fileMatch');
    expect(out).toContain('fileMatchPattern: "**/*.java"');
  });
});

describe('serialize: cursor', () => {
  it('fileMatch → globs + alwaysApply:false', () => {
    const out = serializeRule({ ...base, inclusion: 'fileMatch', filePatterns: ['**/*.java'] }, 'cursor');
    expect(out).toContain('globs: "**/*.java"');
    expect(out).toContain('alwaysApply: false');
  });
  it('manual → no frontmatter', () => {
    const out = serializeRule({ ...base, inclusion: 'manual' }, 'cursor');
    expect(out.startsWith('---')).toBe(false);
  });
});

describe('serialize: claude-code', () => {
  it('always → no frontmatter', () => {
    expect(serializeRule(base, 'claude-code').startsWith('---')).toBe(false);
  });
  it('fileMatch → paths array', () => {
    const out = serializeRule({ ...base, inclusion: 'fileMatch', filePatterns: ['a', 'b'] }, 'claude-code');
    expect(out).toContain('paths:');
    expect(out).toContain('- a');
    expect(out).toContain('- b');
  });
});

describe('serialize: determinism', () => {
  it('produces byte-identical output across calls', () => {
    const rule: CanonicalRule = {
      name: 'x',
      inclusion: 'fileMatch',
      filePatterns: ['src/**', 'test/**'],
      description: 'd',
      body: '# Body\n\ntext',
    };
    for (const fmt of ['kiro', 'cursor', 'claude-code', 'copilot'] as const) {
      expect(serializeRule(rule, fmt)).toBe(serializeRule(rule, fmt));
    }
  });
});
