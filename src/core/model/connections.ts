/**
 * Where placed parts' Technic and click-hinge connections are, which plug
 * into each other, and the joints a group of parts hangs by: the line it
 * can swing about when every connection holding it turns freely about one.
 */
import { PLATE_HEIGHT, type Vec3 } from '../grid';
import { rotateBy, type Turn } from '../orientation';
import type { Connector, ConnectorKind, PartDef, PartLookup } from '../parts/types';
import { ROUND_PIVOTS, brickCellBox, brickOrigin, brickTurn, isLoose, isOnGrid, type PlacedPart } from './geometry';
import { isPair, mates } from './mates';
import type { Brick } from './types';

/** A connection where it is in the world: its middle and length in world units, and the unit axis it runs along. */
export interface WorldConnector {
  readonly kind: ConnectorKind;
  readonly at: Vec3;
  readonly axis: Vec3;
  readonly length: number;
}

/** Connections lie on one line to within this, in world units (half an LDraw unit, as files round them). */
const ON_LINE = 0.025;
/** ... and run along it to within about 2.5°. */
const PARALLEL = 0.999;

export { mates };

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function along(at: Vec3, axis: Vec3, by: number): Vec3 {
  return { x: at.x + axis.x * by, y: at.y + axis.y * by, z: at.z + axis.z * by };
}

