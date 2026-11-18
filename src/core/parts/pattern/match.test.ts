import { describe, expect, it } from 'bun:test';
import { toPartDef } from '../../ldraw/catalogIndex';
import type { LDrawIndexEntry, SolidBox } from '../../ldraw/format';
import { getPart } from '../catalog';
import { globMatches, matchesPattern, type MatchContext } from './match';
import { parsePattern } from './parse';
import { subjectOf, type Subject } from './subject';

const builtIn = (id: string): Subject => {
  const part = getPart(id);
  if (!part) throw new Error(`no built-in part ${id}`);
  return subjectOf(part);
};

/** A library part as the shipped index lists it: real LDraw names and sizes. */
const library = (id: string, name: string, category: string, w: number, d: number, h: number, solids?: SolidBox[]): Subject =>
  subjectOf(toPartDef({ id, name, category, w, d, h, origin: [0, 0, 0], snug: true, ...(solids ? { solids } : {}) } satisfies LDrawIndexEntry));

function matches(text: string, subject: Subject, context?: MatchContext): boolean {
  const parsed = parsePattern(text);
  if (!parsed.ok) throw new Error(`${text}: ${parsed.error.message}`);
  return matchesPattern(parsed.pattern, subject, context);
}

describe('parts as patterns see them', () => {
  it('give built-in parts their kind, angle, size, height and top face', () => {
    expect(builtIn('plate-2x4')).toMatchObject({ kind: 'P', number: '3020', source: 'basic', sizes: [2, 4], plates: 1, grid: 'oooo/oooo', grids: ['oooo/oooo', 'oo/oo/oo/oo'] });
    expect(builtIn('slope45-2x2')).toMatchObject({ kind: 'S', angle: 45, inverted: false, plates: 3, grid: 'oo/..', grids: ['oo/..', '.o/.o', '../oo', 'o./o.'] });
    expect(builtIn('slope33-3x2-inv')).toMatchObject({ kind: 'S', angle: 33, inverted: true, grid: 'oo/oo/oo' });
    expect(builtIn('tile-1x2')).toMatchObject({ kind: 'T', grid: '..' });
    expect(builtIn('round-tile-1x1')).toMatchObject({ kind: 'R', grid: '.' });
    expect(builtIn('cone-1x1')).toMatchObject({ kind: 'C', grid: 'o' });
    expect(builtIn('arch-1x6x2')).toMatchObject({ kind: 'A', plates: 6, grid: 'oooooo' });
    expect(builtIn('brick-1x2x5')).toMatchObject({ kind: 'B', plates: 15 });
  });

  it('take nicknames from built-in parts’ keywords as well as their names', () => {
    expect([...builtIn('slope30-1x2').features].toSorted()).toEqual(['cheese', 'slope']);
    expect(builtIn('round-plate-1x1').features.has('dot')).toBe(true);
  });

  it('give library parts their kind from their names', () => {
    const kind = (name: string, category = ''): Subject['kind'] => library('x', name, category, 1, 1, 3).kind;
    expect(kind('Slope Brick 45 2 × 2', 'Slope')).toBe('S');
    expect(kind('Wedge 2 × 2 Sloped', 'Slope')).toBe('S');
    expect(kind('Arch 1 × 4')).toBe('A');
    expect(kind('Cone 1 × 1')).toBe('C');
    expect(kind('Brick 2 × 2 Round')).toBe('R');
    expect(kind('Plate 2 × 2 Round with Axle Hole')).toBe('R');
    expect(kind('Brick 2 × 2 × 2 Round with Fins')).toBe('R');
    expect(kind('Cylinder 2 × 4 × 4 Half')).toBe('R');
    expect(kind('Brick 2 × 2 Corner Round')).toBe('B');
    expect(kind('Tile 1 × 2 Grille')).toBe('T');
    expect(kind('Plate 1 × 2 with Clip')).toBe('P');
    expect(kind('Brick 1 × 1 with Headlight')).toBe('B');
    expect(kind('Technic Beam 3')).toBeNull();
  });

  it('read a library slope’s angle and inversion from its name', () => {
    expect(library('54200', 'Slope Brick 31 1 × 1 × 0.667', 'Slope', 1, 1, 2)).toMatchObject({ angle: 31, inverted: false, plates: 2 });
    expect(library('3660', 'Slope Brick 45 2 × 2 Inverted', 'Slope', 2, 2, 3)).toMatchObject({ angle: 45, inverted: true });
    expect(library('15068', 'Slope Brick Curved 2 × 2 × 0.667', 'Slope', 2, 2, 2)).toMatchObject({ angle: null });
  });

  it('size library parts as sold, and leave their studs unknown', () => {
    const clip = library('61252', 'Plate 1 × 1 with Clip Horizontal (Thick C-Clip)', 'Plate', 2, 1, 2);
    expect(clip).toMatchObject({ sizes: [1, 1], plates: 1, grid: '##' });
    const corner = library('2420', 'Plate 2 × 2 Corner', 'Plate', 2, 2, 1, [
      [0, 0, 0, 1, 1, 2],
      [1, 0, 1, 2, 1, 2],
    ]);
    expect(corner.grid).toBe('#_/##');
    expect(corner.grids).toHaveLength(4);
    // LDraw's own keywords are too loose to give nicknames
    const loose = subjectOf({ ...toPartDef({ id: 'y', name: 'Plate 1 × 1', category: 'Plate', w: 1, d: 1, h: 1, origin: [0, 0, 0], snug: true }), keywords: ['plate', 'cheese'] });
    expect(loose.features.has('cheese')).toBe(false);
  });
});

