import { describe, expect, it } from 'bun:test';
import { PLATE_HEIGHT, type Vec3 } from '../grid';
import { brickConnectors, engaged } from '../model/connections';
import { brickFloor } from '../model/geometry';
import { isOutOfBounds } from '../model/spatial';
import { connectorLookup as lookup } from '../model/connectorTestParts';
import { makeBrick } from '../model/testUtils';
import type { Brick } from '../model/types';
import { attachToConnector, nextWay, type ConnectTurn } from './connect';
import { box, hit, plug, STILL, UP } from './connectTesting';
import { payloadFromPart } from './payload';

/** The ways `partId` can plug into `target` at the cursor, and which of them it takes (see Plugging); null where it does not plug in. */
function waysAt(target: Brick, partId: string, point: Vec3, normal: Vec3, turned: ConnectTurn = STILL, others: readonly Brick[] = []) {
  const part = lookup(partId);
  if (!part) throw new Error(partId);
  return attachToConnector(hit(point, normal, target.id), target, payloadFromPart(part, 4, 0), turned, lookup, [target, ...others])?.ways ?? null;
}

const beam = makeBrick({ id: 'beam', partId: 'beam' });

describe('choosing which of its own connections a part plugs in by', () => {
  const pin = plug(beam, 'pin', { x: 0.55, y: 1.2, z: 1.45 }, UP, STILL, 'pin') as Brick;
  const onPin = { x: 0.9, y: 1.6, z: 1.5 };
  const side = { x: 1, y: 0, z: 0 };
  /** The box of a beam built onto the pin standing in `beam`, turned and plugged in as `turned` asks. */
  const beamOn = (turned: ConnectTurn) => {
    const top = plug(pin, 'beam', onPin, side, turned);
    if (!top) throw new Error('no beam');
    return box(top);
  };

  it('puts a beam onto a pin by whichever of its holes is chosen, and R turns it about that one', () => {
    // by its end hole, as it goes on by itself; by its middle hole; by the hole at its other end
    expect(beamOn(STILL).z).toEqual([1, 4]);
    expect(beamOn({ ...STILL, via: 1 })).toEqual({ x: [0, 1], y: [1, 2.2], z: [0, 3] });
    expect(beamOn({ ...STILL, via: 2 }).z).toEqual([-1, 2]);
    // R swings it a quarter about the pin, still on it by its middle hole, and T turns it over there
    expect(beamOn({ spin: 1, flipped: false, via: 1 })).toEqual({ x: [-1, 2], y: [1, 2.2], z: [1, 2] });
    const over = plug(pin, 'beam', onPin, side, { spin: 0, flipped: true, via: 1 });
    // about the hole's middle, which is not the beam's
    expect(over && box(over)).toEqual({ x: [0, 1], y: [0.8, 2], z: [0, 3] });
    expect(over?.m?.[4]).toBeCloseTo(-1, 9);
  });

  it('counts the ways it can plug in there, the way it takes by itself first, and says which it takes', () => {
    // by an end hole or by the middle one: on by the other end's hole, the beam lies as it does on by the first end's turned half
    // round, so that is no other way
    expect(waysAt(pin, 'beam', onPin, side)).toEqual({ at: 0, plugs: [0, 1] });
    expect(waysAt(pin, 'beam', onPin, side, { ...STILL, via: 1 })).toEqual({ at: 1, plugs: [0, 1] });
    expect(waysAt(pin, 'beam', onPin, side, { ...STILL, via: 2 })).toEqual({ at: 0, plugs: [0, 1] });
    // a pin's two ends are alike: whichever goes into the hole, the pin stands as it would by the other, so there is one way
    expect(waysAt(beam, 'pin', { x: 0.55, y: 1.2, z: 1.45 }, UP)).toEqual({ at: 0, plugs: [0] });
    // where the index marks none alike, each goes in its own way: a double pin by any of its four pins, its shape telling them
    // apart, and a beam printed at one end by any of its holes
    expect(waysAt(beam, 'double-pin', { x: 0.55, y: 1.2, z: 1.45 }, UP)?.plugs).toHaveLength(4);
    expect(waysAt(pin, 'printed-beam', onPin, side)).toEqual({ at: 0, plugs: [0, 1, 2] });
  });

  it('counts alike connections as one way only where R’s quarter turns keep to the grid, not at a tilted connection', () => {
    // a bar with a stretch to hold by at each end: into a plate's clip, square to the grid, it goes in alike by either, one way;
    // into a minifigure hand's clip, tilted with the wrist, R's quarters by one end are not those by the other, so each is a way
    const plate = makeBrick({ id: 'plate', partId: 'clip-plate', y: 5 });
    expect(waysAt(plate, 'twin-bar', { x: 0.55, y: 2.35, z: 2 }, { x: 0, y: 0, z: 1 })?.plugs).toHaveLength(1);
    const hand = makeBrick({ id: 'hand', partId: 'hand', y: 5 });
    expect(waysAt(hand, 'twin-bar', { x: 0.55, y: 2.3, z: 1.45 }, UP)?.plugs).toHaveLength(2);
    // nor where the part's own connections lean: holes leaning in at each end of an angled connector, onto an upright pin
    expect(waysAt(pin, 'leaning-holes', onPin, side)?.plugs).toHaveLength(2);
  });

  it('names each way by the connection its best fit goes on by, so plugging in by that one gives the way as it was', () => {
    // a pin pushed into a slot joiner's left mouth from the left goes in by its second end, whose axis already points in; its two
    // ends are alike, so there is one way, and plugging in by its first end turns it otherwise
    const joiner = makeBrick({ id: 'joiner', partId: 'slot-joiner' });
    const mouth = { x: -0.35, y: 0.5, z: 0.5 };
    const left = { x: -1, y: 0, z: 0 };
    expect(waysAt(joiner, 'pin', mouth, left)).toEqual({ at: 0, plugs: [1] });
    expect(plug(joiner, 'pin', mouth, left, { ...STILL, via: 1 })).toEqual(plug(joiner, 'pin', mouth, left));
    expect(plug(joiner, 'pin', mouth, left, { ...STILL, via: 0 })).not.toEqual(plug(joiner, 'pin', mouth, left));
  });

  it('puts first, of ways that fit as well, the one whose best fit comes first: the way the part takes by itself', () => {
    // by its first hole, which sits high on it, the beam would reach into the ground, or stand on its head; by its middle hole and by
    // its last it goes on as well as each other, and takes its middle one, the first it comes to, though the index groups its last
    // with its first
    expect(waysAt(pin, 'tie-beam', onPin, side)).toEqual({ at: 0, plugs: [1, 2] });
  });

  it('takes the first way it lists by itself, and each way by the connection that way names', () => {
    const parts = ['pin', 'beam', 'printed-beam', 'technic-brick', 'axle', 'bush', 'pin-joiner', 'slot-joiner', 'long-pin', 'triple-pin', 'double-pin', 'thin-beam', 'torso', 'hips', 'leg-left', 'arm', 'bar', 'clip-plate', 'handle-plate', 'droid-torso', 'droid-arm', 'link', 'bent-arm', 'fork', 'finger'];
    let asked = 0;
    for (const payloadId of parts) {
      for (const targetId of parts) {
        const target = makeBrick({ id: 'target', partId: targetId, y: 5 });
        for (const socket of brickConnectors(target, lookup)) {
          for (const s of [-0.4, 0, 0.4]) {
            const point = { x: socket.at.x + socket.axis.x * s, y: socket.at.y + socket.axis.y * s + 0.05, z: socket.at.z + socket.axis.z * s };
            const itself = waysAt(target, payloadId, point, UP);
            if (!itself) continue;
            asked++;
            expect(itself.at).toBe(0);
            itself.plugs.forEach((via, at) => expect(waysAt(target, payloadId, point, UP, { ...STILL, via })?.at).toBe(at));
          }
        }
      }
    }
    expect(asked).toBeGreaterThan(100);
  });

  it('steps to the next way, or the one before, round from the last to the first', () => {
    expect(nextWay({ at: 0, plugs: [0, 1, 2] }, false)).toBe(1);
    expect(nextWay({ at: 2, plugs: [0, 1, 2] }, false)).toBe(0);
    expect(nextWay({ at: 0, plugs: [4, 1, 2] }, true)).toBe(2);
    expect(nextWay({ at: 1, plugs: [4, 1, 2] }, true)).toBe(4);
    expect(nextWay({ at: 0, plugs: [3] }, false)).toBeNull();
    expect(nextWay({ at: 0, plugs: [3] }, true)).toBeNull();
  });

  it('goes on as it would by itself where the connection chosen does not plug in there, or is none of its own', () => {
    // a thin liftarm onto a pin: only its pin hole goes onto one, not the axle holes at its ends
    const by = (turned: ConnectTurn) => plug(pin, 'thin-beam', onPin, side, turned);
    expect(by({ ...STILL, via: 1 })).toEqual(by(STILL));
    expect(by({ ...STILL, via: 7 })).toEqual(by(STILL));
    expect(waysAt(pin, 'thin-beam', onPin, side, { ...STILL, via: 1 })).toEqual({ at: 0, plugs: [0] });
  });

  it('goes on by a way it can be built, not into the ground, where it has one', () => {
    // a pin standing out of the front of a Technic brick on the baseplate, its hole 0.7 studs up
    const brick = makeBrick({ id: 'brick', partId: 'technic-brick' });
    const front = { x: 0, y: 0, z: 1 };
    const standing = plug(brick, 'pin', { x: 1.05, y: 0.75, z: 1 }, front, STILL, 'pin') as Brick;
    // a beam goes onto it standing up from it by its end hole: hanging down, the way that turns it least, it would reach 1.8
    // studs into the ground
    const up = plug(standing, 'beam', { x: 1.05, y: 0.75, z: 1.6 }, front, STILL, 'beam', [brick]);
    if (!up) throw new Error('no beam');
    expect(isOutOfBounds(up, lookup)).toBe(false);
    expect(brickFloor(up, lookup) * PLATE_HEIGHT).toBeCloseTo(0.2, 9);
    // R still swings it round the pin, down into the ground too, where it cannot be built
    const down = plug(standing, 'beam', { x: 1.05, y: 0.75, z: 1.6 }, front, { spin: 2, flipped: false }, 'beam', [brick]);
    expect(down && isOutOfBounds(down, lookup)).toBe(true);
    // that comes before plugging in the most it can: onto both of the pins on one side of a double pin standing on the baseplate,
    // one over the other, a beam would reach a twentieth of a stud into the ground, so it goes onto the upper one alone
    const double = makeBrick({ id: 'double', partId: 'double-pin' });
    const onUpper = plug(double, 'beam', { x: 2.5, y: 1.5, z: 0.5 }, { x: 1, y: 0, z: 0 });
    if (!onUpper) throw new Error('no beam');
    expect(isOutOfBounds(onUpper, lookup)).toBe(false);
    expect(brickConnectors(onUpper, lookup).filter((hole) => brickConnectors(double, lookup).some((end) => engaged(hole, end)))).toHaveLength(1);
  });
});
