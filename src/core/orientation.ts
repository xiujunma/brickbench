/**
 * Which way a placed part faces: one of the 24 turns that keep a part square
 * to the grid. Each is a quarter turn about the part's own vertical (its
 * spin, 0 to 3, as parts have always turned), then the turn that points the
 * part's top along one of the six axis directions (its facing). Orientations
 * 0 to 3 face up, with their spin as their number, so a brick's `r` means
 * what it always has: 4 to 23 are parts on their sides and upside down.
 */
import type { Vec3 } from './grid';

/** 0 to 23: `facing index × 4 + spin`. */
export type Orientation = number;

export const ORIENTATIONS = 24;

/** The directions a part's top can face, in the order orientations count them. */
export const FACINGS = ['+y', '-y', '+x', '-x', '+z', '-z'] as const;
export type Facing = (typeof FACINGS)[number];

/** A 3 × 3 rotation, row by row; every entry is -1, 0 or 1. */
export type Turn = readonly [number, number, number, number, number, number, number, number, number];

/** A quarter turn about +Y, `spin` times: the turn three.js makes with `rotation.y = spin · π/2`. */
function spinTurn(spin: number): Turn {
  const c = [1, 0, -1, 0][spin] ?? 1;
  const s = [0, 1, 0, -1][spin] ?? 0;
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

/** The turn that points +Y at each facing, keeping everything else as still as it can. */
const FACING_TURNS: Readonly<Record<Facing, Turn>> = {
  '+y': [1, 0, 0, 0, 1, 0, 0, 0, 1],
  // a half turn about X
  '-y': [1, 0, 0, 0, -1, 0, 0, 0, -1],
  // a quarter turn about Z, each way
  '+x': [0, 1, 0, -1, 0, 0, 0, 0, 1],
  '-x': [0, -1, 0, 1, 0, 0, 0, 0, 1],
  // a quarter turn about X, each way
  '+z': [1, 0, 0, 0, 0, -1, 0, 1, 0],
  '-z': [1, 0, 0, 0, 0, 1, 0, -1, 0],
};

/** `a` after `b`: the rotation that turns by `b`, then by `a`. */
export function multiplyTurns(a: Turn, b: Turn): Turn {
  return multiply(a, b);
}

function multiply(a: Turn, b: Turn): Turn {
  const at = (m: Turn, row: number, col: number): number => m[row * 3 + col] ?? 0;
  const entry = (row: number, col: number): number => at(a, row, 0) * at(b, 0, col) + at(a, row, 1) * at(b, 1, col) + at(a, row, 2) * at(b, 2, col);
  return [entry(0, 0), entry(0, 1), entry(0, 2), entry(1, 0), entry(1, 1), entry(1, 2), entry(2, 0), entry(2, 1), entry(2, 2)];
}

const TURNS: readonly Turn[] = FACINGS.flatMap((facing) => [0, 1, 2, 3].map((spin) => multiply(FACING_TURNS[facing], spinTurn(spin))));

/** The rotation an orientation makes; an unknown number counts as 0. */
export function turnOf(orientation: Orientation): Turn {
  return TURNS[orientation] ?? (TURNS[0] as Turn);
}

/** Whether `value` is an orientation: a whole number from 0 to 23. */
export function isOrientation(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < ORIENTATIONS;
}

/** The orientation a rotation makes, when it is one of the 24 (entries within `tolerance` of -1, 0 or 1); null otherwise. */
export function orientationOfTurn(turn: ArrayLike<number>, tolerance = 1e-9): Orientation | null {
  for (const [orientation, candidate] of TURNS.entries()) {
    let same = true;
    for (let i = 0; i < 9 && same; i++) same = Math.abs((turn[i] ?? NaN) - (candidate[i] ?? 0)) <= tolerance;
    if (same) return orientation;
  }
  return null;
}

/** Faces up: one of the four turns parts have always had. */
export function isUpright(orientation: Orientation): boolean {
  return orientation < 4;
}

/** The quarter turns about the part's own vertical. */
export function spinOf(orientation: Orientation): number {
  return orientation % 4;
}

/** Where the part's top faces. */
export function facingOf(orientation: Orientation): Facing {
  return FACINGS[Math.floor(orientation / 4)] ?? '+y';
}

export function orientationFacing(facing: Facing, spin = 0): Orientation {
  return FACINGS.indexOf(facing) * 4 + (((spin % 4) + 4) % 4);
}

/** Applies an orientation's rotation to a vector. */
export function rotateVector(orientation: Orientation, v: Vec3): Vec3 {
  return rotateBy(turnOf(orientation), v);
}

/** Applies a rotation, given row by row, to a vector. */
export function rotateBy([a, b, c, d, e, f, g, h, i]: Turn, v: Vec3): Vec3 {
  return { x: a * v.x + b * v.y + c * v.z, y: d * v.x + e * v.y + f * v.z, z: g * v.x + h * v.y + i * v.z };
}

/** The rotation that undoes another: its transpose. */
export function transposeTurn([a, b, c, d, e, f, g, h, i]: Turn): Turn {
  return [a, d, g, b, e, h, c, f, i];
}

/** Whether nine numbers, row by row, make a rotation: rows of length 1, at right angles, not mirrored. */
export function isRotation(m: ArrayLike<number>, tolerance = 1e-3): boolean {
  if (m.length !== 9) return false;
  const row = (r: number): Vec3 => ({ x: m[r * 3] ?? NaN, y: m[r * 3 + 1] ?? NaN, z: m[r * 3 + 2] ?? NaN });
  const dot = (p: Vec3, q: Vec3): number => p.x * q.x + p.y * q.y + p.z * q.z;
  const [x, y, z] = [row(0), row(1), row(2)];
  const lengths = [dot(x, x), dot(y, y), dot(z, z)].every((l) => Math.abs(l - 1) <= tolerance);
  const square = [dot(x, y), dot(y, z), dot(x, z)].every((d) => Math.abs(d) <= tolerance);
  const cross = { x: x.y * y.z - x.z * y.y, y: x.z * y.x - x.x * y.z, z: x.x * y.y - x.y * y.x };
  return lengths && square && dot(cross, z) > 0;
}

/** A rotation squared up again (Gram-Schmidt on its rows), so rounding in files and repeated turns does not build up. */
export function orthonormalize(m: ArrayLike<number>): Turn {
  const unit = (v: Vec3): Vec3 => {
    const length = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / length, y: v.y / length, z: v.z / length };
  };
  const x = unit({ x: m[0] ?? 1, y: m[1] ?? 0, z: m[2] ?? 0 });
  const raw = { x: m[3] ?? 0, y: m[4] ?? 1, z: m[5] ?? 0 };
  const along = x.x * raw.x + x.y * raw.y + x.z * raw.z;
  const y = unit({ x: raw.x - along * x.x, y: raw.y - along * x.y, z: raw.z - along * x.z });
  const z = { x: x.y * y.z - x.z * y.y, y: x.z * y.x - x.x * y.z, z: x.x * y.y - x.y * y.x };
  // + 0 turns -0 into 0
  return [x.x + 0, x.y + 0, x.z + 0, y.x + 0, y.y + 0, y.z + 0, z.x + 0, z.y + 0, z.z + 0];
}

