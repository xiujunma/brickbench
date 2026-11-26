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

/** A Technic pin: two ends a stud long, pointing out from its collar in the middle, 0.4 studs up, alike as its shape makes them. */
export const PIN = {
  ...part('pin', 2, 1, 2, [
    { kind: 'pin', at: { x: -0.5, y: 0.4, z: 0 }, axis: NEG_X, length: 1 },
    { kind: 'pin', at: { x: 0.5, y: 0.4, z: 0 }, axis: X, length: 1 },
  ]),
  alike: [0, 0],
};

const BEAM_HOLES: readonly Connector[] = [
  { kind: 'pinhole', at: { x: 0, y: 0.5, z: -1 }, axis: Y, length: 1 },
  { kind: 'pinhole', at: { x: 0, y: 0.5, z: 0 }, axis: Y, length: 1 },
  { kind: 'pinhole', at: { x: 0, y: 0.5, z: 1 }, axis: Y, length: 1 },
];

/** A Technic beam 3 lying flat: three upright holes a stud apart, through its stud-thick body, those at its ends alike. */
export const BEAM = { ...part('beam', 1, 3, 3, BEAM_HOLES), alike: [0, 1, 0] };

/** The same beam printed at one end, as LDraw 32523p01: the print tells its end holes apart, so none are alike. */
export const PRINTED_BEAM = part('printed-beam', 1, 3, 3, BEAM_HOLES);

/**
 * A beam whose first hole sits high on it, as no real part's does, and
 * which the index takes for alike with its last: for how ways that fit as
 * well are ordered, whatever the index groups together.
 */
export const TIE_BEAM = {
  ...part('tie-beam', 1, 3, 3, [{ kind: 'pinhole', at: { x: 0, y: 2, z: -1 }, axis: Y, length: 1 }, ...BEAM_HOLES.slice(1)]),
  alike: [0, 1, 0],
};

/** A Technic brick 1 × 2 with its hole from front to back, 0.7 studs up. */
export const TECHNIC_BRICK = part('technic-brick', 2, 1, 3, [{ kind: 'pinhole', at: { x: 0, y: 0.7, z: 0 }, axis: Z, length: 1 }]);

/** A Technic axle 4, along X, 0.3 studs up. */
export const AXLE = part('axle', 4, 1, 2, [{ kind: 'axle', at: { x: 0, y: 0.3, z: 0 }, axis: NEG_X, length: 4 }]);

/**
 * A Technic axle 5.5 with a stop on it, along X, 0.4 studs up, as the
 * library build gives LDraw 32209: an axle either side of the stop, which
 * its part holds, 4.375 and 0.9 studs long, a tenth of a stud apart.
 */
export const STOPPED_AXLE = part('stopped-axle', 5, 1, 2, [
  { kind: 'axle', at: { x: 0.5, y: 0.4, z: 0 }, axis: NEG_X, length: 4.375 },
  { kind: 'axle', at: { x: -2.2375, y: 0.4, z: 0 }, axis: NEG_X, length: 0.9 },
]);
/** A Technic bush: an axle hole a stud long, from front to back. */
export const BUSH = part('bush', 1, 1, 2, [{ kind: 'axlehole', at: { x: 0, y: 0.45, z: 0 }, axis: Z, length: 1 }]);

/** An axle joiner, as LDraw 6538a: one axle hole two studs long, from front to back, and little more round it. */
export const AXLE_JOINER = {
  ...part('axle-joiner', 1, 2, 3, [{ kind: 'axlehole', at: { x: 0, y: 0.5, z: 0 }, axis: NEG_Z, length: 2 }]),
  extent: { min: { x: -0.5, y: 0, z: -1 }, max: { x: 0.5, y: 1, z: 1 } },
};

/** A wheel with a hub two studs long, as LDraw 3739: an axle hole along X through its middle, the wheel far round it. */
export const HUB_WHEEL = {
  ...part('hub-wheel', 3, 5, 14, [{ kind: 'axlehole', at: { x: 0, y: 2.6875, z: 0 }, axis: NEG_X, length: 2 }]),
  extent: { min: { x: -1.5, y: 0, z: -2.69 }, max: { x: 1.5, y: 5.38, z: 2.69 } },
};

