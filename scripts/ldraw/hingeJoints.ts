/**
 * Where the older hinges and the turntables turn, set on the LDraw files
 * that draw their halves: LDraw draws their pivots with plain shapes, so
 * no primitive marks them. Each pair's halves are drawn about the same
 * origin (or one set a known way off it), as LDraw's own assembled hinges
 * and turntables show (3937c01, 73983, 3680c01, 3403c01, 30516c01,
 * 61485c01), so both halves' pivots are the same line; the library verify test checks each against where its part's round
 * surfaces are centred, and against those assemblies. Each joint is in its
 * file's LDraw frame.
 */
import { setJoint as joint, type FlatConnector } from './connectors.ts';
import type { V3 } from './parse.ts';

const DOWN: V3 = [0, 1, 0];
const ACROSS: V3 = [1, 0, 0];

export const HINGE_JOINTS: Readonly<Record<string, readonly FlatConnector[]>> = {
  // a 1 × 2 hinge brick: its top (1 × 2 or 2 × 2, each drawn as two halves) swings on pegs along the base's length, 10 LDU down
  '3937.dat': [joint('hingebase', [0, 10, 0], ACROSS, 40)],
  's/3938s01.dat': [joint('hingetop', [0, 10, 0], ACROSS, 40)],
  // a 1 × 4 hinge plate: its top swivels on a small pivot, 4 to 8 LDU down, in the hole at the base's end
  '2429.dat': [joint('swivelbase', [0, 6, 0], DOWN, 4)],
  '2430.dat': [joint('swiveltop', [0, 6, 0], DOWN, 4)],
  // a 1 × 4 hinge brick: its top swivels on a pin the size of a Technic one, which LDraw draws as one; its base's hole, 8 to 24 LDU down, takes it
  '3831.dat': [joint('pinhole', [0, 16, 0], DOWN, 16)],
  // a 2 × 2 turntable: its top turns on the snap in the middle of its base (plain, or with a hinge)
  's/3680s01.dat': [joint('turnbase', [0, 6, 0], DOWN, 4)],
  '3679.dat': [joint('turntop', [0, 6, 0], DOWN, 4)],
  // a 4 × 4 turntable: its top (and the locking one drawn from it) turns about the post in the middle of its base
  '3403.dat': [joint('turnbase4', [0, 10, 0], DOWN, 12)],
  '3404.dat': [joint('turntop4', [0, 10, 0], DOWN, 12)],
  // the grooved base the locking 4 × 4 top turns on is only in the library as part of the complete turntable, where LDraw sets it 16 LDU under
  // the top: this is that top's joint from the base's side, so the complete one's is taken
  '30516.dat': [joint('turnbase4', [0, -6, 0], DOWN, 12)],
  // a flat 4 × 4 turntable base, and the round 4 × 4 plate whose snap stud, under its 8 LDU, turns in it: LDraw sets the base 8 LDU lower
  '61485.dat': [joint('turnflat', [0, 2, 0], DOWN, 4)],
  '60474.dat': [joint('turnsnap', [0, 10, 0], DOWN, 4)],
};
