/**
 * Technic and click-hinge connections, read from the LDraw primitives that
 * draw them: pins (connect*, confric*), round pin holes (peghole*, beamhol*,
 * connhol*), axles and axle holes (axle*, axl*), and click hinges'
 * single fingers and forks of two (clh*), the older hinge plates' two and
 * three fingers (h1, h2), the clips (clip*) and handle bars (phandle*,
 * handle*), and the snap a round plate turns on a flat turntable base by
 * (stud18a), which LDraw draws as primitives; bars drawn as plain
 * cylinders are found by their size (barPiece), and clips drawn with plain
 * arcs by their shape (clipArc). Each primitive in a part is a piece of a
 * connection; pieces along one line join up, so the peg-hole ends on the
 * two faces of a Technic brick make one hole through it. Connections LDraw
 * draws with other plain shapes are set on their parts' files instead
 * (minifigJoints.ts, hingeJoints.ts, clipJoints.ts).
 */
import { CONNECTOR_KINDS } from '../../src/core/ldraw/format.ts';
import { mates } from '../../src/core/model/mates.ts';
import type { Transform, V3 } from './parse.ts';

export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

/**
 * A connection, or a piece of one, in LDraw coordinates: its middle, the
 * axis it runs along (a unit vector; a pin's points from its base collar to
 * its tip) and its length along it.
 */
export interface FlatConnector {
  readonly kind: ConnectorKind;
  readonly at: V3;
  readonly axis: V3;
  readonly length: number;
  /**
   * For pieces drawn alike for axles and axle holes: how their surfaces face
   * the axis, from -1 (all inwards: a hole) to 1 (all outwards: a rod); 0
   * when that can't be told.
   */
  readonly outward: number;
  /**
   * How much wider (or thinner) than its primitive it is drawn, across its
   * axis: 1 as LDraw's primitive is; 0.65 for the small pivot a hinge plate
   * is drawn with from a Technic pin's primitive.
   */
  readonly across: number;
  /**
   * For a piece of a clip's inside drawn as an arc (clipArc): how much of a
   * turn it is. Arcs over one stretch of one line that together make a
   * clip's five eighths become the clip (allConnectors); any others are
   * left out.
   */
  readonly turn?: number;
}

/** A connection set by hand on the file that draws its part: there, along that way, that long (see minifigJoints.ts, hingeJoints.ts). */
export function setJoint(kind: ConnectorKind, at: V3, [x, y, z]: V3, length: number): FlatConnector {
  const size = Math.hypot(x, y, z);
  return { kind, at, axis: [x / size, y / size, z / size], length, outward: 0, across: 1 };
}

/** A primitive that draws a connection: what it is, and the axis it is drawn along in its own frame. */
export interface ConnectorPrimitive {
  readonly kind: ConnectorKind;
  readonly axis: V3;
  /** A point the axis passes through, in the primitive's frame. */
  readonly through: V3;
  /** Drawn alike for rods and holes: which it is depends on which way its surfaces face. */
  readonly either: boolean;
}

const ORIGIN: V3 = [0, 0, 0];
const ALONG_Y: V3 = [0, 1, 0];
/** Pin primitives run from their base collar, at y = 0, to their tip, up LDraw's -Y. */
const PIN: ConnectorPrimitive = { kind: 'pin', axis: [0, -1, 0], through: ORIGIN, either: false };
const PIN_HOLE: ConnectorPrimitive = { kind: 'pinhole', axis: ALONG_Y, through: ORIGIN, either: false };
const AXLE: ConnectorPrimitive = { kind: 'axle', axis: ALONG_Y, through: ORIGIN, either: true };
const AXLE_HOLE: ConnectorPrimitive = { kind: 'axlehole', axis: ALONG_Y, through: ORIGIN, either: true };

function hinge(kind: 'finger' | 'fork', y: number, z: number): ConnectorPrimitive {
  return { kind, axis: [1, 0, 0], through: [0, y, z], either: false };
}

/** The older hinge plates' fingers turn about their primitive's Z axis, through the knuckle 10 LDU out from where the primitive joins its plate. */
function fingers(kind: 'fingers2' | 'fingers3'): ConnectorPrimitive {
  return { kind, axis: [0, 0, 1], through: [0, 10, 0], either: false };
}

/**
 * Click hinges turn about their primitive's X axis, through the point where
 * the hinge's round surfaces are centred (y, z): found from the circle
 * primitives each is drawn with (the verify test checks them against the
 * library). Single fingers fit between the two halves of a fork.
 */
