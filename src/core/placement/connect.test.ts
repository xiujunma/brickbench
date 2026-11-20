import { describe, expect, it } from 'bun:test';
import { PLATE_HEIGHT, type Vec3 } from '../grid';
import { brickConnectors, engaged } from '../model/connections';
import { brickCellBox, isLoose } from '../model/geometry';
import { technicLookup as lookup } from '../model/technicTestParts';
import { makeBrick } from '../model/testUtils';
import type { Brick } from '../model/types';
import { attachToConnector, type ConnectTurn } from './connect';
import { materialize, payloadFromPart } from './payload';
import type { Hit } from './ray';

const STILL: ConnectTurn = { spin: 0, flipped: false };

function hit(point: Vec3, normal: Vec3, brickId: string): Hit {
  return { kind: 'brick', brickId, point, normal, t: 1, base: 0 };
}

/** Builds `partId` plugged into `target` at the cursor, or null. */
function plug(target: Brick, partId: string, point: Vec3, normal: Vec3, turned: ConnectTurn = STILL, id = 'new'): Brick | null {
  const part = lookup(partId);
  if (!part) throw new Error(partId);
  const attached = attachToConnector(hit(point, normal, target.id), target, payloadFromPart(part, 4, 0), turned, lookup);
  if (!attached) return null;
  const [brick] = materialize(attached.payload, attached.offset, () => id);
  return brick ?? null;
}

/** A brick's box in the world, in studs on every axis, to 0.001. */
function box(brick: Brick): { x: number[]; y: number[]; z: number[] } {
  const cells = brickCellBox(brick, lookup);
  const r = (v: number) => Math.round(v * 1000) / 1000 + 0;
  return { x: [r(cells.x0), r(cells.x1)], y: [r(cells.y0 * PLATE_HEIGHT), r(cells.y1 * PLATE_HEIGHT)], z: [r(cells.z0), r(cells.z1)] };
}

function pluggedInto(a: Brick, b: Brick): boolean {
  return brickConnectors(a, lookup).some((mine) => brickConnectors(b, lookup).some((theirs) => engaged(mine, theirs)));
}

const UP = { x: 0, y: 1, z: 0 };
const beam = makeBrick({ id: 'beam', partId: 'beam' });

describe('plugging a pin into a hole', () => {
  it('pushes it in from the side the cursor is on, as far as it goes, its other end standing out', () => {
    // over the beam's middle hole, from above
    const pin = plug(beam, 'pin', { x: 0.55, y: 1.2, z: 1.45 }, UP);
    if (!pin) throw new Error('no pin');
    expect(isLoose(pin)).toBe(true);
    expect(pluggedInto(pin, beam)).toBe(true);
    const { x, y, z } = box(pin);
    expect(y).toEqual([0, 2]);
    expect((x[0]! + x[1]!) / 2).toBeCloseTo(0.5, 9);
    expect((z[0]! + z[1]!) / 2).toBeCloseTo(1.5, 9);
    // from below, it goes in upwards
    const under = plug(beam, 'pin', { x: 0.5, y: 0, z: 1.5 }, { x: 0, y: -1, z: 0 });
    expect(under && box(under).y).toEqual([-1, 1]);
  });

  it('pushes an axle through a hole, flush with its far face, the rest towards the cursor', () => {
    const brick = makeBrick({ id: 'brick', partId: 'technic-brick' });
    const axle = plug(brick, 'axle', { x: 1.05, y: 0.75, z: 1 }, { x: 0, y: 0, z: 1 });
    if (!axle) throw new Error('no axle');
    expect(box(axle).z).toEqual([0, 4]);
    expect(pluggedInto(axle, brick)).toBe(true);
  });
});

describe('plugging a part onto a pin or an axle', () => {
  const pin = plug(beam, 'pin', { x: 0.55, y: 1.2, z: 1.45 }, UP, STILL, 'pin') as Brick;

  it('slides a beam onto the pin from its base, lying flat, by its end hole', () => {
    const top = plug(pin, 'beam', { x: 0.9, y: 1.6, z: 1.5 }, { x: 1, y: 0, z: 0 });
    if (!top) throw new Error('no beam');
    expect(box(top)).toEqual({ x: [0, 1], y: [1, 2.2], z: [1, 4] });
    expect(pluggedInto(top, pin)).toBe(true);
  });

  it('turns it a quarter about the pin for each R', () => {
    const turned = plug(pin, 'beam', { x: 0.9, y: 1.6, z: 1.5 }, { x: 1, y: 0, z: 0 }, { spin: 1, flipped: false });
    expect(turned && box(turned)).toEqual({ x: [0, 3], y: [1, 2.2], z: [1, 2] });
  });

  it('slides a bush along an axle, half a stud at a time', () => {
    const brick = makeBrick({ id: 'brick', partId: 'technic-brick' });
    const axle = plug(brick, 'axle', { x: 1.05, y: 0.75, z: 1 }, { x: 0, y: 0, z: 1 }, STILL, 'axle') as Brick;
    const bush = plug(axle, 'bush', { x: 1.3, y: 0.7, z: 2.8 }, { x: 1, y: 0, z: 0 });
    if (!bush) throw new Error('no bush');
    const [hole] = brickConnectors(bush, lookup);
    expect(hole?.at.x).toBeCloseTo(1, 9);
    expect(hole?.at.y).toBeCloseTo(0.7, 9);
    expect(hole?.at.z).toBeCloseTo(3, 9);
    expect(pluggedInto(bush, axle)).toBe(true);
  });
});

describe('plugging a click hinge together', () => {
  const fork = makeBrick({ id: 'fork', partId: 'fork' });
  const at = { x: 2.9, y: 0.75, z: 1 };
  const front = { x: 0, y: 0, z: 1 };

  it('fits the finger into the fork, the parts either side of it', () => {
    const finger = plug(fork, 'finger', at, front);
    if (!finger) throw new Error('no finger');
    expect(box(finger)).toEqual({ x: [2, 5], y: [0, 1.2], z: [0, 1] });
    expect(pluggedInto(finger, fork)).toBe(true);
  });

  it('turns it end over end along the hinge with T', () => {
    const flipped = plug(fork, 'finger', at, front, { spin: 0, flipped: true });
    if (!flipped?.m) throw new Error('not turned');
    // upside down
    expect(flipped.m[4]).toBeCloseTo(-1, 9);
    expect(pluggedInto(flipped, fork)).toBe(true);
  });
});

describe('what does not plug in', () => {
  it('leaves parts without a connection to match, cursors away from one, and groups to the studs', () => {
    expect(plug(beam, 'brick-2x4', { x: 0.55, y: 1.2, z: 1.45 }, UP)).toBeNull();
    expect(plug(beam, 'pin', { x: 0.5, y: 1.2, z: 0.05 }, UP)).toBeNull();
    // a hole's mouth, not its whole length: the side of the beam is not a way in
    expect(plug(beam, 'pin', { x: 1, y: 0.5, z: 1.5 }, { x: 1, y: 0, z: 0 })).toBeNull();
    const pinPart = lookup('pin');
    if (!pinPart) throw new Error('pin');
    const single = payloadFromPart(pinPart, 4, 0);
    const pair = { ...single, bricks: [...single.bricks, ...single.bricks] };
    expect(attachToConnector(hit({ x: 0.55, y: 1.2, z: 1.45 }, UP, 'beam'), beam, pair, STILL, lookup)).toBeNull();
  });
});
