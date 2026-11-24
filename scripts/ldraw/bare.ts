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
 * holding it, a droid's neck with its head on. Clips likewise: a clip is
 * somewhere a bar can go only where nothing of its part is in it already
 * (emptyClips): a screwdriver in a figure's hand, which LDraw does not
 * draw as a bar, or a rider's hands on a scooter's handlebars, which hold
 * them a little off their line or at a slant, where the kinds of their
 * connections don't pair them (finishConnectors); and a bar its part's
 * hand or clip holds so is not bare there either (heldBars).
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
    return piecesOf(connector, kept);
  });
}

/** A bar as the stretches of it given, from its middle: itself when one of them reaches both its ends. */
function piecesOf(bar: FlatConnector, stretches: readonly Stretch[]): FlatConnector[] {
  const half = bar.length / 2;
  const [only] = stretches;
  if (stretches.length === 1 && only && only.from <= -half + SLACK && only.to >= half - SLACK) return [bar];
  return stretches.map(({ from, to }) => {
    const middle = (from + to) / 2;
    const [x, y, z] = bar.at;
    const [ax, ay, az] = bar.axis;
    return { ...bar, at: [x + ax * middle, y + ay * middle, z + az * middle], length: to - from };
  });
}

/** How many ways out of a clip's line, square to it, its fill is looked for along at each place, and in how many of them it must be found. */
const WAYS_OUT = 16;
const FILLED_WAYS = 4;
/** Where along a clip, as a share of its length from its middle, its fill is looked for: its middle, and towards either end. */
const ALONG_CLIP = [-0.4, 0, 0.4];
/**
 * Anything a clip's line meets nearer than this, in LDU, is in the clip,
 * whichever way it faces: the flat sides a clip's inside is drawn with,
 * eight to a turn at the fewest, come no nearer to its line than 3.7.
 */
const WELL_INSIDE = 3.5;

/** How far along a ray from `from`, going `way`, it meets a triangle, and whether it meets its back (it starts inside a solid); null when it misses it. */
function meet(from: V3, way: V3, t: FlatTriangle): { readonly far: number; readonly back: boolean } | null {
  const e1 = sub(t.b, t.a);
  const e2 = sub(t.c, t.a);
  const p = cross(way, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-12) return null;
  const s = sub(from, t.a);
  const u = dot(s, p) / det;
  if (u < 0 || u > 1) return null;
  const q = cross(s, e1);
  const v = dot(way, q) / det;
  if (v < 0 || u + v > 1) return null;
  const far = dot(e2, q) / det;
  return far > SAME ? { far, back: !t.doubleSided && dot(cross(e1, e2), way) > 0 } : null;
}

/**
 * Whether something of a clip's part is in it: at some place along it, the
 * ways out of its line meet first, in FILLED_WAYS of WAYS_OUT or more, the
 * inside of a solid no further out than a bar's surface (a rod or a handle
 * in it, a little off its line or not) or anything at all well inside its
 * own wall (WELL_INSIDE). A surface drawn to be seen from both sides says
 * nothing of whether the line is inside it.
 */
