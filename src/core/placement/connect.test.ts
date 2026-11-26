import { describe, expect, it } from 'bun:test';
import { PLATE_HEIGHT, type Vec3 } from '../grid';
import { brickConnectors, engaged, type WorldConnector } from '../model/connections';
import { brickCellBox, brickFloor, isLoose } from '../model/geometry';
import { isOutOfBounds } from '../model/spatial';
import { connectorLookup as lookup } from '../model/connectorTestParts';
import { makeBrick } from '../model/testUtils';
import { multiplyTurns, turnOf, type Turn } from '../orientation';
import type { Brick } from '../model/types';
import { attachToConnector, nextDepth, type ConnectTurn } from './connect';
import { ask, box, hit, plug, STILL, UP } from './connectTesting';
import { payloadFromPart } from './payload';

/** As `plug`, with the bricks already plugged in around the target. */
function plugAmong(others: readonly Brick[], target: Brick, partId: string, point: Vec3, normal: Vec3, id = 'new'): Brick | null {
  return plug(target, partId, point, normal, STILL, id, others);
}

/**
 * What a part asked for among `others` is told: 'room' where it plugs in,
 * 'none' where it would but another part is there, 'not here' where it does
 * not plug in at all and builds on the target like any brick.
 */
function answer(others: readonly Brick[], target: Brick, partId: string, point: Vec3, normal: Vec3): 'room' | 'none' | 'not here' {
  const asked = ask(target, partId, point, normal, STILL, 'new', others);
  return asked === null ? 'not here' : asked.free ? 'room' : 'none';
}

/** The connection of `brick` that is plugged into one of `into`'s. */
function connectionIn(brick: Brick, into: Brick) {
  return brickConnectors(brick, lookup).find((mine) => brickConnectors(into, lookup).some((theirs) => engaged(mine, theirs)));
}

function pluggedInto(a: Brick, b: Brick): boolean {
  return brickConnectors(a, lookup).some((mine) => brickConnectors(b, lookup).some((theirs) => engaged(mine, theirs)));
}

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

  it('pushes an axle a stud into a hole: through one a stud long, flush with its far face, the rest towards the cursor', () => {
    const brick = makeBrick({ id: 'brick', partId: 'technic-brick' });
    const axle = plug(brick, 'axle', { x: 1.05, y: 0.75, z: 1 }, { x: 0, y: 0, z: 1 });
    if (!axle) throw new Error('no axle');
    expect(box(axle).z).toEqual([0, 4]);
    expect(pluggedInto(axle, brick)).toBe(true);
  });
});