const HINGES: Readonly<Record<string, ConnectorPrimitive>> = {
  clh1: hinge('finger', 0, -10),
  clh2: hinge('finger', -7, 0),
  clh3: hinge('finger', 0, -10),
  clh6: hinge('finger', 0, -10),
  clh6d: hinge('finger', 0, -10),
  clh6u: hinge('finger', 0, -10),
  clh8: hinge('finger', 0, -7),
  clh9: hinge('finger', -7, 0),
  clh12: hinge('finger', -7, 0),
  clh13: hinge('finger', -7, 0),
  clh15: hinge('finger', 0, -10),
  clh4: hinge('fork', 0, 4),
  clh5: hinge('fork', 0, 10),
  clh7: hinge('fork', 0, 4),
  clh10: hinge('fork', 0, 4),
  clh11: hinge('fork', 0, 4),
  clh14: hinge('fork', 0, 10),
  // the hinge plates before click hinges: two fingers go between three, middle to middle
  h1: fingers('fingers2'),
  h2: fingers('fingers3'),
};

/** The hinge primitives and the pivot each turns about, for the verify test. */
export const HINGE_PRIMITIVES: Readonly<Record<string, ConnectorPrimitive>> = HINGES;

function rod(kind: 'bar' | 'clip', axis: V3, through: V3): ConnectorPrimitive {
  return { kind, axis, through, either: false };
}

const ALONG_X: V3 = [1, 0, 0];
const ALONG_Z: V3 = [0, 0, 1];

/**
 * Clips hold a bar along the line their inner surface, of a bar's radius
 * (4 LDU), runs round; handles are bars. Found from where each primitive's
 * round surfaces are centred (the verify test checks them against the
 * library). The road-sign clip (clip4) holds a plate's edge, not a bar.
 */
const RODS: Readonly<Record<string, ConnectorPrimitive>> = {
  clip1: rod('clip', ALONG_Y, ORIGIN),
  clip2: rod('clip', ALONG_Y, [0, 0, -10]),
  clip3: rod('clip', ALONG_X, [0, 2, 0]),
  clip5: rod('clip', ALONG_Y, ORIGIN),
  clip6: rod('clip', ALONG_X, [0, 2, 0]),
  clip7: rod('clip', ALONG_Y, ORIGIN),
  clip8: rod('clip', ALONG_Z, [0, -6, 0]),
  clip9: rod('clip', ALONG_Y, [0, 0, -10]),
  clip10: rod('clip', ALONG_Y, [0, 0, -10]),
  clip11: rod('clip', ALONG_Z, [0, -6, 0]),
  clip12: rod('clip', ALONG_Y, ORIGIN),
  clip13: rod('clip', ALONG_Y, ORIGIN),
  clip14: rod('clip', ALONG_Y, [0, 0, -10]),
  clip15: rod('clip', ALONG_Y, ORIGIN),
  clip16: rod('clip', ALONG_Y, ORIGIN),
  phandle1: rod('bar', ALONG_X, [0, 2, 0]),
  phandle2: rod('bar', ALONG_X, [0, 2, 0]),
  handle: rod('bar', ALONG_X, [0, 0, 4]),
  handle2: rod('bar', ALONG_X, [0, 0, 4]),
};

/** Open studs: a bar-sized hole down their middle, which a bar stands in; open only at their top, so their axis runs from their base (y 0) up to it (y -4). */
const OPEN_STUD: ConnectorPrimitive = { kind: 'barhole', axis: [0, -1, 0], through: ORIGIN, either: false };
/** The plain open stud and those shaped for round and octagonal parts, with their base edges or without, with the logo or without. */
const OPEN_STUDS = /^stud(2|6|17)a?(-logo\d*)?$/;
/**
 * The snap in the middle of the underside of a round plate, a round brick
 * or a gear plate that turns on a flat turntable base: an open stud's tube
 * with snaps round its rim, which goes up into the ring on the base's top
 * (hingeJoints.ts). Its axis runs out of the tube, from its base (y 0) to
 * its rim (y -4), as an open stud's does.
 */
const SNAP: ConnectorPrimitive = { kind: 'turnsnap', axis: [0, -1, 0], through: ORIGIN, either: false };

/** The clip and handle primitives and the line each holds a bar on, for the verify test. */
export const ROD_PRIMITIVES: Readonly<Record<string, ConnectorPrimitive>> = RODS;

