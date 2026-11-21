/**
 * Technic, click-hinge and minifigure parts for tests, with the
 * connections the library converter finds on the real ones (LDraw 3673,
 * 32523, 3700, 3705, 3713, 30364, 30365, 973, 3626b and 3818), in the
 * editor's frame: studs, y up, from the middle of the part's footprint at
 * its bottom.
 */
import { getPart } from '../parts/catalog';
import type { Connector, PartDef, PartLookup } from '../parts/types';

function part(id: string, w: number, d: number, h: number, connectors: readonly Connector[]): PartDef {
  return { id, name: id, category: 'library', w, d, h, studs: [], solids: [{ x0: 0, y0: 0, z0: 0, x1: w, y1: h, z1: d }], shape: { kind: 'mesh' }, keywords: [], connectors };
}

const X = { x: 1, y: 0, z: 0 };
const NEG_X = { x: -1, y: 0, z: 0 };
const Y = { x: 0, y: 1, z: 0 };
const NEG_Y = { x: 0, y: -1, z: 0 };
const Z = { x: 0, y: 0, z: 1 };
const NEG_Z = { x: 0, y: 0, z: -1 };

/** A Technic pin: two ends a stud long, pointing out from its collar in the middle, 0.4 studs up. */
export const PIN = part('pin', 2, 1, 2, [
  { kind: 'pin', at: { x: -0.5, y: 0.4, z: 0 }, axis: NEG_X, length: 1 },
  { kind: 'pin', at: { x: 0.5, y: 0.4, z: 0 }, axis: X, length: 1 },
]);

/** A Technic beam 3 lying flat: three upright holes a stud apart, through its stud-thick body. */
export const BEAM = part('beam', 1, 3, 3, [
  { kind: 'pinhole', at: { x: 0, y: 0.5, z: -1 }, axis: Y, length: 1 },
  { kind: 'pinhole', at: { x: 0, y: 0.5, z: 0 }, axis: Y, length: 1 },
  { kind: 'pinhole', at: { x: 0, y: 0.5, z: 1 }, axis: Y, length: 1 },
]);

/** A Technic brick 1 × 2 with its hole from front to back, 0.7 studs up. */
export const TECHNIC_BRICK = part('technic-brick', 2, 1, 3, [{ kind: 'pinhole', at: { x: 0, y: 0.7, z: 0 }, axis: Z, length: 1 }]);

/** A Technic axle 4, along X, 0.3 studs up. */
export const AXLE = part('axle', 4, 1, 2, [{ kind: 'axle', at: { x: 0, y: 0.3, z: 0 }, axis: NEG_X, length: 4 }]);

/** A Technic bush: an axle hole a stud long, from front to back. */
export const BUSH = part('bush', 1, 1, 2, [{ kind: 'axlehole', at: { x: 0, y: 0.45, z: 0 }, axis: Z, length: 1 }]);

/** A round pin joiner, as LDraw 75535: one hole two studs long, which takes a pin's end at each of its own. */
export const PIN_JOINER = part('pin-joiner', 2, 1, 3, [{ kind: 'pinhole', at: { x: 0, y: 0.5, z: 0 }, axis: NEG_X, length: 2 }]);

/**
 * A round pin joiner with a slot, as LDraw 62462: the slot breaks its hole,
 * so LDraw draws only the hole's two mouths, each a tenth of a stud deep.
 */
export const SLOT_JOINER = {
  ...part('slot-joiner', 2, 1, 3, [
    { kind: 'pinhole', at: { x: -0.95, y: 0.5, z: 0 }, axis: X, length: 0.1 },
    { kind: 'pinhole', at: { x: 0.95, y: 0.5, z: 0 }, axis: NEG_X, length: 0.1 },
  ]),
  extent: { min: { x: -1, y: 0, z: -0.5 }, max: { x: 1, y: 1, z: 0.5 } },
};

/** A long axle pin, as LDraw 11214: a pin two studs long out from its collar, which takes two beams, and a stub of axle the other way. */
export const LONG_PIN = part('long-pin', 3, 1, 2, [
  { kind: 'pin', at: { x: -0.487, y: 0.4, z: 0 }, axis: NEG_X, length: 2 },
  { kind: 'axle', at: { x: 1, y: 0.4, z: 0 }, axis: NEG_X, length: 0.975 },
]);

/** A long pin, as LDraw 6558: LDraw draws its long end as two pins a stud long, one after the other, and its short end as a third. */
export const TRIPLE_PIN = part('triple-pin', 3, 1, 2, [
  { kind: 'pin', at: { x: -1, y: 0.39, z: 0 }, axis: NEG_X, length: 1 },
  { kind: 'pin', at: { x: 0, y: 0.39, z: 0 }, axis: X, length: 1 },
  { kind: 'pin', at: { x: 1, y: 0.39, z: 0 }, axis: X, length: 1 },
]);

