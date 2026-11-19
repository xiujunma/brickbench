import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3, type BufferGeometry, type Intersection } from 'three';
import { describe, expect, it } from 'bun:test';
import { PLATE_HEIGHT } from '../../core/grid';
import { toPartDef } from '../../core/ldraw/catalogIndex';
import { getPart } from '../../core/parts/catalog';
import type { PartDef } from '../../core/parts/types';
import { BRICK_GAP, buildBodyGeometry } from './partGeometry';
import { cavityOf, ceilingAt, PIN_RADIUS, TOP, TUBE_INNER, TUBE_OUTER, tubeSpots, WALL } from './underside';

function part(id: string): PartDef {
  const found = getPart(id);
  if (!found) throw new Error(`missing part ${id}`);
  return found;
}

const BRICK = 3 * PLATE_HEIGHT;
const MATERIAL = new MeshBasicMaterial({ side: DoubleSide });

/** The first surface a ray meets in a part's body. */
function firstHit(def: PartDef, from: readonly [number, number, number], towards: readonly [number, number, number]): Intersection {
  const mesh = new Mesh(buildBodyGeometry(def), MATERIAL);
  const hit = new Raycaster(new Vector3(...from), new Vector3(...towards).normalize()).intersectObject(mesh)[0];
  if (!hit) throw new Error(`nothing from ${from.join(', ')}`);
  return hit;
}

/** Looking up at (x, z) from below: how high the first surface is, and whether it faces down at the viewer. */
function fromBelow(def: PartDef, x: number, z: number): { readonly y: number; readonly facingDown: boolean } {
  const hit = firstHit(def, [x, -1, z], [0, 1, 0]);
  return { y: hit.point.y, facingDown: (hit.face?.normal.y ?? 0) < -0.99 };
}

function triangles(geometry: BufferGeometry): number {
  return (geometry.getIndex()?.count ?? 0) / 3;
}

describe('where tubes and pins go', () => {
  it('puts a tube between every four studs and a pin between every two on 1 × n parts', () => {
    expect(tubeSpots(2, 2)).toEqual({ tubes: [[0, 0]], pins: [] });
    expect(tubeSpots(4, 2).tubes).toEqual([
      [-1, 0],
      [0, 0],
      [1, 0],
    ]);
    expect(tubeSpots(4, 1)).toEqual({ tubes: [], pins: [[-1, 0], [0, 0], [1, 0]] });
    expect(tubeSpots(1, 3)).toEqual({ tubes: [], pins: [[0, -0.5], [0, 0.5]] });
    expect(tubeSpots(1, 1)).toEqual({ tubes: [], pins: [] });
  });
});

describe('cavities in a cross-section', () => {
  it('move every edge in by the wall, the top by its thickness, and leave the floor open', () => {
    const cavity = cavityOf([[-1, 0], [1, 0], [1, 1], [-1, 1]], 1);
    expect(cavity?.map(([u, v]) => [Math.round(u * 1e6) / 1e6, Math.round(v * 1e6) / 1e6])).toEqual(
      expect.arrayContaining([
        [-1 + WALL, 0],
        [1 - WALL, 0],
        [1 - WALL, 1 - TOP],
        [-1 + WALL, 1 - TOP],
      ]),
    );
    expect(ceilingAt(cavity ?? [], 0)).toBeCloseTo(1 - TOP, 6);
  });

  it('are left out where there is no room for one', () => {
    expect(cavityOf([[0, 0], [0.3, 0], [0.3, 0.2], [0, 0.2]], 0.2)).toBeNull();
  });
});

