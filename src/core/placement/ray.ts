import { PLATE_HEIGHT, type Vec3 } from '../grid';
import { brickOrigin, brickTurn, brickWorldBoxes, isLoose, partLocalBoxes, requirePart, type Aabb } from '../model/geometry';
import { rotateBy, transposeTurn } from '../orientation';
import type { Brick } from '../model/types';
import type { PartDef, PartLookup } from '../parts/types';

export interface Ray {
  readonly origin: Vec3;
  readonly dir: Vec3;
}

export interface Hit {
  readonly kind: 'brick' | 'ground';
  readonly brickId: string | null;
  readonly point: Vec3;
  /** Axis-aligned normal of the face that was hit. */
  readonly normal: Vec3;
  readonly t: number;
  /** Bottom layer (in plates) of the solid that was hit; 0 for the ground. */
  readonly base: number;
}

const EPSILON = 1e-9;
const AXES = ['x', 'y', 'z'] as const;

function axisNormal(axis: (typeof AXES)[number], sign: number): Vec3 {
  return { x: axis === 'x' ? sign : 0, y: axis === 'y' ? sign : 0, z: axis === 'z' ? sign : 0 };
}

/** Slab test returning the entry distance and face normal, or null on a miss. */
export function rayAabb(ray: Ray, box: Aabb): { t: number; normal: Vec3 } | null {
  let tNear = -Infinity;
  let tFar = Infinity;
  let normal: Vec3 | null = null;

  for (const axis of AXES) {
    const o = ray.origin[axis];
    const d = ray.dir[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];
    if (Math.abs(d) < EPSILON) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const t1 = (lo - o) / d;
    const t2 = (hi - o) / d;
    const enter = Math.min(t1, t2);
    const exit = Math.max(t1, t2);
    if (enter > tNear) {
      tNear = enter;
      normal = axisNormal(axis, d > 0 ? -1 : 1);
    }
    tFar = Math.min(tFar, exit);
    if (tNear > tFar) return null;
  }

  if (normal === null || tNear < 0) return null;
  return { t: tNear, normal };
}

/** Distance along the ray to the horizontal plane at height y, if it is ahead. */
export function rayGround(ray: Ray, y: number): number | null {
  if (Math.abs(ray.dir.y) < EPSILON) return null;
  const t = (y - ray.origin.y) / ray.dir.y;
  return t > 0 ? t : null;
}

function pointAt(ray: Ray, t: number): Vec3 {
  return {
    x: ray.origin.x + ray.dir.x * t,
    y: ray.origin.y + ray.dir.y * t,
    z: ray.origin.z + ray.dir.z * t,
  };
}

/** Horizontal area (in studs) where the ground can be built on; omit for unlimited ground. */
export interface GroundBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface PickOptions {
  /** Height of the ground plane, or null for no ground. */
  readonly groundY: number | null;
  readonly groundBounds?: GroundBounds | null;
  readonly exclude?: ReadonlySet<string>;
}

function insideBounds(point: Vec3, bounds: GroundBounds | null | undefined): boolean {
  if (!bounds) return true;
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.z >= bounds.minZ && point.z <= bounds.maxZ;
}

/** The axis a vector points most along, as a unit vector: a turned face's normal, squared up for placing against. */
function nearestAxis(v: Vec3): Vec3 {
  const [ax, ay, az] = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
  if (ay >= ax && ay >= az) return { x: 0, y: Math.sign(v.y) || 1, z: 0 };
  if (ax >= az) return { x: Math.sign(v.x) || 1, y: 0, z: 0 };
  return { x: 0, y: 0, z: Math.sign(v.z) || 1 };
}

/** The part of a box inside another; null when they don't meet. */
function clipBox(box: Aabb, to: Aabb): Aabb | null {
  const min = { x: Math.max(box.min.x, to.min.x), y: Math.max(box.min.y, to.min.y), z: Math.max(box.min.z, to.min.z) };
  const max = { x: Math.min(box.max.x, to.max.x), y: Math.min(box.max.y, to.max.y), z: Math.min(box.max.z, to.max.z) };
  return min.x < max.x && min.y < max.y && min.z < max.z ? { min, max } : null;
}

/**
 * The boxes a part's shape is picked by, in its own frame: the cells it
 * fills, cut down to the shape it really fills when the library says
 * (PartDef.extent), so a bar is found by its rod and not its whole cell.
 */
function shapeBoxes(part: PartDef): Aabb[] {
  const cells = partLocalBoxes(part);
  const { extent } = part;
  if (!extent) return cells;
  const clipped = cells.flatMap((box) => clipBox(box, extent) ?? []);
  return clipped.length > 0 ? clipped : cells;
}

/** The nearest of some boxes along a ray: how far, and the normal of the face the ray comes in by. */
function nearestOf(local: Ray, boxes: readonly Aabb[]): { t: number; normal: Vec3 } | null {
  let best: { t: number; normal: Vec3 } | null = null;
  for (const box of boxes) {
    const hit = rayAabb(local, box);
    if (hit && (best === null || hit.t < best.t)) best = hit;
  }
  return best;
}