/** A double pin, as LDraw 32138: two pins a stud apart, one over the other, on each side of its body. */
export const DOUBLE_PIN = part('double-pin', 3, 1, 5, [
  { kind: 'pin', at: { x: -1, y: 1.45, z: 0 }, axis: NEG_X, length: 1 },
  { kind: 'pin', at: { x: -1, y: 0.45, z: 0 }, axis: NEG_X, length: 1 },
  { kind: 'pin', at: { x: 1, y: 1.45, z: 0 }, axis: X, length: 1 },
  { kind: 'pin', at: { x: 1, y: 0.45, z: 0 }, axis: X, length: 1 },
]);

/** A thin liftarm, as LDraw 6632: half a stud thick, a pin hole in its middle and an axle hole at each end. */
export const THIN_BEAM = part('thin-beam', 1, 3, 1, [
  { kind: 'pinhole', at: { x: 0, y: 0.25, z: 0 }, axis: NEG_Y, length: 0.5 },
  { kind: 'axlehole', at: { x: 0, y: 0.25, z: 1 }, axis: NEG_Y, length: 0.5 },
  { kind: 'axlehole', at: { x: 0, y: 0.25, z: -1 }, axis: NEG_Y, length: 0.5 },
]);

/** Hinge bricks 1 × 2 with a click hinge on their +X end: one finger, and the fork it fits. */
export const FINGER = part('finger', 3, 1, 3, [{ kind: 'finger', at: { x: 1, y: 0.7, z: 0 }, axis: Z, length: 0.9 }]);
export const FORK = part('fork', 3, 1, 3, [{ kind: 'fork', at: { x: 1, y: 0.7, z: 0 }, axis: Z, length: 0.85 }]);

const SHOULDER_TILT = Math.atan2(0.17, 0.985);

/** A minifigure torso: its neck on top, its waist's two sockets under it, a shoulder each side tilted about 9.8°. */
export const TORSO = part('torso', 2, 1, 5, [
  { kind: 'neck', at: { x: 0, y: 1.6, z: 0 }, axis: Y, length: 0.2 },
  { kind: 'waist', at: { x: -0.5, y: 0, z: 0 }, axis: Y, length: 0.275 },
  { kind: 'waist', at: { x: 0.5, y: 0, z: 0 }, axis: Y, length: 0.275 },
  { kind: 'shoulder', at: { x: -0.7776, y: 1.15, z: 0 }, axis: { x: Math.cos(SHOULDER_TILT), y: -Math.sin(SHOULDER_TILT), z: 0 }, length: 0.3 },
  { kind: 'shoulder', at: { x: 0.7776, y: 1.15, z: 0 }, axis: { x: Math.cos(SHOULDER_TILT), y: Math.sin(SHOULDER_TILT), z: 0 }, length: 0.3 },
]);

/** Minifigure hips and legs, the hips' two studs on their top, their box reaching above them as the real one's does. */
export const HIPS = part('hips', 2, 1, 7, [
  { kind: 'hips', at: { x: -0.5, y: 2, z: 0 }, axis: Y, length: 0.275 },
  { kind: 'hips', at: { x: 0.5, y: 2, z: 0 }, axis: Y, length: 0.275 },
]);

/**
 * Minifigure hips on their own, as LDraw 3815b: their two studs on top, and
 * one axle right across for both legs, two studs long.
 */
export const BARE_HIPS = part('bare-hips', 2, 1, 4, [
  { kind: 'hips', at: { x: -0.5, y: 1.038, z: 0 }, axis: NEG_Y, length: 0.275 },
  { kind: 'hips', at: { x: 0.5, y: 1.038, z: 0 }, axis: NEG_Y, length: 0.275 },
  { kind: 'hip', at: { x: 0, y: 0.438, z: 0 }, axis: X, length: 2 },
]);

/**
 * A minifigure's right and left legs, as LDraw 3816c and 3817c. LDraw draws
 * both about the middle of the hips, so each one's joint lies beside it,
 * half a stud towards the other leg: on the hips' axle the two joints fill
 * the same stud, the legs either side of it.
 */
export const LEG_RIGHT = {
  ...part('leg-right', 1, 1, 5, [{ kind: 'leg', at: { x: 0.513, y: 1.4, z: -0.062 }, axis: NEG_X, length: 1 }]),
  extent: { min: { x: -0.45, y: 0, z: -0.5 }, max: { x: 0.45, y: 1.84, z: 0.5 } },
};
export const LEG_LEFT = {
  ...part('leg-left', 1, 1, 5, [{ kind: 'leg', at: { x: -0.512, y: 1.4, z: -0.062 }, axis: X, length: 1 }]),
  extent: { min: { x: -0.45, y: 0, z: -0.5 }, max: { x: 0.45, y: 1.84, z: 0.5 } },
};

