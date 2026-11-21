/**
 * Where the older hinges and the turntables turn, set on the LDraw files
 * that draw their halves: LDraw draws their pivots with plain shapes, so
 * no primitive marks them. Each pair's halves are drawn about the same
 * origin (or one set a known way off it), as LDraw's own assembled hinges
 * and turntables show (3937c01, 73983, 3680c01, 3403c01, 30516c01,
 * 61485c01, 3149ec01, 73587a, 652c01), so both halves' pivots are the same
 * line; the library verify test checks each against where its part's round
 * surfaces are centred, and against those assemblies. Each joint is in its
 * file's LDraw frame.
 *
 * The way a pivot points says how its half goes onto the other at rest:
 * turned so the two point the same way, as near as can be to how the other
 * half is turned (restTurn in src/core/placement/connect.ts). Halves LDraw
 * draws as they go together point the same way; the halves of a 1 × 8
 * hinge brick, drawn the same way round though they face each other, point
 * opposite ways, and so do a roof's holder and a panel LDraw draws before
 * its fingers, where it draws a roof behind them.
 */
import { setJoint as joint, type FlatConnector } from './connectors.ts';
import type { V3 } from './parse.ts';

const DOWN: V3 = [0, 1, 0];
const ACROSS: V3 = [1, 0, 0];
const ALONG: V3 = [0, 0, 1];
/**
 * Across a part that lies behind its pivot (towards LDraw's -Z), as a roof
 * does whose fingers are along its front edge; and across what holds one.
 */
const BEHIND: V3 = [-1, 0, 0];
/** ... and across a part that lies before its pivot. */
const BEFORE: V3 = [1, 0, 0];

/**
 * The hinge of car roofs, canopies and hinged panels: four fingers along
 * one edge, 36 LDU either way from its middle, go between the five of a
 * holder, a stud wider; a pip at either end snaps them in. LDraw draws
 * every one of these right way up, its fingers along X, most with the part
 * behind them: such a part goes on as it is drawn, turned as its holder
 * is, a roof lying on from the holder, a canopy hanging from it. A part
 * drawn before its fingers goes on turned half round, so that it too
 * reaches on from the holder, not back over it.
 */
const fingers = (at: V3, lies: V3 = BEHIND): FlatConnector => joint('fingers4', at, lies, 72);
const holder = (at: V3): FlatConnector => joint('fingers5', at, BEHIND, 80);
/** Where LDraw draws a canopy from: the middle of its fingers. */
const AT_ORIGIN: V3 = [0, 0, 0];
/**
 * A folding hinge plate's two plates, drawn about the hinge along one end
 * of both, which lie behind it: the base's knuckles at its sides, the
 * top's between them.
 */
const FOLD_BASE = [joint('foldbase', AT_ORIGIN, BEHIND, 40)];
const FOLD_TOP = [joint('foldtop', AT_ORIGIN, BEHIND, 40)];

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
  // car roofs, plain and with a sunroof (both sunroofs drawn from one file), a hinged tile and a hinged double slope: flat parts, their
  // fingers along one edge
  '4213.dat': [fingers([0, 4, 36])],
  's/2349s01.dat': [fingers([0, 4, 36])],
  '2873.dat': [fingers([0, 4, 24])],
  '4857.dat': [fingers([0, 20, 36])],
  // a hinged panel and a canopy half stand on their fingers, drawn before them: the panel's shelf, 68 LDU up, reaches forwards. The
  // panel's joint is on the file its shape is in, which its printed ones are drawn from too
  's/2582s01.dat': [fingers([0, 68, -26], BEFORE)],
  '6084.dat': [fingers([0, 40, -26], BEFORE)],
  // windscreens and canopies, drawn from their fingers: they hang behind them, or stand on them. Each one's joint is on the file its
  // shape is in, where there is one, so its printed ones have it
  's/30161s01.dat': [fingers(AT_ORIGIN)],
  '2620.dat': [fingers(AT_ORIGIN)],
  's/2483s01.dat': [fingers(AT_ORIGIN)],
  's/4474s01.dat': [fingers(AT_ORIGIN)],
  's/2507s01.dat': [fingers(AT_ORIGIN)],
  // a dome's shape is in a file for one half of it, drawn twice, the second time mirrored: its fingers are set on the dome itself, and
  // on the printed one
  '30083.dat': [fingers(AT_ORIGIN)],
  '30083ps0.dat': [fingers(AT_ORIGIN)],
  // a canopy extender hangs from its fingers, and holds the next canopy by the five at its other end
  '2337.dat': [fingers(AT_ORIGIN), holder([0, 0, -80])],
  // the holders: two bricks tall, or a tile, their five fingers along one edge of their top; and a plate with them beside it
  '4214.dat': [holder([0, -4, 6])],
  '4625.dat': [holder([0, -4, 6])],
  '4315.dat': [holder([0, 4, -14])],
  // a hinge tile's two fingers are those of the hinge plates (h1), drawn with plain shapes
  '4531.dat': [joint('fingers2', [30, 4, 0], ALONG, 20)],
  // folding hinge plates, 2 × 5 and 2 × 9, with a small hole or a large one
  '3149d.dat': FOLD_BASE,
  '3149e.dat': FOLD_BASE,
  '3324d.dat': FOLD_BASE,
  '3324e.dat': FOLD_BASE,
  '314d.dat': FOLD_TOP,
  '3148.dat': FOLD_TOP,
  // a control stick tips about the short barrel at its foot, which snaps between two pips 2 LDU above the middle of its base
  '4592.dat': [joint('stickbase', [0, -2, 0], ACROSS, 4)],
  '4593.dat': [joint('stick', AT_ORIGIN, ACROSS, 4)],
  // the halves of a 1 × 8 hinge brick: a knuckle beyond the end of each, 5 LDU above its top, one's tongue in the other's yoke. LDraw
  // draws both the same way round; in its complete one (652c01) the second is turned half round
  '652.dat': [joint('tongue', [40, -5, 0], ALONG, 20)],
  '653.dat': [joint('yoke', [40, -5, 0], [0, 0, -1], 20)],
};
