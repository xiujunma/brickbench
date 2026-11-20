import type { Vec3 } from '../grid';

/** Front-right, looking down at about 35°: the editor's home view. */
export const DEFAULT_VIEW_DIRECTION: Vec3 = { x: -0.5, y: -0.58, z: -0.64 };

export interface ViewFrame {
  /** Point at the centre of the picture. */
  readonly target: Vec3;
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  /** Half the visible width and height, in world units, for an orthographic camera. */
  readonly halfWidth: number;
  readonly halfHeight: number;
}

export interface FrameOptions {
  /** Breathing room around the model, as a fraction of its size. */
  readonly margin: number;
  /** Smallest half-width, so tiny models aren't blown up to fill the page. */
  readonly minHalfWidth: number;
}

const DEFAULTS: FrameOptions = { margin: 0.08, minHalfWidth: 3 };
const UP: Vec3 = { x: 0, y: 1, z: 0 };

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const add = (...vs: Vec3[]): Vec3 => vs.reduce((sum, v) => ({ x: sum.x + v.x, y: sum.y + v.y, z: sum.z + v.z }), { x: 0, y: 0, z: 0 });

function normalize(v: Vec3): Vec3 | null {
  const length = Math.hypot(v.x, v.y, v.z);
  return length > 1e-9 ? scale(v, 1 / length) : null;
}

/** Steepest a picture may look down (or up), as the y of a unit view direction: steeper, it has too little "up" to stand upright. */
export const STEEPEST_VIEW = 0.98;
/** Less than this across the ground, and a direction's heading is lost in rounding. */
const LEAST_HEADING = 1e-6;

/**
 * The direction a picture can be drawn from: `direction` at unit length,
 * tilted up to the steepest view there is (keeping its heading) if it
 * looks down more steeply. Null for no direction, or one straight up or
 * down, which has no heading to keep.
 */
export function drawableDirection(direction: Vec3): Vec3 | null {
  const forward = [direction.x, direction.y, direction.z].every(Number.isFinite) ? normalize(direction) : null;
  if (!forward) return null;
  const across = Math.hypot(forward.x, forward.z);
  if (across <= LEAST_HEADING) return null;
  if (Math.abs(forward.y) <= STEEPEST_VIEW) return forward;
  const widen = Math.sqrt(1 - STEEPEST_VIEW ** 2) / across;
  return { x: forward.x * widen, y: Math.sign(forward.y) * STEEPEST_VIEW, z: forward.z * widen };
}

/** A view without a heading has no "up" to keep pictures upright, so falls back to the default angle. */
function usableDirection(direction: Vec3): Vec3 {
  return drawableDirection(direction) ?? normalize(DEFAULT_VIEW_DIRECTION) ?? DEFAULT_VIEW_DIRECTION;
}

/**
 * Fits a box into an orthographic view along `direction` with the given
 * picture aspect (width / height), keeping the world's up direction upright.
 */
export function frameView(
  bounds: { readonly min: Vec3; readonly max: Vec3 },
  direction: Vec3,
  aspect: number,
  options: FrameOptions = DEFAULTS,
): ViewFrame {
  const forward = usableDirection(direction);
  const right = normalize(cross(forward, UP)) ?? { x: 1, y: 0, z: 0 };
  const up = cross(right, forward);

  let minR = Infinity, maxR = -Infinity, minU = Infinity, maxU = -Infinity;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const r = dot({ x, y, z }, right);
        const u = dot({ x, y, z }, up);
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
      }
    }
  }

  const centre = scale(add(bounds.min, bounds.max), 0.5);
  const target = add(scale(right, (minR + maxR) / 2), scale(up, (minU + maxU) / 2), scale(forward, dot(centre, forward)));
  let halfWidth = Math.max(((maxR - minR) / 2) * (1 + options.margin), options.minHalfWidth);
  let halfHeight = ((maxU - minU) / 2) * (1 + options.margin);
  if (halfWidth / Math.max(halfHeight, 1e-9) < aspect) halfWidth = halfHeight * aspect;
  else halfHeight = halfWidth / aspect;

  return { target, forward, right, up, halfWidth, halfHeight };
}