/** A jet engine on a plate with an axle hole 1.7 studs deep, as LDraw 4868a has, here from its back face in. */
export const JET_ENGINE = part('jet-engine', 2, 5, 6, [{ kind: 'axlehole', at: { x: 0, y: 1, z: -1.65 }, axis: Z, length: 1.7 }]);

/** An axle 3 with a pin hole across its middle, as LDraw 27940: an axle either side of the pin hole, each a stud long less a fortieth. */
export const PIN_HOLE_AXLE = {
  ...part('pin-hole-axle', 3, 1, 3, [
    { kind: 'pinhole', at: { x: 0, y: 0.5, z: 0 }, axis: NEG_Y, length: 1 },
    { kind: 'axle', at: { x: -0.9875, y: 0.5, z: 0 }, axis: X, length: 0.975 },
    { kind: 'axle', at: { x: 0.9875, y: 0.5, z: 0 }, axis: NEG_X, length: 0.975 },
  ]),
  extent: { min: { x: -1.48, y: 0, z: -0.45 }, max: { x: 1.48, y: 1, z: 0.45 } },
};

/** An axle 3 with a ring round it either side of its middle, a tenth of a stud wide, as a stick's shaft has: three axles, the middle one held at both ends. */
export const RINGED_AXLE = part('ringed-axle', 3, 1, 2, [
  { kind: 'axle', at: { x: -1.025, y: 0.4, z: 0 }, axis: X, length: 0.95 },
  { kind: 'axle', at: { x: 0, y: 0.4, z: 0 }, axis: X, length: 0.9 },
  { kind: 'axle', at: { x: 1.025, y: 0.4, z: 0 }, axis: X, length: 0.95 },
]);

/**
 * Two stubs of axle on one line a stud apart, in a blade that reaches a
 * stud past either end of them, as a propeller's (LDraw 89509): each stub
 * has its part beyond both its ends, so it goes into a hole only through it.
 */
export const BLADED_AXLES = {
  ...part('bladed-axles', 5, 1, 3, [
    { kind: 'axle', at: { x: -0.9875, y: 0.5, z: 0 }, axis: X, length: 0.975 },
    { kind: 'axle', at: { x: 0.9875, y: 0.5, z: 0 }, axis: NEG_X, length: 0.975 },
  ]),
  extent: { min: { x: -2.5, y: 0, z: -0.45 }, max: { x: 2.5, y: 1, z: 0.45 } },
};

/** A housing with a stub of axle a stud long inside it, as a wind-up motor's: the housing reaches a stud past either end of the stub. */
export const HOUSED_AXLE = part('housed-axle', 3, 1, 2, [{ kind: 'axle', at: { x: 0, y: 0.4, z: 0 }, axis: X, length: 1 }]);

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

/** A double pin, as LDraw 32138: two pins a stud apart, one over the other, on each side of its body; its shape tells all four apart. */
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

/**
 * Hinge bricks 1 × 2 with a click hinge on their +X end, as LDraw 30364
 * and 30365: one finger, and the fork it fits, each reaching a quarter of
 * a stud beyond its pivot, well short of the end of its three cells.
 */
export const FINGER = {
  ...part('finger', 3, 1, 3, [{ kind: 'finger', at: { x: 1, y: 0.7, z: 0 }, axis: Z, length: 0.9 }]),
  extent: { min: { x: -1.5, y: 0, z: -0.5 }, max: { x: 1.27, y: 1.4, z: 0.5 } },
};
export const FORK = {
  ...part('fork', 3, 1, 3, [{ kind: 'fork', at: { x: 1, y: 0.7, z: 0 }, axis: Z, length: 0.85 }]),
  extent: { min: { x: -1.5, y: 0, z: -0.5 }, max: { x: 1.3, y: 1.4, z: 0.5 } },
};

/**
 * A 1 × 2 hinge plate that carries its click hinge's finger on top, as
 * LDraw 30383: the pivot over the middle of its second stud, the plate
 * running on under it to its end, half a stud beyond.
 */
export const FINGER_ON_TOP = {
  ...part('finger-on-top', 2, 1, 3, [{ kind: 'finger', at: { x: 0.5, y: 0.7, z: 0 }, axis: Z, length: 0.9 }]),
  extent: { min: { x: -1, y: 0, z: -0.5 }, max: { x: 1, y: 0.97, z: 0.5 } },
};

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

