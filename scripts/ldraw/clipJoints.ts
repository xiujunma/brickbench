/**
 * Clips LDraw draws in ways their shape alone does not tell from a groove
 * or a hole (see clipArc in connectors.ts): clips of half a turn with
 * straight jaws, clips that go three quarters of the way round, and clips
 * drawn face by face. Each is set on the file that draws it: its middle on
 * the line it holds a bar along, a bar's radius from the inside of the
 * clip, the way that line runs and how long the clip is along it. With
 * them, a bar the rule for bars (a whole cylinder) does not find where a
 * clip found here would otherwise seem free: a shaft drawn in pieces round
 * the hole through it. The library verify test checks each against the
 * part's shape: surface a bar's radius from the line, half to three
 * quarters of the way round it and facing in for a clip, all the way
 * round and facing out for a bar, from one end to the other and no
 * further. Each is in its file's LDraw frame.
 */
import { setJoint as joint, type FlatConnector } from './connectors.ts';
import type { V3 } from './parse.ts';

const ACROSS: V3 = [1, 0, 0];
const UPRIGHT: V3 = [0, 1, 0];
const ALONG: V3 = [0, 0, 1];
const AT_ORIGIN: V3 = [0, 0, 0];

/** A clip is 8 LDU long, where nothing else is said. */
const clip = (at: V3, runs: V3, length = 8): FlatConnector => joint('clip', at, runs, length);

/** The clips of a ladder: one each side of its end rung. */
const rungClips = (z: number): FlatConnector[] => [clip([-16, 0, z], ACROSS), clip([16, 0, z], ACROSS)];

export const CLIP_JOINTS: Readonly<Record<string, readonly FlatConnector[]>> = {
  // a bar a stud and a half long with a clip on its end, drawn face by face. The one with a hole through its shaft draws the shaft
  // in pieces: it is the bar the plain one's is, from 6.4 to 29 LDU down
  '48729a.dat': [clip(AT_ORIGIN, ALONG)],
  '48729b.dat': [clip(AT_ORIGIN, ALONG), joint('bar', [0, 17.7, 0], UPRIGHT, 22.6)],
  // droids' arms: a straight one with a clip at each end, one square to the other; one with a clip and a hole for a rod; a wiry one
  '59230.dat': [clip(AT_ORIGIN, ACROSS), clip([0, 40, 0], ALONG)],
  '53989.dat': [clip(AT_ORIGIN, ALONG)],
  '10058.dat': [clip(AT_ORIGIN, ACROSS)],
  // a battle droid's legs, which clip onto the bar of its torso's hips
  '30376.dat': [clip([0, -38, 0], ACROSS)],
  // a super battle droid: its arms, plain and with a blaster, clip onto its body's shoulders, and its legs onto the bar of its hips
  '41890.dat': [clip(AT_ORIGIN, ACROSS)],
  '64796.dat': [clip(AT_ORIGIN, ACROSS)],
  '42687.dat': [clip([0, -62.5, 0], ACROSS)],
  // figures' bent arms, whose hands are clips eleven long
  '66788.dat': [clip([9.7, 24.4, 0], ALONG, 11)],
  '28660.dat': [clip([10.4, 16.4, 0], ALONG, 11)],
  // a martian's head, drawn as two halves, plain and printed
  '30529.dat': [clip(AT_ORIGIN, ACROSS)],
  '30529p01.dat': [clip(AT_ORIGIN, ACROSS)],
  '30529p02.dat': [clip(AT_ORIGIN, ACROSS)],
  // a horse's saddle with a clip on one side, or on both
  '4491a.dat': [clip([-31, -10, 17.5], UPRIGHT)],
  '4491b.dat': [clip([-31, -10, 17.5], UPRIGHT), clip([31, -10, 17.5], UPRIGHT)],
  // an arm with a towball and a clip; a sabre with a clip for a pommel; feathers with a clip, plain and printed
  '30082.dat': [clip([0, 0, -10], UPRIGHT)],
  '59229.dat': [clip([0, 18, 0], ALONG)],
  '30127.dat': [clip(AT_ORIGIN, UPRIGHT)],
  '30127p01.dat': [clip(AT_ORIGIN, UPRIGHT)],
  // ladders, 7 × 3, with clips at one end or at both
  '6020.dat': rungClips(0),
  '30095.dat': [...rungClips(0), ...rungClips(160)],
  // leaves with a clip ten long; a panel that clips on
  '30239.dat': [clip([0, 5, 30], UPRIGHT, 10)],
  '30034.dat': [clip([0, 2, -20], ACROSS)],
  // a trap door's frame, which holds the door's bar in two flat clips
  '92107.dat': [clip([-50, 2, -30], ALONG), clip([-50, 2, 30], ALONG)],
  // Technic connectors with two clips, drawn from one file four times over
  '47994.dat': [clip([-30, -9.75, 0], UPRIGHT), clip([-30, 9.75, 0], UPRIGHT)],
  '19159.dat': [clip([-30, -9.75, 0], UPRIGHT), clip([-30, 9.75, 0], UPRIGHT)],
  // a 2 × 3 tile with two angled clips: its shape is in a file its printed one is drawn from too
  's/30350as01.dat': [clip([-10, 2, 40], ACROSS), clip([10, 2, 40], ACROSS)],
  // a skateboard's two wheel clips, which go three quarters of the way round its wheels' axles
  '45917.dat': [clip([-30, 15, 0], ALONG), clip([30, 15, 0], ALONG)],
  // a cannon's base: the two short clips its barrel turns in, four long, and two upright at its back
  '2527.dat': [clip([-18, -28, -30], ACROSS, 4), clip([18, -28, -30], ACROSS, 4), clip([-30, -12, 10], UPRIGHT), clip([30, -12, 10], UPRIGHT)],
  // a conveyor belt's frame: two short clips its drum turns in, and two each end its axles turn in
  '633.dat': [
    clip([-18, 0, 0], ACROSS, 4),
    clip([18, 0, 0], ACROSS, 4),
    ...[-140, 140].flatMap((z) => [clip([-32, -34, z], ACROSS), clip([32, -34, z], ACROSS)]),
  ],
  // a three-wheeled motorcycle's body, which holds its forks' stem upright
  '30187.dat': [clip([0, -4, -84], UPRIGHT)],
  // a trap door's frame, older than 92107, which holds the door's bar in two flat clips
  '30041.dat': [clip([-50, 10, -30], ALONG), clip([-50, 10, 30], ALONG)],
  // an ornamented arch, with a clip either side
  '2145.dat': [clip([-50, 18, 10], ACROSS), clip([50, 18, 10], ACROSS)],
};
