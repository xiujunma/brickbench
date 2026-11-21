import { describe, expect, it } from 'bun:test';
import { PLATE_HEIGHT, type Vec3 } from '../grid';
import { brickConnectors, engaged } from '../model/connections';
import { brickCellBox, brickFloor, isLoose } from '../model/geometry';
import { isOutOfBounds } from '../model/spatial';
import { connectorLookup as lookup } from '../model/connectorTestParts';
import { makeBrick } from '../model/testUtils';
import { turnOf } from '../orientation';
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

describe('putting a minifigure together', () => {
  it('sets a head on the torso’s neck, facing the way the torso faces', () => {
    const torso = makeBrick({ id: 'torso', partId: 'torso', r: 1 });
    const head = plug(torso, 'head', { x: 0.55, y: 2, z: 1.05 }, UP);
    if (!head?.m) throw new Error('no head');
    turnOf(1).forEach((v, i) => expect(head.m?.[i]).toBeCloseTo(v, 9));
    expect(pluggedInto(head, torso)).toBe(true);
    // its underside on the torso's top, round the neck
    expect(box(head).y[0]).toBeCloseTo(1.6, 9);
  });

  it('seats a torso on both the hips’ studs, not on one with the other beside it', () => {
    const hips = makeBrick({ id: 'hips', partId: 'hips' });
    // the cursor over the hips' left stud
    const torso = plug(hips, 'torso', { x: 0.45, y: 2.8, z: 0.5 }, UP);
    if (!torso) throw new Error('no torso');
    expect(box(torso).x).toEqual([0, 2]);
    expect(box(torso).y[0]).toBeCloseTo(2, 9);
  });

  it('hangs an arm from a shoulder, out from the torso, tilted as the shoulder is', () => {
    const torso = makeBrick({ id: 'torso', partId: 'torso' });
    const arm = plug(torso, 'arm', { x: 0, y: 1.15, z: 0.55 }, { x: -1, y: 0, z: 0 });
    if (!arm?.m) throw new Error('no arm');
    expect(arm.m[4]).toBeCloseTo(0.985 / Math.hypot(0.985, 0.17), 9);
    const { x } = box(arm);
    expect(((x[0] ?? 0) + (x[1] ?? 0)) / 2).toBeLessThan(0);
    expect(pluggedInto(arm, torso)).toBe(true);
  });
});

