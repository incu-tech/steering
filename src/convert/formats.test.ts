import { describe, it, expect } from 'vitest';
import { resolveFormatName, FORMAT_ALIASES, FORMATS } from './formats.ts';
import { AGENT_FORMATS } from './types.ts';

describe('resolveFormatName', () => {
  it('accepts every canonical id as-is', () => {
    for (const f of AGENT_FORMATS) expect(resolveFormatName(f)).toBe(f);
  });

  it('maps skills-style aliases to canonical ids', () => {
    expect(resolveFormatName('github-copilot')).toBe('copilot');
    expect(resolveFormatName('codex')).toBe('agents-md');
    expect(resolveFormatName('universal')).toBe('agents-md');
    expect(resolveFormatName('kiro-cli')).toBe('kiro');
  });

  it('returns undefined for unknown names', () => {
    expect(resolveFormatName('not-an-agent')).toBeUndefined();
    expect(resolveFormatName('')).toBeUndefined();
  });

  it('every alias targets an existing format and never shadows a canonical id', () => {
    for (const [alias, target] of Object.entries(FORMAT_ALIASES)) {
      expect(FORMATS[target]).toBeDefined();
      expect((AGENT_FORMATS as string[]).includes(alias)).toBe(false);
    }
  });
});
