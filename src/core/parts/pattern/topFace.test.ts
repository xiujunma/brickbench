import { describe, expect, it } from 'bun:test';
import { PatternSyntaxError, PatternTooCostlyError, TOO_COSTLY_MESSAGE, WorkBudget } from './errors';
import { MAX_REPEAT, matchesTopFace, parseTopFace, readRange, type Range } from './topFace';

const ONCE: Range = { min: 1, max: 1 };
const face = (body: string, repeat: Range = ONCE) => parseTopFace(body, repeat, 0);
const matches = (body: string, grid: string, repeat: Range = ONCE): boolean => matchesTopFace(face(body, repeat), grid);

function refusal(body: string, repeat: Range = ONCE): { message: string; at: number } {
  try {
    face(body, repeat);
  } catch (error: unknown) {
    if (error instanceof PatternSyntaxError) return { message: error.message, at: error.at };
    throw error;
  }
  throw new Error(`${body} was not refused`);
}

describe('top faces', () => {
  it('match whole grids, cell by cell', () => {
    expect(matches('oo', 'oo')).toBe(true);
    expect(matches('oo', 'ooo')).toBe(false);
    expect(matches('ooo', 'oo')).toBe(false);
    expect(matches('o.', 'o.')).toBe(true);
    expect(matches('o.', '.o')).toBe(false);
    expect(matches('oo/..', 'oo/..')).toBe(true);
    expect(matches('oo/..', 'oo..')).toBe(false);
  });

  it('let # stand for any filled cell, and match a grid’s unknown cells with o and .', () => {
    expect(matches('##', 'o.')).toBe(true);
    expect(matches('##', 'o_')).toBe(false);
    expect(matches('o.', '##')).toBe(true);
    expect(matches('_', '#')).toBe(false);
    expect(matches('#_/##', '#_/##')).toBe(true);
  });

  it('count cells and groups, choose within rows, and take cell classes', () => {
    expect(matches('o*', '')).toBe(true);
    expect(matches('o+', '')).toBe(false);
    expect(matches('o+.?', 'ooo')).toBe(true);
    expect(matches('o+.?', 'ooo.')).toBe(true);
    expect(matches('o+.?', 'ooo..')).toBe(false);
    expect(matches('o{2,3}', 'oooo')).toBe(false);
    expect(matches('o{2,}', 'oooooo')).toBe(true);
    expect(matches('(o.)+', 'o.o.')).toBe(true);
    expect(matches('(o.)+', 'o.o')).toBe(false);
    expect(matches('oo|.', '.')).toBe(true);
    expect(matches('(oo|.)_', '._')).toBe(true);
    expect(matches('[o_]{3}', 'o_o')).toBe(true);
    expect(matches('[o_]{3}', 'o.o')).toBe(false);
  });

  it('repeat all their rows when counted after the brackets', () => {
    expect(matches('oo', 'oo/oo', { min: 2, max: 2 })).toBe(true);
    expect(matches('oo', 'oo/oo/oo', { min: 2, max: 2 })).toBe(false);
    expect(matches('o/.', 'o/./o/.', { min: 1, max: 2 })).toBe(true);
    expect(matches('o/.', 'o/./o', { min: 1, max: 2 })).toBe(false);
    expect(matches('o*', 'ooo/o/', { min: 1, max: Infinity })).toBe(true);
    expect(face('o/.', { min: 2, max: 3 }).rows).toEqual({ min: 4, max: 6 });
  });

  it('rule out grids with too many or too few rows before matching', () => {
    expect(matches('o*', 'o/o')).toBe(false);
    expect(matches('o', '', { min: 1, max: 1 })).toBe(false);
  });

  it('match big grids quickly, with no backtracking to blow up', () => {
    const row = '#'.repeat(MAX_REPEAT - 1);
    const grid = Array.from({ length: 48 }, () => row).join('/');
    expect(matchesTopFace(face('(#|o|.)*', { min: 1, max: MAX_REPEAT }), grid)).toBe(true);
    expect(matchesTopFace(face('(#|o|.)*_', { min: 1, max: MAX_REPEAT }), grid)).toBe(false);
  });

  it('merge a choice of single cells into one cell', () => {
    expect(face('(o|.)').cells).toEqual({ type: 'cell', accepts: 'o#.' });
    expect(face('(o|..)').cells.type).toBe('alt');
  });

  it('draw their work from a budget, and stop when it runs out', () => {
    const grid = Array.from({ length: 16 }, () => 'o.'.repeat(8)).join('/');
    const costly = face('(o|.)*(o.|.o){8}', { min: 1, max: MAX_REPEAT });
    const budget = new WorkBudget(1_000_000);
    expect(matchesTopFace(costly, grid, budget)).toBe(true);
    expect(budget.spent).toBeGreaterThan(1000);
    expect(budget.limit).toBe(1_000_000);
    expect(() => matchesTopFace(costly, grid, new WorkBudget(1000))).toThrow(PatternTooCostlyError);
    expect(() => matchesTopFace(costly, grid, new WorkBudget(1000))).toThrow(TOO_COSTLY_MESSAGE);
  });

  it('read counts and refuse ones that cannot be', () => {
    expect(readRange('3', 0)).toEqual({ min: 3, max: 3 });
    expect(readRange('2,5', 0)).toEqual({ min: 2, max: 5 });
    expect(readRange('2,', 0)).toEqual({ min: 2, max: Infinity });
    expect(() => readRange('', 4)).toThrow('A count is written {n}, {min,max} or {min,}');
    expect(() => readRange('5,2', 4)).toThrow('A count’s maximum cannot be below its minimum');
    expect(() => readRange(`${MAX_REPEAT + 1}`, 4)).toThrow(`Counts go up to ${MAX_REPEAT}`);
    expect(() => readRange('1,999', 4)).toThrow(`Counts go up to ${MAX_REPEAT}`);
  });

  it('refuse faces that do not read, saying where', () => {
    expect(refusal('')).toEqual({ message: 'Each row, and each choice in it, needs at least one cell', at: 0 });
    expect(refusal('oo/')).toEqual({ message: 'Each row, and each choice in it, needs at least one cell', at: 3 });
    expect(refusal('o|')).toEqual({ message: 'Each row, and each choice in it, needs at least one cell', at: 2 });
    expect(refusal('o)')).toEqual({ message: 'This “)” has no “(” to close', at: 1 });
    expect(refusal('(oo')).toEqual({ message: 'A “(” in a top face needs its “)”', at: 3 });
    expect(refusal('(o/o)').message).toBe('A row ends only outside ( ): close the group before the “/”');
    expect(refusal('*o')).toEqual({ message: 'Nothing before this to count', at: 0 });
    expect(refusal('o**')).toEqual({ message: 'A count cannot follow another count: write o*, not o**', at: 2 });
    expect(refusal('o{2}?').message).toBe('A count cannot follow another count: write o*, not o**');
    expect(refusal('(o*)*')).toEqual({ message: 'A group with a count inside cannot be counted again: write (oo)* or o*, not (o*)*', at: 4 });
    expect(refusal('(o+.)?').message).toContain('cannot be counted again');
    expect(refusal('ox').message).toBe('A top face is made of o . _ and #, with ( ) | * + ? {m,n} and [ ]: “x” is not one of them');
    expect(refusal('[o').message).toBe('A “[” in a top face needs its “]”');
    expect(refusal('o[]')).toEqual({ message: 'An empty [ ] matches no cell', at: 1 });
    expect(refusal('[ox]')).toEqual({ message: 'Only o . _ and # go between [ ]: “x” does not', at: 2 });
    expect(refusal('o{2').message).toBe('A “{” needs its “}”');
    expect(refusal('o', { min: 0, max: 2 }).message).toBe('A top face has its rows at least once');
  });

  it('give error positions in the whole pattern', () => {
    try {
      parseTopFace('oo/x', ONCE, 10);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(PatternSyntaxError);
      expect((error as PatternSyntaxError).at).toBe(13);
    }
  });
});
