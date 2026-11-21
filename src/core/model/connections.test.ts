import { describe, expect, it } from 'bun:test';
import { type Vec3 } from '../grid';
import { attachToConnector } from '../placement/connect';
import { materialize, payloadFromPart } from '../placement/payload';
import { brickConnectors, engaged, hasRoom, holdOf, inTheWay, mates, stretchOn, turnsFreely, type Stretch, type WorldConnector } from './connections';
import { connectorLookup as lookup } from './connectorTestParts';
import { makeBrick } from './testUtils';
import type { Brick } from './types';

const UP = { x: 0, y: 1, z: 0 };
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;

/** Builds `partId` plugged into `target` at the cursor, with id `id`. */
function plug(target: Brick, partId: string, point: Vec3, normal: Vec3, id: string): Brick {
  const part = lookup(partId);
  if (!part) throw new Error(partId);
  const attached = attachToConnector({ kind: 'brick', brickId: target.id, point, normal, t: 1, base: 0 }, target, payloadFromPart(part, 4, 0), { spin: 0, flipped: false }, lookup, []);
  const [brick] = attached ? materialize(attached.payload, attached.offset, () => id) : [];
  if (!brick) throw new Error(`${partId} did not plug in`);
  return brick;
}

describe('connections of placed parts', () => {
  it('turn and move with the part', () => {
    const [hole] = brickConnectors(makeBrick({ partId: 'technic-brick', x: 3 }), lookup);
    expect(hole).toEqual({ kind: 'pinhole', at: { x: 4, y: 0.7, z: 0.5 }, axis: { x: 0, y: 0, z: 1 }, length: 1 });
    // a quarter turn about the vertical takes its hole from front to back to side to side
    const [turned] = brickConnectors(makeBrick({ partId: 'technic-brick', r: 1 }), lookup);
    expect(turned?.axis.x).toBeCloseTo(1, 9);
    expect(brickConnectors(makeBrick(), lookup)).toEqual([]);
  });

  it('plug pins into pin holes, axles into either hole and hinge fingers into forks; only an axle hole holds an axle still', () => {
    expect(mates('pin', 'pinhole')).toBe(true);
    expect(mates('pinhole', 'axle')).toBe(true);
    expect(mates('axlehole', 'axle')).toBe(true);
    expect(mates('fork', 'finger')).toBe(true);
    expect(mates('pin', 'axlehole')).toBe(false);
    expect(mates('pin', 'pin')).toBe(false);
    expect(mates('finger', 'finger')).toBe(false);
    expect(turnsFreely('pin', 'pinhole')).toBe(true);
    expect(turnsFreely('axle', 'pinhole')).toBe(true);
    expect(turnsFreely('axlehole', 'axle')).toBe(false);
    // a minifigure's head on its neck, hips under its waist, legs, arms and hands
    for (const [a, b] of [['neck', 'head'], ['hips', 'waist'], ['hip', 'leg'], ['arm', 'shoulder'], ['wrist', 'hand']] as const) expect(mates(a, b)).toBe(true);
    expect(mates('head', 'waist')).toBe(false);
    // the older hinges and the turntables: each half with its own other half only
    for (const [a, b] of [['fingers2', 'fingers3'], ['hingetop', 'hingebase'], ['swivelbase', 'swiveltop'], ['turntop', 'turnbase'], ['turnbase4', 'turntop4'], ['turnsnap', 'turnflat']] as const) {
      expect(mates(a, b)).toBe(true);
      expect(turnsFreely(a, b)).toBe(true);
    }
    expect(mates('hingetop', 'turnbase')).toBe(false);
    expect(mates('fingers2', 'fork')).toBe(false);
    expect(mates('turntop', 'turnbase4')).toBe(false);
    // a bar in a clip, or in a minifigure's hand, which turns in it
    expect(mates('clip', 'bar')).toBe(true);
    expect(mates('barhole', 'bar')).toBe(true);
    expect(mates('barhole', 'pin')).toBe(false);
    expect(mates('bar', 'pinhole')).toBe(false);
    expect(turnsFreely('bar', 'clip')).toBe(true);
    expect(mates('arm', 'pinhole')).toBe(false);
    // heads, legs, arms and hands turn; a torso on its hips does not
    expect(turnsFreely('neck', 'head')).toBe(true);
    expect(turnsFreely('hips', 'waist')).toBe(false);
  });

  it('are plugged together when they mate, lie on one line and overlap along it', () => {
    const beam = makeBrick({ id: 'beam', partId: 'beam' });
    const pin = plug(beam, 'pin', { x: 0.55, y: 1.2, z: 1.45 }, UP, 'pin');
    const [inside, standing] = brickConnectors(pin, lookup).sort((a, b) => a.at.y - b.at.y);
    const holes = brickConnectors(beam, lookup);
    if (!inside || !standing) throw new Error('pin ends');
    expect(holes.filter((hole) => engaged(inside, hole))).toHaveLength(1);
    expect(holes.some((hole) => engaged(standing, hole))).toBe(false);
  });
});

