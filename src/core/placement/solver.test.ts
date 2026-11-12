import { describe, expect, it } from 'bun:test';
import { getPart } from '../parts/catalog';
import { PLATE_HEIGHT } from '../grid';
import { makeBrick } from '../model/testUtils';
import type { Hit } from './ray';
import { materialize, payloadFromBricks, payloadFromPart, reuseIds, rotatePayload } from './payload';
import { solvePlacement } from './solver';

function part(id: string) {
  const found = getPart(id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

const brick2x4 = payloadFromPart(part('brick-2x4'), 4, 0);
const alwaysFree = () => true;

function hit(point: [number, number, number], normal: [number, number, number], base = 0): Hit {
  return {
    kind: 'brick',
    brickId: 'target',
    t: 1,
    point: { x: point[0], y: point[1], z: point[2] },
    normal: { x: normal[0], y: normal[1], z: normal[2] },
    base,
  };
}

describe('payloads', () => {
  it('centres the grab point on a single part', () => {
    expect(brick2x4.size).toEqual({ w: 4, h: 3, d: 2 });
    expect(brick2x4.grab).toEqual({ x: 2, y: 1.5, z: 1 });
  });

  it('uses the rotated footprint', () => {
    expect(payloadFromPart(part('brick-2x4'), 4, 1).size).toEqual({ w: 2, h: 3, d: 4 });
  });

  it('normalises a group of bricks to its corner and keeps the grab point', () => {
    const payload = payloadFromBricks(
      [makeBrick({ id: 'a', x: 5, y: 3, z: 5 }), makeBrick({ id: 'b', x: 9, y: 3, z: 5 })],
      getPart,
      { x: 6, y: 6 * PLATE_HEIGHT, z: 6 },
    );
    expect(payload.size).toEqual({ w: 8, h: 3, d: 2 });
    expect(payload.bricks.map((b) => [b.x, b.y, b.z])).toEqual([[0, 0, 0], [4, 0, 0]]);
    expect(payload.grab.x).toBeCloseTo(1);
    expect(payload.grab.y).toBeCloseTo(3);
    expect(payload.grab.z).toBeCloseTo(1);
  });

  it('turns a payload and keeps the grab in its centre', () => {
    const turned = rotatePayload(brick2x4, getPart, 1);
    expect(turned.size).toEqual({ w: 2, h: 3, d: 4 });
    expect(turned.bricks[0]?.r).toBe(1);
    expect(turned.grab).toEqual({ x: 1, y: 1.5, z: 2 });
  });

  it('reuses existing ids in order so moved bricks keep their identity', () => {
    const next = reuseIds(['a', 'b']);
    expect([next(), next(), next()]).toEqual(['a', 'b', 'extra-2']);
  });

  it('materialises bricks with fresh ids at an offset', () => {
    let n = 0;
    const bricks = materialize(brick2x4, { x: 3, y: 6, z: -2 }, () => `id${n++}`);
    expect(bricks).toEqual([
      { id: 'id0', partId: 'brick-2x4', colorId: 4, x: 3, y: 6, z: -2, r: 0 },
    ]);
  });
});

describe('solvePlacement', () => {
  it('centres a new part under the cursor on the ground', () => {
    const result = solvePlacement({ ...hit([2.3, 0, 1.6], [0, 1, 0]), kind: 'ground', brickId: null }, brick2x4, alwaysFree);
    expect(result).toEqual({ offset: { x: 0, y: 0, z: 1 }, valid: true });
  });

  it('stacks onto the top face of a brick', () => {
    const result = solvePlacement(hit([2, 3 * PLATE_HEIGHT, 1], [0, 1, 0]), brick2x4, alwaysFree);
    expect(result.offset.y).toBe(3);
    expect(result.valid).toBe(true);
  });

  it('lifts the part above anything in its way', () => {
    const result = solvePlacement(hit([2, 0, 1], [0, 1, 0]), brick2x4, (o) => o.y >= 6);
    expect(result).toEqual({ offset: { x: 0, y: 6, z: 0 }, valid: true });
  });

  it('keeps a grabbed point under the cursor when given the cursor ray', () => {
    // payload grabbed on its top face; the ray crosses that height at x = 2 and meets the ground at x = 4
    const grabbedTop = { ...brick2x4, grab: { x: 2, y: 3, z: 1 } };
    const ray = { origin: { x: 0, y: 2.4, z: 1 }, dir: { x: 2, y: -1.2, z: 0 } };
    const ground = { ...hit([4, 0, 1], [0, 1, 0]), kind: 'ground' as const, brickId: null };
    expect(ground.base).toBe(0);
    expect(solvePlacement(ground, grabbedTop, alwaysFree).offset.x).toBe(2);
    expect(solvePlacement(ground, grabbedTop, alwaysFree, { ray }).offset.x).toBe(0);
  });

  it('gives up lifting after the limit', () => {
    const result = solvePlacement(hit([2, 0, 1], [0, 1, 0]), brick2x4, () => false, { maxLift: 4 });
    expect(result.valid).toBe(false);
  });

  it('places against positive and negative side faces', () => {
    const plusX = solvePlacement(hit([4, 0.6, 1.2], [1, 0, 0]), brick2x4, alwaysFree);
    expect(plusX.offset).toEqual({ x: 4, y: 0, z: 0 });
    const minusZ = solvePlacement(hit([2.2, 0.6, 0], [0, 0, -1]), brick2x4, alwaysFree);
    expect(minusZ.offset).toEqual({ x: 0, y: 0, z: -2 });
  });

  it('lines side placements up with the bottom of the brick that was touched', () => {
    // anywhere on the side of a brick resting on layer 6 puts the new brick level with it
    for (const y of [6.1, 7.4, 8.9]) {
      const result = solvePlacement(hit([4, y * PLATE_HEIGHT, 1], [1, 0, 0], 6), brick2x4, alwaysFree);
      expect(result.offset.y).toBe(6);
    }
  });

  it('steps up a tall column one course at a time', () => {
    const column = hit([4, 10.5 * PLATE_HEIGHT, 1], [1, 0, 0], 0);
    expect(solvePlacement(column, brick2x4, alwaysFree).offset.y).toBe(9);
    const plate = payloadFromPart(part('plate-2x2'), 4, 0);
    expect(solvePlacement(column, plate, alwaysFree).offset.y).toBe(10);
  });

  it('hangs below a brick when aiming at its underside', () => {
    const result = solvePlacement(hit([2, 6 * PLATE_HEIGHT, 1], [0, -1, 0]), brick2x4, alwaysFree);
    expect(result).toEqual({ offset: { x: 0, y: 3, z: 0 }, valid: true });
  });

  it('rejects placements under the ground or into other bricks', () => {
    const underground = solvePlacement(hit([2, PLATE_HEIGHT, 1], [0, -1, 0]), brick2x4, alwaysFree);
    expect(underground.valid).toBe(false);
    const blocked = solvePlacement(hit([4, 0.6, 1], [1, 0, 0]), brick2x4, () => false);
    expect(blocked.valid).toBe(false);
  });
});
