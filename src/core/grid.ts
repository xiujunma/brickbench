/**
 * Grid and unit conventions shared by the whole editor.
 *
 * World units: 1 unit = one stud pitch (8 mm). Bricks snap to whole studs on
 * X/Z and to whole plates (3.2 mm) on Y. A standard brick is three plates tall.
 */
export const PLATE_HEIGHT = 0.4;
export const PLATES_PER_BRICK = 3;
export const BRICK_HEIGHT = PLATE_HEIGHT * PLATES_PER_BRICK;
export const STUD_RADIUS = 0.3;
export const STUD_HEIGHT = 0.2;

/** LDraw units (LDU) per world unit (one stud pitch). */
export const LDU_PER_UNIT = 20;

/** Bricks must stay within ±GRID_LIMIT studs horizontally and 0..MAX_LAYER plates vertically. */
export const GRID_LIMIT = 512;
export const MAX_LAYER = 1023;

export type Rotation = 0 | 1 | 2 | 3;

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Size2 {
  readonly w: number;
  readonly d: number;
}

/** Turns -0 into 0 so grid coordinates compare and serialise cleanly. */
export function cleanZero(n: number): number {
  return n === 0 ? 0 : n;
}

export function normalizeRotation(value: number): Rotation {
  return (((Math.trunc(value) % 4) + 4) % 4) as Rotation;
}

/** Footprint of a w×d part after r quarter turns. */
export function rotatedSize(w: number, d: number, r: Rotation): Size2 {
  return r % 2 === 0 ? { w, d } : { w: d, d: w };
}

/**
 * Maps footprint cell (lx, lz) of a w×d part to its cell index after the part
 * turns r quarter turns about +Y (the same turn as three.js `rotation.y = r·π/2`).
 */
export function rotateCell(
  lx: number,
  lz: number,
  w: number,
  d: number,
  r: Rotation,
): readonly [number, number] {
  switch (r) {
    case 0:
      return [lx, lz];
    case 1:
      return [lz, w - 1 - lx];
    case 2:
      return [w - 1 - lx, d - 1 - lz];
    case 3:
      return [d - 1 - lz, lx];
  }
}

/** Rotates a point on the XZ plane by r quarter turns about +Y. */
export function rotatePoint(x: number, z: number, r: Rotation): readonly [number, number] {
  switch (r) {
    case 0:
      return [x, z];
    case 1:
      return [z, -x];
    case 2:
      return [-x, -z];
    case 3:
      return [-z, x];
  }
}
