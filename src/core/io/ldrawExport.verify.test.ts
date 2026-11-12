/**
 * Round-trips every part through the LDraw exporter at all four rotations:
 * the exported line, applied to the real LDraw part file, must land exactly
 * where the brick sits in BrickBench (footprint, height and slope direction).
 *
 * Opt-in because it needs the library on disk:
 *   LDRAW_DIR=/path/to/ldraw bun test src/core/io/ldrawExport.verify.test.ts
 */
import { describe, expect, it } from 'bun:test';
import { LDU_PER_UNIT, PLATE_HEIGHT, STUD_HEIGHT, rotatePoint, type Rotation } from '../grid';
import { brickCellBox } from '../model/geometry';
import { modelFromBricks } from '../model/model';
import { PARTS, getPart } from '../parts/catalog';
import { LDrawLibrary, apply, bounds, type V3 } from '../parts/ldrawLibrary.verify';
import { toLDraw } from './ldraw';

const LDRAW_DIR = process.env['LDRAW_DIR'];
const TOLERANCE = 0.04;
const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];

const cases = PARTS.filter((p) => p.ldraw).flatMap((part) => ROTATIONS.map((r) => [part.id, r] as const));

describe.skipIf(!LDRAW_DIR)('LDraw export round trip', () => {
  const library = new LDrawLibrary(LDRAW_DIR ?? '');

  it.each(cases)('%s turned %i lands where it was built', (partId, r) => {
    const part = getPart(partId);
    if (!part) throw new Error(partId);
    const brick = { id: 'b', partId, colorId: 4, x: 3, y: 6, z: -5, r };
    const line = toLDraw('t', modelFromBricks([brick]), getPart).text.split('\r\n').find((l) => l.startsWith('1 '));
    if (!line) throw new Error('no brick line exported');
    const tokens = line.split(' ');
    const numbers = tokens.slice(2, 14).map(Number);
    const placement = { t: [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0] as V3, m: numbers.slice(3, 12) };

    // LDraw model coordinates back to our world: (x, y, z) / 20 → (x, -y, -z)
    const world = library
      .vertices(tokens.slice(14).join(' '))
      .map((v) => apply(placement, v))
      .map(([x, y, z]): V3 => [x / LDU_PER_UNIT, -y / LDU_PER_UNIT, -z / LDU_PER_UNIT]);
    const actual = bounds(world);
    const cells = brickCellBox(brick, getPart);
    const top = (cells.y1 * PLATE_HEIGHT) + (part.studs.length > 0 ? STUD_HEIGHT : 0);
    const expected = { min: [cells.x0, cells.y0 * PLATE_HEIGHT, cells.z0], max: [cells.x1, top, cells.z1] };
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(actual.min[k]! - expected.min[k]!), `min[${k}]`).toBeLessThan(TOLERANCE);
      expect(Math.abs(actual.max[k]! - expected.max[k]!), `max[${k}]`).toBeLessThan(TOLERANCE);
    }

    if (part.shape.kind === 'slope') {
      // the high side (stud rows for normal slopes, the base for inverted ones) faces local -Z turned by r
      const [hx, hz] = rotatePoint(0, -1, r);
      const centre = [(actual.min[0] + actual.max[0]) / 2, (actual.min[2] + actual.max[2]) / 2];
      const ys = world.map((p) => p[1]);
      const probe = part.shape.inverted
        ? world.filter((p) => p[1] < Math.min(...ys) + 0.02)
        : world.filter((p) => p[1] > Math.max(...ys) - STUD_HEIGHT - 0.02);
      const mx = probe.reduce((s, p) => s + p[0], 0) / probe.length - (centre[0] ?? 0);
      const mz = probe.reduce((s, p) => s + p[2], 0) / probe.length - (centre[1] ?? 0);
      expect(mx * hx + mz * hz, 'slope faces the wrong way').toBeGreaterThan(0);
    }
  });
});