/** A bar's radius, in LDU (3.18 mm), how far off it a surface drawn for one may be, and the shortest stretch of a bar worth plugging into. */
export const BAR_RADIUS = 4;
const RADIUS_SLACK = 0.05;
export const SHORTEST_BAR = 8;

/**
 * A bar, when a reference draws one: a whole cylinder of a bar's radius,
 * open (4-4cyli), edged (4-4cylo) or closed at one end (4-4cylc, as whips,
 * hilts and bars with a stop end), with its edge lines or without (cyli2,
 * cylc2, cylc3), at least SHORTEST_BAR long, its surface facing out. Null
 * for anything else, inside out (a hole) included. Where a bar found here
 * is bare is told once the part is drawn (bareBars in bare.ts).
 */
export function barPiece(file: string, matrix: Transform, inverted: boolean): FlatConnector | null {
  if (inverted || !/^(48\/)?4-4cyl(?:[ioc]|i2|c2|c3)\.dat$/.test(file.replace(/\\/g, '/').toLowerCase())) return null;
  const [a, b, c, d, e, f, g, h, i] = matrix.m;
  const radial = [Math.hypot(a, d, g), Math.hypot(c, f, i)];
  const length = Math.hypot(b, e, h);
  if (radial.some((r) => Math.abs(r - BAR_RADIUS) > RADIUS_SLACK) || length < SHORTEST_BAR) return null;
  const [x, y, z] = matrix.t;
  return { kind: 'bar', at: [x + b / 2, y + e / 2, z + h / 2], axis: [b / length, e / length, h / length], length, outward: 0, across: 1 };
}

/** How long a clip is, in LDU: 8 on a plate's or a tile's, 6 on a link of a tread, 5 either side of an islander's mask. */
const [SHORTEST_CLIP, LONGEST_CLIP] = [5, 10];
/** How much of a turn the inside of a clip goes round a bar: five eighths, however many arcs it is drawn with. */
const CLIP_TURN = 5 / 8;

/**
 * A piece of the inside of a clip, when a reference draws one with a plain
 * shape: a cylinder, or part of one (5-8cyli, 5-16cylo, 2-4cyli ...), of a
 * bar's radius. Null for anything else: an arc closed at one end (cylc)
 * is the floor of a pocket, which no bar goes through. Whether it is a
 * clip is told once the part's pieces are gathered (clipsOf): the arc must
 * be inside out, a rod's round being drawn with the same shapes, and five
 * eighths of a turn with the others on its line, which a whole cylinder,
 * a hole, never is.
 */
export function clipArc(file: string, matrix: Transform, inverted: boolean): FlatConnector | null {
  const arc = /^(?:48\/)?(\d+)-(\d+)cyl[io]\.dat$/.exec(file.replace(/\\/g, '/').toLowerCase());
  const turn = arc ? Number(arc[1]) / Number(arc[2]) : 0;
  if (!(turn > 0)) return null;
  const [a, b, c, d, e, f, g, h, i] = matrix.m;
  const length = Math.hypot(b, e, h);
  if ([Math.hypot(a, d, g), Math.hypot(c, f, i)].some((r) => Math.abs(r - BAR_RADIUS) > RADIUS_SLACK) || length === 0) return null;
  const [x, y, z] = matrix.t;
  return { kind: 'clip', at: [x + b / 2, y + e / 2, z + h / 2], axis: [b / length, e / length, h / length], length, outward: inverted ? -1 : 1, across: 1, turn };
}

