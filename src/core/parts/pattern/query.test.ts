import { describe, expect, it } from 'bun:test';
import { parsePattern } from './parse';
import { patternColour, readQuery } from './query';

const kindOf = (text: string): string => readQuery(text).kind;

function colourOf(text: string): number | null {
  const parsed = parsePattern(text);
  if (!parsed.ok) throw new Error(`${text}: ${parsed.error.message}`);
  return patternColour(parsed.pattern);
}

describe('reading a search query', () => {
  it('leaves words and sizes alone', () => {
    expect(kindOf('red 2x4 brick')).toBe('words');
    expect(kindOf('2x4')).toBe('words');
    expect(kindOf(' 2 × 4 × 3 ')).toBe('words');
    expect(kindOf('Brick 1 x 2')).toBe('words');
    expect(kindOf('3001')).toBe('words');
    expect(kindOf('')).toBe('words');
  });

  it('leaves words in capitals and hyphenated words alone, kind letters and all', () => {
    for (const text of ['BAR', 'CAP', 'TAB', 'TRAP', 'ARC 1x4', 'SNOT', 'C-clip', 'T-bar', 'S-clip']) expect(kindOf(text)).toBe('words');
  });

  it('reads patterns', () => {
    for (const text of ['P2x4', 'B', 'S45 2x2', 'Si', 'Si 2x2', 'Si1x2', '!B', '(P|T)2x4', '[oo]', '=3001', '@owned', '+clip', '-clip', '"clip" P', '*', '2x*', '(1|2)x4', 'P | T', 'B ^15']) {
      expect(readQuery(text)).toMatchObject({ kind: 'pattern', pattern: { text } });
    }
  });

  it('keeps the error of a query that looks like a pattern but does not read', () => {
    expect(readQuery('P2x4 [oo')).toEqual({ kind: 'broken', error: { message: 'A “[” needs its “]”', at: 5 } });
    // a capital standing alone is a kind letter: these are tried as patterns, then searched as words
    expect(kindOf('A frame')).toBe('broken');
    expect(kindOf('LEGO T piece')).toBe('broken');
    expect(kindOf('brick 1x1 (headlight)')).toBe('broken');
  });
});

describe('a pattern’s colour', () => {
  it('is the one colour it asks for outright', () => {
    expect(colourOf(':red')).toBe(4);
    expect(colourOf('P2x4 :red')).toBe(4);
    expect(colourOf('P2x4 :red :4')).toBe(4);
  });

  it('is none when it names none, several, or one only within a choice or a not', () => {
    expect(colourOf('P2x4')).toBeNull();
    expect(colourOf(':red :blue')).toBeNull();
    expect(colourOf('P | :red')).toBeNull();
    expect(colourOf('P !:red')).toBeNull();
  });
});
