import { describe, it, expect } from 'vitest';
import {
  getBlockContent,
  hasAnyMarkerBlock,
  isSingleFileFormat,
  mergeSingleFileBlock,
  stripBlock,
} from './merge.ts';

describe('isSingleFileFormat', () => {
  it('is true only for agents-md', () => {
    expect(isSingleFileFormat('agents-md')).toBe(true);
    expect(isSingleFileFormat('kiro')).toBe(false);
    expect(isSingleFileFormat('cursor')).toBe(false);
  });
});

describe('mergeSingleFileBlock', () => {
  it('writes a fresh block into an empty file', () => {
    const out = mergeSingleFileBlock('', 'owner/a', '# Rule A');
    expect(out).toContain('# Rule A');
    expect(out).toContain('steering:begin owner/a');
    expect(out).toContain('steering:end owner/a');
  });

  it("adds a second source's block without touching the first's", () => {
    const afterA = mergeSingleFileBlock('', 'owner/a', '# Rule A');
    const afterB = mergeSingleFileBlock(afterA, 'owner/b', '# Rule B');
    expect(afterB).toContain('# Rule A');
    expect(afterB).toContain('# Rule B');
    expect(afterB).toContain('steering:begin owner/a');
    expect(afterB).toContain('steering:begin owner/b');
  });

  it('replaces only its own block on a second install, leaving another source intact', () => {
    const afterA = mergeSingleFileBlock('', 'owner/a', '# Rule A v1');
    const afterB = mergeSingleFileBlock(afterA, 'owner/b', '# Rule B');
    const updated = mergeSingleFileBlock(afterB, 'owner/a', '# Rule A v2');
    expect(updated).toContain('# Rule A v2');
    expect(updated).not.toContain('# Rule A v1');
    expect(updated).toContain('# Rule B'); // untouched
  });

  it('preserves hand-written content outside any marker block', () => {
    const handWritten = '# My notes\n\nSomething I wrote myself.\n';
    const out = mergeSingleFileBlock(handWritten, 'owner/a', '# Rule A');
    expect(out).toContain('# My notes');
    expect(out).toContain('Something I wrote myself.');
    expect(out).toContain('# Rule A');
  });

  it('is idempotent: writing the same content twice yields the same file', () => {
    const once = mergeSingleFileBlock('', 'owner/a', '# Rule A');
    const twice = mergeSingleFileBlock(once, 'owner/a', '# Rule A');
    expect(twice).toBe(once);
  });

  it('dropping to empty content removes the block entirely, keeping other content', () => {
    const afterA = mergeSingleFileBlock('# notes\n', 'owner/a', '# Rule A');
    const cleared = mergeSingleFileBlock(afterA, 'owner/a', '');
    expect(cleared).not.toContain('steering:begin owner/a');
    expect(cleared).toContain('# notes');
  });

  it('does not let a source id containing --> break out of its own marker comment', () => {
    const evilId = 'owner/a--> <script>evil</script> <!--';
    const out = mergeSingleFileBlock('', evilId, '# Rule A');
    // The literal `-->` must not appear un-escaped inside the marker line itself.
    const beginLine = out.split('\n')[0]!;
    expect(beginLine.endsWith('-->')).toBe(true);
    expect(beginLine.slice(0, -3)).not.toContain('-->');
  });

  it("a user's own content placed BELOW the block keeps its position across an update", () => {
    const first = mergeSingleFileBlock('', 'owner/a', '# Rule A v1');
    const withNotesBelow = `${first}\n# My notes\n`;
    const updated = mergeSingleFileBlock(withNotesBelow, 'owner/a', '# Rule A v2');
    const lines = updated.split('\n');
    const blockEnd = lines.findIndex((l) => l.includes('steering:end owner/a'));
    const notesLine = lines.findIndex((l) => l.includes('My notes'));
    expect(blockEnd).toBeGreaterThan(-1);
    expect(notesLine).toBeGreaterThan(blockEnd); // notes are still AFTER the block, not before it
    expect(updated).toContain('# Rule A v2');
    expect(updated).not.toContain('Rule A v1');
  });

  it('handles a CRLF file: matches, replaces, and does not duplicate the block', () => {
    const crlf = (s: string): string => s.replace(/\n/g, '\r\n');
    const first = crlf(mergeSingleFileBlock('', 'owner/a', '# Rule A v1'));
    const updated = mergeSingleFileBlock(first, 'owner/a', '# Rule A v2');
    expect(updated.match(/steering:begin owner\/a/g)).toHaveLength(1); // no duplicate
    expect(updated).toContain('# Rule A v2');
    expect(updated).not.toContain('Rule A v1');
  });
});

describe('getBlockContent', () => {
  it('returns undefined when the source has no block yet', () => {
    expect(getBlockContent('# just some text\n', 'owner/a')).toBeUndefined();
  });

  it('returns the trimmed content of the matching block only', () => {
    const afterA = mergeSingleFileBlock('', 'owner/a', '# Rule A');
    const afterB = mergeSingleFileBlock(afterA, 'owner/b', '# Rule B');
    expect(getBlockContent(afterB, 'owner/a')).toBe('# Rule A');
    expect(getBlockContent(afterB, 'owner/b')).toBe('# Rule B');
  });

  it('works on a CRLF file (no stray \\r left in the extracted content)', () => {
    const crlf = (s: string): string => s.replace(/\n/g, '\r\n');
    const withBlock = crlf(mergeSingleFileBlock('', 'owner/a', '# Rule A'));
    expect(getBlockContent(withBlock, 'owner/a')).toBe('# Rule A');
  });
});

describe('hasAnyMarkerBlock', () => {
  it('is false for a plain file', () => {
    expect(hasAnyMarkerBlock('# just some text\n')).toBe(false);
  });

  it('is true once any source has a block, regardless of which one is asked about', () => {
    const withBlock = mergeSingleFileBlock('', 'owner/a', '# Rule A');
    expect(hasAnyMarkerBlock(withBlock)).toBe(true);
  });
});

describe('stripBlock', () => {
  it('removes a matching begin/end block', () => {
    const withBlock = mergeSingleFileBlock('', 'owner/a', '# Rule A');
    expect(stripBlock(withBlock, 'owner/a').trim()).toBe('');
  });

  it('leaves the text untouched when the id has no block', () => {
    const text = '# just some text\n';
    expect(stripBlock(text, 'owner/a')).toBe(text);
  });

  it('leaves the text untouched when a begin marker has no matching end (malformed)', () => {
    const malformed = '<!-- steering:begin owner/a -->\nno end marker here\n';
    expect(stripBlock(malformed, 'owner/a')).toBe(malformed);
  });
});