/** The connection a primitive draws, by its file name ("p/connect.dat" or "connect.dat"); undefined for any other file. */
export function connectorPrimitive(name: string): ConnectorPrimitive | undefined {
  const base = name.replace(/^.*\//, '').replace(/\.dat$/, '');
  if (/^(connect|confric)\d*$/.test(base)) return PIN;
  // not npeghol*: the "negative" faces around and between holes, centred on none
  if (/^(peghole\d*|beamhol[e2]|connhol(e|\d+))$/.test(base)) return PIN_HOLE;
  if (/^(axle|axleend\d*|axles|axlesphe|axlebeam|axlecaph?\d*)$/.test(base)) return AXLE;
  if (/^(axlehol[2-9e]|axleho1[02]|axl\dhol[e\d]|axl\dho\d+|axl\dend)$/.test(base)) return AXLE_HOLE;
  if (OPEN_STUDS.test(base)) return OPEN_STUD;
  if (base === 'stud18a') return SNAP;
  return HINGES[base] ?? RODS[base];
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function scale(v: V3, s: number): V3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

interface Facet {
  readonly a: V3;
  readonly b: V3;
  readonly c: V3;
  readonly doubleSided: boolean;
}

/**
 * How a primitive's surfaces face its axis (see FlatConnector.outward):
 * each front-facing triangle's normal against the way out from the axis
 * through it, weighted by its area.
 */
function outwardness(triangles: readonly Facet[], primitive: ConnectorPrimitive): number {
  let facing = 0;
  let total = 0;
  for (const t of triangles) {
    if (t.doubleSided) continue;
    const normal = cross(sub(t.b, t.a), sub(t.c, t.a));
    const centre = scale(add(add(t.a, t.b), t.c), 1 / 3);
    const off = sub(centre, primitive.through);
    const radial = sub(off, scale(primitive.axis, dot(off, primitive.axis)));
    const reach = Math.hypot(...radial);
    const size = Math.hypot(...normal);
    if (reach < 1e-6 || size === 0) continue;
    facing += dot(normal, radial) / reach;
    total += size;
  }
  return total > 0 ? facing / total : 0;
}

/** A connection primitive as one connection: along its axis, through the middle of what it draws. */
export function connectorOf(primitive: ConnectorPrimitive, triangles: readonly Facet[]): FlatConnector | null {
  if (triangles.length === 0) return null;
  const k = primitive.axis.findIndex((v) => v !== 0);
  let min = Infinity;
  let max = -Infinity;
  for (const t of triangles) {
    for (const p of [t.a, t.b, t.c]) {
      min = Math.min(min, p[k] ?? 0);
      max = Math.max(max, p[k] ?? 0);
    }
  }
  const middle = (min + max) / 2;
  const at: V3 = [k === 0 ? middle : primitive.through[0], k === 1 ? middle : primitive.through[1], k === 2 ? middle : primitive.through[2]];
  return { kind: primitive.kind, at, axis: primitive.axis, length: max - min, outward: primitive.either ? outwardness(triangles, primitive) : 0, across: 1 };
}

/** How much a reference's matrix widens what lies across a unit axis: the mean of its stretch along two directions square to it. */
function widening(matrix: Transform, axis: V3): number {
  const [a, b, c, d, e, f, g, h, i] = matrix.m;
  const stretch = ([x, y, z]: V3): number => Math.hypot(a * x + b * y + c * z, d * x + e * y + f * z, g * x + h * y + i * z);
  // two unit vectors square to the axis and to each other
  const k = axis.findIndex((v) => Math.abs(v) < 0.9);
  const other: V3 = [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0];
  const first = cross(axis, other);
  const size = Math.hypot(...first);
  const u = scale(first, 1 / size);
  return Math.sqrt(stretch(u) * stretch(cross(axis, u)));
}

/**
 * A child's connection where the parent puts it: moved, turned and
 * stretched by the reference's matrix, its surfaces facing the other way
 * when the reference turns them inside out. Null when the matrix flattens
 * its axis away.
 */
export function placeConnector(connector: FlatConnector, matrix: Transform, inverted: boolean): FlatConnector | null {
  const [a, b, c, d, e, f, g, h, i] = matrix.m;
  const [x, y, z] = connector.axis;
  const along: V3 = [a * x + b * y + c * z, d * x + e * y + f * z, g * x + h * y + i * z];
  const stretch = Math.hypot(...along);
  if (stretch === 0) return null;
  const [px, py, pz] = connector.at;
  return {
    kind: connector.kind,
    at: [a * px + b * py + c * pz + matrix.t[0], d * px + e * py + f * pz + matrix.t[1], g * px + h * py + i * pz + matrix.t[2]],
    axis: scale(along, 1 / stretch),
    length: connector.length * stretch,
    outward: inverted ? -connector.outward : connector.outward,
    across: connector.across * widening(matrix, connector.axis),
    ...(connector.turn === undefined ? {} : { turn: connector.turn }),
  };
}

/** Axles and axle holes are told apart by their surfaces when they can be (see FlatConnector.outward), by their primitive's name otherwise. */
const TELLS = 0.3;

function settled(connector: FlatConnector): FlatConnector {
  if (connector.kind !== 'axle' && connector.kind !== 'axlehole') return connector;
  if (connector.outward > TELLS) return { ...connector, kind: 'axle' };
  if (connector.outward < -TELLS) return { ...connector, kind: 'axlehole' };
  return connector;
}

/**
 * How far apart pieces on one line may be and still be one connection, in
 * LDU: a Technic brick's peg-hole ends are 16 apart; an axle's pieces a
 * notch apart (3, on the 2L axle 32062) or a flexible axle's ribs (3.6),
 * and where its part holds an axle between its pieces, a stop or a ring,
 * the axle is cut again (bare.ts). The kinds not here are whole as they
 * come: a pin's two ends, a clip, a joint set by hand.
 */
const JOIN_GAP: Readonly<Partial<Record<ConnectorKind, number>>> = { pinhole: 16, axle: 3.6, axlehole: 16, finger: 0, fork: 8, bar: 1 };

/** Technic pins, holes and axles are one size: a piece drawn more than this much wider or thinner than its primitive is something else. */
const TECHNIC_SIZE = 0.15;

function isTechnicSized(connector: FlatConnector): boolean {
  const technic = connector.kind === 'pin' || connector.kind === 'pinhole' || connector.kind === 'axle' || connector.kind === 'axlehole';
  return !technic || Math.abs(connector.across - 1) <= TECHNIC_SIZE;
}

/** Pieces of a connection lie on one line to within this, in LDU. */
const ON_LINE = 0.5;

function coaxial(a: FlatConnector, b: FlatConnector): boolean {
  if (Math.abs(dot(a.axis, b.axis)) < 0.999) return false;
  const off = sub(b.at, a.at);
  return Math.hypot(...sub(off, scale(a.axis, dot(off, a.axis)))) < ON_LINE;
}

/** Where a connection starts and ends along another's axis, from that one's middle. */
function span(connector: FlatConnector, along: FlatConnector): readonly [number, number] {
  const s = dot(sub(connector.at, along.at), along.axis);
  return [s - connector.length / 2, s + connector.length / 2];
}

function joins(a: FlatConnector, b: FlatConnector): boolean {
  const gap = JOIN_GAP[a.kind];
  if (gap === undefined || a.kind !== b.kind || !coaxial(a, b)) return false;
  const [b0, b1] = span(b, a);
  return Math.max(-a.length / 2, b0) - Math.min(a.length / 2, b1) <= gap + 1e-6;
}

/** Joins each run of pieces into one connection, spanning them all, along the first one's axis. */
function joinRuns(pieces: readonly FlatConnector[]): FlatConnector[] {
  const group = pieces.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (group[r] !== r) r = group[r] ?? r;
    return r;
  };
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const [a, b] = [pieces[i], pieces[j]];
      if (a && b && joins(a, b)) group[root(j)] = root(i);
    }
  }
  const runs = new Map<number, FlatConnector[]>();
  pieces.forEach((piece, i) => runs.set(root(i), [...(runs.get(root(i)) ?? []), piece]));
  return [...runs.values()].map((run) => {
    const [first] = run as [FlatConnector, ...FlatConnector[]];
    if (run.length === 1) return first;
    let lo = Infinity;
    let hi = -Infinity;
    for (const piece of run) {
      const [s0, s1] = span(piece, first);
      lo = Math.min(lo, s0);
      hi = Math.max(hi, s1);
    }
    return { ...first, at: add(first.at, scale(first.axis, (lo + hi) / 2)), length: hi - lo };
  });
}

