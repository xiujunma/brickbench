import { PLATE_HEIGHT, cleanZero, type Vec3 } from '../grid';
import type { Payload } from './payload';
import type { Hit, Ray } from './ray';

export interface PlacementResult {
  /** Grid offset for the payload's minimum corner. */
  readonly offset: Vec3;
  readonly valid: boolean;
}

export interface SolveOptions {
  /** How many plates a payload may be lifted to clear obstacles when stacking. */
  readonly maxLift?: number;
  /**
   * The cursor ray. When given, stacking keeps the grab point itself (not the
   * payload's bottom) under the cursor, so a dragged brick doesn't jump.
   */
  readonly ray?: Ray;
}

/** Where the ray crosses the horizontal plane at height y, if it does. */
function crossAt(ray: Ray, y: number): { x: number; z: number } | null {
  if (Math.abs(ray.dir.y) < 1e-9) return null;
  const t = (y - ray.origin.y) / ray.dir.y;
  return t > 0 ? { x: ray.origin.x + ray.dir.x * t, z: ray.origin.z + ray.dir.z * t } : null;
}

const DEFAULT_MAX_LIFT = 96;

function offset(x: number, y: number, z: number): Vec3 {
  return { x: cleanZero(x), y: cleanZero(y), z: cleanZero(z) };
}

/** Where the payload would go for a hit, before collision checks. */
function candidate(hit: Hit, payload: Payload, ray: Ray | undefined): { offset: Vec3; stacking: boolean } {
  const { point: p, normal: n } = hit;
  const { size, grab } = payload;
  const besideX = Math.round(p.x - grab.x);
  const besideZ = Math.round(p.z - grab.z);
  const layer = Math.round(p.y / PLATE_HEIGHT);

  if (n.y > 0.5) {
    const held = ray ? crossAt(ray, (layer + grab.y) * PLATE_HEIGHT) : null;
    const x = held ? Math.round(held.x - grab.x) : besideX;
    const z = held ? Math.round(held.z - grab.z) : besideZ;
    return { offset: offset(x, layer, z), stacking: true };
  }
  if (n.y < -0.5) return { offset: offset(besideX, layer - size.h, besideZ), stacking: false };

  // beside a brick, line up with its courses (counted in the payload's own height) so nothing floats half a brick up
  const courses = Math.max(0, Math.floor((p.y / PLATE_HEIGHT - hit.base + 1e-6) / size.h));
  const sideY = Math.max(0, hit.base + courses * size.h);
  if (Math.abs(n.x) > 0.5) {
    const face = Math.round(p.x);
    return { offset: offset(n.x > 0 ? face : face - size.w, sideY, besideZ), stacking: false };
  }
  const face = Math.round(p.z);
  return { offset: offset(besideX, sideY, n.z > 0 ? face : face - size.d), stacking: false };
}

/**
 * Snaps a payload against the face under the cursor. Parts dropped onto a
 * top face (or the ground) rise until they clear whatever is in the way;
 * parts placed beside or under a face must fit exactly where they land.
 */
export function solvePlacement(
  hit: Hit,
  payload: Payload,
  isFree: (offset: Vec3) => boolean,
  options: SolveOptions = {},
): PlacementResult {
  const { offset: base, stacking } = candidate(hit, payload, options.ray);
  if (base.y < 0) return { offset: base, valid: false };
  if (!stacking) return { offset: base, valid: isFree(base) };

  const maxLift = options.maxLift ?? DEFAULT_MAX_LIFT;
  for (let lift = 0; lift <= maxLift; lift++) {
    const lifted = { ...base, y: base.y + lift };
    if (isFree(lifted)) return { offset: lifted, valid: true };
  }
  return { offset: base, valid: false };
}