function minus(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** A part's connection, turned and moved as the part is placed. */
export function placeConnector(connector: Connector, origin: Vec3, turn: Turn): WorldConnector {
  const at = rotateBy(turn, connector.at);
  return { kind: connector.kind, at: { x: origin.x + at.x, y: origin.y + at.y, z: origin.z + at.z }, axis: rotateBy(turn, connector.axis), length: connector.length };
}

/** A placed part's connections, in the world. */
export function brickConnectors(brick: PlacedPart, lookup: PartLookup): WorldConnector[] {
  const connectors = lookup(brick.partId)?.connectors;
  if (!connectors || connectors.length === 0) return [];
  const origin = brickOrigin(brick, lookup);
  const turn = brickTurn(brick);
  return connectors.map((connector) => placeConnector(connector, origin, turn));
}

/** Whether plugged-together connections turn about their axis: all but an axle in an axle hole, which locks it, and hips in a torso. */
export function turnsFreely(a: ConnectorKind, b: ConnectorKind): boolean {
  return !isPair(a, b, 'axle', 'axlehole') && !isPair(a, b, 'waist', 'hips');
}

/** Round connections, whose own turn about their axis means nothing to what plugs into them. */
export function isRound(kind: ConnectorKind): boolean {
  return ['pin', 'pinhole', 'axle', 'axlehole', 'bar', 'barhole'].includes(kind);
}

/** How far a point lies from a connection's line. */
function offLine(point: Vec3, connector: WorldConnector): number {
  const off = minus(point, connector.at);
  const s = dot(off, connector.axis);
  return Math.hypot(off.x - connector.axis.x * s, off.y - connector.axis.y * s, off.z - connector.axis.z * s);
}

/** Whether two connections lie on one line. */
export function onOneLine(a: WorldConnector, b: WorldConnector): boolean {
  return Math.abs(dot(a.axis, b.axis)) >= PARALLEL && offLine(b.at, a) <= ON_LINE;
}

/** Whether two connections are plugged together: kinds that mate, on one line, overlapping along it. */
export function engaged(a: WorldConnector, b: WorldConnector): boolean {
  if (!mates(a.kind, b.kind) || !onOneLine(a, b)) return false;
  const s = dot(minus(b.at, a.at), a.axis);
  return Math.min(a.length / 2, s + b.length / 2) - Math.max(-a.length / 2, s - b.length / 2) > ON_LINE;
}

/** Whether two placed parts are plugged together: a connection of one in a connection of the other. */
export function pluggedTogether(a: PlacedPart, b: PlacedPart, lookup: PartLookup): boolean {
  const theirs = brickConnectors(b, lookup);
  return theirs.length > 0 && brickConnectors(a, lookup).some((mine) => theirs.some((other) => engaged(mine, other)));
}

/**
 * A stretch of a connection's line that another connection lies along: from
 * where to where along its axis, from its middle, in world units, and
 * whether that one points the same way along the line (1) or the other.
 */
export interface Stretch {
  readonly from: number;
  readonly to: number;
  readonly way: 1 | -1;
}

/**
 * How far parts may reach into each other along a connection, or fall short
 * of filling it, and still fit, in world units. It lies between the two
 * that must be told apart: LDraw draws an axle a twentieth of a stud short
 * of its length, so parts set along one from its end stand that far out of
 * step with those set by the studs; and the shortest connections there are,
 * the mouths of a hole a slot breaks, are a tenth of a stud long. And it is
 * off the quarter LDraw units parts are drawn on, so that no two parts
 * overlap by just this, to fit in one place and not in the next.
 */
const PLAY = 0.07;

/** The play a stretch of `length` has: PLAY, or most of the stretch, when it is shorter than that. */
export function playOf(length: number): number {
  return Math.min(PLAY, 0.7 * length);
}

/** The stretch of `line`'s own line that a connection on it lies along. */
export function stretchOn(line: WorldConnector, other: WorldConnector): Stretch {
  const s = dot(minus(other.at, line.at), line.axis);
  return { from: s - other.length / 2, to: s + other.length / 2, way: dot(other.axis, line.axis) < 0 ? -1 : 1 };
}

/** Whether two stretches of one line are in each other's way: overlapping by more than the play the shorter has. */
export function inTheWay(a: Stretch, b: Stretch): boolean {
  const overlap = Math.min(a.to, b.to) - Math.max(a.from, b.from);
  return overlap > playOf(Math.min(a.to - a.from, b.to - b.from));
}

/** The stretches of a connection that parts plugged into it take: one for each of `around` that is. */
export function takenOn(socket: WorldConnector, around: readonly WorldConnector[]): Stretch[] {
  return around.filter((other) => engaged(socket, other)).map((other) => stretchOn(socket, other));
}

/**
 * Whether a connection has room for one more part: for a plug lying along
 * the stretch `plug` of it, besides those along the stretches `taken`. The
 * plug must be clear of the others, but on the axle across a minifigure's
 * hips: a leg hangs on each end of that, yet LDraw draws both legs about
 * the middle of the hips, so both legs' joints lie on the middle of the
 * axle. Each points to its own leg's side: the axle has room for a leg that
 * points the way no leg on it does.
 */
export function hasRoom(socket: WorldConnector, plug: Stretch, taken: readonly Stretch[]): boolean {
  if (socket.kind === 'hip') return !taken.some((other) => other.way === plug.way);
  return !taken.some((other) => inTheWay(plug, other));
}

/**
 * How a group of parts is held by the rest: by joints on one line it can
 * swing about, rigidly, or not by any connection. A joint's axis points the
 * way R swings the group about it (as a right-handed screw turns).
 */
export type Hold = { readonly kind: 'joint'; readonly axis: Vec3; readonly pivot: Vec3 } | { readonly kind: 'rigid' } | { readonly kind: 'none' };

/** An axis pointing the way of its largest part, so R swings parts about an upright one the way it turns them on the grid. */
function canonicalAxis(axis: Vec3): Vec3 {
  const largest = [axis.x, axis.y, axis.z].reduce((a, b) => (Math.abs(b) > Math.abs(a) + 1e-9 ? b : a));
  return largest < 0 ? { x: -axis.x, y: -axis.y, z: -axis.z } : axis;
}

/** How far to the side of its pivot a part's middle must lie, in studs, for the part to hang to that side of it: the least in the library is 0.3. */
const TO_ONE_SIDE = 0.1;

/**
 * The way about a hinge's pivot that turns its part up, as a right-handed
 * screw turns: for a part hinged at an end or an edge (ROUND_PIVOTS), its
 * middle to one side of the pivot, as a car roof on its holder, a plate on
 * a click hinge or the top of a folding hinge plate is. R swings such a
 * part this way, whichever way it faces in the world, so R lifts it. Null
 * for a part whose middle lies over or under its pivot (a control stick, a
 * hinge brick's top), and for any other connection: about those R turns
 * the way the world's axes point.
 */
function liftingWay(part: PartDef, pivot: Connector, turn: Turn): Vec3 | null {
  if (!ROUND_PIVOTS.includes(pivot.kind)) return null;
  const { min, max } = part.extent ?? { min: { x: -part.w / 2, y: 0, z: -part.d / 2 }, max: { x: part.w / 2, y: part.h * PLATE_HEIGHT, z: part.d / 2 } };
  const [x, z] = [(min.x + max.x) / 2 - pivot.at.x, (min.z + max.z) / 2 - pivot.at.z];
  // how far up a turn about the pivot, the way it points, takes the part's middle: the upright part of pivot × (pivot to middle)
  const lift = pivot.axis.z * x - pivot.axis.x * z;
  if (Math.abs(lift) < TO_ONE_SIDE) return null;
  const way = rotateBy(turn, pivot.axis);
  return lift > 0 ? way : { x: -way.x, y: -way.y, z: -way.z };
}

function overlaps(a: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }, b: typeof a, margin: number): boolean {
  return a.x0 - margin <= b.x1 && b.x0 - margin <= a.x1 && a.y0 - margin <= b.y1 && b.y0 - margin <= a.y1 && a.z0 - margin <= b.z1 && b.z0 - margin <= a.z1;
}