/** A pin-hole piece along an axle hole is the round mouth of that axle hole, not a hole of its own. */
function alongAxleHole(hole: FlatConnector, axleHoles: readonly FlatConnector[]): boolean {
  return axleHoles.some((axle) => {
    if (!coaxial(axle, hole)) return false;
    const [h0, h1] = span(hole, axle);
    return h0 >= -axle.length / 2 - 2 && h1 <= axle.length / 2 + 2;
  });
}


/**
 * The clips a part draws with plain arcs (clipArc): arcs inside out, over
 * one stretch of one line, that together go five eighths of a turn round a
 * bar, are the inside of a clip, a clip long. Each such set is one clip; an
 * arc drawn wider or thinner than a bar by the part that uses it, a groove
 * of half a turn, the slot of a pin's hollow end and arcs that face out are
 * left out.
 */
function clipsOf(arcs: readonly FlatConnector[]): FlatConnector[] {
  const inside = arcs.filter((arc) => arc.outward < 0 && Math.abs(arc.across - 1) * BAR_RADIUS <= RADIUS_SLACK);
  const together = (a: FlatConnector, b: FlatConnector): boolean => {
    if (!coaxial(a, b)) return false;
    const [from, to] = span(b, a);
    return Math.abs(from + a.length / 2) < ON_LINE && Math.abs(to - a.length / 2) < ON_LINE;
  };
  // each arc with the first one it lies together with: the sets of arcs that are one surface
  const firsts = inside.filter((arc, i) => !inside.slice(0, i).some((other) => together(other, arc)));
  return firsts.flatMap((first): FlatConnector[] => {
    const turn = inside.filter((arc) => together(first, arc)).reduce((sum, arc) => sum + (arc.turn ?? 0), 0);
    const isClip = Math.abs(turn - CLIP_TURN) < 1e-9 && first.length >= SHORTEST_CLIP && first.length <= LONGEST_CLIP;
    return isClip ? [{ kind: 'clip', at: first.at, axis: first.axis, length: first.length, outward: 0, across: 1 }] : [];
  });
}

