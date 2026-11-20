import { describe, expect, it } from 'bun:test';
import { type Vec3 } from '../grid';
import { attachToConnector } from '../placement/connect';
import { materialize, payloadFromPart } from '../placement/payload';
import { brickConnectors, engaged, holdOf, mates, turnsFreely } from './connections';
import { connectorLookup as lookup } from './connectorTestParts';
import { makeBrick } from './testUtils';
import type { Brick } from './types';

const UP = { x: 0, y: 1, z: 0 };

/** Builds `partId` plugged into `target` at the cursor, with id `id`. */
function plug(target: Brick, partId: string, point: Vec3, normal: Vec3, id: string): Brick {
  const part = lookup(partId);
  if (!part) throw new Error(partId);
  const attached = attachToConnector({ kind: 'brick', brickId: target.id, point, normal, t: 1, base: 0 }, target, payloadFromPart(part, 4, 0), { spin: 0, flipped: false }, lookup);
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
    // a bar in a clip, or in a minifigure's hand, which turns in it
    expect(mates('clip', 'bar')).toBe(true);
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

describe('what a group hangs by', () => {
  const beam = makeBrick({ id: 'beam', partId: 'beam' });
  const pin = plug(beam, 'pin', { x: 0.55, y: 1.2, z: 1.45 }, UP, 'pin');
  const top = plug(pin, 'beam', { x: 0.9, y: 1.6, z: 1.5 }, { x: 1, y: 0, z: 0 }, 'top');
  const model = [beam, pin, top];

  it('swings about a pin it hangs on, alone or with the pin', () => {
    for (const group of [[top], [pin, top], [beam]]) {
      const hold = holdOf(group, model, lookup);
      if (hold.kind !== 'joint') throw new Error(`${group.map((b) => b.id).join('+')} is held ${hold.kind}`);
      expect(Math.abs(hold.axis.y)).toBeCloseTo(1, 9);
      expect(hold.pivot.x).toBeCloseTo(0.5, 9);
      expect(hold.pivot.z).toBeCloseTo(1.5, 9);
    }
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
    const under = makeBrick({ id: 'under', partId: 'brick-2x4', y: -3 });
    expect(holdOf([brick], [under, brick, axle], lookup).kind).toBe('rigid');
    expect(holdOf([brick], [makeBrick({ id: 'aside', partId: 'brick-2x4', x: 5, y: -3 }), brick, axle], lookup).kind).toBe('joint');
    expect(holdOf([makeBrick({ id: 'lone' })], model, lookup).kind).toBe('none');
    expect(holdOf([makeBrick({ id: 'apart', partId: 'beam', x: 9 })], model, lookup).kind).toBe('none');
  });
});
