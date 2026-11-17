import { describe, expect, it } from 'bun:test';
import type { LDrawIndexEntry } from '../ldraw/format';
import { PARTS } from '../parts/catalog';
import { matchColour, matchList, matchPart, partNumberOf, partNumbersOf } from './match';
import { MAX_QUANTITY } from './read';

function entry(id: string, keywords: string[] = []): LDrawIndexEntry {
  return { id, name: id, category: 'Brick', keywords, w: 1, d: 1, h: 3, origin: [0, 0, 0], snug: true };
}

const LIBRARY = [
  entry('3001'),
  entry('6141', ['BrickLink 4073']),
  entry('3684c', ['Rebrickable 98560']),
  entry('3040b', ['BrickLink 3040']),
  // two parts note the same number: the one that is that number wins
  entry('4025', ['Rebrickable 4025']),
  entry('18626', ['Rebrickable 4025']),
  // and otherwise the first by number
  entry('92a', ['BrickLink 92']),
  entry('92b', ['BrickLink 92']),
  entry('61678'),
  // BrickLink files the thin-walled arch under the old number, which LDraw (and Rebrickable) keep for the first arch
  entry('2339'),
  entry('14395', ['BrickLink 2339']),
];
const NUMBERS = partNumbersOf(PARTS, LIBRARY, new Map([['11153', '61678'], ['3660', '3660a']]));

describe('part numbers BrickBench knows', () => {
  it('collects library parts, the basic parts and the catalogue numbers parts note', () => {
    expect(NUMBERS.known.has('6141')).toBe(true);
    // a basic part with no twin in this small library
    expect(NUMBERS.known.has('3005')).toBe(true);
    expect(NUMBERS.noted.bricklink.get('4073')).toBe('6141');
    expect(NUMBERS.noted.rebrickable.get('98560')).toBe('3684c');
    expect(NUMBERS.noted.rebrickable.get('4025')).toBe('4025');
    expect(NUMBERS.noted.bricklink.get('92')).toBe('92a');
  });

  it("reads a part's LDraw number", () => {
    expect(partNumberOf(PARTS.find((p) => p.id === 'brick-2x4'))).toBe('3001');
    expect(partNumberOf({ ldraw: { file: '3040B.DAT', origin: [0, 0, 0] } })).toBe('3040b');
    expect(partNumberOf({ ldraw: undefined })).toBeNull();
    expect(partNumberOf(undefined)).toBeNull();
  });
});

describe('matching a part number', () => {
  it('takes numbers the library has as they are, in any case', () => {
    expect(matchPart('3001', 'rebrickable', NUMBERS)).toBe('3001');
    expect(matchPart('3040B', 'bricklink', NUMBERS)).toBe('3040b');
  });

  it("follows the catalogue's own note, then the other catalogue's", () => {
    expect(matchPart('98560', 'rebrickable', NUMBERS)).toBe('3684c');
    expect(matchPart('4073', 'bricklink', NUMBERS)).toBe('6141');
    // Rebrickable numbers 4073 as BrickLink does
    expect(matchPart('4073', 'rebrickable', NUMBERS)).toBe('6141');
    expect(matchPart('3040', 'rebrickable', NUMBERS)).toBe('3040b');
  });

  it('keeps a number LDraw has over what the other catalogue calls it', () => {
    expect(matchPart('2339', 'rebrickable', NUMBERS)).toBe('2339');
    expect(matchPart('2339', 'bricklink', NUMBERS)).toBe('14395');
  });

  it('follows LDraw renames to a part it has, and gives up otherwise', () => {
    expect(matchPart('11153', 'rebrickable', NUMBERS)).toBe('61678');
    expect(matchPart('3660', 'rebrickable', NUMBERS)).toBeNull();
    expect(matchPart('5903', 'bricklink', NUMBERS)).toBeNull();
  });
});

describe('matching a colour', () => {
  it('turns each catalogue’s colour numbers into palette colours', () => {
    expect(matchColour(4, 'rebrickable')).toBe(4);
    // where Rebrickable's numbers differ from LDraw's
    expect(matchColour(182, 'rebrickable')).toBe(57);
    expect(matchColour(179, 'rebrickable')).toBe(315);
    expect(matchColour(1050, 'rebrickable')).toBe(353);
    expect(matchColour(11, 'bricklink')).toBe(0);
    expect(matchColour(86, 'bricklink')).toBe(71);
    expect(matchColour(98, 'bricklink')).toBe(57);
  });

  it('gives up on colours the palette lacks or no one knows', () => {
    // Opal Trans-Clear is an LDraw colour, but not one of BrickBench's
    expect(matchColour(1055, 'rebrickable')).toBeNull();
    expect(matchColour(9999, 'rebrickable')).toBeNull();
    expect(matchColour(0, 'bricklink')).toBeNull();
  });
});

describe('matching a list', () => {
  it('adds repeated lines up to the most one lot may hold', () => {
    const big = { part: '3001', colour: 4, quantity: 60_000 };
    const matched = matchList({ catalogue: 'rebrickable', parts: [big, big, { ...big, part: 'nope' }, { ...big, part: 'nope' }], notParts: 0, unreadable: 0 }, NUMBERS);
    expect(matched.lots[0]?.quantity).toBe(MAX_QUANTITY);
    expect(matched.unmatched[0]?.quantity).toBe(MAX_QUANTITY);
  });

  it('adds up repeated lines and keeps what cannot be used, with the reason', () => {
    const matched = matchList(
      {
        catalogue: 'rebrickable',
        parts: [
          { part: '3001', colour: 4, quantity: 2 },
          { part: '3001', colour: 4, quantity: 1 },
          { part: '4073', colour: 182, quantity: 4 },
          { part: '5903', colour: 85, quantity: 2 },
          { part: '5903', colour: 85, quantity: 1 },
          { part: '3001', colour: 1055, quantity: 1 },
          { part: 'nope', colour: 1055, quantity: 1 },
        ],
        notParts: 0,
        unreadable: 0,
      },
      NUMBERS,
    );
    expect(matched.lots).toEqual([
      { part: '3001', colour: 4, quantity: 3 },
      { part: '6141', colour: 57, quantity: 4 },
    ]);
    expect(matched.unmatched).toEqual([
      { part: '5903', colour: 85, quantity: 3, reason: 'part' },
      { part: '3001', colour: 1055, quantity: 1, reason: 'colour' },
      { part: 'nope', colour: 1055, quantity: 1, reason: 'part' },
    ]);
  });
});
