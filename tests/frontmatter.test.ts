import { describe, it, expect } from 'vitest';
import { parseFrontmatter, validateKiroFrontmatter } from '../src/frontmatter.ts';

describe('parseFrontmatter', () => {
  it('parses YAML frontmatter and body', () => {
    const { data, content } = parseFrontmatter('---\ninclusion: always\n---\n# Body\n');
    expect(data.inclusion).toBe('always');
    expect(content).toBe('# Body\n');
  });

  it('returns empty data when no frontmatter', () => {
    const { data, content } = parseFrontmatter('# Just content');
    expect(data).toEqual({});
    expect(content).toBe('# Just content');
  });

  it('does not throw on malformed YAML', () => {
    const { data } = parseFrontmatter('---\n: : :\n---\nbody');
    expect(data).toEqual({});
  });
});

describe('validateKiroFrontmatter', () => {
  it('accepts a valid inclusion mode with no warnings', () => {
    const { inclusion, warnings } = validateKiroFrontmatter('---\ninclusion: manual\n---\n', 'a.md');
    expect(inclusion).toBe('manual');
    expect(warnings).toEqual([]);
  });

  it('defaults to "always" when no frontmatter is present', () => {
    const { inclusion, warnings } = validateKiroFrontmatter('# No frontmatter', 'a.md');
    expect(inclusion).toBe('always');
    expect(warnings).toEqual([]);
  });

  it('warns on an invalid inclusion mode but falls back to always', () => {
    const { inclusion, warnings } = validateKiroFrontmatter(
      '---\ninclusion: always_on\n---\n',
      'security.md'
    );
    expect(inclusion).toBe('always');
    expect(warnings[0]).toMatch(/invalid inclusion mode 'always_on'/);
  });

  it('warns when fileMatch is missing fileMatchPattern', () => {
    const { warnings } = validateKiroFrontmatter('---\ninclusion: fileMatch\n---\n', 'java.md');
    expect(warnings.some((w) => /fileMatchPattern/.test(w))).toBe(true);
  });

  it('accepts fileMatch with a pattern', () => {
    const { inclusion, warnings } = validateKiroFrontmatter(
      '---\ninclusion: fileMatch\nfileMatchPattern: "**/*.java"\n---\n',
      'java.md'
    );
    expect(inclusion).toBe('fileMatch');
    expect(warnings).toEqual([]);
  });
});
