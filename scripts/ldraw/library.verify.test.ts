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
import { HINGE_PRIMITIVES } from './connectors.ts';
import { convertPart } from './convert.ts';
import { Flattener } from './flatten.ts';
import { directorySource } from './library.ts';
import { parseLDraw, type Transform } from './parse.ts';

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

  it('finds the studs on parts’ sides, and none on plain bricks', () => {
    const sideOf = (file: string) => {
      const result = convertPart(file, flattener);
      if (!result.ok) throw new Error(`${file} was skipped: ${result.reason}`);
      return result.sideStuds;
    };
    // facing index 4 is +Z: the studs stand 14 LDU (0.7 studs) up a brick, out of its front half a stud from its middle
    expect(sideOf('87087.dat')).toEqual([[0, 0.7, 0.5, 4]]);
    expect(sideOf('11211.dat')).toEqual([
      [-0.5, 0.7, 0.5, 4],
      [0.5, 0.7, 0.5, 4],
    ]);
    // a bracket's four, on the face of its upright plate
    expect(sideOf('99207.dat')).toHaveLength(4);
    expect(sideOf('99207.dat').every(([, , z, facing]) => z === 0.7 && facing === 4)).toBe(true);
    for (const file of ['3001.dat', '3024.dat', '3794b.dat']) expect(sideOf(file)).toEqual([]);
  });

  it('finds the Technic and click-hinge connections of real parts', () => {
    const connectorsOf = (file: string) => {
      const result = convertPart(file, flattener);
      if (!result.ok) throw new Error(`${file} was skipped: ${result.reason}`);
      // [kind, x, y, z, ax, ay, az, length], to two places, with axes as they lie
      return result.connectors.map((entry) => entry.map((v) => Math.round(v * 100) / 100 + 0));
    };
    const kinds = (file: string) => connectorsOf(file).map(([kind]) => ['pin', 'pinhole', 'axle', 'axlehole', 'finger', 'fork'][kind ?? 0]);
    // a Technic brick's one hole runs through it from front to back, 0.7 studs (14 LDU) up from its bottom
    expect(connectorsOf('3700.dat')).toEqual([[1, 0, 0.7, 0, 0, 0, 1, 1]]);
    // a beam's three holes, upright, a stud apart
    expect(
      connectorsOf('32523.dat')
        .map(([, x, , z, , ay]) => [x, z, Math.abs(ay ?? 0)])
        .sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0)),
    ).toEqual([
      [0, -1, 1],
      [0, 0, 1],
      [0, 1, 1],
    ]);
    // a pin's two ends, each a stud long, pointing away from its middle; a long pin's three sections
    expect(connectorsOf('3673.dat').map(([kind, x, , , ax, , , length]) => [kind, x, ax, length])).toEqual([
      [0, -0.5, -1, 1],
      [0, 0.5, 1, 1],
    ]);
    expect(kinds('6558.dat')).toEqual(['pin', 'pin', 'pin']);
    // an axle 4 is four studs long, near enough (its bevelled ends are drawn a little short)
    expect(kinds('3705.dat')).toEqual(['axle']);
    expect(connectorsOf('3705.dat')[0]?.[7]).toBeCloseTo(4, 1);
    // a bush, a gear and a half bush take an axle; an axle pin is a pin at one end and an axle at the other
    for (const file of ['3713.dat', '3647.dat', '4265c.dat']) expect(kinds(file)).toEqual(['axlehole']);
    expect(kinds('43093.dat')).toEqual(['pin', 'axle']);
    // click hinges: one finger on a plate, and the fork of two it fits
    expect(kinds('44301.dat')).toEqual(['finger']);
    expect(kinds('44302.dat')).toEqual(['fork']);
    expect(connectorsOf('44301.dat')[0]?.slice(1, 4)).toEqual(connectorsOf('44302.dat')[0]?.slice(1, 4));
    // plain bricks and plates have none
    for (const file of ['3001.dat', '3024.dat', '87087.dat']) expect(connectorsOf(file)).toEqual([]);
  });

  it('turns each click hinge about where its round surfaces are centred', () => {
    const circle = /^(?:48\\|8\\)?\d+-\d+(?:edge|cyli|cylc|cylo|disc|ndis|con\d+|ring\d*|chrd|tndis|sphe)\.dat$/i;
    const compose = (p: Transform, c: Transform): Transform => {
      const [a, b, cc, d, e, f, g, h, i] = p.m;
      const [A, B, C, D, E, F, G, H, I] = c.m;
      const [x, y, z] = c.t;
      return {
        t: [p.t[0] + a * x + b * y + cc * z, p.t[1] + d * x + e * y + f * z, p.t[2] + g * x + h * y + i * z],
        m: [a * A + b * D + cc * G, a * B + b * E + cc * H, a * C + b * F + cc * I, d * A + e * D + f * G, d * B + e * E + f * H, d * C + e * F + f * I, g * A + h * D + i * G, g * B + h * E + i * H, g * C + h * F + i * I],
      };
    };
    // the centres, as "y,z", of the circles drawn about the primitive's X axis
    const centres = (file: string, at: Transform, found: Map<string, number>): void => {
      for (const line of parseLDraw(readFileSync(join(LDRAW_DIR ?? '', 'p', file.replace(/\\/g, '/').toLowerCase()), 'utf8'))) {
        if (line.kind !== 'ref') continue;
        const placed = compose(at, line.matrix);
        if (!circle.test(line.file)) {
          centres(line.file, placed, found);
          continue;
        }
        const [, b, , , e, , , h] = placed.m;
        if (Math.abs(b) / Math.hypot(b, e, h) < 0.999) continue;
        const key = `${Math.round(placed.t[1] * 100) / 100 + 0},${Math.round(placed.t[2] * 100) / 100 + 0}`;
        found.set(key, (found.get(key) ?? 0) + 1);
      }
    };
    for (const [name, primitive] of Object.entries(HINGE_PRIMITIVES)) {
      const found = new Map<string, number>();
      centres(`${name}.dat`, { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }, found);
      const [most] = [...found.entries()].sort((p, q) => q[1] - p[1]);
      expect(`${name} ${most?.[0]}`).toBe(`${name} ${primitive.through[1]},${primitive.through[2]}`);
    }
  });

  it('says which way a jumper plate’s stud sits between cells, and that a plain plate’s do not', () => {
    const offsetOf = (file: string) => {
      const result = convertPart(file, flattener);
      if (!result.ok) throw new Error(`${file} was skipped: ${result.reason}`);
      return result.fit.studOffset;
    };
    // 1 × 2 jumpers, with and without groove or understud; a 2 × 2 with one centre stud; a 1 × 3 with two studs offset
    for (const file of ['3794a.dat', '3794b.dat', '15573.dat', '34103.dat']) expect(offsetOf(file)).toEqual([0.5, 0]);
    expect(offsetOf('87580.dat')).toEqual([0.5, 0.5]);
    for (const file of ['3023.dat', '3024.dat', '3001.dat']) expect(offsetOf(file)).toEqual([0, 0]);
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
