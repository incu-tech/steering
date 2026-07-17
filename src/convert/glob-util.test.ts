import { describe, it, expect } from 'vitest';
import { toPatternArray } from './glob-util.ts';

describe('toPatternArray', () => {
  it('returns [] for undefined/null', () => {
    expect(toPatternArray(undefined)).toEqual([]);
    expect(toPatternArray(null)).toEqual([]);
  });

  it('wraps a single pattern', () => {
    expect(toPatternArray('**/*.java')).toEqual(['**/*.java']);
  });

  it('splits comma-separated patterns and trims', () => {
    expect(toPatternArray('src/**, tests/** ')).toEqual(['src/**', 'tests/**']);
  });

  it('keeps brace expansions intact', () => {
    expect(toPatternArray('**/*.{ts,tsx}')).toEqual(['**/*.{ts,tsx}']);
    expect(toPatternArray('**/*.{test,spec}.*, docs/**')).toEqual(['**/*.{test,spec}.*', 'docs/**']);
  });

  it('handles nested braces', () => {
    expect(toPatternArray('**/*.{test,spec}.{ts,js}')).toEqual(['**/*.{test,spec}.{ts,js}']);
  });

  it('ignores an unmatched closing brace', () => {
    expect(toPatternArray('a}b, c')).toEqual(['a}b', 'c']);
  });

  it('normalizes arrays of non-strings', () => {
    expect(toPatternArray(['**/*.ts', 42])).toEqual(['**/*.ts', '42']);
  });
});
