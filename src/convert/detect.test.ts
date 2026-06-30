import { describe, it, expect } from 'vitest';
import { detectFormat } from './detect.ts';

describe('detectFormat', () => {
  it('by directory marker', () => {
    expect(detectFormat('.kiro/steering/security.md').format).toBe('kiro');
    expect(detectFormat('.cursor/rules/api.mdc').format).toBe('cursor');
    expect(detectFormat('.github/instructions/x.instructions.md').format).toBe('copilot');
  });
  it('by filename', () => {
    expect(detectFormat('AGENTS.md').format).toBe('agents-md');
  });
  it('by extension', () => {
    expect(detectFormat('whatever/api.mdc').format).toBe('cursor');
    expect(detectFormat('x.instructions.md').format).toBe('copilot');
  });
  it('by frontmatter shape', () => {
    expect(detectFormat('rule.md', '---\ninclusion: always\n---\n').format).toBe('kiro');
    expect(detectFormat('rule.md', '---\napplyTo: "**"\n---\n').format).toBe('copilot');
    expect(detectFormat('rule.md', '---\nalwaysApply: true\n---\n').format).toBe('cursor');
    const paths = detectFormat('rule.md', '---\npaths:\n  - a\n---\n');
    expect(paths.format).toBe('claude-code');
    expect(paths.alternatives).toContain('opencode');
  });
  it('returns null when undetectable', () => {
    expect(detectFormat('rule.md', '# just markdown').format).toBeNull();
  });
});
