import { describe, expect, it } from 'bun:test';
import { getPart } from '../parts/catalog';
import { makeBrick } from '../model/testUtils';
import { turnAbout } from '../orientation';
import { pickBricks, rayAabb, rayGround, type Ray } from './ray';

const box = { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 1, z: 2 } };
const down = (x: number, z: number, y = 10): Ray => ({
  origin: { x, y, z },
  dir: { x: 0, y: -1, z: 0 },
});

describe('rayAabb', () => {
  it('hits the top face from above', () => {
    const hit = rayAabb(down(1, 1), box);
    expect(hit?.t).toBeCloseTo(9);
    expect(hit?.normal).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('hits a side face', () => {
    const hit = rayAabb({ origin: { x: -5, y: 0.5, z: 1 }, dir: { x: 1, y: 0, z: 0 } }, box);
    expect(hit?.t).toBeCloseTo(5);
    expect(hit?.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  it('misses boxes behind the ray or off to the side', () => {
    expect(rayAabb({ origin: { x: 5, y: 0.5, z: 1 }, dir: { x: 1, y: 0, z: 0 } }, box)).toBeNull();
    expect(rayAabb(down(5, 5), box)).toBeNull();
  });

  it('ignores rays that start inside the box', () => {
    expect(rayAabb({ origin: { x: 1, y: 0.5, z: 1 }, dir: { x: 0, y: 1, z: 0 } }, box)).toBeNull();
  });
});

describe('rayGround', () => {
  it('finds where a downward ray meets the ground', () => {
    expect(rayGround(down(0, 0, 4), 0)).toBeCloseTo(4);
  });

  it('ignores rays pointing away from the ground', () => {
    expect(rayGround({ origin: { x: 0, y: 4, z: 0 }, dir: { x: 0, y: 1, z: 0 } }, 0)).toBeNull();
    expect(rayGround({ origin: { x: 0, y: 4, z: 0 }, dir: { x: 1, y: 0, z: 0 } }, 0)).toBeNull();
  });
});

describe('pickBricks', () => {
  const low = makeBrick({ id: 'low' });
  const high = makeBrick({ id: 'high', y: 3 });

  it('returns the nearest brick face', () => {
    const hit = pickBricks(down(1, 1), [low, high], getPart, { groundY: 0 });
    expect(hit?.brickId).toBe('high');
    expect(hit?.point.y).toBeCloseTo(2.4);
    expect(hit?.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(hit?.base).toBe(3);
  });

  it('reports the bottom layer of the solid that was hit', () => {
    const arch = makeBrick({ id: 'arch', partId: 'arch-1x4', y: 3 });
    const overOpening: Ray = { origin: { x: 2, y: 2.2, z: -5 }, dir: { x: 0, y: 0, z: 1 } };
    // the band above the opening starts one plate up from the arch's base
    expect(pickBricks(overOpening, [arch], getPart, { groundY: null })?.base).toBe(4);
  });

  it('skips excluded bricks', () => {
    const hit = pickBricks(down(1, 1), [low, high], getPart, {
      groundY: 0,
      exclude: new Set(['high']),
    });
    expect(hit?.brickId).toBe('low');
  });

  it('falls back to the ground', () => {
    const hit = pickBricks(down(20, 20), [low], getPart, { groundY: 0 });
    expect(hit).toMatchObject({ kind: 'ground', brickId: null });
    expect(hit?.point).toMatchObject({ x: 20, z: 20 });
  });

  it('only offers ground inside the baseplate when bounds are given', () => {
    const bounds = { minX: -16, maxX: 16, minZ: -16, maxZ: 16 };
    expect(pickBricks(down(20, 20), [], getPart, { groundY: 0, groundBounds: bounds })).toBeNull();
    expect(pickBricks(down(3, -4), [], getPart, { groundY: 0, groundBounds: bounds })?.kind).toBe('ground');
  });

  it('returns null when nothing is hit', () => {
    expect(pickBricks(down(20, 20), [low], getPart, { groundY: null })).toBeNull();
  });

  it('sees through the opening of an arch', () => {
    const arch = makeBrick({ id: 'arch', partId: 'arch-1x4' });
    const ray: Ray = { origin: { x: 2, y: 0.2, z: -5 }, dir: { x: 0, y: 0, z: 1 } };
    expect(pickBricks(ray, [arch], getPart, { groundY: null })).toBeNull();
    const leg: Ray = { origin: { x: 0.5, y: 0.2, z: -5 }, dir: { x: 0, y: 0, z: 1 } };
    expect(pickBricks(leg, [arch], getPart, { groundY: null })?.brickId).toBe('arch');
  });
});

describe('picking loose parts', () => {
  // a 2 × 2 plate turned an eighth about the vertical, its middle at (1, 0, 1): it reaches √2 studs from there along X
  const eighth = turnAbout({ x: 0, y: 1, z: 0 }, Math.PI / 4);
  const loose = makeBrick({ id: 'loose', partId: 'plate-2x2', x: 1 - Math.SQRT2, y: 0, z: 1 - Math.SQRT2, m: eighth });

  it('finds them by the boxes they fill, turned with them, and squares the face up', () => {
    const down: Ray = { origin: { x: 1, y: 5, z: 1 }, dir: { x: 0, y: -1, z: 0 } };
    const top = pickBricks(down, [loose], getPart, { groundY: null });
    expect(top?.brickId).toBe('loose');
    expect(top?.point.y).toBeCloseTo(0.4, 9);
    expect(top?.normal).toEqual({ x: 0, y: 1, z: 0 });
    // from the side, along X: the corner of the turned plate sticks out to x = 1 + √2
    const side = pickBricks({ origin: { x: 9, y: 0.2, z: 1 }, dir: { x: -1, y: 0, z: 0 } }, [loose], getPart, { groundY: null });
    expect(side?.point.x).toBeCloseTo(1 + Math.SQRT2, 9);
    expect(Math.abs(side?.normal.x ?? 0) + Math.abs(side?.normal.z ?? 0)).toBe(1);
    // its box's corner, outside the turned plate, is empty
    expect(pickBricks({ origin: { x: 2.3, y: 5, z: 2.3 }, dir: { x: 0, y: -1, z: 0 } }, [loose], getPart, { groundY: null })).toBeNull();
  });
});
