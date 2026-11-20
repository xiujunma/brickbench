/**
 * Puts LDraw placements back on BrickBench's grid: the exact inverse of
 * the LDraw export (see ../ldraw.ts). LDraw places parts anywhere, turned
 * any way; BrickBench builds upright parts, turned in quarter turns, on
 * whole or half studs (as on a jumper plate) and whole plates.
 */
import { LDU_PER_PLATE_STEP, LDU_PER_STUD_STEP, LDU_PER_UNIT, PLATE_HEIGHT, STUD_STEP, cleanZero, snapToLdu, type Rotation } from '../../grid';
import { turnedCorner } from '../../model/geometry';
import { orientationOfTurn, rotateBy, turnOf, type Orientation, type Turn } from '../../orientation';
import type { PartDef } from '../../parts/types';
import type { M3, V3 } from './read';

/** LDraw units in a plate's height. */
const LDU_PER_PLATE = PLATE_HEIGHT * LDU_PER_UNIT;
/** How far a matrix entry may stray from 0 or ±1: editors write rounded numbers (Studio: 1.000015). */
const MATRIX_TOLERANCE = 1e-3;
/** How far off the grid a part may sit and still be on it, in LDU (about 0.2 mm): rounding, not design. */
export const GRID_TOLERANCE_LDU = 0.5;
/** The lattice offset is found to half an LDU. */
const STEPS_PER_LDU = 2;

/** The LDraw matrix of `r` quarter turns about the vertical, as the exporter writes it. */
export function turnMatrix(r: Rotation): M3 {
  const angle = (r * Math.PI) / 2;
  const c = cleanZero(Math.round(Math.cos(angle)));
  const s = cleanZero(Math.round(Math.sin(angle)));
  return [c, 0, cleanZero(-s), 0, 1, 0, s, 0, c];
}

/** LDraw's axes are ours with y and z flipped, so a turn reads as the same turn with those flips on either side. */
const FLIP = [1, -1, -1] as const;

/**
 * Which of the 24 ways a part can face a matrix turns it, upright, on a
 * side or upside down; null when it is at an angle or mirrored.
 */
export function orientationOf(matrix: M3): Orientation | null {
  const ours = matrix.map((value, i) => value * (FLIP[Math.floor(i / 3)] ?? 1) * (FLIP[i % 3] ?? 1));
  return orientationOfTurn(ours, MATRIX_TOLERANCE);
}

/** Where a brick's footprint corner (x, z, in studs) and bottom (y, in plates) land, before snapping to whole cells. */
export interface GridSpot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Where the brick for an LDraw placement of `part`, turned `r`, would sit:
 * the corner of the box it fills. LDraw's frame is ours turned half a turn
 * about X: (x, y, z) → (x, -y, -z), at 20 LDU to the stud. Null for parts
 * without an LDraw origin.
 */
export function gridSpotOf(part: PartDef, position: V3, r: Orientation | Turn): GridSpot | null {
  const origin = part.ldraw?.origin;
  if (!origin) return null;
  const [ox, oy, oz] = origin;
  // where the LDraw origin sits from the part's own (the middle of its footprint, at its bottom), once turned
  const offset = rotateBy(typeof r === 'number' ? turnOf(r) : r, { x: ox, y: oy, z: oz });
  const corner = turnedCorner(part, r);
  const x = position[0] / LDU_PER_UNIT;
  const y = -position[1] / LDU_PER_UNIT;
  const z = -position[2] / LDU_PER_UNIT;
  return { x: x - offset.x + corner.x, y: (y - offset.y + corner.y) / PLATE_HEIGHT, z: z - offset.z + corner.z };
}

/** How far the grid a model was built on sits from whole cells, along each axis, in cells. */
export interface Lattice {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The fraction of a step most values sit at: where the grid they share
 * starts. Along x and z the step is half a stud, so parts on a jumper's
 * stud share the grid of the rest.
 */
function commonOffset(values: readonly number[], lduPerCell: number, step = 1): number {
  const steps = lduPerCell * STEPS_PER_LDU * step;
  const counts = new Map<number, number>();
  for (const value of values) {
    const inSteps = value / step;
    const at = Math.round((inSteps - Math.floor(inSteps)) * steps) % steps;
    counts.set(at, (counts.get(at) ?? 0) + 1);
  }
  let best = 0;
  let most = 0;
  for (const [step, count] of counts) {
    if (count > most || (count === most && step < best)) {
      best = step;
      most = count;
    }
  }
  return (best / steps) * step;
}

/**
 * The grid most of a model's parts share. Editors place models anywhere,
 * so it need not start at LDraw's origin; parts off it are off the grid.
 */
export function latticeOf(spots: readonly GridSpot[]): Lattice {
  return {
    x: commonOffset(spots.map((s) => s.x), LDU_PER_UNIT, STUD_STEP),
    y: commonOffset(spots.map((s) => s.y), LDU_PER_PLATE),
    z: commonOffset(spots.map((s) => s.z), LDU_PER_UNIT, STUD_STEP),
  };
}

function snapAxis(value: number, offset: number, lduPerCell: number, step = 1): number | null {
  const shifted = value - offset;
  const place = Math.round(shifted / step) * step;
  return Math.abs(shifted - place) * lduPerCell <= GRID_TOLERANCE_LDU ? place : null;
}

/**
 * Where a spot sits, counted along the lattice, on the nearest whole LDraw
 * unit: where parts off the cell grid (on their sides, or between studs)
 * stand, moved at most half an LDraw unit.
 */
export function snapExactly(spot: GridSpot, lattice: Lattice): GridSpot {
  return {
    x: snapToLdu(spot.x - lattice.x, LDU_PER_STUD_STEP),
    y: snapToLdu(spot.y - lattice.y, LDU_PER_PLATE_STEP),
    z: snapToLdu(spot.z - lattice.z, LDU_PER_STUD_STEP),
  };
}

/**
 * Where a spot sits, counted along the lattice: on whole or half studs,
 * and whole plates; null when it sits off them (a quarter stud over, or
 * half a plate up).
 */
export function snapToLattice(spot: GridSpot, lattice: Lattice): GridSpot | null {
  const x = snapAxis(spot.x, lattice.x, LDU_PER_UNIT, STUD_STEP);
  const y = snapAxis(spot.y, lattice.y, LDU_PER_PLATE);
  const z = snapAxis(spot.z, lattice.z, LDU_PER_UNIT, STUD_STEP);
  return x === null || y === null || z === null ? null : { x, y, z };
}
