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
const Z = { x: 0, y: 0, z: 1 };

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

/** A minifigure head, its joint at the middle of its underside. */
export const HEAD = part('head', 1, 1, 3, [{ kind: 'head', at: { x: 0, y: 0, z: 0 }, axis: Y, length: 0.2 }]);

/** A minifigure's right arm, by its shoulder pin, which its body hangs out and down from. */
export const ARM = part('arm', 1, 1, 4, [{ kind: 'arm', at: { x: 0.4, y: 1.4, z: 0 }, axis: X, length: 0.3 }]);

/** A bar 3 studs long, upright, as LDraw 87994: a fifth of a stud across, well inside its cells. */
export const BAR = {
  ...part('bar', 1, 1, 8, [{ kind: 'bar', at: { x: 0, y: 1.5, z: 0 }, axis: Y, length: 3 }]),
  extent: { min: { x: -0.2, y: 0, z: -0.2 }, max: { x: 0.2, y: 3, z: 0.2 } },
};

/** A 1 × 1 plate with a clip on its front, holding a bar across, as LDraw 61252. */
export const CLIP_PLATE = part('clip-plate', 1, 2, 1, [{ kind: 'clip', at: { x: 0, y: 0.3, z: 0.5 }, axis: X, length: 0.4 }]);

const TECHNIC = new Map([PIN, BEAM, TECHNIC_BRICK, AXLE, BUSH, FINGER, FORK, TORSO, HIPS, HEAD, ARM, BAR, CLIP_PLATE].map((p) => [p.id, p]));

/** The test parts, and the built-in catalogue's. */
export const connectorLookup: PartLookup = (id) => TECHNIC.get(id) ?? getPart(id);