describe('hollow undersides', () => {
  it('leave bricks, plates and tiles open below, up to a ceiling under the top', () => {
    expect(fromBelow(part('brick-2x4'), 0.5, 0)).toEqual({ y: expect.closeTo(BRICK - TOP, 6), facingDown: true });
    expect(fromBelow(part('plate-2x2'), 0.6, 0.6).y).toBeCloseTo(PLATE_HEIGHT - TOP, 6);
    expect(fromBelow(part('tile-1x2'), 0.5, 0).y).toBeCloseTo(PLATE_HEIGHT - TOP, 6);
    expect(fromBelow(part('brick-1x1'), 0, 0).y).toBeCloseTo(BRICK - TOP, 6);
  });

  it('stand them on a rim as thick as the walls', () => {
    expect(fromBelow(part('brick-2x4'), 2 - BRICK_GAP - WALL / 2, 0)).toEqual({ y: expect.closeTo(0, 6), facingDown: true });
  });

  it('put tubes between four studs, open in the middle, and pins under 1 × n parts', () => {
    const tubeWall = (TUBE_OUTER + TUBE_INNER) / 2;
    expect(fromBelow(part('brick-2x4'), 1 + tubeWall, 0).y).toBeCloseTo(0, 6);
    expect(fromBelow(part('brick-2x4'), 1, 0).y).toBeCloseTo(BRICK - TOP, 6);
    expect(fromBelow(part('brick-1x4'), PIN_RADIUS / 2, 0).y).toBeCloseTo(0, 6);
    expect(fromBelow(part('brick-1x4'), 0.5, 0).y).toBeCloseTo(BRICK - TOP, 6);
  });

  it('face the cavity’s walls inwards, at the wall’s thickness in from the outside', () => {
    const hit = firstHit(part('brick-2x4'), [0.5, 0.5, 0.6], [1, 0, 0]);
    expect(hit.point.x).toBeCloseTo(2 - BRICK_GAP - WALL, 6);
    expect(hit.face?.normal.x).toBeCloseTo(-1, 6);
  });

  it('follow a slope’s profile, higher under its top than under its slope, with a tube that stays under both', () => {
    const slope = part('slope45-2x2');
    const back = fromBelow(slope, 0.5, -0.6);
    const front = fromBelow(slope, 0.5, 0.6);
    expect(back).toEqual({ y: expect.closeTo(BRICK - TOP, 6), facingDown: true });
    expect(front.y).toBeGreaterThan(0.1);
    expect(front.y).toBeLessThan(back.y - 0.2);
    expect(fromBelow(slope, (TUBE_OUTER + TUBE_INNER) / 2, 0).y).toBeCloseTo(0, 6);
    expect(fromBelow(part('slope45-2x1'), PIN_RADIUS / 2, 0).y).toBeCloseTo(0, 6);
  });

  it('hollow round parts, with a tube in the middle of a 2 × 2', () => {
    expect(fromBelow(part('round-brick-2x2'), 0.6, 0).y).toBeCloseTo(BRICK - TOP, 6);
    expect(fromBelow(part('round-brick-2x2'), (TUBE_OUTER + TUBE_INNER) / 2, 0).y).toBeCloseTo(0, 6);
    expect(fromBelow(part('round-plate-1x1'), 0, 0).y).toBeCloseTo(PLATE_HEIGHT - TOP, 6);
  });

  it('hollow each leg of an arch like a 1 × 1 brick, leaving the opening as it was', () => {
    const arch = part('arch-1x4');
    expect(fromBelow(arch, -1.5, 0)).toEqual({ y: expect.closeTo(BRICK - TOP, 6), facingDown: true });
    expect(fromBelow(arch, 1.5, 0).y).toBeCloseTo(BRICK - TOP, 6);
    expect(fromBelow(arch, -(2 - BRICK_GAP - WALL / 2), 0).y).toBeCloseTo(0, 6);
    expect(fromBelow(arch, 0, 0).y).toBeGreaterThan(0.75);
    expect(fromBelow(part('arch-1x6x2'), -2.5, 0).y).toBeCloseTo(2 * BRICK - TOP, 6);
  });

  it('hollow inverted slopes under their flat back, following the slope up, and the cone along its sides', () => {
    const inverted = part('slope45-2x2-inv');
    expect(fromBelow(inverted, 0.5, -0.5)).toEqual({ y: expect.closeTo(BRICK - TOP, 6), facingDown: true });
    // in front, the underside slopes up: the first thing above is the slope itself
    expect(fromBelow(inverted, 0.5, 0.5).y).toBeGreaterThan(0.3);
    const cone = fromBelow(part('cone-1x1'), 0, 0);
    expect(cone.facingDown).toBe(true);
    expect(cone.y).toBeGreaterThan(0.5);
    expect(fromBelow(part('cone-1x1'), 0.45, 0).y).toBeCloseTo(0, 6);
  });

  it('keep the box that stands in for a library part solid', () => {
    const standIn = toPartDef({ id: '3001', name: 'Brick 2 × 4', category: 'Brick', w: 4, d: 2, h: 3, origin: [0, 0, 0], snug: true });
    expect(fromBelow(standIn, 0.5, 0).y).toBeCloseTo(0, 6);
  });

  it('stay light enough to draw big models: a 16 × 16 plate and its 225 tubes in under 20,000 triangles', () => {
    expect(triangles(buildBodyGeometry(part('brick-2x4')))).toBeLessThan(1500);
    expect(triangles(buildBodyGeometry(part('plate-16x16')))).toBeLessThan(20_000);
  });
});