/** A ray in a brick's own frame, where its part's boxes are square to the axes. */
function seenFrom(ray: Ray, brick: Brick, lookup: PartLookup): Ray {
  const back = transposeTurn(brickTurn(brick));
  const origin = brickOrigin(brick, lookup);
  return {
    origin: rotateBy(back, { x: ray.origin.x - origin.x, y: ray.origin.y - origin.y, z: ray.origin.z - origin.z }),
    dir: rotateBy(back, ray.dir),
  };
}

/** How far along a ray a brick's shape is (shapeBoxes), turned as the brick is; null when the ray misses it. */
function rayShape(ray: Ray, brick: Brick, lookup: PartLookup): number | null {
  return nearestOf(seenFrom(ray, brick, lookup), shapeBoxes(requirePart(lookup, brick.partId)))?.t ?? null;
}

/** A loose part under a ray: how far along the ray its shape is, and the hit to work with. */
interface LooseHit {
  readonly shape: number;
  readonly hit: Hit;
}

/**
 * Where a ray meets a loose part. It is found by its shape, so a bar by its
 * rod and not its whole cell; the place given is where the ray comes into
 * its cells, the face squared up, for parts are placed against cells: a
 * brick built at a bar goes beside the bar's cell, not half into it.
 */
function rayLoose(ray: Ray, brick: Brick, lookup: PartLookup): LooseHit | null {
  const part = requirePart(lookup, brick.partId);
  const local = seenFrom(ray, brick, lookup);
  const shape = nearestOf(local, shapeBoxes(part));
  if (!shape) return null;
  // from inside its cells there is no way in: the shape itself, then
  const cells = part.extent ? (nearestOf(local, partLocalBoxes(part)) ?? shape) : shape;
  const point = pointAt(ray, cells.t);
  const normal = nearestAxis(rotateBy(brickTurn(brick), cells.normal));
  return { shape: shape.t, hit: { kind: 'brick', brickId: brick.id, t: cells.t, normal, point, base: Math.round(point.y / PLATE_HEIGHT) } };
}

/** Where a ray first meets a brick on the grid: the cells it fills, as bricks there have always been found. */
function rayCells(ray: Ray, brick: Brick, lookup: PartLookup): Hit | null {
  let best: { t: number; normal: Vec3; base: number } | null = null;
  for (const box of brickWorldBoxes(brick, lookup)) {
    const hit = rayAabb(ray, box);
    if (hit && (best === null || hit.t < best.t)) best = { t: hit.t, normal: hit.normal, base: Math.round(box.min.y / PLATE_HEIGHT) };
  }
  return best && { kind: 'brick', brickId: brick.id, point: pointAt(ray, best.t), ...best };
}

/** Hits this close along the ray are at one place: a part plugged into another shares faces with its box. */
const SAME_PLACE = 1e-6;

/**
 * The nearest brick under a ray. Bricks on the grid are found by their
 * cells, the nearest first; a loose part before them wherever none of them
 * really stands in front of it: where its shape meets the ray no farther
 * than the shape any of them fills (PartDef.extent), which may be well
 * inside its cells. So a turntable's top is found in its base, whose cells
 * it lies within, and a hinge's on its base, where the two meet the ray
 * together.
 */
function nearestBrick(ray: Ray, bricks: Iterable<Brick>, lookup: PartLookup, exclude: ReadonlySet<string> | undefined): Hit | null {
  let onGrid: Hit | null = null;
  let loose: LooseHit | null = null;
  // how near the ray comes to what a brick on the grid really fills
  let filled = Infinity;
  for (const brick of bricks) {
    if (exclude?.has(brick.id)) continue;
    if (isLoose(brick)) {
      const found = rayLoose(ray, brick, lookup);
      if (found && (loose === null || found.shape < loose.shape - SAME_PLACE)) loose = found;
      continue;
    }
    const hit = rayCells(ray, brick, lookup);
    if (!hit) continue;
    if (onGrid === null || hit.t < onGrid.t) onGrid = hit;
    // its shape lies within its cells, so only a brick whose cells the ray meets can stand in the way
    filled = Math.min(filled, requirePart(lookup, brick.partId).extent ? (rayShape(ray, brick, lookup) ?? Infinity) : hit.t);
  }
  return loose !== null && loose.shape <= filled + SAME_PLACE ? loose.hit : onGrid;
}

/** Finds the closest brick face (or the ground) under a ray. */
export function pickBricks(
  ray: Ray,
  bricks: Iterable<Brick>,
  lookup: PartLookup,
  options: PickOptions,
): Hit | null {
  let best = nearestBrick(ray, bricks, lookup, options.exclude);
  if (options.groundY !== null) {
    const t = rayGround(ray, options.groundY);
    if (t !== null && (best === null || t < best.t)) {
      const point = pointAt(ray, t);
      if (insideBounds(point, options.groundBounds)) {
        best = { kind: 'ground', brickId: null, t, normal: { x: 0, y: 1, z: 0 }, point, base: 0 };
      }
    }
  }
  return best;
}
