/**
 * Where minifigure parts join, set on the LDraw files every variant of each
 * part is drawn from, so a torso's print or a leg's pattern carries them
 * along: a head on the torso's neck, the hips under its waist by the studs
 * on top of them, an arm at each shoulder and a hand at each wrist, the
 * legs on the axle across the hips. The places are where LDraw's own
 * assembled minifigures put the parts (76382.dat, a torso with arms and
 * hands; 73200b-f1.dat, hips with legs); the library verify test checks
 * them against those files. Each joint is in its file's LDraw frame.
 */
import type { FlatConnector } from './connectors.ts';
import type { V3 } from './parse.ts';

const UP: V3 = [0, 1, 0];
const ACROSS: V3 = [1, 0, 0];

function joint(kind: FlatConnector['kind'], at: V3, [x, y, z]: V3, length: number): FlatConnector {
  const size = Math.hypot(x, y, z);
  return { kind, at, axis: [x / size, y / size, z / size], length, outward: 0 };
}

/** A head's underside, 24 LDU under the hollow stud on its top, which every standard head is drawn with. */
const HEAD = [joint('head', [0, 24, 0], UP, 4)];
/** A leg's top, on the hips' axle, where its body is drawn from. */
const LEG = [joint('leg', [0, 0, 0], ACROSS, 20)];

export const MINIFIG_JOINTS: Readonly<Record<string, readonly FlatConnector[]>> = {
  // the torso's body, under every torso's print: the neck on its top, the hips' two studs 32 under it,
  // and the shoulders, which turn the arms about 9.8° out from upright
  's/973s01.dat': [
    joint('neck', [0, 0, 0], UP, 4),
    joint('waist', [-10, 32, 0], UP, 5.5),
    joint('waist', [10, 32, 0], UP, 5.5),
    joint('shoulder', [-15.552, 9, 0], [0.985, 0.17, 0], 6),
    joint('shoulder', [15.552, 9, 0], [0.985, -0.17, 0], 6),
  ],
  's/3626bs02.dat': HEAD,
  's/3626cs01.dat': HEAD,
  's/3626cs02.dat': HEAD,
  // each of the two studs on top of the hips, which go up into the torso
  'hipstud.dat': [joint('hips', [0, 0, 0], UP, 5.5)],
  // the hips' body: the axle the legs turn on, 12 LDU down, right across
  's/3815bs01.dat': [joint('hip', [0, 12, 0], ACROSS, 40)],
  's/3817cs01.dat': LEG,
  's/3817cs02.dat': LEG,
  // the right arm's inner half (the left arm is the right one mirrored): its shoulder, and the wrist its hand turns in
  's/3818s01.dat': [joint('arm', [0, 0, 0], ACROSS, 6), joint('wrist', [-4.994, 18.891, -9.898], [0, -1, 1], 6)],
  // a hand, by the pin along its Z it turns on
  '3820.dat': [joint('hand', [0, 0, 0], [0, 0, 1], 13)],
};