/** A turn by `angle` radians about a unit axis, counter-clockwise looking down the axis from its tip. */
export function turnAbout(axis: Vec3, angle: number): Turn {
  const { x, y, z } = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

/** The one of the 24 orientations closest to a rotation: the one that turns least from it. */
export function nearestOrientation(turn: Turn): Orientation {
  let best: Orientation = 0;
  let bestTrace = -Infinity;
  for (const [orientation, candidate] of TURNS.entries()) {
    // trace(candidateᵀ · turn): the larger, the smaller the turn between them
    let trace = 0;
    for (let i = 0; i < 9; i++) trace += (candidate[i] ?? 0) * (turn[i] ?? 0);
    if (trace > bestTrace + 1e-9) {
      bestTrace = trace;
      best = orientation;
    }
  }
  return best;
}

/** `outer` after `inner`: the orientation of a part turned by `inner`, then by `outer`. */
export function compose(outer: Orientation, inner: Orientation): Orientation {
  return orientationOfTurn(multiply(turnOf(outer), turnOf(inner))) ?? 0;
}

/** The turn that undoes an orientation. */
export function inverse(orientation: Orientation): Orientation {
  const [a, b, c, d, e, f, g, h, i] = turnOf(orientation);
  // a rotation's inverse is its transpose
  return orientationOfTurn([a, d, g, b, e, h, c, f, i]) ?? 0;
}

/** The unit vector a facing points along. */
export function facingVector(facing: Facing): Vec3 {
  const sign = facing[0] === '-' ? -1 : 1;
  return { x: facing[1] === 'x' ? sign : 0, y: facing[1] === 'y' ? sign : 0, z: facing[1] === 'z' ? sign : 0 };
}

/** The facing an axis-aligned vector points along; null when it points between axes. */
export function facingOfVector(v: Vec3, tolerance = 1e-6): Facing | null {
  for (const facing of FACINGS) {
    const f = facingVector(facing);
    if (Math.abs(v.x - f.x) <= tolerance && Math.abs(v.y - f.y) <= tolerance && Math.abs(v.z - f.z) <= tolerance) return facing;
  }
  return null;
}

/** A quarter turn about a world axis, `dir` = 1 counter-clockwise looking down the axis from its positive end. */
export function quarterTurn(axis: 'x' | 'y' | 'z', dir: 1 | -1): Orientation {
  const s = dir;
  const turn: Turn =
    axis === 'x' ? [1, 0, 0, 0, 0, -s, 0, s, 0] : axis === 'y' ? [0, 0, s, 0, 1, 0, -s, 0, 0] : [0, -s, 0, s, 0, 0, 0, 0, 1];
  return orientationOfTurn(turn) ?? 0;
}
