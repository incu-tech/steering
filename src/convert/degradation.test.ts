import { describe, it, expect } from 'vitest';
import { degradeForTarget } from './degradation.ts';
import type { CanonicalRule } from './types.ts';

describe('degradeForTarget', () => {
  it('manual → claude-code degrades to always with warning', () => {
    const rule: CanonicalRule = { name: 'incident', inclusion: 'manual', body: 'x' };
    const { rule: r, warnings } = degradeForTarget(rule, 'claude-code');
    expect(r.inclusion).toBe('always');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ type: 'unsupported_mode', appliedFallback: 'always' });
  });

  it('auto → copilot degrades to always with warning', () => {
    const { warnings } = degradeForTarget({ name: 'x', inclusion: 'auto', description: 'd', body: 'x' }, 'copilot');
    expect(warnings[0]!.message).toMatch(/auto.*not supported/i);
  });

  it('truncates multiple patterns for copilot', () => {
    const rule: CanonicalRule = { name: 'api', inclusion: 'fileMatch', filePatterns: ['a', 'b', 'c'], body: 'x' };
    const { rule: r, warnings } = degradeForTarget(rule, 'copilot');
    expect(r.filePatterns).toEqual(['a']);
    expect(warnings[0]).toMatchObject({ type: 'patterns_truncated', appliedFallback: 'a' });
  });

  it('fileMatch → agents-md keeps content, notes pattern as comment', () => {
    const rule: CanonicalRule = { name: 'x', inclusion: 'fileMatch', filePatterns: ['**/*.java'], body: 'rules' };
    const { rule: r, warnings } = degradeForTarget(rule, 'agents-md');
    expect(r.inclusion).toBe('always');
    expect(r.body).toContain('**/*.java');
    expect(warnings[0]!.type).toBe('degraded_inclusion');
  });

  it('passes through representable modes without warnings', () => {
    const { warnings } = degradeForTarget({ name: 'x', inclusion: 'fileMatch', filePatterns: ['a'], body: 'x' }, 'cursor');
    expect(warnings).toEqual([]);
  });
});