describe('bars and clips', () => {
  it('lays a bar in a clip, along it, its middle in the clip', () => {
    const plate = makeBrick({ id: 'plate', partId: 'clip-plate' });
    // the clip's front, at its bar's line: x 0.5, y 0.3, z 1.5 in the world
    const bar = plug(plate, 'bar', { x: 0.55, y: 0.35, z: 2 }, { x: 0, y: 0, z: 1 });
    if (!bar) throw new Error('no bar');
    const [held] = brickConnectors(bar, lookup);
    expect(Math.abs(held?.axis.x ?? 0)).toBeCloseTo(1, 9);
    expect(held?.at.x).toBeCloseTo(0.5, 9);
    expect(held?.at.z).toBeCloseTo(1.5, 9);
    expect(pluggedInto(bar, plate)).toBe(true);
  });

  it('lets a bar lie in a clip near the ground, its shape clear of it though its box is not', () => {
    const plate = makeBrick({ id: 'plate', partId: 'clip-plate' });
    const bar = plug(plate, 'bar', { x: 0.55, y: 0.35, z: 2 }, { x: 0, y: 0, z: 1 });
    if (!bar) throw new Error('no bar');
    expect(brickCellBox(bar, lookup).y0).toBeLessThan(0);
    expect(isOutOfBounds(bar, lookup)).toBe(false);
    // a fifth of a stud under the clip's line, a quarter of a plate off the ground
    expect(brickFloor(bar, lookup)).toBeCloseTo(0.25, 9);
  });

  it('stands a bar in an open stud, down to the stud’s base', () => {
    const round = makeBrick({ id: 'round', partId: 'round-brick' });
    const bar = plug(round, 'bar', { x: 0.55, y: 1.4, z: 0.5 }, UP);
    if (!bar) throw new Error('no bar');
    // upright, from the stud's base, 1.2 up, three studs on up
    const [standing] = brickConnectors(bar, lookup);
    expect(Math.abs(standing?.axis.y ?? 0)).toBeCloseTo(1, 9);
    expect((standing?.at.y ?? 0) - (standing?.length ?? 0) / 2).toBeCloseTo(1.2, 9);
    expect(pluggedInto(bar, round)).toBe(true);
  });

  it('leaves a part that only has a bar on it, and a part with an open stud at a bar, to stack as ever', () => {
    const round = makeBrick({ id: 'round', partId: 'round-brick' });
    // a plate with a handle is no bar: at the round brick's stud it stacks
    expect(plug(round, 'handle-plate', { x: 0.55, y: 1.4, z: 0.5 }, UP)).toBeNull();
    // though its handle still goes into a clip
    const clip = makeBrick({ id: 'plate', partId: 'clip-plate' });
    expect(plug(clip, 'handle-plate', { x: 0.55, y: 0.35, z: 2 }, { x: 0, y: 0, z: 1 })).not.toBeNull();
    // an open stud is somewhere to put a bar, not a way onto one
    const upright = makeBrick({ id: 'bar', partId: 'bar' });
    expect(plug(upright, 'round-brick', { x: 0.8, y: 2.1, z: 0.5 }, { x: 1, y: 0, z: 0 })).toBeNull();
  });

  it('stands a part in an open stud only by the free bottom end of its bar', () => {
    const round = makeBrick({ id: 'round', partId: 'round-brick' });
    const top = { x: 0.55, y: 1.4, z: 0.5 };
    // a sword goes in hilt first, blade up
    const sword = plug(round, 'sword', top, UP);
    if (!sword?.m) throw new Error('no sword');
    expect(sword.m[4]).toBeCloseTo(1, 9);
    expect(box(sword).y[0]).toBeCloseTo(1.2, 9);
    // T can't turn it over there: an open stud is open only at its top
    expect(plug(round, 'sword', top, UP, { spin: 0, flipped: true })?.m?.[4]).toBeCloseTo(1, 9);
    // an antenna's mast is free only at its top: it stacks by its base, not upside down in the stud
    expect(plug(round, 'antenna', top, UP)).toBeNull();
    // under a stud facing down it still goes in hilt first, and hangs blade down
    const hanging = { ...round, id: 'hanging', y: 12, r: 4 };
    expect(plug(hanging, 'sword', { x: 0.5, y: 4.7, z: 0.5 }, { x: 0, y: -1, z: 0 })?.m?.[4]).toBeCloseTo(-1, 9);
  });

  it('slides a clip along a bar, half a stud at a time', () => {
    const upright = makeBrick({ id: 'bar', partId: 'bar' });
    const clip = plug(upright, 'clip-plate', { x: 0.8, y: 2.1, z: 0.5 }, { x: 1, y: 0, z: 0 });
    if (!clip) throw new Error('no clip');
    const [holding] = brickConnectors(clip, lookup);
    // on the bar's line, its lower end on the half stud nearest the cursor: 2 studs up the bar
    expect(holding?.at.x).toBeCloseTo(0.5, 9);
    expect((holding?.at.y ?? 0) - (holding?.length ?? 0) / 2).toBeCloseTo(2, 9);
    expect(pluggedInto(clip, upright)).toBe(true);
  });
});