/** A minifigure head, its joint at the middle of its underside. */
export const HEAD = part('head', 1, 1, 3, [{ kind: 'head', at: { x: 0, y: 0, z: 0 }, axis: Y, length: 0.2 }]);

/** A minifigure's right arm, by its shoulder pin, which its body hangs out and down from. */
export const ARM = part('arm', 1, 1, 4, [{ kind: 'arm', at: { x: 0.4, y: 1.4, z: 0 }, axis: X, length: 0.3 }]);

/**
 * A minifigure's right and left arms and a hand, as LDraw 3818, 3819 and
 * 3820: the arm's wrist is a socket shorter than the pin of the hand that
 * turns in it.
 */
const ARM_EXTENT = { min: { x: -0.43, y: 0, z: -0.5 }, max: { x: 0.43, y: 1.45, z: 0.5 } };
const WRIST_AXIS = { x: 0, y: Math.SQRT1_2, z: -Math.SQRT1_2 };
export const ARM_RIGHT = {
  ...part('arm-right', 1, 1, 4, [
    { kind: 'arm', at: { x: 0.077, y: 1.122, z: -0.173 }, axis: X, length: 0.3 },
    { kind: 'wrist', at: { x: -0.173, y: 0.177, z: 0.322 }, axis: WRIST_AXIS, length: 0.3 },
  ]),
  extent: ARM_EXTENT,
};
export const ARM_LEFT = {
  ...part('arm-left', 1, 1, 4, [
    { kind: 'arm', at: { x: -0.077, y: 1.122, z: -0.173 }, axis: NEG_X, length: 0.3 },
    { kind: 'wrist', at: { x: 0.173, y: 0.177, z: 0.322 }, axis: WRIST_AXIS, length: 0.3 },
  ]),
  extent: ARM_EXTENT,
};
export const HAND = {
  ...part('hand', 1, 2, 2, [
    { kind: 'hand', at: { x: 0, y: 0.231, z: -0.063 }, axis: NEG_Z, length: 0.65 },
    { kind: 'clip', at: { x: 0, y: 0.272, z: 0.432 }, axis: { x: 0, y: 0.968, z: 0.25 }, length: 0.55 },
  ]),
  extent: { min: { x: -0.3, y: 0, z: -0.72 }, max: { x: 0.3, y: 0.62, z: 0.72 } },
};

/** A bar 3 studs long, upright, as LDraw 87994: a fifth of a stud across, well inside its cells. */
export const BAR = {
  ...part('bar', 1, 1, 8, [{ kind: 'bar', at: { x: 0, y: 1.5, z: 0 }, axis: Y, length: 3 }]),
  extent: { min: { x: -0.2, y: 0, z: -0.2 }, max: { x: 0.2, y: 3, z: 0.2 } },
};

/** A 1 × 1 plate with a clip on its front, holding a bar across, as LDraw 61252. */
export const CLIP_PLATE = part('clip-plate', 1, 2, 1, [{ kind: 'clip', at: { x: 0, y: 0.3, z: 0.5 }, axis: X, length: 0.4 }]);

/** A 1 × 2 plate with a handle along its front, as LDraw 48336: a bar, but at the edge of a part that stacks. */
export const HANDLE_PLATE = part('handle-plate', 2, 2, 1, [{ kind: 'bar', at: { x: 0, y: 0.3, z: 0.8 }, axis: X, length: 2 }]);

/** An antenna: a mast, a bar, standing on a 1 × 1 base, so only its top end is free. */
export const ANTENNA = {
  ...part('antenna', 1, 1, 10, [{ kind: 'bar', at: { x: 0, y: 2.4, z: 0 }, axis: Y, length: 3.2 }]),
  extent: { min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 4, z: 0.5 } },
};

/** A sword, hilt down: its hilt a bar free at the bottom, its blade above, half a stud to either side. */
export const SWORD = {
  ...part('sword', 1, 1, 9, [{ kind: 'bar', at: { x: 0, y: 0.5, z: 0 }, axis: { x: 0, y: -1, z: 0 }, length: 1 }]),
  extent: { min: { x: -0.5, y: 0, z: -0.1 }, max: { x: 0.5, y: 3.5, z: 0.1 } },
};

/** A 1 × 2 hinge brick's base and top, as LDraw 3937 and 3938: one pivot along their length, which LDraw's assembled hinge puts 0.7 studs up the base and 0.3 up the top. */
export const HINGE_BASE = part('hinge-base', 2, 1, 3, [{ kind: 'hingebase', at: { x: 0, y: 0.7, z: 0 }, axis: X, length: 2 }]);
export const HINGE_TOP = part('hinge-top', 2, 1, 2, [{ kind: 'hingetop', at: { x: 0, y: 0.3, z: 0 }, axis: X, length: 2 }]);

