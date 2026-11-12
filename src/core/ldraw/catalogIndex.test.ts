import { describe, expect, it } from 'bun:test';
import { getPart, registerLibraryParts } from '../parts/catalog';
import { isLDrawPartId, parseLDrawIndex, toPartDef } from './catalogIndex';
import type { LDrawIndexEntry } from './format';
import { categoriesOf, createLibrarySearch } from './librarySearch';

const BRICK: LDrawIndexEntry = {
  id: '3001', name: 'Brick 2 × 4', category: 'Brick', author: 'James Jessiman', w: 4, d: 2, h: 3, origin: [0, 1.2, 0], snug: true,
};
const HINGE: LDrawIndexEntry = {
  id: '3937', name: 'Hinge 1 × 2 Base', category: 'Hinge', keywords: ['swivel'], w: 2, d: 1, h: 2, origin: [0, 0.8, 0], snug: false,
};
const LONG_BRICK: LDrawIndexEntry = { ...BRICK, id: '3008', name: 'Brick 1 × 8', w: 8, d: 1 };

describe('library index', () => {
  it('accepts a well-formed index', () => {
    const index = parseLDrawIndex({ version: 1, generated: '2026-11-11T00:00:00Z', parts: [BRICK, HINGE] });
    expect(index.parts.map((p) => p.id)).toEqual(['3001', '3937']);
  });

  it('rejects damaged or unexpected indexes with a readable message', () => {
    expect(() => parseLDrawIndex({ version: 2, generated: '', parts: [] })).toThrow(/damaged/);
    expect(() => parseLDrawIndex({ version: 1, generated: '', parts: [{ ...BRICK, id: '../evil' }] })).toThrow(/damaged/);
    expect(() => parseLDrawIndex({ version: 1, generated: '', parts: [{ ...BRICK, w: 0 }] })).toThrow(/damaged/);
    expect(() => parseLDrawIndex('nope')).toThrow(/damaged/);
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

describe('library search', () => {
  const search = createLibrarySearch([LONG_BRICK, BRICK, HINGE]);

  it('matches every word against names, numbers, categories and keywords', () => {
    expect(search('brick', null).map((e) => e.id)).toEqual(['3008', '3001']);
    expect(search('2x4', null).map((e) => e.id)).toEqual(['3001']);
    expect(search('swivel', null).map((e) => e.id)).toEqual(['3937']);
    expect(search('brick 8', null).map((e) => e.id)).toEqual(['3008']);
    expect(search('', 'Hinge').map((e) => e.id)).toEqual(['3937']);
    expect(search('brick', 'Hinge')).toEqual([]);
  });

  it('puts the part whose number is the query first', () => {
    expect(search('300', null).map((e) => e.id)).toEqual(['3008', '3001']);
    expect(search('3001', null).map((e) => e.id)).toEqual(['3001']);
    const numbered = createLibrarySearch([LONG_BRICK, { ...HINGE, id: '3008b', name: 'Brick 1 × 8 with 3008 in its name' }, { ...BRICK, id: '3008b2' }]);
    expect(numbered('3008b', null)[0]?.id).toBe('3008b');
  });

  it('ranks names that start with the query, then names holding every word, above keyword matches', () => {
    const ranked = createLibrarySearch([
      { ...HINGE, id: 'a', name: 'Arch 1 × 2', keywords: ['brick'] },
      { ...BRICK, id: 'b', name: 'Plate with Brick 1 × 2 Side' },
      { ...BRICK, id: 'c', name: 'Brick 1 × 2' },
      { ...BRICK, id: 'd', name: 'Sheet Plastic Panel 11 × 23 Brick' },
    ]);
    expect(ranked('brick 1 x 2', null).map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('prefers names where the words come early', () => {
    const sized = createLibrarySearch([
      { ...BRICK, id: 'bracket', name: 'Bracket 1 × 2 - 2 × 4' },
      { ...BRICK, id: 'brick', name: 'Brick 2 × 4' },
      { ...BRICK, id: 'plate', name: 'Plate 2 × 4' },
    ]);
    expect(sized('2x4', null).map((e) => e.id)).toEqual(['brick', 'plate', 'bracket']);
  });

  it('lists parts named after a category first when browsing it', () => {
    const technic = createLibrarySearch([
      { ...BRICK, id: 'duplo', name: 'Duplo Axle 6', category: 'Technic' },
      { ...BRICK, id: 'axle', name: 'Technic Axle 2', category: 'Technic' },
    ]);
    expect(technic('', 'Technic').map((e) => e.id)).toEqual(['axle', 'duplo']);
    expect(technic('', null).map((e) => e.id)).toEqual(['duplo', 'axle']);
  });

  it('lists categories alphabetically with their sizes', () => {
    expect(categoriesOf([LONG_BRICK, HINGE, BRICK])).toEqual([
      { name: 'Brick', count: 2 },
      { name: 'Hinge', count: 1 },
    ]);
  });
});