/** Whether two bricks on the grid stand one on the other, their footprints overlapping: held together by studs. */
function stacked(a: Brick, b: Brick, lookup: PartLookup): boolean {
  if (!isOnGrid(a) || !isOnGrid(b)) return false;
  const [p, q] = [brickCellBox(a, lookup), brickCellBox(b, lookup)];
  const footprints = Math.min(p.x1, q.x1) > Math.max(p.x0, q.x0) && Math.min(p.z1, q.z1) > Math.max(p.z0, q.z0);
  return footprints && (p.y1 === q.y0 || q.y1 === p.y0);
}

type Box = ReturnType<typeof brickCellBox>;

/**
 * The connections of the bricks that may be plugged into `brick`: of those
 * of `others` whose boxes come within a cell of its own, itself left out.
 */
export function connectionsAround(brick: Brick, others: Iterable<Brick>, lookup: PartLookup): WorldConnector[] {
  const box = brickCellBox(brick, lookup);
  const found: WorldConnector[] = [];
  for (const other of others) {
    if (other.id === brick.id || !lookup(other.partId)?.connectors?.length) continue;
    if (overlaps(brickCellBox(other, lookup), box, 1)) found.push(...brickConnectors(other, lookup));
  }
  return found;
}

/**
 * A connection of the group's, with the box of the part it is on, whether
 * that part is loose (plugged in, not standing on the grid), and the way
 * about it that turns the part up, if it hangs to one side of it
 * (liftingWay).
 */
interface Own {
  readonly connector: WorldConnector;
  readonly box: Box;
  readonly loose: boolean;
  readonly lifts: Vec3 | null;
}

/** A connection of the group's (as Own) plugged into one of another brick's. */
interface Plugged extends Own {
  readonly theirs: WorldConnector;
}

/** The group's connections that are plugged into `other`'s. */
function pluggedInto(own: readonly Own[], other: Brick, lookup: PartLookup): Plugged[] {
  if (!lookup(other.partId)?.connectors?.length) return [];
  const box = brickCellBox(other, lookup);
  // a cell's margin either way: plugged-in parts reach into each other's boxes
  const near = own.filter((mine) => overlaps(mine.box, box, 1));
  if (near.length === 0) return [];
  return brickConnectors(other, lookup).flatMap((theirs) => near.filter(({ connector }) => engaged(connector, theirs)).map((mine) => ({ ...mine, theirs })));
}

