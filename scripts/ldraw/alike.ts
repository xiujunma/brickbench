/**
 * Which of a part's connections are alike: plugged in by either, the part
 * stands as it would by the other, however it is turned, so the editor
 * counts the two as one way to plug it in (src/core/placement/connect.ts).
 * Two are alike where a quarter turn of the part about the middle of its
 * box takes its shape onto itself, every corner of its triangles onto a
 * corner of the same colour, and its connections onto its connections, the
 * one onto the other: a Technic pin's two ends, the holes at a beam's two
 * ends. A shock absorber's two ends are not, though its box and its holes
 * look the same both ways round, nor those of a beam printed at one end.
 * Corners, not triangles: a face LDraw draws as one quad across the middle
 * is split into triangles one way, and turned, it would be split the other.
 */
import { CONNECTOR_KINDS, type ConnectorEntry } from '../../src/core/ldraw/format.ts';
import { ORIENTATIONS, rotateBy, turnOf, type Turn } from '../../src/core/orientation.ts';
import type { V3 } from './parse.ts';

/** A triangle of the part's shape, in the placed part's frame (studs), and its LDraw colour. */
export interface ColouredTriangle {
  readonly a: V3;
  readonly b: V3;
  readonly c: V3;
  readonly color: number;
}

/** How near two points must be to be one, in studs: a twentieth of an LDraw unit. */
const NEAR = 2.5e-3;
/** Corners are filed in cells of this size, in studs, larger than NEAR: a corner's match is in its own cell or one of those round it. */
const CELL = 0.01;

function turnPoint(turn: Turn, middle: V3, [x, y, z]: V3): V3 {
  const { x: tx, y: ty, z: tz } = rotateBy(turn, { x: x - middle[0], y: y - middle[1], z: z - middle[2] });
  return [middle[0] + tx, middle[1] + ty, middle[2] + tz];
}

function near(a: readonly number[], b: readonly number[]): boolean {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0)) < NEAR;
}

/** The cell a point lies in, offset by `dx`, `dy` and `dz` cells, with a colour. */
function cellOf([x, y, z]: V3, color: number, dx = 0, dy = 0, dz = 0): string {
  return `${Math.floor(x / CELL) + dx},${Math.floor(y / CELL) + dy},${Math.floor(z / CELL) + dz}|${color}`;
}

/** The corners of the part's triangles, each with its triangle's colour: every one that is not another's double, and those of each cell and colour. */
interface Shape {
  readonly corners: readonly (readonly [V3, number])[];
  readonly cells: ReadonlyMap<string, readonly V3[]>;
}

function shapeOf(triangles: readonly ColouredTriangle[]): Shape {
  const corners = new Map<string, readonly [V3, number]>();
  for (const t of triangles) for (const p of [t.a, t.b, t.c]) corners.set(`${p.join(',')}|${t.color}`, [p, t.color]);
  const cells = new Map<string, V3[]>();
  for (const [p, color] of corners.values()) {
    const key = cellOf(p, color);
    cells.set(key, [...(cells.get(key) ?? []), p]);
  }
  return { corners: [...corners.values()], cells };
}

const ROUND = [-1, 0, 1];

/** Whether the shape has a corner of this colour within NEAR of a point: in the point's cell or one of the 26 round it. */
function hasCorner(shape: Shape, point: V3, color: number): boolean {
  return ROUND.some((dx) => ROUND.some((dy) => ROUND.some((dz) => (shape.cells.get(cellOf(point, color, dx, dy, dz)) ?? []).some((corner) => near(corner, point)))));
}

/** Whether a quarter turn about the middle takes every corner onto one of the shape's own, of its colour. */
function keepsShape(shape: Shape, turn: Turn, middle: V3): boolean {
  return shape.corners.every(([p, color]) => hasCorner(shape, turnPoint(turn, middle, p), color));
}

/**
 * Connections whose way says nothing, either to the part that goes on by
 * them or to one that goes on them afterwards: holes right through a part,
 * and clips. A pin goes in tip first; parts slide along an axle or a bar
 * half a stud at a time from the end its axis points away from; and a
 * hinge's or a minifigure joint's way is part of how it turns: those keep
 * theirs.
 */
const EITHER_WAY: readonly number[] = ['pinhole', 'axlehole', 'clip'].map((kind) => CONNECTOR_KINDS.indexOf(kind as (typeof CONNECTOR_KINDS)[number]));

/** Where a quarter turn about the middle takes each connection: the index of the one it lands on, or -1 where it lands on none. */
function connectionsOnto(connectors: readonly ConnectorEntry[], turn: Turn, middle: V3): number[] {
  return connectors.map(([kind, x, y, z, ax, ay, az, length]) => {
    const at = turnPoint(turn, middle, [x, y, z]);
    const axis = turnPoint(turn, [0, 0, 0], [ax, ay, az]);
    const lies = (other: readonly number[]): boolean => near(other, axis) || (EITHER_WAY.includes(kind) && near(other.map((v) => -v), axis));
    return connectors.findIndex(([otherKind, ox, oy, oz, oax, oay, oaz, otherLength]) => otherKind === kind && Math.abs(otherLength - length) < NEAR && near([ox, oy, oz], at) && lies([oax, oay, oaz]));
  });
}

/**
 * For each of the part's connections, the first of those alike with it;
 * null when none is alike with another. `triangles` and `connectors` are in
 * the placed part's frame, as `extent`, the box the whole shape fills.
 */
export function alikeConnectors(triangles: readonly ColouredTriangle[], connectors: readonly ConnectorEntry[], extent: readonly [number, number, number, number, number, number]): number[] | null {
  if (connectors.length < 2) return null;
  const [x0, y0, z0, x1, y1, z1] = extent;
  const middle: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const size: V3 = [x1 - x0, y1 - y0, z1 - z0];
  // each connection's first alike, as a forest: following `first` from one leads to it
  const first = connectors.map((_, index) => index);
  const rootOf = (index: number): number => (first[index] === index ? index : rootOf(first[index] ?? index));
  let shape: Shape | null = null;
  for (let orientation = 1; orientation < ORIENTATIONS; orientation++) {
    const turn = turnOf(orientation);
    // the box onto itself: as long along each axis turned as before
    if (!near(turnPoint(turn, [0, 0, 0], size).map(Math.abs), size)) continue;
    const onto = connectionsOnto(connectors, turn, middle);
    if (onto.includes(-1) || onto.every((to, from) => rootOf(to) === rootOf(from))) continue;
    shape ??= shapeOf(triangles);
    if (!keepsShape(shape, turn, middle)) continue;
    onto.forEach((to, from) => {
      const [a, b] = [rootOf(from), rootOf(to)];
      first[Math.max(a, b)] = Math.min(a, b);
    });
  }
  const roots = connectors.map((_, index) => rootOf(index));
  return roots.some((root, index) => root !== index) ? roots : null;
}
