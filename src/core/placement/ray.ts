import { PLATE_HEIGHT, type Vec3 } from '../grid';
import { brickWorldBoxes, type Aabb } from '../model/geometry';
import type { Brick } from '../model/types';
import type { PartLookup } from '../parts/types';

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

/** Finds the closest brick face (or the ground) under a ray. */
export function pickBricks(
  ray: Ray,
  bricks: Iterable<Brick>,
  lookup: PartLookup,
  options: PickOptions,
): Hit | null {
  let best: Hit | null = null;
  for (const brick of bricks) {
    if (options.exclude?.has(brick.id)) continue;
    for (const box of brickWorldBoxes(brick, lookup)) {
      const hit = rayAabb(ray, box);
      if (hit && (best === null || hit.t < best.t)) {
        best = {
          kind: 'brick',
          brickId: brick.id,
          t: hit.t,
          normal: hit.normal,
          point: pointAt(ray, hit.t),
          base: Math.round(box.min.y / PLATE_HEIGHT),
        };
      }
    }
  }
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