/**
 * The joints of the older hinges and of the turntables: a hinge brick's top
 * in its base, a turntable's top on its base, a car roof on its holder, the
 * two plates of a folding hinge plate, a control stick in its base, the
 * halves of a 1 × 8 hinge brick. LDraw draws them with plain shapes, so
 * each is set by hand on the file that draws its half
 * (scripts/ldraw/hingeJoints.ts): at rest one half goes onto the other as
 * those are drawn. The halves are parts to build on in their own right,
 * and sit in or over each other's cells.
 */
export const SET_JOINTS: readonly ConnectorKind[] = [
  'hingebase',
  'hingetop',
  'swivelbase',
  'swiveltop',
  'turnbase',
  'turntop',
  'turnbase4',
  'turntop4',
  'turnflat',
  'turnsnap',
  'fingers4',
  'fingers5',
  'foldbase',
  'foldtop',
  'stickbase',
  'stick',
  'tongue',
  'yoke',
];

/** How far a part's top may rise above its cells, in plates: the library build fits parts into cells so (scripts/ldraw/fit.ts). */
const TOP_RISE = 0.25;

/** Whether a brick on the grid stands on a part with this box: over it, its underside at the box's top, or as far above as that part's top may rise. */
function standsOn(brick: Brick, box: Box, lookup: PartLookup): boolean {
  if (!isOnGrid(brick)) return false;
  const own = brickCellBox(brick, lookup);
  const above = own.y0 - box.y1;
  const isOver = Math.min(own.x1, box.x1) > Math.max(own.x0, box.x0) && Math.min(own.z1, box.z1) > Math.max(own.z0, box.z0);
  return isOver && above > -1e-6 && above < TOP_RISE + 1e-6;
}

/**
 * How `group` hangs on the other bricks (`others`, which may include the
 * group's own, skipped by id): the line it swings about, and which way
 * round (see Hold, liftingWay), when everything plugging it to them turns
 * freely about that one line, and no studs hold it too: another brick's,
 * or the baseplate's, for a brick on the grid at ground level, which turns
 * on the grid as it always has. One case is not studs though it looks it:
 * the cells of a hinge's or a turntable's base reach up round its top, so
 * a brick standing on a top plugged in there stands on the base's cells
 * too; with the top, it swings.
 */
export function holdOf(group: readonly Brick[], others: Iterable<Brick>, lookup: PartLookup): Hold {
  const ids = new Set(group.map((brick) => brick.id));
  const own = group.flatMap((brick): Own[] => {
    const part = lookup(brick.partId);
    const pivots = part?.connectors ?? [];
    if (!part || pivots.length === 0) return [];
    const box = brickCellBox(brick, lookup);
    const loose = isLoose(brick);
    const turn = brickTurn(brick);
    return brickConnectors(brick, lookup).flatMap((connector, i): Own[] => {
      const pivot = pivots[i];
      return pivot ? [{ connector, box, loose, lifts: liftingWay(part, pivot, turn) }] : [];
    });
  });
  if (own.length === 0) return { kind: 'none' };
  const pairs: Plugged[] = [];
  let studded = group.some((brick) => isOnGrid(brick) && brick.y === 0);
  for (const other of others) {
    if (ids.has(other.id)) continue;
    const plugged = pluggedInto(own, other, lookup);
    pairs.push(...plugged);
    // the group's tops plugged into this brick: what stands on one of them is not on this brick's studs
    const tops = plugged.filter((pair) => pair.loose && SET_JOINTS.includes(pair.connector.kind)).map((pair) => pair.box);
    studded ||= group.some((brick) => stacked(brick, other, lookup) && !tops.some((top) => standsOn(brick, top, lookup)));
  }
  const [first] = pairs;
  if (!first) return { kind: 'none' };
  const free = !studded && pairs.every(({ connector, theirs }) => turnsFreely(connector.kind, theirs.kind) && onOneLine(first.theirs, theirs));
  if (!free) return { kind: 'rigid' };
  const lifting = pairs.find(({ lifts }) => lifts !== null);
  return { kind: 'joint', axis: lifting?.lifts ?? canonicalAxis(first.theirs.axis), pivot: first.theirs.at };
}