/** A 2 × 2 turntable's base and top, as LDraw 3680 and 3679: they turn about the upright through their middle. */
export const TURN_BASE = part('turn-base', 2, 2, 1, [{ kind: 'turnbase', at: { x: 0, y: 0.1, z: 0 }, axis: { x: 0, y: -1, z: 0 }, length: 0.2 }]);
export const TURN_TOP = part('turn-top', 2, 2, 1, [{ kind: 'turntop', at: { x: 0, y: 0.1, z: 0 }, axis: { x: 0, y: -1, z: 0 }, length: 0.2 }]);

/**
 * A 4 × 4 turntable's base and top, as LDraw 3403 and 3404: the base a plate
 * with a hub that stops short of the top of its three plates of cells, the
 * top turning inside those cells, 0.3 studs up the base.
 */
export const TURN_BASE_4 = {
  ...part('turn-base-4', 4, 4, 3, [{ kind: 'turnbase4', at: { x: 0, y: 0.7, z: 0 }, axis: { x: 0, y: -1, z: 0 }, length: 0.6 }]),
  extent: { min: { x: -2, y: 0, z: -2 }, max: { x: 2, y: 1, z: 2 } },
};
export const TURN_TOP_4 = part('turn-top-4', 4, 4, 2, [{ kind: 'turntop4', at: { x: 0, y: 0.4, z: 0 }, axis: { x: 0, y: -1, z: 0 }, length: 0.6 }]);

/**
 * A 1 × 4 hinge plate's base and top, as LDraw 2429 and 2430: each a 1 × 2
 * plate with an arm beside it, the top swivelling on the base about an
 * upright pivot where the arms lie one over the other. Put together, their
 * boxes share two of their three studs' length.
 */
export const SWIVEL_BASE = part('swivel-base', 3, 2, 1, [{ kind: 'swivelbase', at: { x: 0.5, y: 0.1, z: 0 }, axis: { x: 0, y: -1, z: 0 }, length: 0.2 }]);
export const SWIVEL_TOP = part('swivel-top', 3, 2, 1, [{ kind: 'swiveltop', at: { x: -0.5, y: 0.1, z: 0 }, axis: { x: 0, y: -1, z: 0 }, length: 0.2 }]);

/**
 * The older hinge plates, as LDraw 4275b, 4276b and 4504: three fingers, or
 * the two that go between them, about a pivot across the plate, half a stud
 * beyond its end and half way up it. The first two are 1 × 2 plates with
 * fingers on one end; the last, a 1 × 6, has two on one end and three on
 * the other.
 */
export const FINGERS_3 = part('fingers-3', 3, 1, 1, [{ kind: 'fingers3', at: { x: 1, y: 0.2, z: 0 }, axis: NEG_Z, length: 1 }]);
export const FINGERS_2 = part('fingers-2', 3, 1, 1, [{ kind: 'fingers2', at: { x: 1, y: 0.2, z: 0 }, axis: NEG_Z, length: 1 }]);
export const FINGERS_BOTH = part('fingers-both', 8, 1, 1, [
  { kind: 'fingers2', at: { x: 3.5, y: 0.2, z: 0 }, axis: NEG_Z, length: 1 },
  { kind: 'fingers3', at: { x: -3.5, y: 0.2, z: 0 }, axis: NEG_Z, length: 1 },
]);

/** A 1 × 1 round brick with an open stud, as LDraw 3062b: a bar-sized hole down its stud. */
export const ROUND_BRICK = part('round-brick', 1, 1, 3, [{ kind: 'barhole', at: { x: 0, y: 1.3, z: 0 }, axis: Y, length: 0.2 }]);

const TECHNIC = new Map(
  [
    PIN,
    BEAM,
    TECHNIC_BRICK,
    AXLE,
    BUSH,
    PIN_JOINER,
    SLOT_JOINER,
    LONG_PIN,
    TRIPLE_PIN,
    DOUBLE_PIN,
    THIN_BEAM,
    FINGER,
    FORK,
    TORSO,
    HIPS,
    BARE_HIPS,
    LEG_RIGHT,
    LEG_LEFT,
    HEAD,
    ARM,
    ARM_RIGHT,
    ARM_LEFT,
    HAND,
    BAR,
    CLIP_PLATE,
    HANDLE_PLATE,
    ANTENNA,
    SWORD,
    ROUND_BRICK,
    HINGE_BASE,
    HINGE_TOP,
    TURN_BASE,
    TURN_TOP,
    TURN_BASE_4,
    TURN_TOP_4,
    SWIVEL_BASE,
    SWIVEL_TOP,
    FINGERS_3,
    FINGERS_2,
    FINGERS_BOTH,
  ].map((p) => [p.id, p]),
);

/** The test parts, and the built-in catalogue's. */
export const connectorLookup: PartLookup = (id) => TECHNIC.get(id) ?? getPart(id);
