/**
 * Converts real parts from the LDraw library and checks they land on the grid
 * exactly where the built-in catalogue (itself verified against LDraw) puts
 * them, so library parts and built-in parts line up and export identically.
 *
 * Opt-in because it needs the library on disk:
 *   LDRAW_DIR=/path/to/ldraw bun test scripts/ldraw/library.verify.test.ts
 */
import { describe, expect, it } from 'bun:test';
import { decodePartMesh, encodePartMesh } from '../../src/core/ldraw/format.ts';
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

  it('skips parts drawn in several fixed colours', () => {
    // a pull-back motor with a white axle: two fixed colours
    expect(convertPart('10039.dat', flattener)).toMatchObject({ ok: false, reason: 'multicolour' });
  });
});
