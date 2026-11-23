/**
 * Where a part's bars are bare. A bar (barPiece in connectors.ts, or one
 * set by hand) is somewhere a clip or a hand can go only where nothing of
 * its part wraps round it: not where a ready-made assembly's own clip,
 * hand or hole holds it, where a handle runs into its posts, or where a rod
 * goes into a socket or into the part it is pushed into, which LDraw does
 * not draw, nor where its part closes round it a little further out (a
 * bore it runs in, a solid it runs through, a ring on it). So each bar
 * keeps the stretches of it where its own round surface is drawn, no
 * surface a bar's radius from its line faces in towards it, and no round
 * surface a little wider goes most of the way round it; each at least
 * SHORTEST_BAR long, as a plate's clip is. This is how LDraw's assemblies
 * show what their own parts leave of a bar that goes on past the clip
 * holding it, a droid's neck with its head on.
 */
import { BAR_RADIUS, finishConnectors, SHORTEST_BAR, type FlatConnector } from './connectors.ts';
import type { FlatPart, FlatTriangle } from './flatten.ts';
import type { V3 } from './parse.ts';

/** How near a bar's radius a surface must be, in LDU, to be a bar's own or to wrap round one: as the verify test measures them. */
const SURFACE = 0.12;
/** How squarely a surface must face out from a bar's line, or in towards it, to go round it: one at an end of it faces along it. */
const ROUND = 0.5;
/** A gap in a bar's drawing no longer than this, in LDU, leaves it whole: pieces of a bar join across such gaps (JOIN_GAP). */
const GAP = 1;
/** Lengths along a bar closer than this are one. */
const SAME = 1e-6;
/**
 * How far short of a bar's end its drawing may stop and still reach it, and
 * how much shorter than a clip a stretch of it may be and still hold one,
 * in LDU: LDraw writes matrices to a few decimals, which turn a bar a hair
 * shorter (a skeleton's tilted arms are 7.9999 long). Off the quarter-LDU
 * lattice parts are drawn on, so that no length on it is a borderline one.
 */
const SLACK = 0.1;
/**
 * How far out from a bar's line, in LDU, a round surface about it closes
 * it when it goes most of the way round (CLOSED): a clip's jaws reach about
 * 6.5 from the line and a minifigure's hand about 7.5, so within this one
 * can't be got round the bar. The bore a pneumatic cylinder's piston rod
 * runs in is 8 from it.
 */
const CLOSE = 8.5;
/** How much of a turn such surfaces must go round a bar between them to close it: half way leaves room for a clip. */
const CLOSED = 0.75;

/**
 * A surface about a bar: from where to where along it, from its middle; and
 * what it is to it: its own round surface, something wrapping round it, a
 * bar's radius from its line and facing in, or part of a round surface a
 * little further out, over the degrees round its line it covers (from, for
 * so many).
 */
type Surface =
  | { readonly from: number; readonly to: number; readonly kind: 'own' | 'wraps' }
  | { readonly from: number; readonly to: number; readonly kind: 'round'; readonly degrees: readonly [number, number] };