describe('matching', () => {
  it('holds a part to every part of a part term', () => {
    expect(matches('P2x4', builtIn('plate-2x4'))).toBe(true);
    expect(matches('P4x2', builtIn('plate-2x4'))).toBe(true);
    expect(matches('B2x4', builtIn('plate-2x4'))).toBe(false);
    expect(matches('P2x4^2', builtIn('plate-2x4'))).toBe(false);
    expect(matches('S45', builtIn('slope33-3x2'))).toBe(false);
    expect(matches('Si', builtIn('slope33-3x2'))).toBe(false);
    expect(matches('Si', builtIn('slope33-3x2-inv'))).toBe(true);
    expect(matches('S[oo/../..]', builtIn('slope33-3x2'))).toBe(true);
    expect(matches('S[../../oo]', builtIn('slope33-3x2'))).toBe(true);
    expect(matches('S[o.o/o.o]', builtIn('slope33-3x2'))).toBe(false);
    expect(matches('*', library('32523', 'Technic Beam 3', 'Technic', 3, 1, 3))).toBe(true);
    expect(matches('B', library('32523', 'Technic Beam 3', 'Technic', 3, 1, 3))).toBe(false);
  });

  it('counts a third size in whole bricks', () => {
    expect(matches('B1x2x5', builtIn('brick-1x2x5'))).toBe(true);
    expect(matches('B1x2x{1,4}', builtIn('brick-1x2x5'))).toBe(false);
    expect(matches('1x2x*', library('z', 'Plate 1 × 2 with Clip', 'Plate', 2, 1, 2))).toBe(true);
    expect(matches('1x2x1', library('w', 'Bracket 1 × 2 - 1 × 2', 'Bracket', 2, 1, 4))).toBe(false);
  });

  it('matches # cells of library parts with studs or none', () => {
    const corner = library('2420', 'Plate 2 × 2 Corner', 'Plate', 2, 2, 1, [
      [0, 0, 0, 1, 1, 2],
      [1, 0, 1, 2, 1, 2],
    ]);
    expect(matches('P[oo/o_]', corner)).toBe(true);
    expect(matches('P[.o/_.]', corner)).toBe(true);
    expect(matches('P[oo]{2}', corner)).toBe(false);
  });

  it('checks features, colours, numbers, sources and words', () => {
    const cheese = builtIn('slope30-1x1');
    expect(matches('+cheese', cheese)).toBe(true);
    expect(matches('-cheese', cheese)).toBe(false);
    expect(matches(':red', cheese)).toBe(true);
    expect(matches(':red', { ...cheese, colours: new Set([1]) })).toBe(false);
    expect(matches(':blue', { ...cheese, colours: new Set([1]) })).toBe(true);
    expect(matches('=54200', cheese)).toBe(true);
    expect(matches('=542??', cheese)).toBe(true);
    expect(matches('=5420', cheese)).toBe(false);
    expect(matches('@basic', cheese)).toBe(true);
    expect(matches('@library', cheese)).toBe(false);
    expect(matches('@owned', cheese)).toBe(false);
    expect(matches('@owned', cheese, { owned: new Set(['slope30-1x1']) })).toBe(true);
    expect(matches('"slope 30"', cheese)).toBe(true);
    expect(matches('"lope"', cheese)).toBe(false);
  });

  it('combines terms with and, or and not', () => {
    const plate = builtIn('plate-2x4');
    expect(matches('P2x4 | T2x4', plate)).toBe(true);
    expect(matches('T2x4 | B2x4', plate)).toBe(false);
    expect(matches('P !+clip', plate)).toBe(true);
    expect(matches('!(P | T)', plate)).toBe(false);
  });
});

describe('part number globs', () => {
  it('match * to any run and ? to any one character', () => {
    expect(globMatches('3001', '3001')).toBe(true);
    expect(globMatches('30*', '3001')).toBe(true);
    expect(globMatches('*1', '3001')).toBe(true);
    expect(globMatches('3?0?', '3001')).toBe(true);
    expect(globMatches('*', '')).toBe(true);
    expect(globMatches('**', '3001')).toBe(true);
    expect(globMatches('3*0*1*', '3001')).toBe(true);
    expect(globMatches('?', '')).toBe(false);
    expect(globMatches('300', '3001')).toBe(false);
    expect(globMatches('3x*', '3001')).toBe(false);
  });

  it('never backtrack, however many stars', () => {
    expect(globMatches(`${'*a'.repeat(200)}*b`, 'a'.repeat(40))).toBe(false);
  });
});
