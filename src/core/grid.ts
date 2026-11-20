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

/** Bricks stand on whole studs, or half a stud over, as on the stud of a jumper plate. */
export const STUD_STEP = 0.5;

/** Whether x (or z) is a place a brick can stand: a whole or half stud. */
export function isStudPosition(value: number): boolean {
  return Number.isInteger(value / STUD_STEP);
}

/** LDraw units in a stud along x and z, and in a plate along y: parts off the cell grid stand on this lattice. */
export const LDU_PER_STUD_STEP = 20;
export const LDU_PER_PLATE_STEP = 8;

/** Whether `value`, counted in units of `ldu` LDraw units each, falls on a whole LDraw unit (floating-point noise aside). */
export function onLduLattice(value: number, ldu: number): boolean {
  const scaled = value * ldu;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/** `value` moved onto the nearest whole LDraw unit, counted in units of `ldu` LDraw units each, without floating-point noise. */
export function snapToLdu(value: number, ldu: number): number {
  return cleanZero(Math.round(value * ldu) / ldu);
}

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

/** Turns -0 into 0 so grid coordinates compare and serialise cleanly. */
export function cleanZero(n: number): number {
  return n === 0 ? 0 : n;
}

export function normalizeRotation(value: number): Rotation {
  return (((Math.trunc(value) % 4) + 4) % 4) as Rotation;
}
