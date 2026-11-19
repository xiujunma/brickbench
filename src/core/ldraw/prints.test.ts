import { describe, expect, it } from 'bun:test';
import { isPrintedName, plainNumberOf } from './prints';

describe('printed and stickered parts', () => {
  it('are told by their names', () => {
    expect(isPrintedName('Tile 1 x 2 with Black "POLICE" Pattern')).toBe(true);
    expect(isPrintedName('Slope Brick 45 2 x 2 with Fire Logo Sticker')).toBe(true);
    expect(isPrintedName('Panel 1 x 2 x 1 with Stickers')).toBe(true);
    expect(isPrintedName('Brick 2 x 4')).toBe(false);
    expect(isPrintedName('Tile 2 x 2 with Groove')).toBe(false);
    // a word that only begins like one
    expect(isPrintedName('Brick 1 x 2 with Patterned Grille')).toBe(false);
    // LDraw's abbreviation, and plain parts that say they are
    expect(isPrintedName('Minifig Torso with Blue Shirt Patt.')).toBe(true);
    expect(isPrintedName('Minifig Head Rodian without Pattern')).toBe(false);
    expect(isPrintedName('Minifig Head (No Pattern)')).toBe(false);
    expect(isPrintedName('Tile 2 x 2 without Groove with Map Pattern')).toBe(true);
  });

  it('find their plain part from their number: a print’s "p", or a sticker’s "d"', () => {
    const plain = new Set(['3626b', '3068b', '10202', '3001']);
    const known = (stem: string): string | null => (plain.has(stem) ? stem : null);
    expect(plainNumberOf('3626bp01', known)).toBe('3626b');
    expect(plainNumberOf('3068bpx1', known)).toBe('3068b');
    expect(plainNumberOf('10202d01', known)).toBe('10202');
    // the longest stem the library has wins
    expect(plainNumberOf('3001pd01', (stem) => (stem === '3001p' || stem === '3001' ? stem : null))).toBe('3001p');
    expect(plainNumberOf('3069bp01', known)).toBeNull();
    expect(plainNumberOf('p01', known)).toBeNull();
  });

  it('may give back whatever the stem now stands for', () => {
    expect(plainNumberOf('3068p01', (stem) => (stem === '3068' ? '3068b' : null))).toBe('3068b');
  });
});