describe('the older hinges and turntables', () => {
  it('sets a hinge’s top on its base as LDraw’s assembled hinge has it, and only on its own kind of base', () => {
    const base = makeBrick({ id: 'base', partId: 'hinge-base' });
    const top = plug(base, 'hinge-top', { x: 1, y: 1.2, z: 0.5 }, UP);
    if (!top?.m) throw new Error('no top');
    // closed, square to the base, in the top two plates of the base's own box
    expect(box(top)).toEqual({ x: [0, 2], y: [0.4, 1.2], z: [0, 1] });
    expect(top.m[0]).toBeCloseTo(1, 9);
    expect(top.m[4]).toBeCloseTo(1, 9);
    expect(pluggedInto(top, base)).toBe(true);
    // a turntable's top is no hinge top
    expect(plug(base, 'turn-top', { x: 1, y: 1.2, z: 0.5 }, UP)).toBeNull();
  });

  it('fits a hinge plate’s two fingers between another’s three, the plates end to end', () => {
    // three fingers on its +X end, about a pivot half a stud beyond the plate, at x 2.5
    const three = makeBrick({ id: 'three', partId: 'fingers-3' });
    const two = plug(three, 'fingers-2', { x: 2.5, y: 0.4, z: 0.5 }, UP);
    if (!two?.m) throw new Error('no plate');
    // turned half a turn to face it, flat, its fingers among the other's: the two boxes share the stud the fingers fill
    expect(box(two)).toEqual({ x: [2, 5], y: [0, 0.4], z: [0, 1] });
    expect(two.m[0]).toBeCloseTo(-1, 9);
    expect(two.m[4]).toBeCloseTo(1, 9);
    expect(pluggedInto(two, three)).toBe(true);
    // three fingers do not go into three, and a cursor well along the plate from the fingers is at its studs
    expect(plug(three, 'fingers-3', { x: 2.5, y: 0.4, z: 0.5 }, UP)).toBeNull();
    expect(plug(three, 'fingers-2', { x: 1.7, y: 0.4, z: 0.5 }, UP)).toBeNull();
  });

  it('chains a plate with fingers on both ends onto another like it, and never lays it over its twin', () => {
    // a 1 × 6 with two fingers on its +X end (pivot at x 7.5) and three on the other (at x 0.5)
    const first = makeBrick({ id: 'first', partId: 'fingers-both' });
    // turned half a turn it would lie right over the first, the fingers of both its ends in the other's: a part goes into one hinge of another, not through it
    const next = plug(first, 'fingers-both', { x: 7.5, y: 0.4, z: 0.5 }, UP);
    if (!next?.m) throw new Error('no plate');
    expect(box(next)).toEqual({ x: [7, 15], y: [0, 0.4], z: [0, 1] });
    expect(next.m[0]).toBeCloseTo(1, 9);
    expect(pluggedInto(next, first)).toBe(true);
    const before = plug(first, 'fingers-both', { x: 0.5, y: 0.4, z: 0.5 }, UP);
    expect(before && box(before)).toEqual({ x: [-7, 1], y: [0, 0.4], z: [0, 1] });
    // R stands it on end on the hinge, its fingers still in the other's
    const onEnd = plug(first, 'fingers-both', { x: 7.5, y: 0.4, z: 0.5 }, UP, { spin: 1, flipped: false });
    if (!onEnd?.m) throw new Error('not turned');
    expect(onEnd.m[4]).toBeCloseTo(0, 9);
    expect(pluggedInto(onEnd, first)).toBe(true);
  });

  it('sets a turntable’s top on its base, squared up with it, and turns it a quarter with R', () => {
    const base = makeBrick({ id: 'base', partId: 'turn-base', r: 1 });
    const top = plug(base, 'turn-top', { x: 1.2, y: 0.4, z: 0.9 }, UP);
    if (!top?.m) throw new Error('no top');
    expect(box(top)).toEqual({ x: [0, 2], y: [0, 0.4], z: [0, 2] });
    turnOf(1).forEach((v, i) => expect(top.m?.[i]).toBeCloseTo(v, 9));
    const turned = plug(base, 'turn-top', { x: 1.2, y: 0.4, z: 0.9 }, UP, { spin: 1, flipped: false });
    turnOf(2).forEach((v, i) => expect(Math.abs(turned?.m?.[i] ?? 9)).toBeCloseTo(Math.abs(v), 9));
  });
});
