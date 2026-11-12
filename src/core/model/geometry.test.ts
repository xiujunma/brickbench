import { describe, expect, it } from 'bun:test';
import { getPart } from '../parts/catalog';
import { PLATE_HEIGHT } from '../grid';
import {
  brickCellBox,
  brickCells,
  brickWorldBoxes,
  groupCellBox,
  rotateGroup,
} from './geometry';
import { makeBrick } from './testUtils';
import type { Brick } from './types';

const lookup = getPart;

function footprint(bricks: readonly Brick[]): string[] {
  return bricks
    .map((b) => {
      const box = brickCellBox(b, lookup);
      return `${box.x0},${box.z0}-${box.x1},${box.z1}`;
    })
    .sort();
}

describe('brickCellBox', () => {
  it('covers the part footprint at its anchor', () => {
    expect(brickCellBox(makeBrick({ x: 1, y: 3, z: -2 }), lookup)).toEqual({
      x0: 1, y0: 3, z0: -2, x1: 5, y1: 6, z1: 0,
    });
  });

  it('swaps the footprint for quarter turns', () => {
    expect(brickCellBox(makeBrick({ r: 1 }), lookup)).toEqual({
      x0: 0, y0: 0, z0: 0, x1: 2, y1: 3, z1: 4,
    });
  });

  it('throws for unknown parts', () => {
    expect(() => brickCellBox(makeBrick({ partId: 'nope' }), lookup)).toThrow(/unknown part/i);
  });
});

describe('brickCells', () => {
  it('lists every occupied cell of a solid brick', () => {
    expect([...brickCells(makeBrick(), lookup)]).toHaveLength(4 * 2 * 3);
  });

  it('leaves the arch opening empty, even when rotated', () => {
    const cells = [...brickCells(makeBrick({ partId: 'arch-1x4', r: 1, x: 10, z: 10 }), lookup)];
    const keys = new Set(cells.map(([x, y, z]) => `${x},${y},${z}`));
    // rotated a quarter turn the arch runs along Z, its opening is the middle two rows
    expect(keys.has('10,0,10')).toBe(true);
    expect(keys.has('10,0,11')).toBe(false);
    expect(keys.has('10,0,12')).toBe(false);
    expect(keys.has('10,0,13')).toBe(true);
    expect(keys.has('10,2,11')).toBe(true);
  });
});

describe('brickWorldBoxes', () => {
  it('converts cell boxes into world units', () => {
    const [box] = brickWorldBoxes(makeBrick({ x: 2, y: 3, z: 1 }), lookup);
    expect(box?.min).toEqual({ x: 2, y: 3 * PLATE_HEIGHT, z: 1 });
    expect(box?.max.x).toBe(6);
    expect(box?.max.y).toBeCloseTo(6 * PLATE_HEIGHT);
    expect(box?.max.z).toBe(3);
  });
});

describe('groupCellBox', () => {
  it('bounds all bricks', () => {
    const box = groupCellBox([makeBrick(), makeBrick({ id: 'b2', x: 6, y: 3, z: -1 })], lookup);
    expect(box).toEqual({ x0: 0, y0: 0, z0: -1, x1: 10, y1: 6, z1: 2 });
  });

  it('rejects empty groups', () => {
    expect(() => groupCellBox([], lookup)).toThrow();
  });
});

describe('rotateGroup', () => {
  it('turns a single brick in place', () => {
    const [turned] = rotateGroup([makeBrick()], lookup, 1);
    expect(turned).toMatchObject({ r: 1, x: 1, z: -1 });
  });

  it('keeps a group arrangement while turning it', () => {
    // an L made from a 2x4 brick and a 1x2 brick sitting at its +X/+Z corner
    const group = [
      makeBrick({ id: 'long' }),
      makeBrick({ id: 'short', partId: 'brick-1x2', x: 2, z: 2 }),
    ];
    const turned = rotateGroup(group, lookup, 1);
    // the long brick now runs along Z and the short one sits on its +X side, low-Z half
    expect(footprint(turned)).toEqual(['0,-1-2,3', '2,-1-3,1']);
  });

  it('returns to the start after four quarter turns, including odd sizes', () => {
    const group = [
      makeBrick({ partId: 'brick-2x3' }),
      makeBrick({ id: 'b2', partId: 'brick-1x1', x: 3, z: 2 }),
    ];
    let current: readonly Brick[] = group;
    for (let i = 0; i < 4; i++) current = rotateGroup(current, lookup, 1);
    expect(current).toEqual(group);
  });

  it('undoes a turn with the opposite turn', () => {
    const group = [makeBrick({ partId: 'brick-2x3', x: 5, z: 7, r: 2 })];
    expect(rotateGroup(rotateGroup(group, lookup, 1), lookup, -1)).toEqual(group);
    expect(rotateGroup(rotateGroup(group, lookup, -1), lookup, 1)).toEqual(group);
  });
});
