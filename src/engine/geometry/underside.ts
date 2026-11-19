/**
 * The undersides of the basic parts, as on real bricks: open, with walls
 * 1.2 mm thick under a 1 mm top, and tubes between every four studs (on
 * 1 × n parts, pins between every two). Sizes are in stud pitches (8 mm).
 * Picking and collision don't see any of this: they use the cells a part fills.
 */
import { ShapeUtils, Vector2 } from 'three';
import type { MeshBuilder, V3 } from './meshBuilder';
import type { PathPoint } from './path';
import { revolve } from './revolve';

/** Side walls, 1.2 mm. */
export const WALL = 0.15;
/** The top, 1 mm. */
export const TOP = 0.125;
/** Tubes: 6.51 mm across, with a 4.8 mm hole. */
export const TUBE_OUTER = 0.407;
export const TUBE_INNER = 0.3;
/** Pins under 1 × n parts, 3 mm across. */
export const PIN_RADIUS = 0.1875;
/** Sides of a tube: few, as big plates have hundreds and are drawn many times over. */
const TUBE_SEGMENTS = 12;
/** A tube or pin shorter than this would only be a ring on the floor: it is left out. */
const MIN_TUBE = 0.05;
/** A cavity smaller than this (in its cross-section) is not worth the triangles: the part stays solid. */
const MIN_CAVITY_AREA = 0.02;
const ON_FLOOR = 1e-6;
const DOWN: V3 = [0, -1, 0];

/** A point in a cross-section: u across, v up. */
export type P2 = readonly [number, number];

export interface TubeSpots {
  readonly tubes: readonly P2[];
  readonly pins: readonly P2[];
}

/** Where a w × d part has tubes (between four studs) or pins (between two, on 1 × n parts), centred on the part. */
export function tubeSpots(w: number, d: number): TubeSpots {
  const tubes: P2[] = [];
  const pins: P2[] = [];
  if (w >= 2 && d >= 2) {
    for (let i = 1; i < w; i++) for (let j = 1; j < d; j++) tubes.push([i - w / 2, j - d / 2]);
  } else if (w >= 2) {
    for (let i = 1; i < w; i++) pins.push([i - w / 2, 0]);
  } else {
    for (let j = 1; j < d; j++) pins.push([0, j - d / 2]);
  }
  return { tubes, pins };
}

const at = (u: number, v: number, nu: number, nv: number): PathPoint => ({ u, v, nu, nv });

/** A tube standing on the floor at (x, z), up to `top`: outer wall, the ring it stands on, and the hole's wall. */
export function addTube(builder: MeshBuilder, x: number, z: number, top: number): void {
  if (top < MIN_TUBE) return;
  const profile = [
    at(TUBE_OUTER, top, 1, 0),
    at(TUBE_OUTER, 0, 1, 0),
    at(TUBE_OUTER, 0, 0, -1),
    at(TUBE_INNER, 0, 0, -1),
    at(TUBE_INNER, 0, -1, 0),
    at(TUBE_INNER, top, -1, 0),
  ];
  revolve(builder, profile, TUBE_SEGMENTS, [x, 0, z]);
}

/** A solid pin standing on the floor at (x, z), up to `top`. */
export function addPin(builder: MeshBuilder, x: number, z: number, top: number): void {
  if (top < MIN_TUBE) return;
  revolve(builder, [at(PIN_RADIUS, top, 1, 0), at(PIN_RADIUS, 0, 1, 0), at(PIN_RADIUS, 0, 0, -1), at(0, 0, 0, -1)], TUBE_SEGMENTS, [x, 0, z]);
}

/** The floor between an opening's edge and a hole in it, facing down: the rim a hollow part stands on. */
export function addRim(builder: MeshBuilder, outer: readonly Vector2[], hole: readonly Vector2[], toWorld: (p: Vector2) => V3): void {
  const contour = outer.map((p) => p.clone());
  const holes = [hole.map((p) => p.clone())];
  const faces = ShapeUtils.triangulateShape(contour, holes);
  const indices = [...contour, ...(holes[0] ?? [])].map((p) => builder.vertex(toWorld(p), DOWN));
  for (const [a, b, c] of faces) builder.triangle(indices[a!]!, indices[b!]!, indices[c!]!);
}