describe('room along a connection', () => {
  it('tells parts side by side from parts in each other’s way, the same wherever in the world they are', () => {
    for (let x = -30; x <= 30; x += 0.7) {
      const at = (from: number, length: number): Stretch => ({ from: x + from, to: x + from + length, way: 1 });
      // a twentieth of a stud into each other, as parts set along an axle LDraw draws that much short: side by side
      expect(inTheWay(at(0, 1), at(0.95, 1))).toBe(false);
      expect(inTheWay(at(0, 0.1), at(0.05, 0.1))).toBe(false);
      // a tenth of a stud into each other, the whole of the shortest connections there are: in the way
      expect(inTheWay(at(0, 1), at(0.9, 1))).toBe(true);
      expect(inTheWay(at(0, 0.1), at(0, 0.1))).toBe(true);
      // and so are those three quarters on each other
      expect(inTheWay(at(0, 0.1), at(0.025, 0.1))).toBe(true);
    }
  });

  it('gives a hole room for what is clear of what is in it, and a minifigure’s hips room for a leg each side', () => {
    const along = (kind: WorldConnector['kind'], x: number, length: number, way: 1 | -1 = 1): WorldConnector => ({ kind, at: { x, y: 0, z: 0 }, axis: { x: way, y: 0, z: 0 }, length });
    const hole = along('pinhole', 0, 2);
    const inLeft = stretchOn(hole, along('pin', -0.5, 1));
    expect(inLeft).toEqual({ from: -1, to: 0, way: 1 });
    expect(hasRoom(hole, stretchOn(hole, along('pin', 0.5, 1, -1)), [inLeft])).toBe(true);
    expect(hasRoom(hole, stretchOn(hole, along('axle', 0, 2)), [inLeft])).toBe(false);
    // both legs' joints lie on the middle of the hips' axle: one that points the other way is on the other side of it
    const hip = along('hip', 0, 2);
    const right = stretchOn(hip, along('leg', 0, 1, -1));
    expect(hasRoom(hip, stretchOn(hip, along('leg', 0, 1)), [right])).toBe(true);
    expect(hasRoom(hip, stretchOn(hip, along('leg', 0, 1, -1)), [right])).toBe(false);
    // a neck is no such thing: a second head, even upside down, is where the first is
    const neck = along('neck', 0, 0.2);
    expect(hasRoom(neck, stretchOn(neck, along('head', 0, 0.2, -1)), [stretchOn(neck, along('head', 0, 0.2))])).toBe(false);
  });
});