describe('how far an axle goes into a hole', () => {
  // the joiner's hole runs along Z from 0 to 2, half a stud up and in
  const joiner = makeBrick({ id: 'joiner', partId: 'axle-joiner' });
  const FRONT = { x: 0, y: 0, z: 1 };
  const BACK = { x: 0, y: 0, z: -1 };
  const front = { x: 0.55, y: 0.55, z: 2 };
  const back = { x: 0.55, y: 0.55, z: 0 };
  /** Pushed by D to the `deeper`-th place it can go to. */
  const pushed = (deeper: number): ConnectTurn => ({ ...STILL, deeper });
  /** Where along Z the axle of `brick` that is in the joiner runs. */
  const inJoiner = (brick: Brick | null): number[] => {
    const axle = brick ? connectionIn(brick, joiner) : undefined;
    if (!axle) throw new Error('not in the joiner');
    const r = (v: number) => Math.round(v * 1000) / 1000 + 0;
    return [r(axle.at.z - axle.length / 2), r(axle.at.z + axle.length / 2)];
  };
  /** How far in the part goes of how far it could, as attachToConnector tells it. */
  const depthsOf = (target: Brick, partId: string, point: Vec3, normal: Vec3, turned: ConnectTurn, others: readonly Brick[] = []) => {
    const part = lookup(partId);
    if (!part) throw new Error(partId);
    return attachToConnector(hit(point, normal, target.id), target, payloadFromPart(part, 4, 0), turned, lookup, [target, ...others])?.depths;
  };

  it('pushes it a stud into a hole two studs long, and D half a stud further each time, as far as the far face', () => {
    expect(inJoiner(plug(joiner, 'axle', front, FRONT))).toEqual([1, 5]);
    expect(depthsOf(joiner, 'axle', front, FRONT, STILL)).toEqual({ at: 0, of: 3 });
    expect(inJoiner(plug(joiner, 'axle', front, FRONT, pushed(1)))).toEqual([0.5, 4.5]);
    expect(inJoiner(plug(joiner, 'axle', front, FRONT, pushed(2)))).toEqual([0, 4]);
    expect(depthsOf(joiner, 'axle', front, FRONT, pushed(2))).toEqual({ at: 2, of: 3 });
    // pushed further than it goes, it goes as far as it goes
    expect(inJoiner(plug(joiner, 'axle', front, FRONT, pushed(7)))).toEqual([0, 4]);
    expect(depthsOf(joiner, 'axle', front, FRONT, pushed(7))).toEqual({ at: 2, of: 3 });
    // from the other end, the other way, and turned or turned over it goes in as far
    expect(inJoiner(plug(joiner, 'axle', back, BACK, pushed(1)))).toEqual([-2.5, 1.5]);
    expect(inJoiner(plug(joiner, 'axle', front, FRONT, { spin: 1, flipped: true, deeper: 1 }))).toEqual([0.5, 4.5]);
  });

  it('meets an axle from the other end in the middle of the joiner, and has no room for a third', () => {
    const first = plug(joiner, 'axle', front, FRONT, STILL, 'first') as Brick;
    const second = plugAmong([first], joiner, 'axle', back, BACK, 'second');
    expect(inJoiner(second)).toEqual([-3, 1]);
    // where the first is, D has nowhere further to push the second
    expect(depthsOf(joiner, 'axle', back, BACK, pushed(1), [first])).toEqual({ at: 0, of: 1 });
    expect(answer([first, second as Brick], joiner, 'axle', front, FRONT)).toBe('none');
    expect(answer([first, second as Brick], joiner, 'axle', back, BACK)).toBe('none');
    // pushed half a stud further, the first leaves too little of the hole for another to hold by
    const deep = plug(joiner, 'axle', front, FRONT, pushed(1), 'deep') as Brick;
    expect(answer([deep], joiner, 'axle', back, BACK)).toBe('none');
  });

  it('goes no further in than its own axle, so its part stays out of the hole', () => {
    // the short axle beyond a stop goes in up to the stop, however far D pushes it, and the stop and the axle beyond it never go in
    expect(depthsOf(joiner, 'stopped-axle', front, FRONT, STILL)).toEqual({ at: 0, of: 1 });
    const stopped = plug(joiner, 'stopped-axle', front, FRONT, pushed(3), 'stopped') as Brick;
    expect(inJoiner(stopped)).toEqual([1.1, 2]);
    expect(brickConnectors(stopped, lookup).filter((axle) => engaged(axle, brickConnectors(joiner, lookup)[0] as WorldConnector))).toHaveLength(1);
    // turned over, it has come through the joiner from its back: as far as it goes, the stop against the back face, the axle beyond it out of the back;
    // and D has nowhere further to push it
    const through = ask(joiner, 'stopped-axle', front, FRONT, { spin: 0, flipped: true }, 'through', []);
    expect(through?.free).toBe(true);
    expect(inJoiner(through?.brick ?? null)).toEqual([0, 0.9]);
    expect(inJoiner(plug(joiner, 'stopped-axle', front, FRONT, { spin: 0, flipped: true, deeper: 2 }))).toEqual([0, 0.9]);
    expect(depthsOf(joiner, 'stopped-axle', front, FRONT, { spin: 0, flipped: true, deeper: 2 })).toEqual({ at: 0, of: 1 });
    // so does its long axle, by which C puts it in: a stud in by its free end, pushed by D as far as the back face; turned over, through, no further
    const long = (turned: ConnectTurn): number[] => {
      const [axle] = brickConnectors(plug(joiner, 'stopped-axle', front, FRONT, { ...turned, via: 0 }) as Brick, lookup);
      if (!axle) throw new Error('no axle');
      return [axle.at.z - axle.length / 2, axle.at.z + axle.length / 2].map((v) => Math.round(v * 1e4) / 1e4 + 0);
    };
    expect(long(STILL)).toEqual([1, 5.375]);
    expect(long(pushed(2))).toEqual([0, 4.375]);
    expect(long({ spin: 0, flipped: true })).toEqual([0, 4.375]);
    expect(long({ spin: 0, flipped: true, deeper: 2 })).toEqual([0, 4.375]);
    expect(depthsOf(joiner, 'stopped-axle', front, FRONT, { spin: 0, flipped: true, via: 0, deeper: 2 })).toEqual({ at: 0, of: 1 });
    // a long pin's stub of axle goes in as far as its collar
    expect(inJoiner(plug(joiner, 'long-pin', front, FRONT, pushed(2)))).toEqual([1.025, 2]);
  });

  it('puts an axle shorter than a hole in by its free end, its stop at the mouth, or through from the far side, its stop at the far face', () => {
    // the brick's hole runs along Z from 0 to 1; the stopped axle's short axle is 0.9 long, the stop beyond it a tenth
    const brick = makeBrick({ id: 'brick', partId: 'technic-brick' });
    const [hole] = brickConnectors(brick, lookup);
    if (!hole) throw new Error('no hole');
    for (const spin of [0, 1, 2, 3]) {
      for (const flipped of [false, true]) {
        const asked = ask(brick, 'stopped-axle', { x: 1.05, y: 0.75, z: 1 }, FRONT, { spin, flipped }, 'new', []);
        if (!asked) throw new Error('no fit');
        // where along Z the short axle and the stop are; in either way it is turned the stop is out of the hole, at its mouth or its far face
        const [long, short] = brickConnectors(asked.brick, lookup);
        if (!long || !short) throw new Error('no axles');
        const ends = (c: WorldConnector) => [c.at.z - c.length / 2, c.at.z + c.length / 2].map((v) => Math.round(v * 1e6) / 1e6 + 0);
        const stop = short.at.z < long.at.z ? [ends(short)[1], ends(long)[0]] : [ends(long)[1], ends(short)[0]];
        const pose = `spin ${spin}${flipped ? ', turned over' : ''}`;
        expect(`${pose}: ${asked.free}`).toBe(`${pose}: true`);
        expect(`${pose}: ${JSON.stringify(ends(short))} stop ${JSON.stringify(stop)}`).toMatch(/: \[0\.1,1\] stop \[1,1\.1\]$|: \[0,0\.9\] stop \[-0\.1,0\]$/);
      }
    }
  });

  it('never has two pieces of one part’s axle in one hole, wherever in the world it is', () => {
    // an axle either side of a pin hole, in a joiner: turned however, and pushed however far, never both
    for (const x of [0, 3, 7, 11, 13]) {
      for (const z of [0, 5, 9]) {
        const shifted = makeBrick({ id: 'joiner', partId: 'axle-joiner', x, z });
        const [hole] = brickConnectors(shifted, lookup);
        if (!hole) throw new Error('no hole');
        for (const turned of [STILL, { spin: 1, flipped: false }, { spin: 0, flipped: true }, { spin: 2, flipped: true }, { ...STILL, deeper: 1 }]) {
          const asked = ask(shifted, 'pin-hole-axle', { x: x + 0.55, y: 0.55, z: z + 2 }, FRONT, turned, 'new', []);
          const inIt = asked ? brickConnectors(asked.brick, lookup).filter((c) => c.kind === 'axle' && engaged(c, hole)).length : 0;
          expect(`${x},${z} ${JSON.stringify(turned)}: ${asked?.free ? inIt : 'no room'}`).toMatch(/: (1|no room)$/);
        }
      }
    }
    // a shaft with rings on it: by its middle axle, held at both ends, through the joiner as far as it goes, its ring and the axle beyond would
    // be in the joiner too, plugged in twice over; so it goes in by an end one, a stud in, by itself or as C asks
    const ringed = ask(joiner, 'ringed-axle', front, FRONT, STILL, 'ringed', []);
    expect(ringed?.free).toBe(true);
    expect(ringed && brickConnectors(ringed.brick, lookup).filter((c) => engaged(c, brickConnectors(joiner, lookup)[0] as WorldConnector)).map((c) => c.length)).toEqual([0.95]);
    for (const via of [0, 1, 2]) {
      for (const turned of [STILL, { spin: 0, flipped: true }]) {
        const asked = ask(joiner, 'ringed-axle', front, FRONT, { ...turned, via }, 'new', []);
        const inIt = asked ? brickConnectors(asked.brick, lookup).filter((c) => engaged(c, brickConnectors(joiner, lookup)[0] as WorldConnector)) : [];
        expect(`${via} ${turned.flipped}: ${asked?.free ? inIt.map((c) => c.length).join(' ') : 'no room'}`).toMatch(/: (0\.95|no room)$/);
      }
    }
  });

  it('turns a part over with T only as far as leaves one of its axles in a hole', () => {
    // each stub of axle in the blade has its part beyond both ends, so it comes through the joiner from the back, the other stub beyond it
    const bladed = ask(joiner, 'bladed-axles', front, FRONT, STILL, 'bladed', []);
    expect(bladed?.free).toBe(true);
    expect(inJoiner(bladed?.brick ?? null)).toEqual([0, 0.975]);
    // turned over where it stands, the other stub reaches a fortieth of a stud into the joiner's mouth: no room
    expect(ask(joiner, 'bladed-axles', front, FRONT, { spin: 0, flipped: true }, 'bladed', [])?.free).toBe(false);
  });

  it('takes places a whisker apart for one: a stub of axle in the far end leaves a stud and a fortieth', () => {
    const stub = plug(joiner, 'long-pin', back, BACK, STILL, 'stub') as Brick;
    expect(inJoiner(stub)).toEqual([0, 0.975]);
    expect(depthsOf(joiner, 'axle', front, FRONT, pushed(1), [stub])).toEqual({ at: 0, of: 1 });
    expect(inJoiner(plugAmong([stub], joiner, 'axle', front, FRONT))).toEqual([1, 5]);
  });

  it('pushes it into a hole a stud long or less only as far as its far face', () => {
    const brick = makeBrick({ id: 'brick', partId: 'technic-brick' });
    const at = { x: 1.05, y: 0.75, z: 1 };
    expect(depthsOf(brick, 'axle', at, FRONT, STILL)).toEqual({ at: 0, of: 1 });
    expect(box(plug(brick, 'axle', at, FRONT, pushed(1)) as Brick).z).toEqual([0, 4]);
    // into a liftarm half a stud thick, half a stud
    const liftarm = makeBrick({ id: 'liftarm', partId: 'thin-beam' });
    const axle = plug(liftarm, 'axle', { x: 0.55, y: 0.45, z: 0.45 }, UP, pushed(1)) as Brick;
    const [own] = brickConnectors(axle, lookup);
    expect(own && [Math.min(own.at.y - 2, own.at.y + 2), Math.max(own.at.y - 2, own.at.y + 2)]).toEqual([0, 4]);
  });

  it('stops at a far face that lies between half studs', () => {
    // the engine's hole runs along Z from its back face, at 0, to 1.7, a stud up
    const engine = makeBrick({ id: 'engine', partId: 'jet-engine' });
    const at = { x: 1.05, y: 1, z: 0 };
    expect(depthsOf(engine, 'axle', at, BACK, STILL)).toEqual({ at: 0, of: 3 });
    // the axle's middle, two studs out from its end in the hole: a stud in, a stud and a half, and as far as it goes
    const middle = (deeper: number): number => connectionIn(plug(engine, 'axle', at, BACK, pushed(deeper)) as Brick, engine)?.at.z ?? NaN;
    expect(middle(0)).toBeCloseTo(-1, 9);
    expect(middle(1)).toBeCloseTo(-0.5, 9);
    expect(middle(2)).toBeCloseTo(-0.3, 9);
  });

  it('pushes nothing but an axle into a hole: a pin goes in to its collar, a bar down an open stud as far as it goes', () => {
    const over = { x: 0.55, y: 1.2, z: 1.45 };
    expect(depthsOf(beam, 'pin', over, UP, pushed(1))).toBeUndefined();
    expect(box(plug(beam, 'pin', over, UP, pushed(1)) as Brick)).toEqual(box(plug(beam, 'pin', over, UP) as Brick));
    const round = makeBrick({ id: 'round', partId: 'round-brick' });
    expect(depthsOf(round, 'bar', { x: 0.55, y: 1.4, z: 0.5 }, UP, pushed(1))).toBeUndefined();
    // a beam onto a pin, a bush onto an axle: the cursor says where
    const pin = plug(beam, 'pin', over, UP, STILL, 'pin') as Brick;
    expect(depthsOf(pin, 'beam', { x: 0.9, y: 1.6, z: 1.5 }, { x: 1, y: 0, z: 0 }, pushed(1))).toBeUndefined();
    const axle = plug(joiner, 'axle', front, FRONT, STILL, 'axle') as Brick;
    expect(depthsOf(axle, 'bush', { x: 0.85, y: 0.55, z: 4 }, { x: 1, y: 0, z: 0 }, pushed(1))).toBeUndefined();
  });

  describe('a part with a hole on the end of an axle', () => {
    const brick = makeBrick({ id: 'brick', partId: 'technic-brick' });
    // the axle runs along Z from 0, in the brick's hole, to 4
    const axle = plug(brick, 'axle', { x: 1.05, y: 0.75, z: 1 }, FRONT, STILL, 'axle') as Brick;
    const at = (z: number): Vec3 => ({ x: 1.3, y: 0.7, z });
    const SIDE = { x: 1, y: 0, z: 0 };
    /** Where along the axle, along Z or X, the hole of `partId` built at the cursor runs. */
    const holeOn = (target: Brick, partId: string, cursor: Vec3, normal: Vec3, others: readonly Brick[] = [brick]): number[] => {
      const built = plugAmong(others, target, partId, cursor, normal);
      const [hole] = built ? brickConnectors(built, lookup) : [];
      if (!hole) throw new Error(`no ${partId}`);
      const middle = Math.abs(hole.axis.z) > 0.5 ? hole.at.z : hole.at.x;
      const r = (v: number) => Math.round(v * 10000) / 10000 + 0;
      return [r(middle - hole.length / 2), r(middle + hole.length / 2)];
    };

    it('hangs an axle joiner off its free end as far as leaves a stud of the joiner on, so another axle goes into the rest', () => {
      // asked for at the axle's end, half on; half a stud in from there, half a stud off; a stud in, all on
      expect(holeOn(axle, 'axle-joiner', at(3.9), SIDE)).toEqual([3, 5]);
      expect(holeOn(axle, 'axle-joiner', at(3.4), SIDE)).toEqual([2.5, 4.5]);
      expect(holeOn(axle, 'axle-joiner', at(3), SIDE)).toEqual([2, 4]);
      // a second axle goes a stud into the rest, against the first
      const joiner = plugAmong([brick], axle, 'axle-joiner', at(3.9), SIDE, 'joiner') as Brick;
      const second = plugAmong([axle], joiner, 'axle', { x: 1.05, y: 0.75, z: 5 }, FRONT, 'second') as Brick;
      const [own] = brickConnectors(second, lookup);
      expect(own && [own.at.z - own.length / 2, own.at.z + own.length / 2]).toEqual([4, 8]);
      // and at the axle's other end, where the brick holds it, the joiner goes no further than all on
      expect(holeOn(axle, 'axle-joiner', at(1.1), SIDE)).toEqual([1, 3]);
    });

    it('hangs off neither end what it can go all on: a wheel with a hub two studs long, a bush', () => {
      expect(holeOn(axle, 'hub-wheel', at(3.9), SIDE)).toEqual([2, 4]);
      expect(holeOn(axle, 'bush', at(3.9), SIDE)).toEqual([3, 4]);
      // an axle loose of anything hangs a joiner off either end
      const loose = makeBrick({ id: 'loose', partId: 'axle' });
      const over = (x: number): Vec3 => ({ x, y: 0.8, z: 0.5 });
      expect(holeOn(loose, 'axle-joiner', over(0.1), UP, [])).toEqual([-1, 1]);
      expect(holeOn(loose, 'axle-joiner', over(3.9), UP, [])).toEqual([3, 5]);
    });

    it('puts a part longer than a stretch of axle against what holds it, off its free end, and over a stretch held at both ends', () => {
      // the short axle beyond the stop runs along X from -0.1875, its free end, to 0.7125, by the stop: a wheel's hub two studs long and a
      // joiner go against the stop, off the free end by the 1.1 studs they are longer
      const stopped = makeBrick({ id: 'stopped', partId: 'stopped-axle' });
      const shortAt = { x: 0.3, y: 0.8, z: 0.5 };
      expect(holeOn(stopped, 'hub-wheel', shortAt, UP, [])).toEqual([-1.2875, 0.7125]);
      expect(holeOn(stopped, 'axle-joiner', shortAt, UP, [])).toEqual([-1.2875, 0.7125]);
      // a stub of axle inside its housing, along X from 1 to 2: a joiner goes over its middle, as far past either end
      const housing = makeBrick({ id: 'housing', partId: 'housed-axle' });
      expect(holeOn(housing, 'axle-joiner', { x: 1.5, y: 0.8, z: 0.5 }, UP, [])).toEqual([0.5, 2.5]);
    });
  });

  it('steps D round the places it can go to, and back', () => {
    expect(nextDepth({ at: 0, of: 3 }, false)).toBe(1);
    expect(nextDepth({ at: 2, of: 3 }, false)).toBe(0);
    expect(nextDepth({ at: 0, of: 3 }, true)).toBe(2);
    expect(nextDepth({ at: 1, of: 3 }, true)).toBe(0);
    expect(nextDepth({ at: 0, of: 1 }, false)).toBeNull();
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

  it('puts a bush on an axle with a stop either side of the stop, never over it', () => {
    const stopped = makeBrick({ id: 'stopped', partId: 'stopped-axle' });
    const [long, short] = brickConnectors(stopped, lookup);
    if (!long || !short) throw new Error('no axles');
    // where along X a connection runs; the stop is the tenth of a stud between the two axles
    const span = (c: { at: Vec3; length: number }) => [c.at.x - c.length / 2, c.at.x + c.length / 2] as const;
    const [stopFrom, stopTo] = [span(short)[1], span(long)[0]];
    expect(stopTo - stopFrom).toBeCloseTo(0.1, 9);
    const side = { x: 0, y: 0, z: 1 };
    const at = (x: number): Vec3 => ({ x, y: long.at.y, z: long.at.z + 0.3 });
    const holeOf = (bush: Brick | null) => {
      const [hole] = bush ? brickConnectors(bush, lookup) : [];
      if (!hole) throw new Error('no bush');
      return span(hole);
    };
    // asked for by the stop, on the long axle's side of it, a bush goes on the long axle against the stop
    const first = plug(stopped, 'bush', at(stopTo + 0.2), side, STILL, 'first');
    expect(holeOf(first)[0]).toBeCloseTo(stopTo, 9);
    expect(holeOf(first)[1]).toBeCloseTo(stopTo + 1, 9);
    // asked for on the short axle's side, on the short one: against the stop, its stud-long hole off the axle's free end by the tenth of a stud the
    // axle is shorter
    const [thirdFrom, thirdTo] = holeOf(plug(stopped, 'bush', at(stopFrom - 0.4), side, STILL, 'third'));
    expect(thirdFrom).toBeCloseTo(span(short)[0] - 0.1, 9);
    expect(thirdTo).toBeCloseTo(stopFrom, 9);
    // and wherever it is asked for along the axle, with that first bush on it or not, a bush goes on one axle or the other, never across the stop:
    // all on the long one, or on the short one, off its free end by no more than that
    for (const others of [[], [first as Brick]]) {
      for (let x = span(short)[0] - 0.4; x < span(long)[1] + 0.4; x += 0.05) {
        const asked = ask(stopped, 'bush', at(x), side, STILL, 'new', others);
        if (!asked?.free) continue;
        const [from, to] = holeOf(asked.brick);
        const onLong = from >= span(long)[0] - 1e-9 && to <= span(long)[1] + 1e-9;
        const onShort = from >= span(short)[0] - 0.1 - 1e-9 && to <= span(short)[1] + 1e-9;
        expect(`${x.toFixed(2)}: ${onLong || onShort}`).toBe(`${x.toFixed(2)}: true`);
      }
    }
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
    expect(attachToConnector(hit({ x: 0.55, y: 1.2, z: 1.45 }, UP, 'beam'), beam, pair, STILL, lookup, [beam])).toBeNull();
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
    // the torso where hips and legs hold it, 2 studs up
    const torso = makeBrick({ id: 'torso', partId: 'torso', y: 5 });
    const arm = plug(torso, 'arm', { x: 0, y: 3.15, z: 0.55 }, { x: -1, y: 0, z: 0 });
    if (!arm?.m) throw new Error('no arm');
    expect(arm.m[4]).toBeCloseTo(0.985 / Math.hypot(0.985, 0.17), 9);
    const { x } = box(arm);
    expect(((x[0] ?? 0) + (x[1] ?? 0)) / 2).toBeLessThan(0);
    expect(pluggedInto(arm, torso)).toBe(true);
    // on a torso standing on the baseplate, hanging would put the arm's hand into the ground: it goes on held out level from the
    // shoulder, a way it can be built
    const low = makeBrick({ id: 'low', partId: 'torso' });
    const held = plug(low, 'arm', { x: 0, y: 1.15, z: 0.55 }, { x: -1, y: 0, z: 0 });
    if (!held?.m) throw new Error('no arm');
    expect(isOutOfBounds(held, lookup)).toBe(false);
    expect(held.m[4]).toBeCloseTo(0, 9);
    expect(pluggedInto(held, low)).toBe(true);
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

  it('hangs a part with a clip at each end by the clip LDraw draws it about: a droid’s arm by its shoulder’s, not its hand’s', () => {
    // a droid's torso where its legs hold it, 2 studs up: its left shoulder a bar across at x 0.2125, 3.85 up, z 0.45
    const torso = makeBrick({ id: 'torso', partId: 'droid-torso', y: 5 });
    const shoulder = { x: 0.2, y: 3.9, z: 0.5 };
    const LEFT = { x: -1, y: 0, z: 0 };
    /** Which of the part's two clips holds the bar (0 its upper one), and how far above and in front of it the other is. */
    const hangs = (partId: string, turned: ConnectTurn, on = torso, at = shoulder): readonly [held: number, above: number, front: number] => {
      const brick = plug(on, partId, at, LEFT, turned);
      if (!brick) throw new Error(`no ${partId}`);
      const clips = brickConnectors(brick, lookup);
      const held = clips.findIndex((clip) => brickConnectors(on, lookup).some((bar) => engaged(clip, bar)));
      const [mine, other] = [clips[held], clips[1 - held]];
      const round = (v: number): number => Math.round(v * 100) / 100 + 0;
      return [held, round((other?.at.y ?? 0) - (mine?.at.y ?? 0)), round((other?.at.z ?? 0) - (mine?.at.z ?? 0))];
    };
    // the arm goes on by its shoulder clip and hangs down from it, its hand's clip 1.91 studs under the bar; T turns it round where
    // it hangs, hand to the front or to the back: one of the two is the way LDraw's assembled droid has it, hand 0.6 in front
    expect(hangs('droid-arm', STILL)).toEqual([0, -1.91, -0.6]);
    expect(hangs('droid-arm', { spin: 0, flipped: true })).toEqual([0, -1.91, 0.6]);
    // on the right shoulder too, whose free end is its bar's other end
    expect(hangs('droid-arm', STILL, torso, { x: 1.8, y: 3.9, z: 0.5 }).slice(0, 2)).toEqual([0, -1.91]);
    // R swings it about the shoulder, forwards, up and back, the same clip on the bar: it never ends up clipped on by its hand
    expect(hangs('droid-arm', { spin: 1, flipped: false })[0]).toBe(0);
    expect(hangs('droid-arm', { spin: 2, flipped: false })).toEqual([0, 1.91, 0.6]);
    expect(hangs('droid-arm', { spin: 3, flipped: false })[0]).toBe(0);
    // unless C chooses its hand's clip: on by that, it stands up from the shoulder, and R swings it about that clip
    expect(hangs('droid-arm', { spin: 0, flipped: false, via: 1 }).slice(0, 2)).toEqual([1, 1.91]);
    expect(hangs('droid-arm', { spin: 2, flipped: false, via: 1 }).slice(0, 2)).toEqual([1, -1.91]);
    // on the bar where LDraw's assembled droid has it: the arm's shoulder clip at the shoulder's outer end, 0.8 studs from the middle
    const arm = plug(torso, 'droid-arm', shoulder, LEFT);
    expect(brickConnectors(arm as Brick, lookup)[0]?.at.x).toBeCloseTo(0.2, 9);
    expect(brickConnectors(arm as Brick, lookup)[0]?.at.y).toBeCloseTo(3.85, 9);
    // a part with the same two clips that is drawn about neither goes on as ever: by the one that leaves it clearest of the torso,
    // standing up from the bar
    expect(hangs('link', STILL).slice(0, 2)).toEqual([1, 1.91]);
    // and so does the arm on a torso standing on the baseplate, where it would hang into the ground: it stands up from the
    // shoulder by its hand's clip, a way it can be built
    const low = makeBrick({ id: 'low', partId: 'droid-torso' });
    expect(hangs('droid-arm', STILL, low, { x: 0.2, y: 1.9, z: 0.5 }).slice(0, 2)).toEqual([1, 1.91]);
    // and at the torso's neck, a bar between its shoulders with no free end, where an arm hung by its shoulder's clip would
    // hang through the torso: there too it stands clear, as ever
    expect(hangs('droid-arm', STILL, torso, { x: 1, y: 3.9, z: 0.5 }).slice(0, 2)).toEqual([1, 1.91]);
    /** Which of the part's connections is plugged into the target's, and how upright the part stands (1 as it is drawn). */
    const heldBy = (on: Brick, partId: string, at: Vec3, normal: Vec3): readonly [held: number, upright: number] => {
      const brick = plug(on, partId, at, normal);
      if (!brick) throw new Error(`no ${partId}`);
      return [brickConnectors(brick, lookup).findIndex((mine) => brickConnectors(on, lookup).some((theirs) => engaged(mine, theirs))), Math.round((brick.m?.[4] ?? 1) * 100) / 100];
    };
    // standing upright comes first: a bent arm, drawn about its shoulder's clip too, goes on the shoulder by that clip, but holds an
    // upright bar by its hand's, which stands it upright, where its shoulder's would lay it on its side
    expect(heldBy(torso, 'bent-arm', shoulder, LEFT)).toEqual([0, 1]);
    expect(heldBy(makeBrick({ id: 'bar', partId: 'bar' }), 'bent-arm', { x: 0.8, y: 2.1, z: 0.5 }, { x: 1, y: 0, z: 0 })).toEqual([1, 1]);
    // and it is clips this goes for: a droid's torso, drawn about the bar of its hips, goes into a clip as ever, by the bar that
    // leaves it clearest of the clip's part, a shoulder's
    expect(heldBy(makeBrick({ id: 'plate', partId: 'clip-plate', y: 9 }), 'droid-torso', { x: 0.55, y: 3.95, z: 2 }, { x: 0, y: 0, z: 1 })).toEqual([0, 1]);
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

describe('the rarer hinges', () => {
  /** The cursor at a brick's first connection, as from above. */
  const at = (target: Brick): Vec3 => {
    const [joint] = brickConnectors(target, lookup);
    if (!joint) throw new Error(`${target.partId} has no connection`);
    return joint.at;
  };
  const turnedAs = (brick: Brick | null, turn: Turn): void => {
    if (!brick?.m) throw new Error('not plugged in');
    turn.forEach((v, i) => expect(brick.m?.[i]).toBeCloseTo(v, 9));
  };

  it('lays a car roof beside the plate that holds it, and over the holder two bricks tall, on the grid with either', () => {
    // the plate's five fingers stand out of its side, at its own height: the roof's four go between them, the roof lying on from there
    const plate = makeBrick({ id: 'plate', partId: 'roof-plate' });
    const roof = plug(plate, 'roof', { x: 2, y: 0.4, z: 1.2 }, UP);
    if (!roof) throw new Error('no roof');
    expect(box(roof)).toEqual({ x: [0, 4], y: [0, 0.4], z: [1, 5] });
    turnedAs(roof, turnOf(0));
    expect(pluggedInto(roof, plate)).toBe(true);
    // the holder's stand along one edge of its top: the roof lies over the holder and three studs on, its underside on the holder's top
    const holder = makeBrick({ id: 'holder', partId: 'roof-holder' });
    const over = plug(holder, 'roof', { x: 2, y: 2.8, z: 0.2 }, UP);
    if (!over) throw new Error('no roof');
    expect(box(over)).toEqual({ x: [0, 4], y: [2.4, 2.8], z: [0, 4] });
    turnedAs(over, turnOf(0));
    expect(pluggedInto(over, holder)).toBe(true);
    // the holder's fingers lie inside the box the plate is picked by: a cursor on the side of that box, four fifths of a stud from them, is at them
    const fromBeside = plug(plate, 'roof', { x: 2, y: 0.2, z: 2 }, { x: 0, y: 0, z: 1 });
    expect(fromBeside && box(fromBeside)).toEqual({ x: [0, 4], y: [0, 0.4], z: [1, 5] });
    // a roof goes into no hinge plate's three fingers, and a hinge plate's two into no roof holder
    expect(plug(makeBrick({ id: 'three', partId: 'fingers-3' }), 'roof', { x: 2.5, y: 0.4, z: 0.5 }, UP)).toBeNull();
    expect(plug(plate, 'fingers-2', { x: 2, y: 0.4, z: 1.2 }, UP)).toBeNull();
  });

  it('turns a hinged part as what holds it is turned: half round, on its side or upside down', () => {
    // however the half already there stands, the other goes on as LDraw draws the two together, not the most upright way in the world
    const AS_DRAWN = turnOf(0);
    const HALF_ROUND = turnOf(2);
    const pairs = [
      ['roof-plate', 'roof', AS_DRAWN],
      ['roof-holder', 'roof', AS_DRAWN],
      ['hinge-base', 'hinge-top', AS_DRAWN],
      ['fold-base', 'fold-top', AS_DRAWN],
      ['fold-top', 'fold-base', AS_DRAWN],
      ['stick-base', 'stick', AS_DRAWN],
      ['turn-base', 'turn-top', AS_DRAWN],
      ['turn-base-4', 'turn-top-4', AS_DRAWN],
      ['turn-flat', 'turn-snap', AS_DRAWN],
      ['swivel-base', 'swivel-top', AS_DRAWN],
      // the halves of a 1 × 8 hinge brick face each other: the second goes on turned half round about the first one's own upright
      ['tongue-brick', 'yoke-brick', HALF_ROUND],
      ['yoke-brick', 'tongue-brick', HALF_ROUND],
    ] as const;
    for (const [holder, hinged, rest] of pairs) {
      for (let r = 0; r < 24; r++) {
        const target = makeBrick({ id: 'target', partId: holder, y: 20, r });
        const placed = plug(target, hinged, at(target), UP);
        if (!placed?.m) throw new Error(`no ${hinged} on a ${holder} turned ${r}`);
        const near = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;
        expect(`${hinged} on ${holder} ${r}: ${placed.m.map(near).join(' ')}`).toBe(`${hinged} on ${holder} ${r}: ${multiplyTurns(turnOf(r), rest).map(near).join(' ')}`);
        expect(pluggedInto(placed, target)).toBe(true);
      }
    }
    // a roof on a plate turned half round lies on from the plate's other side
    const plate = makeBrick({ id: 'plate', partId: 'roof-plate', r: 2 });
    const roof = plug(plate, 'roof', at(plate), UP);
    expect(roof && box(roof)).toEqual({ x: [0, 4], y: [0, 0.4], z: [-3, 1] });
  });

  it('stands a roof on its hinge with R, and turns it over with T', () => {
    const plate = makeBrick({ id: 'plate', partId: 'roof-plate' });
    const up = plug(plate, 'roof', { x: 2, y: 0.4, z: 1.2 }, UP, { spin: 1, flipped: false });
    if (!up?.m) throw new Error('not turned');
    expect(up.m[4]).toBeCloseTo(0, 9);
    expect(pluggedInto(up, plate)).toBe(true);
    const over = plug(plate, 'roof', { x: 2, y: 0.4, z: 1.2 }, UP, { spin: 0, flipped: true });
    if (!over?.m) throw new Error('not turned over');
    expect(over.m[4]).toBeCloseTo(-1, 9);
    expect(pluggedInto(over, plate)).toBe(true);
    // on the same side of the plate still
    expect(box(over).z).toEqual([1, 5]);
  });

  it('closes a folding hinge plate, the top on its base in the base’s own box, whichever half is there first', () => {
    const base = makeBrick({ id: 'base', partId: 'fold-base' });
    const top = plug(base, 'fold-top', at(base), UP);
    if (!top) throw new Error('no top');
    expect(box(top)).toEqual(box(base));
    turnedAs(top, turnOf(0));
    expect(pluggedInto(top, base)).toBe(true);
    const first = makeBrick({ id: 'top', partId: 'fold-top', y: 2 });
    const under = plug(first, 'fold-base', at(first), UP);
    expect(under && box(under)).toEqual(box(first));
    // a hinge brick's top is no folding plate's
    expect(plug(base, 'hinge-top', at(base), UP)).toBeNull();
  });

  it('stands a control stick in its base, upright, its pivot in the base’s', () => {
    const base = makeBrick({ id: 'base', partId: 'stick-base' });
    const stick = plug(base, 'stick', { x: 0.5, y: 0.8, z: 0.5 }, UP);
    if (!stick) throw new Error('no stick');
    expect(box(stick)).toEqual({ x: [0, 1], y: [0.3, 2.3], z: [0, 1] });
    turnedAs(stick, turnOf(0));
    expect(pluggedInto(stick, base)).toBe(true);
    // a bar is no control stick, and a stick stands in no open stud
    expect(plug(base, 'bar', { x: 0.5, y: 0.8, z: 0.5 }, UP)).toBeNull();
    expect(plug(makeBrick({ id: 'round', partId: 'round-brick' }), 'stick', { x: 0.5, y: 1.4, z: 0.5 }, UP)).toBeNull();
  });

  it('joins the halves of a 1 × 8 hinge brick end to end, the second turned half round, as LDraw’s complete one is', () => {
    const tongue = makeBrick({ id: 'tongue', partId: 'tongue-brick' });
    const yoke = plug(tongue, 'yoke-brick', at(tongue), UP);
    if (!yoke) throw new Error('no second half');
    // the first fills x 0 to 5, its knuckle in the last of those; the second's knuckle goes round it, its brick on from there
    expect(box(yoke)).toEqual({ x: [3, 8], y: [0, 2], z: [0, 1] });
    turnedAs(yoke, turnOf(2));
    expect(pluggedInto(yoke, tongue)).toBe(true);
    // and the other way about
    const first = makeBrick({ id: 'yoke', partId: 'yoke-brick' });
    const second = plug(first, 'tongue-brick', at(first), UP);
    expect(second && box(second)).toEqual({ x: [3, 8], y: [0, 2], z: [0, 1] });
    turnedAs(second, turnOf(2));
    // two of one half do not join
    expect(plug(tongue, 'tongue-brick', at(tongue), UP)).toBeNull();
  });

  it('leaves a holder with its roof on to be built on like any brick: a second roof does not plug in', () => {
    const plate = makeBrick({ id: 'plate', partId: 'roof-plate' });
    const roof = plug(plate, 'roof', { x: 2, y: 0.4, z: 1.2 }, UP, STILL, 'roof') as Brick;
    expect(answer([roof], plate, 'roof', { x: 2, y: 0.4, z: 1.2 }, UP)).toBe('not here');
    const base = makeBrick({ id: 'base', partId: 'stick-base' });
    const stick = plug(base, 'stick', { x: 0.5, y: 0.8, z: 0.5 }, UP, STILL, 'stick') as Brick;
    expect(answer([stick], base, 'stick', { x: 0.5, y: 0.8, z: 0.5 }, UP)).toBe('not here');
    // nor a third half onto a 1 × 8 hinge brick, nor a second top onto a folding hinge plate
    const tongue = makeBrick({ id: 'tongue', partId: 'tongue-brick' });
    const yoke = plug(tongue, 'yoke-brick', at(tongue), UP, STILL, 'yoke') as Brick;
    expect(answer([yoke], tongue, 'yoke-brick', at(tongue), UP)).toBe('not here');
    const fold = makeBrick({ id: 'fold', partId: 'fold-base' });
    const top = plug(fold, 'fold-top', at(fold), UP, STILL, 'top') as Brick;
    expect(answer([top], fold, 'fold-top', at(fold), UP)).toBe('not here');
  });
});

describe('connections another part already takes', () => {
  const DOWN = { x: 0, y: -1, z: 0 };
  const OUT = { x: 1, y: 0, z: 0 };
  const BACK = { x: -1, y: 0, z: 0 };
  const FRONT = { x: 0, y: 0, z: 1 };

  it('takes no second pin in a hole a pin fills, from either side, and still takes one in the next hole', () => {
    const over = { x: 0.55, y: 1.2, z: 1.45 };
    const pin = plug(beam, 'pin', over, UP, STILL, 'pin') as Brick;
    expect(answer([pin], beam, 'pin', over, UP)).toBe('none');
    // it shows where it would have gone: where the first is
    expect(ask(beam, 'pin', over, UP, STILL, 'new', [pin])?.brick).toEqual({ ...pin, id: 'new' });
    // from below neither: a pin's end is as long as the hole
    expect(answer([pin], beam, 'pin', { x: 0.5, y: 0, z: 1.5 }, DOWN)).toBe('none');
    const next = plugAmong([pin], beam, 'pin', { x: 0.55, y: 1.2, z: 2.45 }, UP);
    expect(next && pluggedInto(next, beam)).toBe(true);
    // the pin being moved is not in its own way
    expect(plugAmong([], beam, 'pin', over, UP)).not.toBeNull();
  });

  it('takes a pin in each end of a hole two studs long, and stops an axle at the pin already in it', () => {
    // the joiner's hole runs along X from 0 to 2, half a stud up
    const joiner = makeBrick({ id: 'joiner', partId: 'pin-joiner' });
    const right = plug(joiner, 'pin', { x: 2, y: 0.55, z: 0.5 }, OUT, STILL, 'right') as Brick;
    expect(connectionIn(right, joiner)?.at.x).toBeCloseTo(1.5, 9);
    const left = plugAmong([right], joiner, 'pin', { x: 0, y: 0.55, z: 0.5 }, BACK, 'left');
    expect(left && connectionIn(left, joiner)?.at.x).toBeCloseTo(0.5, 9);
    // an axle goes a stud into the empty hole, half way, and D pushes it on to its far face; here, as far as the pin, half way, and no further
    const mouth = { x: 0, y: 0.55, z: 0.5 };
    expect(box(plug(joiner, 'axle', mouth, BACK) as Brick).x).toEqual([-3, 1]);
    expect(box(plug(joiner, 'axle', mouth, BACK, { ...STILL, deeper: 2 }) as Brick).x).toEqual([-2, 2]);
    const axle = plugAmong([right], joiner, 'axle', mouth, BACK, 'axle') as Brick;
    expect(box(axle).x).toEqual([-3, 1]);
    expect(box(plug(joiner, 'axle', mouth, BACK, { ...STILL, deeper: 2 }, 'deep', [right]) as Brick).x).toEqual([-3, 1]);
    // and then the hole is full
    expect(answer([right, axle], joiner, 'axle', { x: 0, y: 0.55, z: 0.5 }, BACK)).toBe('none');
    expect(answer([right, axle], joiner, 'pin', { x: 0, y: 0.55, z: 0.5 }, BACK)).toBe('none');
  });

  it('sets a second beam on a long pin against the first, and a third nowhere', () => {
    // the pin's two studs run along X from its collar at 2.013 to its tip at 0.013
    const long = makeBrick({ id: 'long', partId: 'long-pin' });
    const over = { x: 1, y: 0.8, z: 0.5 };
    const first = plug(long, 'beam', over, UP, STILL, 'first') as Brick;
    expect(connectionIn(first, long)?.at.x).toBeCloseTo(1.513, 9);
    const second = plugAmong([first], long, 'beam', over, UP, 'second') as Brick;
    expect(connectionIn(second, long)?.at.x).toBeCloseTo(0.513, 9);
    expect(answer([first, second], long, 'beam', over, UP)).toBe('none');
    // with the first gone, the second's place stays taken and the first's is free again
    const again = plugAmong([second], long, 'beam', over, UP);
    expect(again && connectionIn(again, long)?.at.x).toBeCloseTo(1.513, 9);
  });

  it('sets two thin liftarms on one end of a pin, and no beam where only half a stud is left', () => {
    const pin = plug(beam, 'pin', { x: 0.55, y: 1.2, z: 1.45 }, UP, STILL, 'pin') as Brick;
    // the pin's free end stands from 1 to 2 studs up
    const at = { x: 0.9, y: 1.6, z: 1.5 };
    const first = plugAmong([beam], pin, 'thin-beam', at, OUT, 'first') as Brick;
    expect(connectionIn(first, pin)?.at.y).toBeCloseTo(1.25, 9);
    const second = plugAmong([beam, first], pin, 'thin-beam', at, OUT, 'second') as Brick;
    expect(connectionIn(second, pin)?.at.y).toBeCloseTo(1.75, 9);
    expect(answer([beam, first, second], pin, 'thin-beam', at, OUT)).toBe('none');
    expect(answer([beam, first], pin, 'beam', at, OUT)).toBe('none');
  });

  it('slides a bush along an axle to the nearest place clear of what is on it, within a stud', () => {
    const brick = makeBrick({ id: 'brick', partId: 'technic-brick' });
    // the axle runs along Z from 0, in the brick's hole, to 4
    const axle = plug(brick, 'axle', { x: 1.05, y: 0.75, z: 1 }, FRONT, STILL, 'axle') as Brick;
    const at = (z: number) => ({ x: 1.3, y: 0.7, z });
    const first = plugAmong([brick], axle, 'bush', at(2.8), OUT, 'first') as Brick;
    expect(connectionIn(first, axle)?.at.z).toBeCloseTo(3, 9);
    // asked for the same place, the next goes beside it
    const second = plugAmong([brick, first], axle, 'bush', at(2.8), OUT, 'second') as Brick;
    expect(connectionIn(second, axle)?.at.z).toBeCloseTo(2, 9);
    // and with those two and the brick on it, the axle has no stud left free
    expect(answer([brick, first, second], axle, 'bush', at(2.8), OUT)).toBe('none');
    // asked for where the brick is, a bush goes against the brick
    const low = plugAmong([brick, first], axle, 'bush', at(0.6), OUT, 'low') as Brick;
    expect(connectionIn(low, axle)?.at.z).toBeCloseTo(1.5, 9);
    // but no further than a stud from where it was asked for: the place free beyond that bush is too far from the brick
    expect(answer([brick, low], axle, 'bush', at(0.5), OUT)).toBe('none');
    expect(connectionIn(plugAmong([brick, low], axle, 'bush', at(2.4), OUT) as Brick, axle)?.at.z).toBeCloseTo(2.5, 9);
  });

  it('takes one head on a neck, one bar in a clip and one in an open stud: a second has no room', () => {
    const torso = makeBrick({ id: 'torso', partId: 'torso', r: 1 });
    const head = plug(torso, 'head', { x: 0.55, y: 2, z: 1.05 }, UP, STILL, 'head') as Brick;
    expect(answer([head], torso, 'head', { x: 0.55, y: 2, z: 1.05 }, UP)).toBe('none');

    const plate = makeBrick({ id: 'plate', partId: 'clip-plate' });
    const bar = plug(plate, 'bar', { x: 0.55, y: 0.35, z: 2 }, FRONT, STILL, 'bar') as Brick;
    expect(answer([bar], plate, 'bar', { x: 0.55, y: 0.35, z: 2 }, FRONT)).toBe('none');

    const round = makeBrick({ id: 'round', partId: 'round-brick' });
    const standing = plug(round, 'bar', { x: 0.55, y: 1.4, z: 0.5 }, UP, STILL, 'standing') as Brick;
    expect(answer([standing], round, 'bar', { x: 0.55, y: 1.4, z: 0.5 }, UP)).toBe('none');
  });

  it('leaves a hinge or a turntable that is put together to be built on like any brick: a second top does not plug in', () => {
    const base = makeBrick({ id: 'base', partId: 'hinge-base' });
    const top = plug(base, 'hinge-top', { x: 1, y: 1.2, z: 0.5 }, UP, STILL, 'top') as Brick;
    expect(answer([], base, 'hinge-top', { x: 1, y: 0.6, z: 1 }, FRONT)).toBe('room');
    expect(answer([top], base, 'hinge-top', { x: 1, y: 0.6, z: 1 }, FRONT)).toBe('not here');
    // nor a second base at the top
    expect(answer([base], top, 'hinge-base', { x: 1, y: 1, z: 1 }, FRONT)).toBe('not here');

    const turntable = makeBrick({ id: 'turntable', partId: 'turn-base' });
    const turning = plug(turntable, 'turn-top', { x: 1.2, y: 0.4, z: 0.9 }, UP, STILL, 'turning') as Brick;
    expect(answer([turning], turntable, 'turn-top', { x: 2, y: 0.2, z: 0.9 }, OUT)).toBe('not here');

    const three = makeBrick({ id: 'three', partId: 'fingers-3' });
    const two = plug(three, 'fingers-2', { x: 2.5, y: 0.4, z: 0.5 }, UP, STILL, 'two') as Brick;
    expect(answer([two], three, 'fingers-2', { x: 2.5, y: 0.4, z: 0.5 }, UP)).toBe('not here');
  });

  it('hangs a second arm from the shoulder that is free, when the cursor is in reach of both', () => {
    const torso = makeBrick({ id: 'torso', partId: 'torso' });
    // on the torso's front, a little towards its -X shoulder
    const chest = { x: 0.9, y: 1.15, z: 1 };
    const first = plug(torso, 'arm', chest, FRONT, STILL, 'first') as Brick;
    expect(connectionIn(first, torso)?.at.x).toBeLessThan(1);
    const second = plugAmong([first], torso, 'arm', chest, FRONT, 'second') as Brick;
    expect(connectionIn(second, torso)?.at.x).toBeGreaterThan(1);
    expect(answer([first, second], torso, 'arm', chest, FRONT)).toBe('none');
  });

  it('seats a second torso on no hips that have one, and a part with two pins only in holes that are both free', () => {
    const hips = makeBrick({ id: 'hips', partId: 'hips' });
    const torso = plug(hips, 'torso', { x: 0.45, y: 2.8, z: 0.5 }, UP, STILL, 'torso') as Brick;
    expect(answer([torso], hips, 'torso', { x: 1.55, y: 2.8, z: 0.5 }, UP)).toBe('none');

    // two pins a stud apart, over the beam's middle hole: one goes in there, the other in a hole beside it
    const over = { x: 0.55, y: 1.2, z: 1.45 };
    const holes = (brick: Brick): number[] =>
      brickConnectors(brick, lookup)
        .filter((mine) => brickConnectors(beam, lookup).some((theirs) => engaged(mine, theirs)))
        .map((mine) => Math.round(mine.at.z * 10) / 10)
        .sort();
    const alone = plug(beam, 'double-pin', over, UP) as Brick;
    expect(holes(alone)).toHaveLength(2);
    const beside = holes(alone).find((z) => z !== 1.5) ?? 0;
    // with a pin in that one, it takes the hole on the other side
    const pin = plug(beam, 'pin', { x: 0.55, y: 1.2, z: beside - 0.05 }, UP, STILL, 'pin') as Brick;
    expect(holes(pin)).toEqual([beside]);
    expect(holes(plugAmong([pin], beam, 'double-pin', over, UP) as Brick)).toEqual(beside < 1.5 ? [1.5, 2.5] : [0.5, 1.5]);
    // turned half round with R, its other pin comes to the hole the pin fills: no room like that
    const halfRound = { spin: 2, flipped: false };
    expect(ask(beam, 'double-pin', over, UP, halfRound, 'new', [pin])?.free).toBe(false);
    expect(ask(beam, 'double-pin', over, UP, halfRound, 'new', [])?.free).toBe(true);
    expect(ask(beam, 'double-pin', over, UP, STILL, 'new', [pin])?.free).toBe(true);
  });

  it('hangs a minifigure’s two legs on the one axle across its hips, each on its own side, and no third', () => {
    // LDraw draws both legs' joints on the middle of the hips' axle, two studs long: it has room for the two
    const hips = makeBrick({ id: 'hips', partId: 'bare-hips', y: 6 });
    const front = { x: 1, y: 6 * PLATE_HEIGHT + 0.44, z: 1 };
    const right = plug(hips, 'leg-right', front, FRONT, STILL, 'right') as Brick;
    const left = plugAmong([right], hips, 'leg-left', front, FRONT, 'left') as Brick;
    // side by side under the hips, a stud and a hair apart as LDraw sets them
    expect(Math.abs(left.x - right.x)).toBeCloseTo(1.025, 9);
    expect(pluggedInto(left, hips)).toBe(true);
    expect(answer([right, left], hips, 'leg-left', front, FRONT)).toBe('none');
    expect(answer([right, left], hips, 'leg-right', front, FRONT)).toBe('none');
    // a second leg of the same side has no room, however R turns it about the axle
    expect(answer([right], hips, 'leg-right', front, FRONT)).toBe('none');
    for (const spin of [1, 2, 3]) expect(ask(hips, 'leg-left', front, FRONT, { spin, flipped: false }, 'new', [left])?.free).toBe(false);
    // the left leg turned over with T comes to the right leg's side: free, until the right leg is there
    expect(ask(hips, 'leg-left', front, FRONT, { spin: 0, flipped: true }, 'new', [])?.free).toBe(true);
    expect(ask(hips, 'leg-left', front, FRONT, { spin: 0, flipped: true }, 'new', [right])?.free).toBe(false);
  });

  it('hangs each leg on its own side of hips that lie on their side, upside down or a little tilted', () => {
    const turn = (degrees: number): Turn => {
      const [c, s] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
      // about X, the way the hips' axle runs
      return [1, 0, 0, 0, c, -s, 0, s, c];
    };
    const standing: Brick[] = [5, 6, 7, 9, 15, 16, 22].map((r) => makeBrick({ id: 'hips', partId: 'bare-hips', x: 4, y: 30, z: 4, r }));
    const tilted: Brick[] = [1, 5, 90].map((degrees) => ({ ...makeBrick({ id: 'hips', partId: 'bare-hips', x: 4, y: 30, z: 4 }), m: turn(degrees) }));
    for (const hips of [...standing, ...tilted]) {
      const [, , axle] = brickConnectors(hips, lookup);
      if (!axle) throw new Error('no axle');
      // each leg's joint points to the leg's own side: a right leg's against the axle, a left leg's along it, as on hips standing upright
      const side = (leg: Brick): number => {
        const joint = connectionIn(leg, hips);
        return joint ? Math.sign(joint.axis.x * axle.axis.x + joint.axis.y * axle.axis.y + joint.axis.z * axle.axis.z) : 0;
      };
      const right = plug(hips, 'leg-right', axle.at, UP, STILL, 'right') as Brick;
      expect(side(right)).toBe(-1);
      expect(answer([right], hips, 'leg-right', axle.at, UP)).toBe('none');
      const left = plugAmong([right], hips, 'leg-left', axle.at, UP, 'left') as Brick;
      expect(side(left)).toBe(1);
      expect(answer([right, left], hips, 'leg-left', axle.at, UP)).toBe('none');
    }
  });

  it('takes one arm on a hand, though the hand’s pin is twice as long as an arm’s wrist', () => {
    const hand = makeBrick({ id: 'hand', partId: 'hand' });
    const over = { x: 0.55, y: 0.3, z: 0.95 };
    const right = plug(hand, 'arm-right', over, UP, STILL, 'right') as Brick;
    expect(pluggedInto(right, hand)).toBe(true);
    expect(answer([right], hand, 'arm-left', over, UP)).toBe('none');
    expect(answer([right], hand, 'arm-right', over, UP)).toBe('none');
  });

  it('keeps a hole clear of what is on the next piece of a pin drawn in pieces', () => {
    // the long end of the pin: two pieces, from x 1 to 2 and from 2 to 3
    const long = makeBrick({ id: 'long', partId: 'triple-pin' });
    const brick = plug(long, 'technic-brick', { x: 2.5, y: 0.8, z: 0.5 }, UP, STILL, 'brick') as Brick;
    expect(connectionIn(brick, long)?.at.x).toBeCloseTo(2.5, 9);
    // a hole two studs long, asked for at the first piece, would reach over the second, where the brick is
    expect(answer([brick], long, 'pin-joiner', { x: 1.6, y: 0.8, z: 0.5 }, UP)).toBe('none');
    // a beam has the first piece to itself
    const beside = plugAmong([brick], long, 'beam', { x: 1.6, y: 0.8, z: 0.5 }, UP) as Brick;
    expect(connectionIn(beside, long)?.at.x).toBeCloseTo(1.5, 9);
  });

  it('finds room for a part turned over with T clear of what was in its way', () => {
    // a pin in the joiner's right end, which takes the hole from 1 to 2
    const joiner = makeBrick({ id: 'joiner', partId: 'pin-joiner' });
    const right = plug(joiner, 'pin', { x: 2, y: 0.55, z: 0.5 }, OUT, STILL, 'right') as Brick;
    const mouth = { x: 0, y: 0.55, z: 0.5 };
    // from the left, the long pin's stub of axle goes in as far as it is long, short of the pin, its long end standing out to the left: room
    const stub = ask(joiner, 'long-pin', mouth, BACK, STILL, 'new', [right]);
    expect(stub?.free).toBe(true);
    expect(stub && connectionIn(stub.brick, joiner)?.at.x).toBeCloseTo(0.4875, 9);
    // turned over there, it has come through the joiner from the right, its long end through the pin: none
    expect(ask(joiner, 'long-pin', mouth, BACK, { spin: 0, flipped: true }, 'new', [right])?.free).toBe(false);
    // asked for at the right, where the pin is, its stub would go into the pin; turned over, it has come through from the left, its long end
    // standing out of the far end
    const at = { x: 2, y: 0.55, z: 0.5 };
    expect(ask(joiner, 'long-pin', at, OUT, STILL, 'new', [right])?.free).toBe(false);
    const over = ask(joiner, 'long-pin', at, OUT, { spin: 0, flipped: true }, 'new', [right]);
    expect(over?.free).toBe(true);
    expect(over && connectionIn(over.brick, joiner)?.at.x).toBeCloseTo(0.4875, 9);
  });

  it('answers the same wherever in the world a hole only a tenth of a stud deep is', () => {
    for (const x of [0, 3, 7, 11, 13]) {
      for (const z of [0, 5, 9]) {
        // the joiner's left mouth is at x, half a stud up
        const joiner = makeBrick({ id: 'joiner', partId: 'slot-joiner', x, z });
        const mouth = { x, y: 0.55, z: z + 0.5 };
        const pin = plug(joiner, 'pin', mouth, BACK, STILL, 'pin') as Brick;
        expect(connectionIn(pin, joiner)?.at.x).toBeCloseTo(x + 0.5, 9);
        // a pin the other way through that mouth would run through the first
        expect(answer([pin], joiner, 'pin', { ...mouth, x: x + 0.1 }, BACK)).toBe('none');
        // and an axle has no hole left to go into: it is not set down outside it
        expect(answer([pin], joiner, 'axle', mouth, BACK)).toBe('none');
      }
    }
  });

  it('sets a part with a hole a tenth of a stud deep on a pin, after the liftarm already on it', () => {
    const pin = plug(beam, 'pin', { x: 0.55, y: 1.2, z: 1.45 }, UP, STILL, 'pin') as Brick;
    const at = { x: 0.9, y: 1.6, z: 1.5 };
    const liftarm = plugAmong([beam], pin, 'thin-beam', at, OUT, 'liftarm') as Brick;
    const joiner = plugAmong([beam, liftarm], pin, 'slot-joiner', at, OUT, 'joiner') as Brick;
    // its mouth right above the liftarm, which takes the pin's end from 1 to 1.5 studs up
    expect(connectionIn(joiner, pin)?.at.y).toBeCloseTo(1.55, 9);
  });
});