/** A rectangle of floor: x from x0 to x1, z from z0 to z1. */
export interface FloorRect {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

const rectangle = (u0: number, v0: number, u1: number, v1: number): Vector2[] => [new Vector2(u0, v0), new Vector2(u1, v0), new Vector2(u1, v1), new Vector2(u0, v1)];
const outlineOf = (r: FloorRect): Vector2[] => rectangle(r.x0, r.z0, r.x1, r.z1);
const onTheFloor = (p: Vector2): V3 => [p.x, 0, p.y];

/** A cavity's walls, facing in, and its ceiling, facing down, over a rectangle of floor. */
function addCavity(builder: MeshBuilder, floor: FloorRect, ceiling: number): void {
  const corners: V3[] = [
    [floor.x0, 0, floor.z0],
    [floor.x1, 0, floor.z0],
    [floor.x1, 0, floor.z1],
    [floor.x0, 0, floor.z1],
  ];
  // each wall faces into the cavity
  const inward: V3[] = [
    [0, 0, 1],
    [-1, 0, 0],
    [0, 0, -1],
    [1, 0, 0],
  ];
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % 4]!;
    const n = inward[i]!;
    builder.quad(builder.vertex(a, n), builder.vertex(b, n), builder.vertex([b[0], ceiling, b[2]], n), builder.vertex([a[0], ceiling, a[2]], n));
  });
  const top = corners.map(([x, , z]) => builder.vertex([x, ceiling, z], DOWN));
  builder.quad(top[0]!, top[1]!, top[2]!, top[3]!);
}

/**
 * The underside of a box part (brick, plate, tile): the rim inside the
 * opening the outer shell leaves, the inner walls and ceiling, and the
 * tubes or pins.
 */
export function addBoxUnderside(builder: MeshBuilder, w: number, d: number, outerHalf: P2, height: number, opening: readonly Vector2[]): void {
  const cavity: FloorRect = { x0: -(outerHalf[0] - WALL), x1: outerHalf[0] - WALL, z0: -(outerHalf[1] - WALL), z1: outerHalf[1] - WALL };
  const ceiling = height - TOP;
  addRim(builder, opening, outlineOf(cavity), onTheFloor);
  addCavity(builder, cavity, ceiling);
  const { tubes, pins } = tubeSpots(w, d);
  for (const [x, z] of tubes) addTube(builder, x, z, ceiling);
  for (const [x, z] of pins) addPin(builder, x, z, ceiling);
}

/** The underside of a column standing on its own, such as an arch's leg: a hollow like a 1 × 1 brick's, without a tube. */
export function addColumnUnderside(builder: MeshBuilder, opening: FloorRect, cavity: FloorRect, ceiling: number): void {
  addRim(builder, outlineOf(opening), outlineOf(cavity), onTheFloor);
  addCavity(builder, cavity, ceiling);
}

/** Keeps the part of a convex polygon where a·u + b·v ≤ c (one Sutherland–Hodgman step). */
function clip(polygon: readonly P2[], a: number, b: number, c: number): P2[] {
  const out: P2[] = [];
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length]!;
    const fp = a * p[0] + b * p[1] - c;
    const fq = a * q[0] + b * q[1] - c;
    if (fp <= 0) out.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  });
  return out;
}

function area(polygon: readonly P2[]): number {
  return Math.abs(polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length]!;
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;
}

const onTheFloorEdge = (p: P2, q: P2): boolean => Math.abs(p[1]) < ON_FLOOR && Math.abs(q[1]) < ON_FLOOR;

/**
 * The cavity under a convex cross-section (counter-clockwise, floor at
 * v = 0): every edge moved in by the wall, the top (v = height) by the top's
 * thickness, and the edges `kept` (the floor, open; a lathe's axis) left
 * where they are. Null when too small to hollow.
 */
export function cavityOf(section: readonly P2[], height: number, kept: (p: P2, q: P2) => boolean = onTheFloorEdge): P2[] | null {
  const far = 1e3;
  let cavity: P2[] = [
    [-far, -far],
    [far, -far],
    [far, far],
    [-far, far],
  ];
  section.forEach((p, i) => {
    const q = section[(i + 1) % section.length]!;
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (length === 0) return;
    // outward normal: the right-hand side of an edge running counter-clockwise
    const nu = (q[1] - p[1]) / length;
    const nv = -(q[0] - p[0]) / length;
    const onTop = Math.abs(p[1] - height) < ON_FLOOR && Math.abs(q[1] - height) < ON_FLOOR;
    cavity = clip(cavity, nu, nv, nu * p[0] + nv * p[1] - (kept(p, q) ? 0 : onTop ? TOP : WALL));
  });
  return cavity.length >= 3 && area(cavity) >= MIN_CAVITY_AREA ? cavity : null;
}

/**
 * The inside of a lathe's cavity, spun about the axis: from the edge of its
 * floor up the wall and in along the ceiling to the axis, facing in.
 * `cavity` is in (radius, height), counter-clockwise, its floor and axis
 * edges kept by cavityOf.
 */