describe('what a group hangs by', () => {
  const beam = makeBrick({ id: 'beam', partId: 'beam' });
  const pin = plug(beam, 'pin', { x: 0.55, y: 1.2, z: 1.45 }, UP, 'pin');
  const top = plug(pin, 'beam', { x: 0.9, y: 1.6, z: 1.5 }, { x: 1, y: 0, z: 0 }, 'top');
  const model = [beam, pin, top];

  /** A brick a brick's height up, off the baseplate. */
  const raised = (brick: Brick): Brick => ({ ...brick, y: brick.y + 3 });

  it('swings about a pin it hangs on, alone or with the pin', () => {
    const up = model.map(raised);
    for (const [group, all] of [[[top], model], [[pin, top], model], [[raised(beam)], up]] as const) {
      const hold = holdOf(group, all, lookup);
      if (hold.kind !== 'joint') throw new Error(`${group.map((b) => b.id).join('+')} is held ${hold.kind}`);
      expect(Math.abs(hold.axis.y)).toBeCloseTo(1, 9);
      expect(hold.pivot.x).toBeCloseTo(0.5, 9);
      expect(hold.pivot.z).toBeCloseTo(1.5, 9);
    }
  });

  it('swings a hinge’s top on its base, and with it what stands on the base’s cells over it', () => {
    const base = makeBrick({ id: 'base', partId: 'hinge-base', y: 3 });
    // plugged in where LDraw's assembled hinge puts the top: loose, inside the top of the base's box
    const top = { ...makeBrick({ id: 'top', partId: 'hinge-top', y: 4 }), m: IDENTITY };
    const hold = holdOf([top], [makeBrick({ id: 'under', partId: 'brick-2x4' }), base, top], lookup);
    if (hold.kind !== 'joint') throw new Error(`the top is held ${hold.kind}`);
    expect(Math.abs(hold.axis.x)).toBeCloseTo(1, 9);
    expect(hold.pivot.y).toBeCloseTo(3 * 0.4 + 0.7, 9);
    // a plate on the grid over the closed top stands on the base's cells, which reach up round the top: with the top it swings,
    // for the base holds the two by the hinge, not by studs
    const plate = makeBrick({ id: 'plate', partId: 'plate-1x2', y: 6 });
    expect(holdOf([top, plate], [base, top, plate], lookup).kind).toBe('joint');
    // with a brick on the plate's own studs they stay put, unless it comes along
    const above = makeBrick({ id: 'above', partId: 'plate-1x2', y: 7 });
    expect(holdOf([top, plate], [base, top, plate, above], lookup).kind).toBe('rigid');
    expect(holdOf([top, plate, above], [base, top, plate, above], lookup).kind).toBe('joint');
    // the top alone swings out from under what stands on it: only what is selected swings
    expect(holdOf([top], [base, top, plate], lookup).kind).toBe('joint');
  });

  it('swings with a turntable’s top what stands on it, though the top stops short of the top of its base’s cells', () => {
    const base = makeBrick({ id: 'base', partId: 'turn-base-4', y: 3 });
    // on the base as LDraw's assembled turntable has it, three quarters of a plate up: its cells stop a quarter of a plate under the base's
    const top = { ...makeBrick({ id: 'top', partId: 'turn-top-4', y: 3.75 }), m: IDENTITY };
    const plate = makeBrick({ id: 'plate', partId: 'plate-1x2', x: 1, y: 6, z: 1 });
    expect(holdOf([top], [base, top, plate], lookup).kind).toBe('joint');
    expect(holdOf([top, plate], [base, top, plate], lookup).kind).toBe('joint');
  });

  it('leaves on a brick’s studs what stands on it beside the part plugged into it, or over a pin in it', () => {
    // a 1 × 4 hinge plate: its top swivels at x 2, and lies over all of the base but its first stud
    const base = makeBrick({ id: 'base', partId: 'swivel-base', y: 3 });
    const top = plug(base, 'swivel-top', { x: 2, y: 1.6, z: 1 }, UP, 'top');
    expect(holdOf([top], [base, top], lookup).kind).toBe('joint');
    // a plate on that first stud stands on the base alone: selected with the top, it holds the two where they are
    const beside = makeBrick({ id: 'beside', partId: 'plate-1x1', y: 4 });
    expect(holdOf([top, beside], [base, top, beside], lookup).kind).toBe('rigid');
    // one over the top swings with it
    const over = makeBrick({ id: 'over', partId: 'plate-1x1', x: 3, y: 4 });
    expect(holdOf([top, over], [base, top, over], lookup).kind).toBe('joint');
    // a pin in a Technic brick's hole is nothing to stand on: a plate on the brick's studs, over the pin, stays on them
    const brick = makeBrick({ id: 'brick', partId: 'technic-brick', y: 3 });
    const pin = plug(brick, 'pin', { x: 1.05, y: 1.95, z: 1 }, { x: 0, y: 0, z: 1 }, 'pin');
    const plate = makeBrick({ id: 'plate', partId: 'plate-1x2', y: 6 });
    expect(holdOf([pin], [brick, pin, plate], lookup).kind).toBe('joint');
    expect(holdOf([pin, plate], [brick, pin, plate], lookup).kind).toBe('rigid');
  });

  it('turns on the grid, as a brick on studs always has, when the brick under it happens to hold it by a connection as well', () => {
    // a bar standing on the grid in a round brick's open stud: stacked there like any brick, no loose part about
    const round = makeBrick({ id: 'round', partId: 'round-brick' });
    const bar = makeBrick({ id: 'bar', partId: 'bar', y: 3 });
    expect(holdOf([bar], [round, bar], lookup).kind).toBe('rigid');
    // plugged in loose, at the same place, it turns in the stud
    expect(holdOf([{ ...bar, m: IDENTITY }], [round, bar], lookup).kind).toBe('joint');
  });

  it('stays put on the baseplate, whatever is plugged into it', () => {
    // the beam under the pin stands on the baseplate's studs: it turns on the grid, as bricks there always have
    expect(holdOf([beam], model, lookup).kind).toBe('rigid');
    const brick = makeBrick({ id: 'brick', partId: 'technic-brick' });
    const axle = plug(brick, 'axle', { x: 1.05, y: 0.75, z: 1 }, { x: 0, y: 0, z: 1 }, 'axle');
    expect(holdOf([brick], [brick, axle], lookup).kind).toBe('rigid');
    expect(holdOf([raised(brick)], [raised(brick), raised(axle)], lookup).kind).toBe('joint');
  });

  it('is held rigidly on two pins, or on an axle in an axle hole, and not at all by nothing', () => {
    const second = plug(beam, 'pin', { x: 0.55, y: 1.2, z: 0.45 }, UP, 'second');
    const across = { ...top, id: 'across' };
    expect(holdOf([across], [beam, pin, second, across], lookup)).toEqual({ kind: 'joint', axis: expect.anything(), pivot: expect.anything() });
    // a beam lying across both pins can't swing about either
    const both = plug(pin, 'beam', { x: 0.9, y: 1.6, z: 1.5 }, { x: 1, y: 0, z: 0 }, 'both');
    const onTwo = { ...both, z: both.z - 1 };
    expect(holdOf([onTwo], [beam, pin, second, onTwo], lookup).kind).toBe('rigid');
    const brick = makeBrick({ id: 'brick', partId: 'technic-brick' });
    const axle = plug(brick, 'axle', { x: 1.05, y: 0.75, z: 1 }, { x: 0, y: 0, z: 1 }, 'axle');
    const bush = plug(axle, 'bush', { x: 1.3, y: 0.7, z: 2.8 }, { x: 1, y: 0, z: 0 }, 'bush');
    expect(holdOf([bush], [brick, axle, bush], lookup).kind).toBe('rigid');
    // the axle turns in the brick's round hole, bush and all
    expect(holdOf([axle, bush], [brick, axle, bush], lookup).kind).toBe('joint');
    // stacked on studs as well, a Technic brick on an axle can't swing about it
    const [brickUp, axleUp] = [{ ...brick, y: 3 }, { ...axle, y: axle.y + 3 }];
    expect(holdOf([brickUp], [makeBrick({ id: 'under', partId: 'brick-2x4' }), brickUp, axleUp], lookup).kind).toBe('rigid');
    expect(holdOf([brickUp], [makeBrick({ id: 'aside', partId: 'brick-2x4', x: 5 }), brickUp, axleUp], lookup).kind).toBe('joint');
    expect(holdOf([makeBrick({ id: 'lone' })], model, lookup).kind).toBe('none');
    expect(holdOf([makeBrick({ id: 'apart', partId: 'beam', x: 9 })], model, lookup).kind).toBe('none');
  });
});
