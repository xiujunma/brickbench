import { describe, expect, it } from 'bun:test';
import { getColor } from '../core/colors';
import { brickCells } from '../core/model/geometry';
import { allBricks } from '../core/model/model';
import { isOutOfBounds } from '../core/model/spatial';
import { getPart } from '../core/parts/catalog';
import { cottageSample } from './cottage';

function ids() {
  let n = 0;
  return () => `s${n++}`;
}

describe('cottage sample', () => {
  const doc = cottageSample(ids());
  const bricks = allBricks(doc.model);

  it('uses only known parts and colours', () => {
    for (const brick of bricks) {
      expect(getPart(brick.partId), brick.partId).toBeDefined();
      expect(getColor(brick.colorId), String(brick.colorId)).toBeDefined();
    }
  });

  it('keeps every brick on the grid and inside the baseplate', () => {
    const half = doc.settings.baseplateSize / 2;
    for (const brick of bricks) {
      expect(isOutOfBounds(brick, getPart)).toBe(false);
      expect(Math.abs(brick.x)).toBeLessThanOrEqual(half);
      expect(Math.abs(brick.z)).toBeLessThanOrEqual(half);
    }
  });

  it('has no overlapping bricks', () => {
    const owners = new Map<string, string>();
    for (const brick of bricks) {
      for (const [x, y, z] of brickCells(brick, getPart)) {
        const key = `${x},${y},${z}`;
        expect(owners.get(key), `${brick.partId} overlaps at ${key}`).toBeUndefined();
        owners.set(key, brick.id);
      }
    }
  });
});
