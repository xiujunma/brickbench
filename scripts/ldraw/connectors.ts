/**
 * Technic and click-hinge connections, read from the LDraw primitives that
 * draw them: pins (connect*, confric*), round pin holes (peghole*, beamhol*,
 * connhol*), axles and axle holes (axle*, axl*), and click hinges'
 * single fingers and forks of two (clh*). Each primitive in a part is a
 * piece of a connection; pieces along one line join up, so the peg-hole ends
 * on the two faces of a Technic brick make one hole through it.
 */
import { CONNECTOR_KINDS } from '../../src/core/ldraw/format.ts';
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
};

/** The hinge primitives and the pivot each turns about, for the verify test. */
export const HINGE_PRIMITIVES: Readonly<Record<string, ConnectorPrimitive>> = HINGES;

/** The connection a primitive draws, by its file name ("p/connect.dat" or "connect.dat"); undefined for any other file. */
export function connectorPrimitive(name: string): ConnectorPrimitive | undefined {
  const base = name.replace(/^.*\//, '').replace(/\.dat$/, '');
  if (/^(connect|confric)\d*$/.test(base)) return PIN;
  // not npeghol*: the "negative" faces around and between holes, centred on none
  if (/^(peghole\d*|beamhol[e2]|connhol(e|\d+))$/.test(base)) return PIN_HOLE;
  if (/^(axle|axleend\d*|axles|axlesphe|axlebeam|axlecaph?\d*)$/.test(base)) return AXLE;
  if (/^(axlehol[2-9e]|axleho1[02]|axl\dhol[e\d]|axl\dho\d+|axl\dend)$/.test(base)) return AXLE_HOLE;
  return HINGES[base];
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
  return { kind: primitive.kind, at, axis: primitive.axis, length: max - min, outward: primitive.either ? outwardness(triangles, primitive) : 0 };
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

/** How far apart pieces on one line may be and still be one connection, in LDU: a Technic brick's peg-hole ends are 16 apart. */
const JOIN_GAP: Readonly<Record<ConnectorKind, number | null>> = { pin: null, pinhole: 16, axle: 2, axlehole: 16, finger: 0, fork: 8 };
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
  if (gap === null || a.kind !== b.kind || !coaxial(a, b)) return false;
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
 * A part's connections, from all the pieces it is drawn with: axles told
 * from axle holes, pieces on one line joined, mouths of axle holes dropped,
 * in a steady order.
 */
export function finishConnectors(pieces: readonly FlatConnector[]): FlatConnector[] {
  const joined = joinRuns(pieces.map(settled).filter((piece) => piece.length > 0));
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