/** The same connection given twice, as by a head drawn with two of the files its neck joint is set on: kept once. */
function once(connectors: readonly FlatConnector[]): FlatConnector[] {
  return connectors.filter(
    (c, i) => !connectors.slice(0, i).some((d) => d.kind === c.kind && Math.hypot(...sub(c.at, d.at)) < 0.1 && Math.abs(dot(c.axis, d.axis)) > 0.999),
  );
}

/**
 * Every connection a part is drawn with, from all its pieces: axles told
 * from axle holes, the arcs of a clip's inside made the clip, pieces on
 * one line joined, mouths of axle holes dropped, each once, in a steady
 * order. Those its own pieces take are among them (see finishConnectors):
 * this is how LDraw's ready-made assemblies show where their halves join.
 */
export function allConnectors(pieces: readonly FlatConnector[]): FlatConnector[] {
  const whole = [...pieces.filter((piece) => piece.turn === undefined), ...clipsOf(pieces.filter((piece) => piece.turn !== undefined))];
  const joined = once(joinRuns(whole.map(settled).filter((piece) => piece.length > 0 && isTechnicSized(piece))));
  const axleHoles = joined.filter((c) => c.kind === 'axlehole');
  const byPlace = (a: FlatConnector, b: FlatConnector): number => {
    for (let k = 0; k < 3; k++) {
      const d = Math.round((a.at[k] ?? 0) * 100) - Math.round((b.at[k] ?? 0) * 100);
      if (d !== 0) return d;
    }
    return 0;
  };
  return joined
    .filter((c) => c.kind !== 'pinhole' || !alongAxleHole(c, axleHoles))
    .sort((a, b) => CONNECTOR_KINDS.indexOf(a.kind) - CONNECTOR_KINDS.indexOf(b.kind) || byPlace(a, b));
}

/** Rods and what holds them: one may go on past the other, and be free there. Any other kind is a joint, taken whole. */
const RODS_AND_HOLDERS: readonly ConnectorKind[] = ['pin', 'pinhole', 'axle', 'axlehole', 'bar', 'clip', 'barhole'];

/** How far a connection may reach past its mate and still be wholly in it, in LDU. */
const TAKEN_SLACK = 1;

/** Whether two connections of one part are plugged into each other: kinds that mate, on one line, overlapping along it. */
export function plugged(a: FlatConnector, b: FlatConnector): boolean {
  if (!mates(a.kind, b.kind) || !coaxial(a, b)) return false;
  const [b0, b1] = span(b, a);
  return Math.min(a.length / 2, b1) - Math.max(-a.length / 2, b0) > ON_LINE;
}

/**
 * Whether `a`, plugged into `b`, has nothing left for another part: a
 * joint's half, or a pin's end; a hole, an axle, a bar or a clip unless it
 * goes on past its mate, as an axle does through a hole.
 */
function takenBy(a: FlatConnector, b: FlatConnector): boolean {
  if (a.kind === 'pin' || !RODS_AND_HOLDERS.includes(a.kind)) return true;
  const [a0, a1] = span(a, b);
  return a0 >= -b.length / 2 - TAKEN_SLACK && a1 <= b.length / 2 + TAKEN_SLACK;
}

/**
 * A part's connections, where other parts can plug in: every one it is
 * drawn with (allConnectors) but those its own pieces take. A ready-made
 * assembly (a complete hinge brick or turntable, a torso with its arms on)
 * holds both halves of a joint, plugged together: nothing else goes there,
 * and the assembly stacks like any other part.
 */
export function finishConnectors(pieces: readonly FlatConnector[]): FlatConnector[] {
  const all = allConnectors(pieces);
  return all.filter((a) => !all.some((b) => b !== a && plugged(a, b) && takenBy(a, b)));
}