/** A bar with a stretch at each end to hold by, alike as its shape makes them, as LDraw's minifigure handlebars. */
export const TWIN_BAR = {
  ...part('twin-bar', 3, 1, 2, [
    { kind: 'bar', at: { x: -1, y: 0.4, z: 0 }, axis: NEG_X, length: 0.8 },
    { kind: 'bar', at: { x: 1, y: 0.4, z: 0 }, axis: X, length: 0.8 },
  ]),
  extent: { min: { x: -1.5, y: 0.2, z: -0.2 }, max: { x: 1.5, y: 0.6, z: 0.2 } },
  alike: [0, 0],
};

/** A part with a pin hole at each end, both leaning in, alike under a half turn about its middle, as an angled connector's are. */
export const LEANING_HOLES = {
  ...part('leaning-holes', 3, 1, 3, [
    { kind: 'pinhole', at: { x: -1, y: 0.6, z: 0 }, axis: { x: 0.6, y: 0.8, z: 0 }, length: 1 },
    { kind: 'pinhole', at: { x: 1, y: 0.6, z: 0 }, axis: { x: -0.6, y: 0.8, z: 0 }, length: 1 },
  ]),
  alike: [0, 0],
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
/** A 2 × 2 top for the same base, as LDraw 6134: its pivot under one of its two rows of studs, the other row reaching a stud to the side. */
export const HINGE_TOP_2X2 = part('hinge-top-2x2', 2, 2, 2, [{ kind: 'hingetop', at: { x: 0, y: 0.3, z: 0.5 }, axis: X, length: 2 }]);

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
 * A flat 4 × 4 turntable base and a round plate that snaps onto it, as
 * LDraw 61485 and 60474: the ring on the base's top goes up into the
 * plate's underside, round the snap in its middle.
 */
export const TURN_FLAT = {
  ...part('turn-flat', 4, 4, 2, [{ kind: 'turnflat', at: { x: 0, y: 0.5, z: 0 }, axis: NEG_Y, length: 0.2 }]),
  extent: { min: { x: -2, y: 0, z: -2 }, max: { x: 2, y: 0.6, z: 2 } },
};
export const TURN_SNAP = part('turn-snap', 4, 4, 1, [{ kind: 'turnsnap', at: { x: 0, y: 0.1, z: 0 }, axis: NEG_Y, length: 0.2 }]);

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
 * the other. The fingers are round about the pivot, a fifth of a stud
 * beyond it: that is where the parts end, short of the end of their cells.
 */
const FINGERS_EXTENT = { min: { x: -1.5, y: 0, z: -0.5 }, max: { x: 1.2, y: 0.6, z: 0.5 } };
export const FINGERS_3 = { ...part('fingers-3', 3, 1, 1, [{ kind: 'fingers3', at: { x: 1, y: 0.2, z: 0 }, axis: NEG_Z, length: 1 }]), extent: FINGERS_EXTENT };
export const FINGERS_2 = { ...part('fingers-2', 3, 1, 1, [{ kind: 'fingers2', at: { x: 1, y: 0.2, z: 0 }, axis: NEG_Z, length: 1 }]), extent: FINGERS_EXTENT };
export const FINGERS_BOTH = {
  ...part('fingers-both', 8, 1, 1, [
    { kind: 'fingers2', at: { x: 3.5, y: 0.2, z: 0 }, axis: NEG_Z, length: 1 },
    { kind: 'fingers3', at: { x: -3.5, y: 0.2, z: 0 }, axis: NEG_Z, length: 1 },
  ]),
  extent: { min: { x: -3.7, y: 0, z: -0.5 }, max: { x: 3.7, y: 0.6, z: 0.5 } },
};

/**
 * A car roof and what holds it, as LDraw 4213, 4315 and 4214: the roof's
 * four fingers run along one edge of it, half way up it. They go between
 * the five beside a 1 × 4 plate, at the plate's own height, or the five
 * along one edge of the top of a holder two bricks tall, which the roof
 * then lies over.
 */
export const ROOF = part('roof', 4, 4, 1, [{ kind: 'fingers4', at: { x: 0, y: 0.2, z: -1.8 }, axis: NEG_X, length: 3.6 }]);
export const ROOF_PLATE = {
  ...part('roof-plate', 4, 2, 1, [{ kind: 'fingers5', at: { x: 0, y: 0.2, z: 0.2 }, axis: NEG_X, length: 4 }]),
  extent: { min: { x: -2, y: 0, z: -1 }, max: { x: 2, y: 0.6, z: 0.4 } },
};
export const ROOF_HOLDER = part('roof-holder', 4, 1, 7, [{ kind: 'fingers5', at: { x: 0, y: 2.6, z: -0.3 }, axis: NEG_X, length: 4 }]);
/** A hinged 2 × 4 tile, as LDraw 2873: its fingers stand out beyond its cells, their pivot right on the edge of them. */
export const ROOF_TILE = part('roof-tile', 4, 2, 1, [{ kind: 'fingers4', at: { x: 0, y: 0.2, z: -1 }, axis: NEG_X, length: 3.6 }]);

/**
 * A folding hinge plate's base and top, as LDraw 3149e and 3148: two
 * 2 × 5 plates, the top lying on the base, hinged along one end. LDraw
 * draws both about the hinge, so closed they fill one box.
 */
export const FOLD_BASE = {
  ...part('fold-base', 2, 5, 2, [{ kind: 'foldbase', at: { x: 0, y: 0.4, z: -2 }, axis: NEG_X, length: 2 }]),
  extent: { min: { x: -1, y: 0, z: -2.4 }, max: { x: 1, y: 0.8, z: 2.5 } },
};
export const FOLD_TOP = {
  ...part('fold-top', 2, 5, 2, [{ kind: 'foldtop', at: { x: 0, y: 0.4, z: -2 }, axis: NEG_X, length: 2 }]),
  extent: { min: { x: -1, y: 0, z: -2.4 }, max: { x: 1, y: 1.1, z: 2.5 } },
};

/** A control stick and its base, as LDraw 4593 and 4592: the stick tips about a short pivot across the base, half a stud up it. */
export const STICK_BASE = {
  ...part('stick-base', 1, 1, 2, [{ kind: 'stickbase', at: { x: 0, y: 0.5, z: 0 }, axis: X, length: 0.2 }]),
  extent: { min: { x: -0.4, y: 0, z: -0.4 }, max: { x: 0.4, y: 0.69, z: 0.4 } },
};
export const STICK = {
  ...part('stick', 1, 1, 5, [{ kind: 'stick', at: { x: 0, y: 0.2, z: 0 }, axis: X, length: 0.2 }]),
  extent: { min: { x: -0.2, y: 0, z: -0.2 }, max: { x: 0.2, y: 2.1, z: 0.2 } },
};

/**
 * The two halves of a 1 × 8 hinge brick, as LDraw 652 and 653: each a
 * 1 × 4 brick with a knuckle beyond one end, above its top; one's tongue
 * goes in the other's yoke, the bricks end to end. LDraw draws both the
 * same way round, so their pivots point opposite ways: one goes on turned
 * half round. The knuckle is half a stud round, and the part ends with it,
 * half a stud short of the end of its five cells.
 */
const HINGE_BRICK_EXTENT = { min: { x: -2.5, y: 0, z: -0.5 }, max: { x: 2, y: 1.95, z: 0.5 } };
export const TONGUE_BRICK = { ...part('tongue-brick', 5, 1, 5, [{ kind: 'tongue', at: { x: 1.5, y: 1.45, z: 0 }, axis: NEG_Z, length: 1 }]), extent: HINGE_BRICK_EXTENT };
export const YOKE_BRICK = { ...part('yoke-brick', 5, 1, 5, [{ kind: 'yoke', at: { x: 1.5, y: 1.45, z: 0 }, axis: Z, length: 1 }]), extent: HINGE_BRICK_EXTENT };

/** A 1 × 1 round brick with an open stud, as LDraw 3062b: a bar-sized hole down its stud. */
export const ROUND_BRICK = part('round-brick', 1, 1, 3, [{ kind: 'barhole', at: { x: 0, y: 1.3, z: 0 }, axis: Y, length: 0.2 }]);

/** A battle droid's torso, as LDraw 30375: bars across for its shoulders, its neck between them, and its hips, which LDraw draws it about. */
export const DROID_TORSO = {
  ...part('droid-torso', 2, 1, 6, [
    { kind: 'bar', at: { x: -0.7875, y: 1.85, z: -0.05 }, axis: X, length: 0.425 },
    { kind: 'bar', at: { x: 0, y: 1.85, z: -0.05 }, axis: X, length: 0.6 },
    { kind: 'bar', at: { x: 0, y: 0.25, z: -0.05 }, axis: X, length: 0.6 },
    { kind: 'bar', at: { x: 0.7875, y: 1.85, z: -0.05 }, axis: X, length: 0.425 },
  ]),
  extent: { min: { x: -1, y: 0, z: -0.6 }, max: { x: 1, y: 2.15, z: 0.4 } },
  ldraw: { file: '30375.dat', origin: [0, 0.25, -0.05] as const },
};
/**
 * A battle droid's arm, as LDraw 30377: a clip at each end, the shoulder's
 * at the top, where LDraw draws the arm about, and the hand's 1.91 studs
 * below and 0.6 in front. And one drawn about neither of its clips: about
 * a point a stud in front of the upper one.
 */
const DROID_ARM_CLIPS: readonly Connector[] = [
  { kind: 'clip', at: { x: 0, y: 2.2354, z: -0.2986 }, axis: NEG_X, length: 0.4 },
  { kind: 'clip', at: { x: 0, y: 0.3254, z: 0.3034 }, axis: NEG_X, length: 0.4 },
];
const DROID_ARM_EXTENT = { min: { x: -0.2, y: 0, z: -0.63 }, max: { x: 0.2, y: 2.49, z: 0.63 } };
export const DROID_ARM = { ...part('droid-arm', 1, 1, 6, DROID_ARM_CLIPS), extent: DROID_ARM_EXTENT, ldraw: { file: '30377.dat', origin: [0, 2.2354, -0.2986] as const } };
export const LINK = { ...part('link', 1, 1, 6, DROID_ARM_CLIPS), extent: DROID_ARM_EXTENT, ldraw: { file: 'link.dat', origin: [0, 2.2354, 0.7] as const } };
/** A droid's bent arm, as LDraw 87568: drawn about its shoulder's clip, which holds a bar across; its hand's holds one upright, in front. */
export const BENT_ARM = {
  ...part('bent-arm', 1, 3, 4, [
    { kind: 'clip', at: { x: 0, y: 1.135, z: -0.9137 }, axis: NEG_X, length: 0.4 },
    { kind: 'clip', at: { x: 0, y: 0.225, z: 1.0863 }, axis: Y, length: 0.4 },
  ]),
  extent: { min: { x: -0.4, y: 0, z: -1.3 }, max: { x: 0.4, y: 1.51, z: 1.3 } },
  ldraw: { file: '87568.dat', origin: [0, 1.135, -0.9137] as const },
};

const TECHNIC = new Map(
  [
    PIN,
    BEAM,
    PRINTED_BEAM,
    TIE_BEAM,
    TECHNIC_BRICK,
    AXLE,
    STOPPED_AXLE,
    BUSH,
    AXLE_JOINER,
    HUB_WHEEL,
    JET_ENGINE,
    HOUSED_AXLE,
    PIN_HOLE_AXLE,
    RINGED_AXLE,
    BLADED_AXLES,
    PIN_JOINER,
    SLOT_JOINER,
    LONG_PIN,
    TRIPLE_PIN,
    DOUBLE_PIN,
    THIN_BEAM,
    FINGER,
    FORK,
    FINGER_ON_TOP,
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
    TWIN_BAR,
    LEANING_HOLES,
    CLIP_PLATE,
    HANDLE_PLATE,
    ANTENNA,
    SWORD,
    ROUND_BRICK,
    DROID_TORSO,
    DROID_ARM,
    LINK,
    BENT_ARM,
    HINGE_BASE,
    HINGE_TOP,
    HINGE_TOP_2X2,
    TURN_BASE,
    TURN_TOP,
    TURN_BASE_4,
    TURN_TOP_4,
    TURN_FLAT,
    TURN_SNAP,
    SWIVEL_BASE,
    SWIVEL_TOP,
    FINGERS_3,
    FINGERS_2,
    FINGERS_BOTH,
    ROOF,
    ROOF_PLATE,
    ROOF_HOLDER,
    ROOF_TILE,
    FOLD_BASE,
    FOLD_TOP,
    STICK_BASE,
    STICK,
    TONGUE_BRICK,
    YOKE_BRICK,
  ].map((p) => [p.id, p]),
);

/** The test parts, and the built-in catalogue's. */
export const connectorLookup: PartLookup = (id) => TECHNIC.get(id) ?? getPart(id);
