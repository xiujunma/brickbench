import { describe, expect, it } from 'bun:test';
import { getPart, registerLibraryParts } from '../parts/catalog';
import { isLDrawPartId, parseLDrawIndex, toPartDef } from './catalogIndex';
import { LDRAW_INDEX_VERSION, type LDrawIndexEntry } from './format';
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

  it('reads where a jumper plate’s stud stands, half a stud off the grid', () => {
    const jumper: LDrawIndexEntry = { id: '3794b', name: 'Plate 1 × 2 with 1 Stud', category: 'Plate', w: 2, d: 1, h: 1, origin: [0, 0.4, 0], snug: true, studOffset: [0.5, 0] };
    const index = parseLDrawIndex({ version: 6, generated: '', parts: [jumper, BRICK] });
    expect(toPartDef(index.parts[0] as LDrawIndexEntry).studOffset).toEqual([0.5, 0]);
    expect(toPartDef(BRICK)).not.toHaveProperty('studOffset');
    // half a stud, or none
    expect(() => parseLDrawIndex({ version: 6, generated: '', parts: [{ ...jumper, studOffset: [0.25, 0] }] })).toThrow(/damaged/);
  });

  it('reads the studs on a part’s sides (version 7), each facing away from its body', () => {
    const sideStud: LDrawIndexEntry = { id: '87087', name: 'Brick 1 × 1 with Stud on 1 Side', category: 'Brick', w: 1, d: 1, h: 3, origin: [0, 1.2, 0], snug: true, sideStuds: [[0, 0.7, -0.5, 5]] };
    const index = parseLDrawIndex({ version: 7, generated: '', parts: [sideStud, BRICK] });
    expect(toPartDef(index.parts[0] as LDrawIndexEntry).sideStuds).toEqual([{ at: { x: 0, y: 0.7, z: -0.5 }, facing: '-z' }]);
    expect(toPartDef(BRICK)).not.toHaveProperty('sideStuds');
    // facing up is what top studs do, and there are only six ways to face
    for (const facing of [0, 6]) {
      expect(() => parseLDrawIndex({ version: 7, generated: '', parts: [{ ...sideStud, sideStuds: [[0, 0.7, -0.5, facing]] }] })).toThrow(/damaged/);
    }
  });

  it('reads a part’s Technic, hinge and minifigure connections (versions 8 and 9), their axes made unit again', () => {
    const pin: LDrawIndexEntry = { ...BRICK, id: '3673', name: 'Technic Pin', connectors: [[0, -0.5, 0.4, 0, -1.00004, 0, 0, 1], [1, 0, 0.5, 0, 0, 1, 0, 1]] };
    const index = parseLDrawIndex({ version: 8, generated: '', parts: [pin, BRICK] });
    const [end, hole] = toPartDef(index.parts[0] as LDrawIndexEntry).connectors ?? [];
    expect(end).toEqual({ kind: 'pin', at: { x: -0.5, y: 0.4, z: 0 }, axis: { x: -1, y: 0, z: 0 }, length: 1 });
    expect(hole?.kind).toBe('pinhole');
    // a hinge brick's base, as version 12 lists them
    const hinge: LDrawIndexEntry = { ...BRICK, id: '3937', name: 'Hinge 1 × 2 Base', connectors: [[21, 0, 0.7, 0, 1, 0, 0, 2]] };
    expect(toPartDef(parseLDrawIndex({ version: 12, generated: '', parts: [hinge] }).parts[0] as LDrawIndexEntry).connectors?.[0]?.kind).toBe('hingebase');
    // a torso's neck, as version 9 lists them
    const torso: LDrawIndexEntry = { ...BRICK, id: '973', name: 'Minifig Torso', connectors: [[6, 0, 1.6, 0, 0, -1, 0, 0.2]] };
    expect(toPartDef(parseLDrawIndex({ version: 9, generated: '', parts: [torso] }).parts[0] as LDrawIndexEntry).connectors?.[0]?.kind).toBe('neck');
    // a car roof's fingers and a control stick, as version 13 lists them
    const roof: LDrawIndexEntry = { ...BRICK, id: '4213', name: 'Hinge Car Roof 4 × 4', connectors: [[31, 0, 0.2, -1.8, 1, 0, 0, 3.6], [36, 0, 0, 0, 1, 0, 0, 0.2]] };
    expect(toPartDef(parseLDrawIndex({ version: 13, generated: '', parts: [roof] }).parts[0] as LDrawIndexEntry).connectors?.map((c) => c.kind)).toEqual(['fingers4', 'stick']);
    // a tile's clip, found by its shape, as version 14 lists them: the same kind of connection as any clip
    const tile: LDrawIndexEntry = { ...BRICK, id: '2555', name: 'Tile 1 × 1 with Clip', connectors: [[17, 0, 0.7, 0, 0, 0, 1, 0.4]] };
    expect(toPartDef(parseLDrawIndex({ version: 14, generated: '', parts: [tile] }).parts[0] as LDrawIndexEntry).connectors?.[0]?.kind).toBe('clip');
    expect(toPartDef(BRICK)).not.toHaveProperty('connectors');
    // no such kind, no axis, no length
    for (const connector of [
      [39, 0, 0, 0, 1, 0, 0, 1],
      [0, 0, 0, 0, 0, 0, 0, 1],
      [0, 0, 0, 0, 1, 0, 0, 0],
    ]) {
      expect(() => parseLDrawIndex({ version: 8, generated: '', parts: [{ ...pin, connectors: [connector] }] })).toThrow(/damaged/);
    }
  });

  it('reads how far a part’s shape really reaches, when that is well inside its cells', () => {
    const bar: LDrawIndexEntry = { ...BRICK, id: '87994', name: 'Bar 3L', extent: [-0.2, 0, -0.2, 0.2, 3, 0.2] };
    const [part] = parseLDrawIndex({ version: 10, generated: '', parts: [bar] }).parts;
    expect(toPartDef(part as LDrawIndexEntry).extent).toEqual({ min: { x: -0.2, y: 0, z: -0.2 }, max: { x: 0.2, y: 3, z: 0.2 } });
    expect(toPartDef(BRICK)).not.toHaveProperty('extent');
    expect(() => parseLDrawIndex({ version: 10, generated: '', parts: [{ ...bar, extent: [0.2, 0, 0, -0.2, 3, 0] }] })).toThrow(/damaged/);
  });

  it('rejects damaged or unexpected indexes with a readable message', () => {
    expect(() => parseLDrawIndex({ version: LDRAW_INDEX_VERSION + 1, generated: '', parts: [] })).toThrow(/damaged/);
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
