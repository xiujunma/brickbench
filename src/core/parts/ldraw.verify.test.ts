/**
 * Checks every catalogue part against the real LDraw library: the footprint,
 * height, origin and slope direction must line up with the LDraw part file,
 * otherwise LDraw exports would come out shifted or turned.
 *
 * Opt-in because it needs the library on disk:
 *   LDRAW_DIR=/path/to/ldraw bun test src/core/parts/ldraw.verify.test.ts
 */
import { describe, expect, it } from 'bun:test';
import { LDU_PER_UNIT, PLATE_HEIGHT } from '../grid';
import { PARTS } from './catalog';
import { LDrawLibrary, bounds, type Box, type V3 } from './ldrawLibrary.verify';
import type { PartDef } from './types';

const LDRAW_DIR = process.env['LDRAW_DIR'];
const TOLERANCE = 0.75;
const STUD_LDU = 4;

/** The box our part should occupy in LDraw part coordinates: (x, y, z) → 20·(x, -y, -z) about the origin. */
function expectedBox(part: PartDef): Box {
  const [ox, oy, oz] = part.ldraw?.origin ?? [0, 0, 0];
  const height = part.h * PLATE_HEIGHT;
  const s = LDU_PER_UNIT;
  const studs = part.studs.length > 0 ? STUD_LDU : 0;
  return {
    min: [s * (-part.w / 2 - ox), -s * (height - oy) - studs, -s * (part.d / 2 - oz)],
    max: [s * (part.w / 2 - ox), s * oy, s * (part.d / 2 + oz)],
  };
}

function meanZ(points: readonly V3[]): number {
  return points.reduce((sum, p) => sum + p[2], 0) / Math.max(points.length, 1);
}

describe.skipIf(!LDRAW_DIR)('LDraw mapping', () => {
  const library = new LDrawLibrary(LDRAW_DIR ?? '');

  it.each(PARTS.filter((p) => p.ldraw).map((p) => [p.id, p] as const))('%s matches its LDraw part', (_id, part) => {
    const points = library.vertices(part.ldraw?.file ?? '');
    const actual = bounds(points);
    const expected = expectedBox(part);
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(actual.min[k]! - expected.min[k]!), `min[${k}] ${actual.min[k]} vs ${expected.min[k]}`).toBeLessThan(TOLERANCE);
      expect(Math.abs(actual.max[k]! - expected.max[k]!), `max[${k}] ${actual.max[k]} vs ${expected.max[k]}`).toBeLessThan(TOLERANCE);
    }

    if (part.shape.kind === 'slope') {
      // our high side is local -Z, which is LDraw +Z
      const centreZ = (actual.min[2] + actual.max[2]) / 2;
      const ys = points.map((p) => p[1]);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      const probe = part.shape.inverted
        ? points.filter((p) => p[1] > bottom - 0.5)
        : points.filter((p) => p[1] < top + STUD_LDU + 0.5);
      expect(meanZ(probe), 'slope faces the wrong way').toBeGreaterThan(centreZ);
    }
  });
});
