import type { V3 } from './parse.ts';

/** Plate height in studs (3.2 mm / 8 mm), matching the editor grid. */
const PLATE = 0.4;
/** How far a body may stick out of its cells on each side, in studs; more and it takes another cell. */
const OVERHANG = 0.2;
/** How far a part's top may rise above its cells, in plates. */
const TOP_OVERHANG = 0.25;
/** Studs this close to a cell centre (in studs) are meant to sit on the grid; farther off is deliberate, as on jumper plates. */
const STUD_NUDGE = 0.2;
/** How close a body must come to whole studs and plates to count as a snug fit. */
const SNUG = 0.1;
const EPSILON = 1e-6;

export interface PartFit {
  /** Footprint in studs along X and Z, and height in plates. */
  readonly w: number;
  readonly d: number;
  readonly h: number;
  /** Added to every point so the footprint is centred on x = z = 0 and the body stands on y = 0 (a thin baseplate's top at the top of its cell). */
  readonly offset: V3;
  /** The body lands on whole studs and plates, so it sits flush with neighbours. */
  readonly snug: boolean;
  /** How far off the grid its top studs sit along X and Z, in studs: half a stud along a jumper plate, else 0. */
  readonly studOffset: readonly [number, number];
}

interface AxisFit {
  readonly size: number;
  readonly offset: number;
  /** Its top studs sit between cells along this axis. */
  readonly halfOffset: boolean;
}

/** Distance from x to the nearest half-integer (a cell centre when x is measured from a cell edge). */
function offCentre(x: number): number {
  return Math.abs(x - Math.floor(x) - 0.5);
}

/** Where a footprint of `size` cells starts if `stud` sits on one of its cell centres and the body fits, if anywhere. */
function alignedStart(lo: number, hi: number, size: number, stud: number): number | null {
  // the largest start with the stud on a cell centre and no more than OVERHANG sticking out at lo
  const start = stud - 0.5 - Math.max(0, Math.ceil(stud - 0.5 - (lo + OVERHANG) - EPSILON));
  return start + size >= hi - OVERHANG - EPSILON ? start : null;
}

/**
 * A whole-stud body whose stud sits between cells, as on a jumper plate:
 * the offset is the point of the part, so it must not be "corrected".
 */
function isHalfOffset(lo: number, hi: number, stud: number): boolean {
  const extent = hi - lo;
  return Math.abs(extent - Math.round(extent)) < SNUG && offCentre(stud - lo) > STUD_NUDGE;
}

/**
 * Fits a body spanning [lo, hi] along one axis into whole cells: the fewest
 * that hold it, placed so its top stud sits on a cell centre, taking one
 * more cell if that is what it takes. Half-offset studs are left alone and
 * the body simply centred.
 */
function fitAxis(lo: number, hi: number, stud: number | undefined): AxisFit {
  const size = Math.max(1, Math.ceil(hi - lo - 2 * OVERHANG - EPSILON));
  const halfOffset = stud !== undefined && isHalfOffset(lo, hi, stud);
  if (stud !== undefined && !halfOffset) {
    for (const candidate of [size, size + 1]) {
      const start = alignedStart(lo, hi, candidate, stud);
      if (start !== null) return { size: candidate, offset: -(start + candidate / 2), halfOffset };
    }
  }
  return { size, offset: -(lo + hi) / 2, halfOffset };
}

const clean = (n: number): number => (Math.abs(n) < 1e-9 ? 0 : n);

/**
 * Fits a part's body (top studs excluded), measured in editor units with
 * y up, onto the grid: its footprint in whole studs, its height in whole
 * plates, and the offset that centres the footprint and stands the body on
 * y = 0 with its top studs over cell centres. A `baseplate`, thinner than a
 * plate, sits at the top of its cell instead, so what is built on its studs
 * sits on its top, and a model built on one comes in on whole plates.
 */
export function fitPart(bodyMin: V3, bodyMax: V3, topStuds: readonly V3[], { baseplate = false }: { readonly baseplate?: boolean } = {}): PartFit {
  const stud = topStuds[0];
  const x = fitAxis(bodyMin[0], bodyMax[0], stud?.[0]);
  const z = fitAxis(bodyMin[2], bodyMax[2], stud?.[2]);
  const plates = (bodyMax[1] - bodyMin[1]) / PLATE;
  const h = Math.max(1, Math.ceil(plates - TOP_OVERHANG - EPSILON));
  const width = bodyMax[0] - bodyMin[0];
  const depth = bodyMax[2] - bodyMin[2];
  const snug = Math.abs(width - x.size) < SNUG && Math.abs(depth - z.size) < SNUG && Math.abs(plates - h) < SNUG / PLATE;
  const studOffset: [number, number] = [x.halfOffset ? 0.5 : 0, z.halfOffset ? 0.5 : 0];
  const y = baseplate && plates < 1 ? h * PLATE - bodyMax[1] : -bodyMin[1];
  return { w: x.size, d: z.size, h, offset: [clean(x.offset), clean(y), clean(z.offset)], snug, studOffset };
}
