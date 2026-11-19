import { describe, expect, it } from 'bun:test';
import { getPart, registerLibraryParts } from '../parts/catalog';
import { isLDrawPartId, parseLDrawIndex, toPartDef } from './catalogIndex';
import type { LDrawIndexEntry } from './format';
import { categoriesOf } from './categories';

const BRICK: LDrawIndexEntry = {
  id: '3001', name: 'Brick 2 × 4', category: 'Brick', author: 'James Jessiman', w: 4, d: 2, h: 3, origin: [0, 1.2, 0], snug: true,
};
const HINGE: LDrawIndexEntry = {
  id: '3937', name: 'Hinge 1 × 2 Base', category: 'Hinge', keywords: ['swivel'], w: 2, d: 1, h: 2, origin: [0, 0.8, 0], snug: false,
};
const LONG_BRICK: LDrawIndexEntry = { ...BRICK, id: '3008', name: 'Brick 1 × 8', w: 8, d: 1 };
/** Plate 2 × 2 Corner: three of its four cells. */
const CORNER: LDrawIndexEntry = {
  id: '2420', name: 'Plate 2 × 2 Corner', category: 'Plate', w: 2, d: 2, h: 1, origin: [0, 0.4, 0], snug: true,
  solids: [[0, 0, 0, 2, 1, 1], [0, 0, 1, 1, 1, 2]],
};

describe('library index', () => {
  it('accepts a well-formed index', () => {
    const index = parseLDrawIndex({ version: 2, generated: '2026-11-11T00:00:00Z', parts: [BRICK, HINGE, CORNER] });
    expect(index.parts.map((p) => p.id)).toEqual(['3001', '3937', '2420']);
    expect(index.parts[2]?.solids).toEqual(CORNER.solids);
  });

  it('still reads a version 1 library, from before parts had solids', () => {
    const index = parseLDrawIndex({ version: 1, generated: '2026-11-11T00:00:00Z', parts: [BRICK] });
    expect(index.parts[0]?.solids).toBeUndefined();
  });

  it('reads the part numbers LDraw renamed, and refuses ones that are not part numbers', () => {
    const index = parseLDrawIndex({ version: 4, generated: '', parts: [BRICK], aliases: [['3001old', '3001']] });
    expect(index.aliases).toEqual([['3001old', '3001']]);
    expect(parseLDrawIndex({ version: 3, generated: '', parts: [BRICK] }).aliases).toBeUndefined();
    expect(() => parseLDrawIndex({ version: 4, generated: '', parts: [], aliases: [['../x', '3001']] })).toThrow(/damaged/);
    expect(() => parseLDrawIndex({ version: 4, generated: '', parts: [], aliases: [['3001']] })).toThrow(/damaged/);
  });

  it('reads printed parts and the plain part each decorates, as parts that say so', () => {
    const print: LDrawIndexEntry = { ...BRICK, id: '3001p01', name: 'Brick 2 × 4 with Fire Logo Pattern', printed: true, base: '3001' };
    const sticker: LDrawIndexEntry = { ...BRICK, id: '9999d01', name: 'Brick 2 × 4 with Map Sticker', printed: true };
    const index = parseLDrawIndex({ version: 5, generated: '', parts: [BRICK, print, sticker] });
    expect(index.parts.map((p) => [p.printed ?? false, p.base ?? null])).toEqual([
      [false, null],
      [true, '3001'],
      [true, null],
    ]);
    expect(toPartDef(index.parts[1] as LDrawIndexEntry).printed).toBe(true);
    expect(toPartDef(BRICK)).not.toHaveProperty('printed');
    expect(() => parseLDrawIndex({ version: 5, generated: '', parts: [{ ...print, base: '../3001' }] })).toThrow(/damaged/);
    expect(() => parseLDrawIndex({ version: 5, generated: '', parts: [{ ...print, printed: false }] })).toThrow(/damaged/);
  });

  it('rejects damaged or unexpected indexes with a readable message', () => {
    expect(() => parseLDrawIndex({ version: 6, generated: '', parts: [] })).toThrow(/damaged/);
    expect(() => parseLDrawIndex({ version: 2, generated: '', parts: [{ ...BRICK, id: '../evil' }] })).toThrow(/damaged/);
    expect(() => parseLDrawIndex({ version: 2, generated: '', parts: [{ ...BRICK, w: 0 }] })).toThrow(/damaged/);
    expect(() => parseLDrawIndex('nope')).toThrow(/damaged/);
  });

  it('rejects solids that are empty or reach outside their part', () => {
    const parse = (solids: unknown) => () => parseLDrawIndex({ version: 2, generated: '', parts: [{ ...CORNER, solids }] });
    expect(parse([[0, 0, 0, 3, 1, 1]])).toThrow(/damaged/);
    expect(parse([[0, 0, 0, 2, 2, 1]])).toThrow(/damaged/);
    expect(parse([[1, 0, 0, 1, 1, 1]])).toThrow(/damaged/);
    expect(parse([[0, 0, 0, 1.5, 1, 1]])).toThrow(/damaged/);
    expect(parse([])).toThrow(/damaged/);
  });

  it('turns entries into solid boxes drawn from their own mesh', () => {
    const part = toPartDef(BRICK);
    expect(part).toMatchObject({
      id: 'ldraw:3001',
      category: 'library',
      w: 4,
      d: 2,
      h: 3,
      studs: [],
      solids: [{ x0: 0, y0: 0, z0: 0, x1: 4, y1: 3, z1: 2 }],
      shape: { kind: 'mesh' },
      ldraw: { file: '3001.dat', origin: [0, 1.2, 0] },
    });
    expect(toPartDef(HINGE).keywords).toEqual(['hinge', 'swivel']);
    expect(toPartDef(CORNER).solids).toEqual([
      { x0: 0, y0: 0, z0: 0, x1: 2, y1: 1, z1: 1 },
      { x0: 0, y0: 0, z0: 1, x1: 1, y1: 1, z1: 2 },
    ]);
    expect(isLDrawPartId('ldraw:3001')).toBe(true);
    expect(isLDrawPartId('brick-2x4')).toBe(false);
  });

  it('registers library parts alongside the built-in ones, which always win', () => {
    // an id no other test registers: test files share one process
    const fresh = { ...HINGE, id: 'registry-check', name: 'Registry Check' };
    expect(getPart('ldraw:registry-check')).toBeUndefined();
    registerLibraryParts([toPartDef(fresh), { ...toPartDef(BRICK), id: 'brick-2x4', name: 'Impostor' }]);
    expect(getPart('ldraw:registry-check')?.name).toBe('Registry Check');
    expect(getPart('brick-2x4')?.name).toBe('Brick 2 × 4');
  });
});

describe('library categories', () => {
  it('lists categories alphabetically with their sizes', () => {
    expect(categoriesOf([LONG_BRICK, HINGE, BRICK])).toEqual([
      { name: 'Brick', count: 2 },
      { name: 'Hinge', count: 1 },
    ]);
  });
});
