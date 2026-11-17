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

  it('rejects damaged or unexpected indexes with a readable message', () => {
    expect(() => parseLDrawIndex({ version: 4, generated: '', parts: [] })).toThrow(/damaged/);
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
