import { PLATE_HEIGHT, STUD_STEP, cleanZero, type Vec3 } from '../grid';
import { ON_STUDS, type StudPhase } from './grids';
import type { Payload } from './payload';
import type { Hit, Ray } from './ray';

export interface PlacementResult {
  /** Grid offset for the payload's minimum corner. */
  readonly offset: Vec3;
  readonly valid: boolean;
  /** The payload as it lands, when it lands turned (on studs facing another way; see ./attach); the payload as given otherwise. */
  readonly payload?: Payload;
}

export interface SolveOptions {
  /** How many plates a payload may be lifted to clear obstacles when stacking. */
  readonly maxLift?: number;
  /**
   * The cursor ray. When given, stacking keeps the grab point itself (not the
   * payload's bottom) under the cursor, so a dragged brick doesn't jump.
   */
  readonly ray?: Ray;
  /**
   * How far off whole studs the payload's offset sits: on a top face (the
   * studs' grid there, half a stud over on a jumper plate), and beside or
   * under a brick (its body's grid). Whole studs when absent; see offsetPhase.
   */
  readonly phase?: { readonly stack: StudPhase; readonly side: StudPhase };
}

/** The place on a grid `phase` off whole studs nearest to `value`. */
function snap(value: number, phase: number): number {
  return Math.round(value - phase) + phase;
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
function candidate(hit: Hit, payload: Payload, options: SolveOptions): { offset: Vec3; stacking: boolean } {
  const { point: p, normal: n } = hit;
  const { size, grab } = payload;
  const { stack, side } = options.phase ?? { stack: ON_STUDS, side: ON_STUDS };
  const besideX = snap(p.x - grab.x, side.x);
  const besideZ = snap(p.z - grab.z, side.z);
  const layer = Math.round(p.y / PLATE_HEIGHT);

  if (n.y > 0.5) {
    const held = (options.ray ? crossAt(options.ray, (layer + grab.y) * PLATE_HEIGHT) : null) ?? p;
    return { offset: offset(snap(held.x - grab.x, stack.x), layer, snap(held.z - grab.z, stack.z)), stacking: true };
  }
  if (n.y < -0.5) return { offset: offset(besideX, layer - size.h, besideZ), stacking: false };

  // beside a brick, line up with its courses (counted in the payload's own height) so nothing floats half a brick up
  const courses = Math.max(0, Math.floor((p.y / PLATE_HEIGHT - hit.base + 1e-6) / size.h));
  const sideY = Math.max(0, hit.base + courses * size.h);
  // faces stand on whole or half studs, as bricks do
  const faceAt = (value: number): number => Math.round(value / STUD_STEP) * STUD_STEP;
  if (Math.abs(n.x) > 0.5) {
    const face = faceAt(p.x);
    return { offset: offset(n.x > 0 ? face : face - size.w, sideY, besideZ), stacking: false };
  }
  const face = faceAt(p.z);
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
  const { offset: base, stacking } = candidate(hit, payload, options);
  if (base.y < 0) return { offset: base, valid: false };
  if (!stacking) return { offset: base, valid: isFree(base) };

  const maxLift = options.maxLift ?? DEFAULT_MAX_LIFT;
  for (let lift = 0; lift <= maxLift; lift++) {
    const lifted = { ...base, y: base.y + lift };
    if (isFree(lifted)) return { offset: lifted, valid: true };
  }
  return { offset: base, valid: false };
}
