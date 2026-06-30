import { describe, it, expect } from 'vitest';
import { parseContent } from './parse/index.ts';

describe('parse: kiro', () => {
  it('maps inclusion + fileMatchPattern', () => {
    const [r] = parseContent(
      '---\ninclusion: fileMatch\nfileMatchPattern: "**/*.java"\n---\n# Body',
      'kiro',
      'java'
    );
    expect(r).toMatchObject({ name: 'java', inclusion: 'fileMatch', filePatterns: ['**/*.java'] });
    expect(r!.body.trim()).toBe('# Body');
  });

  it('defaults invalid inclusion to always', () => {
    const [r] = parseContent('---\ninclusion: always_on\n---\nx', 'kiro', 'x');
    expect(r!.inclusion).toBe('always');
  });

  it('carries description for auto', () => {
    const [r] = parseContent('---\ninclusion: auto\ndescription: "use for X"\n---\nx', 'kiro', 'x');
    expect(r).toMatchObject({ inclusion: 'auto', description: 'use for X' });
  });
});

describe('parse: claude-code / opencode (paths)', () => {
  it('no paths → always', () => {
    expect(parseContent('# x', 'claude-code', 'x')[0]).toMatchObject({ inclusion: 'always' });
  });
  it('paths → fileMatch', () => {
    const [r] = parseContent('---\npaths:\n  - "src/**/*.ts"\n---\nx', 'opencode', 'x');
    expect(r).toMatchObject({ inclusion: 'fileMatch', filePatterns: ['src/**/*.ts'] });
  });
});

describe('parse: cursor / windsurf (4 modes)', () => {
  it('alwaysApply true → always (wins over globs)', () => {
    const [r] = parseContent('---\nalwaysApply: true\nglobs: "**/*.ts"\n---\nx', 'cursor', 'x');
    expect(r!.inclusion).toBe('always');
  });
  it('globs + alwaysApply false → fileMatch', () => {
    const [r] = parseContent('---\nalwaysApply: false\nglobs: "src/**"\n---\nx', 'cursor', 'x');
    expect(r).toMatchObject({ inclusion: 'fileMatch', filePatterns: ['src/**'] });
  });
  it('description only → auto', () => {
    const [r] = parseContent('---\nalwaysApply: false\ndescription: "d"\n---\nx', 'windsurf', 'x');
    expect(r).toMatchObject({ inclusion: 'auto', description: 'd' });
  });
  it('nothing → manual', () => {
    expect(parseContent('x', 'cursor', 'x')[0]).toMatchObject({ inclusion: 'manual' });
  });
  it('empty globs string → always (§8 edge)', () => {
    const [r] = parseContent('---\nglobs: ""\n---\nx', 'cursor', 'x');
    expect(r!.inclusion).toBe('always');
  });
});

describe('parse: copilot', () => {
  it('applyTo → fileMatch; comma-separated split', () => {
    const [r] = parseContent('---\napplyTo: "**/*.ts, **/*.tsx"\n---\nx', 'copilot', 'x');
    expect(r).toMatchObject({ inclusion: 'fileMatch', filePatterns: ['**/*.ts', '**/*.tsx'] });
  });
});

describe('parse: agents-md (H2 split)', () => {
  it('no H2 → single always rule', () => {
    const rules = parseContent('# Title\n\nbody', 'agents-md', 'agents');
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ name: 'agents', inclusion: 'always' });
  });
  it('splits by H2, slugs names, keeps preamble', () => {
    const rules = parseContent('intro\n\n## Security\n\nsec\n\n## API Rules\n\napi', 'agents-md', 'agents');
    expect(rules.map((r) => r.name)).toEqual(['agents', 'security', 'api-rules']);
    expect(rules.every((r) => r.inclusion === 'always')).toBe(true);
    expect(rules[1]!.body).toContain('## Security');
  });
});

describe('parse: cline', () => {
  it('always, no frontmatter', () => {
    expect(parseContent('rules', 'cline', 'x')[0]).toMatchObject({ inclusion: 'always', body: 'rules' });
  });
});