interface Stretch {
  readonly from: number;
  readonly to: number;
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Two directions square to a unit axis and to each other, to measure the degrees round it from. */
function across([x, y, z]: V3): readonly [V3, V3] {
  const side: V3 = Math.abs(y) < 0.9 ? [z, 0, -x] : [0, -z, y];
  const size = Math.hypot(...side);
  const u: V3 = [side[0] / size, side[1] / size, side[2] / size];
  return [u, cross([x, y, z], u)];
}

/** The degrees round a line a triangle covers, from the way out to its corners: from its first corner to its last, the short way round. */
function degreesOf(radials: readonly V3[], [u, v]: readonly [V3, V3]): readonly [number, number] {
  const angles = radials.map((r) => ((Math.atan2(dot(r, v), dot(r, u)) * 180) / Math.PI + 360) % 360).sort((a, b) => a - b);
  const [a0 = 0, a1 = 0, a2 = 0] = angles;
  const gaps = [a1 - a0, a2 - a1, a0 + 360 - a2];
  const widest = gaps.indexOf(Math.max(...gaps));
  return [[a1, a2, a0][widest] ?? 0, Math.round(360 - (gaps[widest] ?? 0))];
}

/**
 * The surfaces about a bar, along its length, that go round it: those a
 * bar's radius from its line, and those on one round surface about it a
 * little wider, out to CLOSE. One drawn to be seen from both sides (not BFC
 * certified) says nothing of which way it faces: a bar's radius from its
 * line, it is the bar's own.
 */
function surfacesRound(bar: FlatConnector, triangles: readonly FlatTriangle[]): Surface[] {
  const half = bar.length / 2;
  const frame = across(bar.axis);
  return triangles.flatMap((t): Surface[] => {
    const corners = [t.a, t.b, t.c].map((p) => {
      const off = sub(p, bar.at);
      const along = dot(off, bar.axis);
      return { along, radial: sub(off, [bar.axis[0] * along, bar.axis[1] * along, bar.axis[2] * along]) };
    });
    const radii = corners.map(({ radial }) => Math.hypot(...radial));
    const atBar = radii.every((r) => Math.abs(r - BAR_RADIUS) <= SURFACE);
    const wider = radii.every((r) => r > BAR_RADIUS + SURFACE && r <= CLOSE) && Math.max(...radii) - Math.min(...radii) <= 2 * SURFACE;
    if (!atBar && !wider) return [];
    const from = Math.min(...corners.map((c) => c.along));
    const to = Math.max(...corners.map((c) => c.along));
    if (to < -half || from > half) return [];
    const normal = cross(sub(t.b, t.a), sub(t.c, t.a));
    const out = corners.reduce<V3>((sum, { radial }) => [sum[0] + radial[0], sum[1] + radial[1], sum[2] + radial[2]], [0, 0, 0]);
    const size = Math.hypot(...normal) * Math.hypot(...out);
    if (size === 0) return [];
    const facing = dot(normal, out) / size;
    if (Math.abs(facing) < ROUND) return [];
    if (wider) return [{ from, to, kind: 'round', degrees: degreesOf(corners.map((c) => c.radial), frame) }];
    return [{ from, to, kind: !t.doubleSided && facing < 0 ? 'wraps' : 'own' }];
  });
}

/** Whether the surfaces about a bar at one place along it leave it bare there, wrap it, or are none of its own. */
function stateOf(there: readonly Surface[]): 'bare' | 'wrapped' | 'none' {
  const round = new Set<number>();
  for (const s of there) {
    if (s.kind === 'wraps') return 'wrapped';
    if (s.kind === 'round') for (let k = 0; k < s.degrees[1]; k++) round.add(Math.floor(s.degrees[0] + k + 0.5) % 360);
  }
  if (round.size >= CLOSED * 360) return 'wrapped';
  return there.some((s) => s.kind === 'own') ? 'bare' : 'none';
}

/** The stretches along a bar, from its middle, that are bare: drawn, wrapped by nothing, across gaps no longer than GAP. */
function bareStretches(half: number, surfaces: readonly Surface[]): Stretch[] {
  const cuts = [...new Set([-half, half, ...surfaces.flatMap((s) => [s.from, s.to]).filter((s) => s > -half && s < half)])].sort((a, b) => a - b);
  const stretches: Stretch[] = [];
  let wrapped = true;
  for (let k = 0; k + 1 < cuts.length; k++) {
    const [from, to] = [cuts[k] ?? 0, cuts[k + 1] ?? 0];
    if (to - from < SAME) continue;
    const middle = (from + to) / 2;
    const state = stateOf(surfaces.filter((s) => s.from <= middle && s.to >= middle));
    if (state === 'wrapped') wrapped = true;
    if (state !== 'bare') continue;
    const last = stretches.at(-1);
    if (last && !wrapped && from - last.to <= GAP + SAME) stretches[stretches.length - 1] = { from: last.from, to };
    else stretches.push({ from, to });
    wrapped = false;
  }
  return stretches;
}

/**
 * A part's connections with each bar cut to where it is bare, in its place
 * among the others, its pieces in the order they come along it; the others
 * as they are.
 */
export function bareBars(connectors: readonly FlatConnector[], triangles: readonly FlatTriangle[]): FlatConnector[] {
  return connectors.flatMap((connector): FlatConnector[] => {
    if (connector.kind !== 'bar') return [connector];
    const half = connector.length / 2;
    const kept = bareStretches(half, surfacesRound(connector, triangles)).filter((s) => s.to - s.from >= SHORTEST_BAR - SLACK);
    const [only] = kept;
    if (kept.length === 1 && only && only.from <= -half + SLACK && only.to >= half - SLACK) return [connector];
    return kept.map(({ from, to }) => {
      const middle = (from + to) / 2;
      const [x, y, z] = connector.at;
      const [ax, ay, az] = connector.axis;
      return { ...connector, at: [x + ax * middle, y + ay * middle, z + az * middle], length: to - from };
    });
  });
}

/** Where other parts can plug into a part: its connections (finishConnectors), its bars where they are bare. */
export function partConnections(part: Pick<FlatPart, 'connectors' | 'triangles'>): FlatConnector[] {
  return bareBars(finishConnectors(part.connectors), part.triangles);
}
