/**
 * Where placed parts' Technic and click-hinge connections are, which plug
 * into each other, and the joints a group of parts hangs by: the line it
 * can swing about when every connection holding it turns freely about one.
 */
import type { Vec3 } from '../grid';
import { rotateBy, type Turn } from '../orientation';
import type { Connector, ConnectorKind, PartLookup } from '../parts/types';
import { brickCellBox, brickOrigin, brickTurn, isOnGrid, type PlacedPart } from './geometry';
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

function isPair(a: ConnectorKind, b: ConnectorKind, p: ConnectorKind, q: ConnectorKind): boolean {
  return (a === p && b === q) || (a === q && b === p);
}

/**
 * What plugs into what: a pin into a pin hole, an axle into either kind of
 * hole, a hinge's single finger into a fork, and a minifigure's head on its
 * neck, hips under its waist, legs on the hips, arms at its shoulders and
 * hands at its wrists, and a bar in a clip, a minifigure's hand or an open
 * stud.
 */
export function mates(a: ConnectorKind, b: ConnectorKind): boolean {
  const pairs: readonly (readonly [ConnectorKind, ConnectorKind])[] = [
    ['pin', 'pinhole'],
    ['axle', 'pinhole'],
    ['axle', 'axlehole'],
    ['finger', 'fork'],
    ['neck', 'head'],
    ['waist', 'hips'],
    ['hip', 'leg'],
    ['shoulder', 'arm'],
    ['wrist', 'hand'],
    ['bar', 'clip'],
    ['bar', 'barhole'],
  ];
  return pairs.some(([p, q]) => isPair(a, b, p, q));
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

/**
 * How `group` hangs on the other bricks (`others`, which may include the
 * group's own, skipped by id): the line it swings about when everything
 * plugging it to them turns freely about that one line, and no studs hold
 * it too: another brick's, or the baseplate's, for a brick on the grid at
 * ground level, which turns on the grid as it always has.
 */
export function holdOf(group: readonly Brick[], others: Iterable<Brick>, lookup: PartLookup): Hold {
  const ids = new Set(group.map((brick) => brick.id));
  const own = group.flatMap((brick) => brickConnectors(brick, lookup).map((connector) => ({ connector, box: brickCellBox(brick, lookup) })));
  if (own.length === 0) return { kind: 'none' };
  const pairs: { readonly mine: WorldConnector; readonly theirs: WorldConnector }[] = [];
  let studded = group.some((brick) => isOnGrid(brick) && brick.y === 0);
  for (const other of others) {
    if (ids.has(other.id)) continue;
    studded ||= group.some((brick) => stacked(brick, other, lookup));
    if (!lookup(other.partId)?.connectors?.length) continue;
    const box = brickCellBox(other, lookup);
    // a cell's margin either way: plugged-in parts reach into each other's boxes
    const near = own.filter((mine) => overlaps(mine.box, box, 1));
    if (near.length === 0) continue;
    for (const theirs of brickConnectors(other, lookup)) {
      for (const { connector: mine } of near) if (engaged(mine, theirs)) pairs.push({ mine, theirs });
    }
  }
  const [first] = pairs;
  if (!first) return { kind: 'none' };
  const free = !studded && pairs.every(({ mine, theirs }) => turnsFreely(mine.kind, theirs.kind) && onOneLine(first.theirs, theirs));
  return free ? { kind: 'joint', axis: first.theirs.axis, pivot: first.theirs.at } : { kind: 'rigid' };
}
