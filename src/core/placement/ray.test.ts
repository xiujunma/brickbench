import { describe, expect, it } from 'bun:test';
import { PLATE_HEIGHT } from '../grid';
import { connectorLookup } from '../model/connectorTestParts';
import { brickCellBox } from '../model/geometry';
import { makeBrick } from '../model/testUtils';
import type { Brick } from '../model/types';
import { turnAbout } from '../orientation';
import { getPart } from '../parts/catalog';
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

describe('picking parts plugged into others', () => {
  const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;
  /** A brick's box of cells in the world, in world units. */
  const brickWorldBox = (brick: Brick) => {
    const box = brickCellBox(brick, connectorLookup);
    return { min: { x: box.x0, y: box.y0 * PLATE_HEIGHT, z: box.z0 }, max: { x: box.x1, y: box.y1 * PLATE_HEIGHT, z: box.z1 } };
  };

  it('finds a hinge’s top, which lies within its base’s box, where the two meet the ray together', () => {
    const base = makeBrick({ id: 'base', partId: 'hinge-base' });
    // closed on the base, as LDraw's assembled hinge has it: the top two plates of the base's box
    const top = { ...makeBrick({ id: 'top', partId: 'hinge-top', y: 1 }), m: IDENTITY };
    const fromAbove: Ray = { origin: { x: 1, y: 5, z: 0.5 }, dir: { x: 0, y: -1, z: 0 } };
    // whichever comes first in the model
    expect(pickBricks(fromAbove, [base, top], connectorLookup, { groundY: null })?.brickId).toBe('top');
    expect(pickBricks(fromAbove, [top, base], connectorLookup, { groundY: null })?.brickId).toBe('top');
    // below the top, on the base's side, it is the base
    const low: Ray = { origin: { x: 1, y: 0.2, z: 5 }, dir: { x: 0, y: 0, z: -1 } };
    expect(pickBricks(low, [base, top], connectorLookup, { groundY: null })?.brickId).toBe('base');
  });

  it('finds a 4 × 4 turntable’s top, which lies a little under the top of its base’s cells', () => {
    const base = makeBrick({ id: 'base', partId: 'turn-base-4' });
    // on the base as LDraw's assembled turntable has it: 0.3 studs up, its top a tenth of a stud under the top of the base's cells, which the base's hub does not reach
    const top = { ...makeBrick({ id: 'top', partId: 'turn-top-4', y: 0.75 }), m: IDENTITY };
    for (const [x, z] of [[2, 2], [0.5, 3.5], [3.9, 0.1]] as const) {
      const fromAbove: Ray = { origin: { x, y: 5, z }, dir: { x: 0, y: -1, z: 0 } };
      const found = pickBricks(fromAbove, [base, top], connectorLookup, { groundY: null });
      expect(found?.brickId).toBe('top');
      expect(found?.point.y).toBeCloseTo(1.1, 9);
      expect(pickBricks(fromAbove, [top, base], connectorLookup, { groundY: null })?.brickId).toBe('top');
    }
    // from the side: the top where it is, the base's plate under it
    const side = (y: number): Ray => ({ origin: { x: 2, y, z: 9 }, dir: { x: 0, y: 0, z: -1 } });
    expect(pickBricks(side(0.7), [base, top], connectorLookup, { groundY: null })?.brickId).toBe('top');
    expect(pickBricks(side(0.15), [base, top], connectorLookup, { groundY: null })?.brickId).toBe('base');
    // alone, the base is found by its cells, as bricks on the grid always are
    expect(pickBricks({ origin: { x: 2, y: 5, z: 2 }, dir: { x: 0, y: -1, z: 0 } }, [base], connectorLookup, { groundY: null })?.point.y).toBeCloseTo(1.2, 9);
  });

  it('finds a loose part seen past what a brick on the grid really fills, and that brick where it stands in front', () => {
    // a bar standing on the grid, a quarter turn round: a rod a fifth of a stud across up the middle of its cell
    const bar = makeBrick({ id: 'bar', partId: 'bar', r: 1 });
    // a loose plate lying behind it
    const behind = { ...makeBrick({ id: 'behind', partId: 'plate-2x2', z: -3 }), m: IDENTITY };
    const at = (x: number): Ray => ({ origin: { x, y: 0.2, z: 5 }, dir: { x: 0, y: 0, z: -1 } });
    // beside the rod, through its cell: the plate behind; with no loose part there, the bar by its cell, as ever
    expect(pickBricks(at(0.9), [bar, behind], connectorLookup, { groundY: null })?.brickId).toBe('behind');
    expect(pickBricks(at(0.9), [behind, bar], connectorLookup, { groundY: null })?.brickId).toBe('behind');
    expect(pickBricks(at(0.9), [bar], connectorLookup, { groundY: null })?.brickId).toBe('bar');
    // on the rod: the bar, at its cell's face
    const onRod = pickBricks(at(0.5), [bar, behind], connectorLookup, { groundY: null });
    expect(onRod?.brickId).toBe('bar');
    expect(onRod?.point.z).toBeCloseTo(1, 9);
    // what a brick really fills turns with it: a sword's blade, a stud wide and a fifth of one thick, is in the way 0.3 from its
    // middle while it faces the ray, and not once turned a quarter round
    expect(pickBricks(at(0.8), [makeBrick({ id: 'sword', partId: 'sword' }), behind], connectorLookup, { groundY: null })?.brickId).toBe('sword');
    expect(pickBricks(at(0.8), [makeBrick({ id: 'sword', partId: 'sword', r: 1 }), behind], connectorLookup, { groundY: null })?.brickId).toBe('behind');
    // a brick on the grid between them hides the plate: the bar's cell is nearest, as among bricks on the grid it always was
    const between = makeBrick({ id: 'between', partId: 'brick-1x1', z: -1 });
    expect(pickBricks(at(0.9), [bar, behind, between], connectorLookup, { groundY: null })?.brickId).toBe('bar');
    // the ground under a loose part is not found before it
    expect(pickBricks({ origin: { x: 1, y: 5, z: -2 }, dir: { x: 0, y: -1, z: 0 } }, [bar, behind], connectorLookup, { groundY: 0 })?.brickId).toBe('behind');
  });

  it('finds a loose part by the shape it really fills, when the library says: a bar by its rod, and says where on its cell', () => {
    // a bar 3 studs long standing at the origin's cell, a fifth of a stud across
    const bar = { ...makeBrick({ id: 'bar', partId: 'bar' }), m: IDENTITY };
    const at = (x: number): Ray => ({ origin: { x, y: 1, z: 5 }, dir: { x: 0, y: 0, z: -1 } });
    const onIt = pickBricks(at(0.5), [bar], connectorLookup, { groundY: null });
    expect(onIt?.brickId).toBe('bar');
    // the place is where the ray comes into the bar's cell, not 0.3 further in at the rod: parts are placed against cells
    expect(onIt?.point.z).toBeCloseTo(1, 9);
    expect(onIt?.normal).toEqual({ x: 0, y: 0, z: 1 });
    // beside the bar, inside its cell: nothing
    expect(pickBricks(at(0.9), [bar], connectorLookup, { groundY: null })).toBeNull();
    // from inside its cell, the rod itself
    const within = pickBricks({ origin: { x: 0.95, y: 1, z: 0.5 }, dir: { x: -1, y: 0, z: 0 } }, [bar], connectorLookup, { groundY: null });
    expect(within?.point.x).toBeCloseTo(0.7, 9);
    // lying along X, it is found by its rod there too, and placed against by its cell, turned with it
    const lying = { ...makeBrick({ id: 'lying', partId: 'bar', y: 5 }), m: turnAbout({ x: 0, y: 0, z: 1 }, -Math.PI / 2) };
    const down = (x: number, z: number): Ray => ({ origin: { x, y: 9, z }, dir: { x: 0, y: -1, z: 0 } });
    const box = brickWorldBox(lying);
    const [cx, cz] = [(box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2];
    const onRod = pickBricks(down(cx, cz), [lying], connectorLookup, { groundY: null });
    expect(onRod?.brickId).toBe('lying');
    expect(onRod?.point.y).toBeCloseTo(box.max.y, 9);
    expect(pickBricks(down(cx, cz + 0.4), [lying], connectorLookup, { groundY: null })).toBeNull();
  });
});
