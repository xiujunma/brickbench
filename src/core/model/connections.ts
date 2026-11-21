/**
 * Where placed parts' Technic and click-hinge connections are, which plug
 * into each other, and the joints a group of parts hangs by: the line it
 * can swing about when every connection holding it turns freely about one.
 */
import type { Vec3 } from '../grid';
import { rotateBy, type Turn } from '../orientation';
import type { Connector, ConnectorKind, PartLookup } from '../parts/types';
import { brickCellBox, brickOrigin, brickTurn, isLoose, isOnGrid, type PlacedPart } from './geometry';
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

/** How a group of parts is held by the rest: by joints on one line it can swing about, rigidly, or not by any connection. */
export type Hold = { readonly kind: 'joint'; readonly axis: Vec3; readonly pivot: Vec3 } | { readonly kind: 'rigid' } | { readonly kind: 'none' };

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

/** A connection of the group's, with the box of the part it is on, and whether that part is loose: plugged in, not standing on the grid. */
interface Own {
  readonly connector: WorldConnector;
  readonly box: Box;
  readonly loose: boolean;
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

/** The halves of joints that sit one within the other's cells: a hinge brick's top in its base, a turntable's top on its base. */
const NESTED: readonly ConnectorKind[] = ['hingebase', 'hingetop', 'swivelbase', 'swiveltop', 'turnbase', 'turntop', 'turnbase4', 'turntop4', 'turnflat', 'turnsnap'];

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
 * group's own, skipped by id): the line it swings about when everything
 * plugging it to them turns freely about that one line, and no studs hold
 * it too: another brick's, or the baseplate's, for a brick on the grid at
 * ground level, which turns on the grid as it always has. One case is not
 * studs though it looks it: the cells of a hinge's or a turntable's base
 * reach up round its top, so a brick standing on a top plugged in there
 * stands on the base's cells too; with the top, it swings.
 */
export function holdOf(group: readonly Brick[], others: Iterable<Brick>, lookup: PartLookup): Hold {
  const ids = new Set(group.map((brick) => brick.id));
  const own = group.flatMap((brick): Own[] => {
    const box = brickCellBox(brick, lookup);
    const loose = isLoose(brick);
    return brickConnectors(brick, lookup).map((connector) => ({ connector, box, loose }));
  });
  if (own.length === 0) return { kind: 'none' };
  const pairs: Plugged[] = [];
  let studded = group.some((brick) => isOnGrid(brick) && brick.y === 0);
  for (const other of others) {
    if (ids.has(other.id)) continue;
    const plugged = pluggedInto(own, other, lookup);
    pairs.push(...plugged);
    // the group's tops plugged into this brick: what stands on one of them is not on this brick's studs
    const tops = plugged.filter((pair) => pair.loose && NESTED.includes(pair.connector.kind)).map((pair) => pair.box);
    studded ||= group.some((brick) => stacked(brick, other, lookup) && !tops.some((top) => standsOn(brick, top, lookup)));
  }
  const [first] = pairs;
  if (!first) return { kind: 'none' };
  const free = !studded && pairs.every(({ connector, theirs }) => turnsFreely(connector.kind, theirs.kind) && onOneLine(first.theirs, theirs));
  return free ? { kind: 'joint', axis: first.theirs.axis, pivot: first.theirs.at } : { kind: 'rigid' };
}
