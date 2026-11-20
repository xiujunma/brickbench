import { PLATE_HEIGHT, cleanZero, normalizeRotation, rotateCell, rotatedSize, type Vec3 } from '../grid';
import type { CellBox, PartDef, PartLookup } from '../parts/types';
import type { Brick } from './types';

export interface Aabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

export function requirePart(lookup: PartLookup, partId: string): PartDef {
  const part = lookup(partId);
  if (!part) throw new Error(`Unknown part: ${partId}`);
  return part;
}

/** World-grid cell box covering a brick's whole footprint and height. */
export function brickCellBox(brick: Brick, lookup: PartLookup): CellBox {
  const part = requirePart(lookup, brick.partId);
  const size = rotatedSize(part.w, part.d, brick.r);
  return {
    x0: brick.x,
    y0: brick.y,
    z0: brick.z,
    x1: brick.x + size.w,
    y1: brick.y + part.h,
    z1: brick.z + size.d,
  };
}

/** Converts one of a part's local solids into world-grid cells for a placed brick. */
function solidToWorld(brick: Brick, part: PartDef, solid: CellBox): CellBox {
  const [ax, az] = rotateCell(solid.x0, solid.z0, part.w, part.d, brick.r);
  const [bx, bz] = rotateCell(solid.x1 - 1, solid.z1 - 1, part.w, part.d, brick.r);
  return {
    x0: brick.x + Math.min(ax, bx),
    y0: brick.y + solid.y0,
    z0: brick.z + Math.min(az, bz),
    x1: brick.x + Math.max(ax, bx) + 1,
    y1: brick.y + solid.y1,
    z1: brick.z + Math.max(az, bz) + 1,
  };
}

/** World-grid boxes of the cells a brick actually fills (arches leave their opening out). */
export function brickSolids(brick: Brick, lookup: PartLookup): CellBox[] {
  const part = requirePart(lookup, brick.partId);
  return part.solids.map((solid) => solidToWorld(brick, part, solid));
}

/** All four quarters of a cell, as a mask of brickCellQuarters. */
export const WHOLE_CELL = 0b1111;

/** Which halves of cell `cell` the span [h0, h1) of half studs covers: bit 1 the lower half, bit 2 the upper. */
function halvesOf(cell: number, h0: number, h1: number): number {
  const lower = 2 * cell >= h0 && 2 * cell < h1 ? 1 : 0;
  const upper = 2 * cell + 1 >= h0 && 2 * cell + 1 < h1 ? 2 : 0;
  return lower | upper;
}

/**
 * The cells a brick's solids reach into, each with a mask of the quarters
 * it fills: bit qx + 2·qz for the quarter that is half qx along x and half
 * qz along z. A brick on whole studs fills whole cells (WHOLE_CELL); one
 * half a stud over fills halves or quarters of the cells along its edges.
 */
export function* brickCellQuarters(brick: Brick, lookup: PartLookup): Generator<readonly [number, number, number, number]> {
  for (const box of brickSolids(brick, lookup)) {
    // in half studs, which positions always come in
    const [hx0, hx1, hz0, hz1] = [box.x0, box.x1, box.z0, box.z1].map((v) => Math.round(v * 2)) as [number, number, number, number];
    for (let y = box.y0; y < box.y1; y++) {
      for (let z = Math.floor(hz0 / 2); 2 * z < hz1; z++) {
        const zHalves = halvesOf(z, hz0, hz1);
        for (let x = Math.floor(hx0 / 2); 2 * x < hx1; x++) {
          const xHalves = halvesOf(x, hx0, hx1);
          yield [x, y, z, (zHalves & 1 ? xHalves : 0) | (zHalves & 2 ? xHalves << 2 : 0)];
        }
      }
    }
  }
}

/** The cells a brick's solids reach into, wholly or in part (see brickCellQuarters). */
export function* brickCells(brick: Brick, lookup: PartLookup): Generator<readonly [number, number, number]> {
  for (const [x, y, z] of brickCellQuarters(brick, lookup)) yield [x, y, z];
}

export function cellBoxToAabb(box: CellBox): Aabb {
  return {
    min: { x: box.x0, y: box.y0 * PLATE_HEIGHT, z: box.z0 },
    max: { x: box.x1, y: box.y1 * PLATE_HEIGHT, z: box.z1 },
  };
}

/** Solid boxes of a brick in world units, used for picking. */
export function brickWorldBoxes(brick: Brick, lookup: PartLookup): Aabb[] {
  return brickSolids(brick, lookup).map(cellBoxToAabb);
}

/** Bottom-centre of a brick's footprint in world units; part meshes are built around it. */
export function brickOrigin(brick: Brick, lookup: PartLookup): Vec3 {
  const box = brickCellBox(brick, lookup);
  return { x: (box.x0 + box.x1) / 2, y: box.y0 * PLATE_HEIGHT, z: (box.z0 + box.z1) / 2 };
}

export function groupCellBox(bricks: readonly Brick[], lookup: PartLookup): CellBox {
  if (bricks.length === 0) throw new Error('Cannot bound an empty group of bricks');
  // a plain loop: spreading thousands of values into Math.min overflows the call stack in some engines
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const brick of bricks) {
    const box = brickCellBox(brick, lookup);
    x0 = Math.min(x0, box.x0);
    y0 = Math.min(y0, box.y0);
    z0 = Math.min(z0, box.z0);
    x1 = Math.max(x1, box.x1);
    y1 = Math.max(y1, box.y1);
    z1 = Math.max(z1, box.z1);
  }
  return { x0, y0, z0, x1, y1, z1 };
}

/**
 * Turns a group a quarter turn about the centre of its footprint. When the
 * footprint's sides differ in parity the centre can't stay exactly put, so
 * the rounding alternates with the turn phase: four turns land back on the
 * start and a turn followed by its opposite is a no-op.
 */
export function rotateGroup(bricks: readonly Brick[], lookup: PartLookup, dir: 1 | -1): Brick[] {
  const first = bricks[0];
  if (!first) return [];
  const bounds = groupCellBox(bricks, lookup);
  const w = bounds.x1 - bounds.x0;
  const d = bounds.z1 - bounds.z0;
  const phaseEven = (dir === 1 ? first.r : normalizeRotation(first.r - 1)) % 2 === 0;
  const round = (dir === 1) === phaseEven ? Math.floor : Math.ceil;
  const x0 = bounds.x0 + round((w - d) / 2);
  const z0 = bounds.z0 + round((d - w) / 2);

  return bricks.map((brick) => {
    const box = brickCellBox(brick, lookup);
    const rx0 = box.x0 - bounds.x0;
    const rx1 = box.x1 - bounds.x0;
    const rz0 = box.z0 - bounds.z0;
    const rz1 = box.z1 - bounds.z0;
    const x = dir === 1 ? rz0 : d - rz1;
    const z = dir === 1 ? w - rx1 : rx0;
    return {
      ...brick,
      x: cleanZero(x0 + x),
      z: cleanZero(z0 + z),
      r: normalizeRotation(brick.r + dir),
    };
  });
}