export function addLatheCavity(builder: MeshBuilder, cavity: readonly P2[], segments: number): void {
  const n = cavity.length;
  // where the floor meets the wall: the floor corner furthest from the axis
  const floorCorners = cavity.map((p, i) => [p, i] as const).filter(([p]) => Math.abs(p[1]) < ON_FLOOR);
  const start = floorCorners.reduce((best, item) => (item[0][0] > best[0][0] ? item : best))[1];
  const profile: PathPoint[] = [];
  for (let k = 0; k < n; k++) {
    const p = cavity[(start + k) % n]!;
    const q = cavity[(start + k + 1) % n]!;
    if (Math.abs(p[0]) < ON_FLOOR) break;
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    // into the cavity: the left-hand side of an edge running counter-clockwise
    const nu = -(q[1] - p[1]) / length;
    const nv = (q[0] - p[0]) / length;
    profile.push(at(p[0], p[1], nu, nv), at(q[0], q[1], nu, nv));
  }
  revolve(builder, profile, segments);
}

/** How far a lathe's cavity reaches out along its floor. */
export function floorReach(cavity: readonly P2[]): number {
  return Math.max(...cavity.filter(([, v]) => Math.abs(v) < ON_FLOOR).map(([u]) => u));
}

/** How high a cavity reaches at u: the top of its section there. */
export function ceilingAt(cavity: readonly P2[], u: number): number {
  let top = -Infinity;
  cavity.forEach((p, i) => {
    const q = cavity[(i + 1) % cavity.length]!;
    if (u < Math.min(p[0], q[0]) || u > Math.max(p[0], q[0])) return;
    top = Math.max(top, p[0] === q[0] ? Math.max(p[1], q[1]) : p[1] + ((u - p[0]) * (q[1] - p[1])) / (q[0] - p[0]));
  });
  return top;
}

export interface SlopeOpening {
  /** The opening in the outer shell's floor: x within ±half, z from z0 to z1. */
  readonly half: number;
  readonly z0: number;
  readonly z1: number;
}

/**
 * The underside of a slope, lofted along x: the cavity's walls and ends,
 * the rim inside the opening, and tubes or pins as tall as the cavity over
 * them allows (a flat-topped tube must stay under the sloping ceiling).
 * `cavity` is in (z, y).
 */
export function addSlopeUnderside(builder: MeshBuilder, w: number, d: number, cavity: readonly P2[], innerHalf: number, opening: SlopeOpening): void {
  cavity.forEach((p, i) => {
    const q = cavity[(i + 1) % cavity.length]!;
    if (Math.abs(p[1]) < ON_FLOOR && Math.abs(q[1]) < ON_FLOOR) return;
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    // into the cavity: the left-hand side of an edge running counter-clockwise
    const n: V3 = [0, (q[0] - p[0]) / length, -(q[1] - p[1]) / length];
    builder.quad(
      builder.vertex([-innerHalf, p[1], p[0]], n),
      builder.vertex([innerHalf, p[1], p[0]], n),
      builder.vertex([innerHalf, q[1], q[0]], n),
      builder.vertex([-innerHalf, q[1], q[0]], n),
    );
  });
  const section = cavity.map(([u, v]) => new Vector2(u, v));
  const faces = ShapeUtils.triangulateShape(section, []);
  for (const x of [-innerHalf, innerHalf]) {
    const n: V3 = [x > 0 ? -1 : 1, 0, 0];
    const indices = section.map((p) => builder.vertex([x, p.y, p.x], n));
    for (const [a, b, c] of faces) builder.triangle(indices[a!]!, indices[b!]!, indices[c!]!);
  }
  const floor = cavity.filter(([, v]) => Math.abs(v) < ON_FLOOR).map(([u]) => u);
  const cz0 = Math.min(...floor);
  const cz1 = Math.max(...floor);
  addRim(builder, rectangle(-opening.half, opening.z0, opening.half, opening.z1), rectangle(-innerHalf, cz0, innerHalf, cz1), onTheFloor);

  const standing = (z: number, radius: number): number | null =>
    z - radius >= cz0 && z + radius <= cz1 ? Math.min(ceilingAt(cavity, z - radius), ceilingAt(cavity, z + radius)) : null;
  const { tubes, pins } = tubeSpots(w, d);
  for (const [x, z] of tubes) {
    const top = standing(z, TUBE_OUTER);
    if (top !== null) addTube(builder, x, z, top);
  }
  for (const [x, z] of pins) {
    const top = standing(z, PIN_RADIUS);
    if (top !== null) addPin(builder, x, z, top);
  }
}