function isFilled(clip: FlatConnector, triangles: readonly FlatTriangle[]): boolean {
  const [u, v] = across(clip.axis);
  const half = clip.length / 2;
  const reach = BAR_RADIUS + SURFACE;
  // the triangles that come within reach of its line, by their boxes
  const ends = [-half, half].map((s): V3 => [clip.at[0] + clip.axis[0] * s, clip.at[1] + clip.axis[1] * s, clip.at[2] + clip.axis[2] * s]);
  const lo = [0, 1, 2].map((k) => Math.min(...ends.map((e) => e[k] ?? 0)) - reach);
  const hi = [0, 1, 2].map((k) => Math.max(...ends.map((e) => e[k] ?? 0)) + reach);
  const near = triangles.filter((t) => [0, 1, 2].every((k) => Math.max(t.a[k] ?? 0, t.b[k] ?? 0, t.c[k] ?? 0) >= (lo[k] ?? 0) && Math.min(t.a[k] ?? 0, t.b[k] ?? 0, t.c[k] ?? 0) <= (hi[k] ?? 0)));
  return ALONG_CLIP.some((share) => {
    const from: V3 = [clip.at[0] + clip.axis[0] * share * clip.length, clip.at[1] + clip.axis[1] * share * clip.length, clip.at[2] + clip.axis[2] * share * clip.length];
    let filled = 0;
    for (let k = 0; k < WAYS_OUT; k++) {
      const angle = (2 * Math.PI * k) / WAYS_OUT;
      const way: V3 = [u[0] * Math.cos(angle) + v[0] * Math.sin(angle), u[1] * Math.cos(angle) + v[1] * Math.sin(angle), u[2] * Math.cos(angle) + v[2] * Math.sin(angle)];
      const first = near.reduce<{ readonly far: number; readonly back: boolean } | null>((best, t) => {
        const met = meet(from, way, t);
        return met && (!best || met.far < best.far) ? met : best;
      }, null);
      if (first && (first.far < WELL_INSIDE || (first.back && first.far <= reach))) filled++;
    }
    return filled >= FILLED_WAYS;
  });
}

/** A part's connections without the clips something of the part is in already (isFilled); the others as they are. */
export function emptyClips(connectors: readonly FlatConnector[], triangles: readonly FlatTriangle[]): FlatConnector[] {
  return connectors.filter((connector) => connector.kind !== 'clip' || !isFilled(connector, triangles));
}

/**
 * How far from a clip's line, in LDU, a bar's line may be at either end of
 * the clip and the bar still run through it: half a bar's radius, as a
 * rider's hand holds a handlebar a little off its line or at a slant.
 */
const THROUGH = BAR_RADIUS / 2;

/** The stretch along a bar, from its middle, that a clip holds when the bar runs through it; null when it does not. */
function heldStretch(bar: FlatConnector, clip: FlatConnector): Stretch | null {
  const ends = [-clip.length / 2, clip.length / 2].map((s): V3 => [clip.at[0] + clip.axis[0] * s, clip.at[1] + clip.axis[1] * s, clip.at[2] + clip.axis[2] * s]);
  const along = ends.map((end) => dot(sub(end, bar.at), bar.axis));
  const through = ends.every((end, k) => {
    const s = along[k] ?? 0;
    return Math.hypot(...sub(sub(end, bar.at), [bar.axis[0] * s, bar.axis[1] * s, bar.axis[2] * s])) <= THROUGH;
  });
  const [from, to] = [Math.min(...along), Math.max(...along)];
  return through && to > -bar.length / 2 && from < bar.length / 2 ? { from, to } : null;
}

/** A part's bars cut where clips that are filled hold them (heldStretch), each piece left at least SHORTEST_BAR long; the others as they are. */
function heldBars(connectors: readonly FlatConnector[], holders: readonly FlatConnector[]): FlatConnector[] {
  return connectors.flatMap((connector): FlatConnector[] => {
    if (connector.kind !== 'bar') return [connector];
    const held = holders.flatMap((holder) => heldStretch(connector, holder) ?? []);
    if (held.length === 0) return [connector];
    const half = connector.length / 2;
    const left = held.reduce<readonly Stretch[]>(
      (pieces, h) => pieces.flatMap((p) => [{ from: p.from, to: Math.min(p.to, h.from) }, { from: Math.max(p.from, h.to), to: p.to }].filter((q) => q.to - q.from > SAME)),
      [{ from: -half, to: half }],
    );
    return piecesOf(connector, left.filter((p) => p.to - p.from >= SHORTEST_BAR - SLACK));
  });
}

/**
 * Where other parts can plug into a part: its connections (finishConnectors),
 * its bars where they are bare and no clip its part fills holds them, its
 * clips that are empty.
 */
export function partConnections(part: Pick<FlatPart, 'connectors' | 'triangles'>): FlatConnector[] {
  const finished = finishConnectors(part.connectors);
  const empty = emptyClips(finished, part.triangles);
  // the clips emptyClips leaves out are those its own part fills
  const filled = finished.filter((c) => !empty.includes(c));
  return heldBars(bareBars(empty, part.triangles), filled);
}
