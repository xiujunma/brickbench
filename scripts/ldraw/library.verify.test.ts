/**
 * Converts real parts from the LDraw library and checks they land on the grid
 * exactly where the built-in catalogue (itself verified against LDraw) puts
 * them, so library parts and built-in parts line up and export identically.
 *
 * Opt-in because it needs the library on disk:
 *   LDRAW_DIR=/path/to/ldraw bun test scripts/ldraw/library.verify.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { decodePartMesh, encodePartMesh } from '../../src/core/ldraw/format.ts';
import { readColourTable } from './colours.ts';
import { convertPart } from './convert.ts';
import { Flattener } from './flatten.ts';
import { directorySource } from './library.ts';

const LDRAW_DIR = process.env['LDRAW_DIR'];

/** [file, w, d, h, origin] as in src/core/parts/catalog.ts. */
const CATALOGUE: readonly (readonly [string, number, number, number, readonly [number, number, number]])[] = [
  ['3001.dat', 4, 2, 3, [0, 1.2, 0]],
  ['3024.dat', 1, 1, 1, [0, 0.4, 0]],
  ['2453b.dat', 1, 1, 15, [0, 6, 0]],
  ['3068b.dat', 2, 2, 1, [0, 0.4, 0]],
  ['3040b.dat', 1, 2, 3, [0, 1.2, -0.5]],
  ['3039.dat', 2, 2, 3, [0, 1.2, -0.5]],
  ['4286.dat', 1, 3, 3, [0, 1.2, -1]],
  ['3665b.dat', 1, 2, 3, [0, 1.2, -0.5]],
  ['54200.dat', 1, 1, 2, [0, 0, 0]],
  ['3062b.dat', 1, 1, 3, [0, 1.2, 0]],
  ['3941.dat', 2, 2, 3, [0, 1.2, 0]],
  ['4589.dat', 1, 1, 3, [0, 1.2, 0]],
  ['3659.dat', 4, 1, 3, [0, 1.2, 0]],
  ['3307.dat', 6, 1, 6, [0, 2.4, 0]],
];

describe.skipIf(!LDRAW_DIR)('converting the real LDraw library', () => {
  const flattener = new Flattener(directorySource(LDRAW_DIR ?? ''));

  it.each(CATALOGUE)('%s fits the grid like the built-in part', (file, w, d, h, origin) => {
    const result = convertPart(file, flattener);
    if (!result.ok) throw new Error(`${file} was skipped: ${result.reason}`);
    expect([result.fit.w, result.fit.d, result.fit.h]).toEqual([w, d, h]);
    result.fit.offset.forEach((value, k) => expect(value).toBeCloseTo(origin[k] ?? 0, 3));
    expect(result.fit.snug).toBe(true);
  });

  it('keeps a converted brick inside its cells, studs on top', () => {
    const result = convertPart('3001.dat', flattener);
    if (!result.ok) throw new Error('3001.dat was skipped');
    const { positions } = decodePartMesh(encodePartMesh(result.mesh));
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    positions.forEach((value, i) => {
      min[i % 3] = Math.min(min[i % 3] ?? Infinity, value);
      max[i % 3] = Math.max(max[i % 3] ?? -Infinity, value);
    });
    expect(min[0]).toBeCloseTo(-2, 2);
    expect(max[0]).toBeCloseTo(2, 2);
    expect(min[2]).toBeCloseTo(-1, 2);
    expect(max[2]).toBeCloseTo(1, 2);
    expect(min[1]).toBeCloseTo(0, 2);
    // studs stand 4 LDU (0.2 studs) above the 1.2-stud body
    expect(max[1]).toBeCloseTo(1.4, 2);
  });

  /** The cells of its box a converted part leaves free, as sorted "x,y,z" keys. */
  function freeCells(file: string): string[] {
    const result = convertPart(file, flattener);
    if (!result.ok) throw new Error(`${file} was skipped: ${result.reason}`);
    const { w, d, h } = result.fit;
    const filled = new Set<string>();
    for (const [x0, y0, z0, x1, y1, z1] of result.solids ?? [[0, 0, 0, w, h, d]]) {
      for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) filled.add(`${x},${y},${z}`);
    }
    const free: string[] = [];
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) if (!filled.has(`${x},${y},${z}`)) free.push(`${x},${y},${z}`);
    return free.sort();
  }

  it('fills only the cells real parts take up', () => {
    // bricks fill their box, hollow undersides and all; so do slopes and round bricks
    for (const file of ['3001.dat', '3039.dat', '3062b.dat', '3941.dat']) expect(freeCells(file)).toEqual([]);
    // the missing corner of a corner plate and a corner brick
    expect(freeCells('2420.dat')).toEqual(['1,0,0']);
    expect(freeCells('2357.dat')).toEqual(['1,0,0', '1,1,0', '1,2,0']);
    // the opening of an arch, and of a door frame between its posts
    expect(freeCells('3307.dat')).toEqual(['1,0,0', '2,0,0', '2,1,0', '2,2,0', '2,3,0', '3,0,0', '3,1,0', '3,2,0', '3,3,0', '4,0,0']);
    expect(freeCells('30179.dat')).toEqual(Array.from({ length: 16 }, (_, y) => [`1,${y + 1},0`, `2,${y + 1},0`]).flat().sort());
    // under a bracket's top plate, where the wall its other plate hangs over goes
    expect(freeCells('44728.dat')).toEqual(['0,0,0', '0,1,0', '0,2,0', '0,3,0', '1,0,0', '1,1,0', '1,2,0', '1,3,0']);
  });

  it('keeps the colours parts fix in layers of their own', () => {
    const colours = readColourTable(readFileSync(join(LDRAW_DIR ?? '', 'LDConfig.ldr'), 'utf8'));
    const layersOf = (file: string) => {
      const result = convertPart(file, flattener, colours);
      if (!result.ok) throw new Error(`${file} was skipped: ${result.reason}`);
      return (result.mesh.layers ?? []).map(({ code, hex, finish }) => ({ code, hex, finish }));
    };
    // a wheel rim in the brick's colour with its rubber tyre
    expect(layersOf('11208c01.dat')).toEqual([
      { code: 16, hex: '#ffffff', finish: 'solid' },
      { code: 256, hex: '#1b2a34', finish: 'solid' },
    ]);
    // a pull-back motor with an axle of its own colours
    expect(layersOf('10039.dat').length).toBeGreaterThan(1);
  });
});
