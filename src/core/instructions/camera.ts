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

/** Straight-down views have no "up" to keep pictures upright, so fall back to the default angle. */
function usableDirection(direction: Vec3): Vec3 {
  const forward = normalize(direction);
  if (forward && Math.abs(forward.y) < 0.98) return forward;
  return normalize(DEFAULT_VIEW_DIRECTION) ?? DEFAULT_VIEW_DIRECTION;
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
