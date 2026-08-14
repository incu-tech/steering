import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseRemoveOptions, pickerChoices, type InstalledEntry } from '../src/remove.ts';

describe('parseRemoveOptions — --source', () => {
  it('parses a valid --source value', () => {
    const { options } = parseRemoveOptions(['security', '--source', 'owner/repo-a']);
    expect(options.source).toBe('owner/repo-a');
  });

  it('rejects a missing --source value (end of args)', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    expect(() => parseRemoveOptions(['security', '--source'])).toThrow();
    exitSpy.mockRestore();
  });

  it('rejects --source swallowing the next flag (e.g. -g)', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    expect(() => parseRemoveOptions(['security', '--source', '-g'])).toThrow();
    exitSpy.mockRestore();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function entry(
  name: string,
  source: string,
  targetFormat?: InstalledEntry['targetFormat']
): InstalledEntry {
  return { name, source, targetFormat };
}

describe('pickerChoices', () => {
  it('one name, one source, one format → a single plain choice', () => {
    const choices = pickerChoices([entry('security', 'owner/repo-a', 'kiro')]);
    expect(choices).toEqual([{ value: 'security', label: 'security' }]);
  });

  it('same name and same source installed to several formats → still ONE plain choice (no duplication)', () => {
    const choices = pickerChoices([
      entry('security', 'owner/repo-a', 'kiro'),
      entry('security', 'owner/repo-a', 'cursor'),
    ]);
    expect(choices).toEqual([{ value: 'security', label: 'security' }]);
  });

  it('same name from two DIFFERENT sources → one choice per source', () => {
    const choices = pickerChoices([
      entry('agents', 'owner/repo-a', 'agents-md'),
      entry('agents', 'owner/repo-b', 'agents-md'),
    ]);
    expect(choices.map((c) => c.value).sort()).toEqual([
      `agents${String.fromCodePoint(0)}owner/repo-a`,
      `agents${String.fromCodePoint(0)}owner/repo-b`,
    ]);
  });

  it('sorts distinct sources deterministically', () => {
    const choices = pickerChoices([
      entry('agents', 'owner/repo-b', 'agents-md'),
      entry('agents', 'owner/repo-a', 'agents-md'),
    ]);
    expect(choices.map((c) => c.label)).toEqual([
      'agents <- owner/repo-a',
      'agents <- owner/repo-b',
    ]);
  });
});
