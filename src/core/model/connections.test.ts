import { describe, expect, it } from 'bun:test';
import { type Vec3 } from '../grid';
import { turnAbout } from '../orientation';
import { attachToConnector } from '../placement/connect';
import { materialize, payloadFromPart } from '../placement/payload';
import { brickConnectors, engaged, hasRoom, holdOf, inTheWay, mates, stretchOn, turnsFreely, type Stretch, type WorldConnector } from './connections';
import { brickCellBox } from './geometry';
import { connectorLookup as lookup } from './connectorTestParts';
import { makeBrick } from './testUtils';
import type { Brick } from './types';

const UP = { x: 0, y: 1, z: 0 };
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;
const HALF_ROUND = [-1, 0, 0, 0, 1, 0, 0, 0, -1] as const;

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
    // the rarer hinges: a car roof's four fingers between its holder's five, the two plates of a folding hinge plate, a control stick in its
    // base, and the two halves of a 1 × 8 hinge brick
    for (const [a, b] of [['fingers4', 'fingers5'], ['foldtop', 'foldbase'], ['stick', 'stickbase'], ['yoke', 'tongue']] as const) {
      expect(mates(a, b)).toBe(true);
      expect(turnsFreely(a, b)).toBe(true);
    }
    // each with its own other half only: a car roof goes into no hinge plate's three fingers, a hinge brick's top onto no folding plate
    expect(mates('fingers4', 'fingers3')).toBe(false);
    expect(mates('fingers2', 'fingers5')).toBe(false);
    expect(mates('hingetop', 'foldbase')).toBe(false);
    expect(mates('stick', 'barhole')).toBe(false);
    expect(mates('tongue', 'tongue')).toBe(false);
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
      // the way the world's axes point: about an upright pin, R turns parts the way it turns them on the grid
      expect(hold.axis.y).toBeCloseTo(1, 9);
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

  it('swings a car roof on its holder, a control stick in its base and half a 1 × 8 hinge brick on the other', () => {
    const holder = makeBrick({ id: 'holder', partId: 'roof-holder' });
    // lying over the holder, as it goes on: in the top plate of the holder's cells, and three studs on
    const roof = { ...makeBrick({ id: 'roof', partId: 'roof', y: 6 }), m: IDENTITY };
    const hold = holdOf([roof], [holder, roof], lookup);
    if (hold.kind !== 'joint') throw new Error(`the roof is held ${hold.kind}`);
    // about the roof's own pivot, the way it points: R turns the roof up about that, not down into the holder
    expect(hold.axis.x).toBeCloseTo(-1, 9);
    expect([hold.pivot.x, hold.pivot.y, hold.pivot.z].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([2, 2.6, 0.2]);
    // turned half round with its holder, it points the other way in the world, and still turns up
    const turnedHolder = makeBrick({ id: 'holder', partId: 'roof-holder', r: 2 });
    const turnedRoof = { ...makeBrick({ id: 'roof', partId: 'roof', y: 6, z: -3, r: 2 }), m: HALF_ROUND };
    const turned = holdOf([turnedRoof], [turnedHolder, turnedRoof], lookup);
    expect(turned.kind === 'joint' && turned.axis.x).toBeCloseTo(1, 9);
    // a holder off the ground, swung on a roof that stays, turns up likewise: by its own middle, a little to the side of the hinge
    const [high, low] = [{ ...holder, y: 3 }, { ...roof, y: 9 }];
    const held = holdOf([high], [high, low], lookup);
    expect(held.kind === 'joint' && held.axis.x).toBeCloseTo(-1, 9);
    // a plate on the roof that reaches over the holder stands on the holder's cells too: it swings with the roof
    const plate = makeBrick({ id: 'plate', partId: 'plate-1x2', x: 1, y: 7, z: 0, r: 1 });
    expect(holdOf([roof, plate], [holder, roof, plate], lookup).kind).toBe('joint');
    const base = makeBrick({ id: 'base', partId: 'stick-base' });
    const stick = { ...makeBrick({ id: 'stick', partId: 'stick', y: 0.75 }), m: IDENTITY };
    expect(holdOf([stick], [base, stick], lookup).kind).toBe('joint');
    // the second half of a hinge brick, turned half round at the first's knuckle
    const tongue = makeBrick({ id: 'tongue', partId: 'tongue-brick' });
    const yoke = { ...makeBrick({ id: 'yoke', partId: 'yoke-brick', x: 3 }), m: HALF_ROUND };
    const bend = holdOf([yoke], [tongue, yoke], lookup);
    if (bend.kind !== 'joint') throw new Error(`the second half is held ${bend.kind}`);
    expect(Math.abs(bend.axis.z)).toBeCloseTo(1, 9);
    // a plate on the second half's first stud stands over the first half's knuckle, in the cells both halves fill there: it is on the
    // second half, and swings with it
    const onYoke = makeBrick({ id: 'on', partId: 'plate-1x2', x: 4, y: 5 });
    expect(holdOf([yoke, onYoke], [tongue, yoke, onYoke], lookup).kind).toBe('joint');
  });

  it('turns up whatever hangs to one side of a hinge, whichever way it faces, and what stands over its pivot the way the world’s axes point', () => {
    const hangs = (holder: string, hinged: string, r: number) => {
      const base = makeBrick({ id: 'base', partId: holder, y: 6, r });
      const [joint] = brickConnectors(base, lookup);
      if (!joint) throw new Error(holder);
      const part = plug(base, hinged, joint.at, UP, 'part');
      const hold = holdOf([part], [base, part], lookup);
      if (hold.kind !== 'joint') throw new Error(`${hinged} on ${holder} is held ${hold.kind}`);
      const box = brickCellBox(part, lookup);
      return { hold, off: { x: (box.x0 + box.x1) / 2 - hold.pivot.x, z: (box.z0 + box.z1) / 2 - hold.pivot.z } };
    };
    // a click hinge's finger on its fork, a hinge plate's two fingers in another's three, half a 1 × 8 hinge brick, a roof, a folding top
    // ... and a plate with fingers on both ends, by those on its far end, the second of its two connections
    for (const [holder, hinged] of [['fork', 'finger'], ['fingers-3', 'fingers-2'], ['tongue-brick', 'yoke-brick'], ['roof-plate', 'roof'], ['fold-base', 'fold-top'], ['fingers-2', 'fingers-both'], ['fingers-3', 'fingers-both']] as const) {
      for (let r = 0; r < 4; r++) {
        const { hold, off } = hangs(holder, hinged, r);
        // a step of R about the hold's axis takes the part's middle up: the upright part of axis × (pivot to middle)
        expect(`${hinged} on ${holder} turned ${r}: ${hold.axis.z * off.x - hold.axis.x * off.z > 0.2 ? 'up' : 'down'}`).toBe(`${hinged} on ${holder} turned ${r}: up`);
      }
    }
    // a 2 × 2 hinge top reaches a stud to one side of the base it hinges on: that side turns up
    for (let r = 0; r < 4; r++) {
      const { hold, off } = hangs('hinge-base', 'hinge-top-2x2', r);
      expect(`2 × 2 top turned ${r}: ${hold.axis.z * off.x - hold.axis.x * off.z > 0.2 ? 'up' : 'down'}`).toBe(`2 × 2 top turned ${r}: up`);
    }
    // a hinge brick's top stands over its pivot, a control stick over its barrel: neither hangs to a side
    for (const [holder, hinged] of [['hinge-base', 'hinge-top'], ['stick-base', 'stick']] as const) {
      for (let r = 0; r < 4; r++) {
        const { x, z } = hangs(holder, hinged, r).hold.axis;
        expect(`${hinged} ${r}: ${Math.round(x + z)}`).toBe(`${hinged} ${r}: 1`);
      }
    }
  });

  it('swings a part on a bar, a clip or a minifigure’s joint the way the world’s axes point, though it hangs to one side of it', () => {
    // a plate with a clip, its middle half a stud from the clip, clipped to a bar that lies level: right way up or turned over, on a bar
    // that points one way or the other, R turns it about the bar the same way round in the world
    const signs = new Set<number>();
    for (const quarter of [1, -1]) {
      const bar = { ...makeBrick({ id: 'bar', partId: 'bar', y: 10 }), m: turnAbout({ x: 0, y: 0, z: 1 }, (quarter * Math.PI) / 2) };
      const [rod] = brickConnectors(bar, lookup);
      const clipPart = lookup('clip-plate');
      if (!rod || !clipPart) throw new Error('no bar');
      for (const flipped of [false, true]) {
        const on = attachToConnector({ kind: 'brick', brickId: 'bar', point: rod.at, normal: UP, t: 1, base: 0 }, bar, payloadFromPart(clipPart, 4, 0), { spin: 0, flipped }, lookup, [bar]);
        const [plate] = on ? materialize(on.payload, on.offset, () => 'plate') : [];
        if (!plate) throw new Error('no clip on the bar');
        const [clip] = brickConnectors(plate, lookup);
        const hold = holdOf([plate], [bar, plate], lookup);
        if (hold.kind !== 'joint' || !clip) throw new Error(`the plate is held ${hold.kind}`);
        expect(`${quarter} ${flipped}: ${Math.round(hold.axis.x + hold.axis.y + hold.axis.z)}`).toBe(`${quarter} ${flipped}: 1`);
        signs.add(Math.round(clip.axis.x + clip.axis.y + clip.axis.z));
      }
    }
    // (the clip itself pointed both ways along the bar in those)
    expect([...signs].sort()).toEqual([-1, 1]);
    // an arm on a torso's shoulder, whichever way the torso faces
    for (const r of [0, 2]) {
      const torso = makeBrick({ id: 'torso', partId: 'torso', y: 10, r });
      const shoulder = brickConnectors(torso, lookup).find((c) => c.kind === 'shoulder');
      if (!shoulder) throw new Error('no shoulder');
      const arm = plug(torso, 'arm-right', shoulder.at, UP, 'arm');
      const hold = holdOf([arm], [torso, arm], lookup);
      if (hold.kind !== 'joint') throw new Error(`the arm is held ${hold.kind}`);
      expect(`arm ${r}: ${hold.axis.x > 0.9}`).toBe(`arm ${r}: true`);
    }
  });

  it('turns a part up by its own top: put on the other way round it still lifts, turned over it swings the other way', () => {
    const plate = makeBrick({ id: 'plate', partId: 'roof-plate', y: 6 });
    const [joint] = brickConnectors(plate, lookup);
    const roofPart = lookup('roof');
    if (!joint || !roofPart) throw new Error('no roof plate');
    const put = (spin: number, flipped: boolean): { readonly up: boolean; readonly rightWayUp: boolean; readonly beyond: boolean } => {
      const on = attachToConnector({ kind: 'brick', brickId: 'plate', point: joint.at, normal: UP, t: 1, base: 0 }, plate, payloadFromPart(roofPart, 4, 0), { spin, flipped }, lookup, [plate]);
      const [roof] = on ? materialize(on.payload, on.offset, () => 'roof') : [];
      if (!roof?.m) throw new Error('no roof');
      const hold = holdOf([roof], [plate, roof], lookup);
      if (hold.kind !== 'joint') throw new Error(`the roof is held ${hold.kind}`);
      const box = brickCellBox(roof, lookup);
      const off = { x: (box.x0 + box.x1) / 2 - hold.pivot.x, z: (box.z0 + box.z1) / 2 - hold.pivot.z };
      return { up: hold.axis.z * off.x - hold.axis.x * off.z > 0.2, rightWayUp: (roof.m[4] ?? 0) > 0.5, beyond: off.z > 0 };
    };
    // as it goes on: right way up, reaching on beyond the plate's fingers, and R turns it up
    expect(put(0, false)).toEqual({ up: true, rightWayUp: true, beyond: true });
    // T and two quarter turns: right way up on the plate's other side, back over the plate; R turns it up there too, about the same
    // fingers the other way round in the world
    expect(put(2, true)).toEqual({ up: true, rightWayUp: true, beyond: false });
    // T alone: upside down where it lay. It turns towards its own top, which is now down: ⇧R lifts it
    expect(put(0, true)).toEqual({ up: false, rightWayUp: false, beyond: true });
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
