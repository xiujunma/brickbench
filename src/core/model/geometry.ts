import { LDU_PER_UNIT, PLATE_HEIGHT, cleanZero, isStudPosition, type Vec3 } from '../grid';
import { compose, isUpright, quarterTurn, rotateVector, type Orientation } from '../orientation';
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

/** LDraw units per stud, along x and z, and per plate, along y: the exact lattice parts are placed on. */
export const LDU_PER_STUD = LDU_PER_UNIT;
export const LDU_PER_PLATE = Math.round(PLATE_HEIGHT * LDU_PER_UNIT);

/** A box in LDraw units on the world's axes (y up), half-open, as world solids are compared exactly. */
export interface LduBox {
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
}

/**
 * Whether a brick stands on the cell grid: upright, on whole or half studs
 * and whole plates, as every brick did before parts could turn on their
 * sides. Others (turned, or placed between) collide by exact boxes.
 */
export function isOnGrid(brick: Pick<Brick, 'x' | 'y' | 'z' | 'r'>): boolean {
  return isUpright(brick.r) && isStudPosition(brick.x) && isStudPosition(brick.z) && Number.isInteger(brick.y);
}

/** A brick's position (its box's minimum corner) in LDraw units. */
export function lduPosition(brick: Pick<Brick, 'x' | 'y' | 'z'>): Vec3 {
  return { x: Math.round(brick.x * LDU_PER_STUD), y: Math.round(brick.y * LDU_PER_PLATE), z: Math.round(brick.z * LDU_PER_STUD) };
}

/** A part's box, or one of its solids, in LDraw units around the part's origin: the middle of its footprint, at its bottom. */
function localBox(part: PartDef, cells: CellBox): LduBox {
  const halfW = (part.w * LDU_PER_STUD) / 2;
  const halfD = (part.d * LDU_PER_STUD) / 2;
  return {
    x0: cells.x0 * LDU_PER_STUD - halfW,
    y0: cells.y0 * LDU_PER_PLATE,
    z0: cells.z0 * LDU_PER_STUD - halfD,
    x1: cells.x1 * LDU_PER_STUD - halfW,
    y1: cells.y1 * LDU_PER_PLATE,
    z1: cells.z1 * LDU_PER_STUD - halfD,
  };
}

function wholeBox(part: PartDef): CellBox {
  return { x0: 0, y0: 0, z0: 0, x1: part.w, y1: part.h, z1: part.d };
}

/** The box a local box fills once turned, around the same origin. */
function turnBox(orientation: Orientation, box: LduBox): LduBox {
  const a = rotateVector(orientation, { x: box.x0, y: box.y0, z: box.z0 });
  const b = rotateVector(orientation, { x: box.x1, y: box.y1, z: box.z1 });
  // + 0 turns -0 into 0
  return {
    x0: Math.min(a.x, b.x) + 0,
    y0: Math.min(a.y, b.y) + 0,
    z0: Math.min(a.z, b.z) + 0,
    x1: Math.max(a.x, b.x) + 0,
    y1: Math.max(a.y, b.y) + 0,
    z1: Math.max(a.z, b.z) + 0,
  };
}

function shift(box: LduBox, by: Vec3): LduBox {
  return { x0: box.x0 + by.x, y0: box.y0 + by.y, z0: box.z0 + by.z, x1: box.x1 + by.x, y1: box.y1 + by.y, z1: box.z1 + by.z };
}

/** Where a brick's part origin sits in the world, in LDraw units: its position, less where its turned box starts. */
export function brickOriginLdu(brick: Brick, lookup: PartLookup): Vec3 {
  return originLdu(brick, requirePart(lookup, brick.partId));
}

function originLdu(brick: Brick, part: PartDef): Vec3 {
  const turned = turnBox(brick.r, localBox(part, wholeBox(part)));
  const at = lduPosition(brick);
  return { x: at.x - turned.x0, y: at.y - turned.y0, z: at.z - turned.z0 };
}

function toCells(box: LduBox): CellBox {
  return {
    x0: box.x0 / LDU_PER_STUD + 0,
    y0: box.y0 / LDU_PER_PLATE + 0,
    z0: box.z0 / LDU_PER_STUD + 0,
    x1: box.x1 / LDU_PER_STUD + 0,
    y1: box.y1 / LDU_PER_PLATE + 0,
    z1: box.z1 / LDU_PER_STUD + 0,
  };
}

/** Where a part's box starts once turned, from its origin, in world units (studs, on every axis). */
export function turnedCorner(part: PartDef, orientation: Orientation): Vec3 {
  const box = turnBox(orientation, localBox(part, wholeBox(part)));
  return { x: box.x0 / LDU_PER_UNIT + 0, y: box.y0 / LDU_PER_UNIT + 0, z: box.z0 / LDU_PER_UNIT + 0 };
}

/** The size a part's box takes in the world once turned: x and z in studs, y in plates. */
export function turnedSize(part: PartDef, orientation: Orientation): { readonly w: number; readonly h: number; readonly d: number } {
  const box = toCells(turnBox(orientation, localBox(part, wholeBox(part))));
  return { w: box.x1 - box.x0, h: box.y1 - box.y0, d: box.z1 - box.z0 };
}

/** The world boxes, in LDraw units, of the cells a brick fills (arches leave their opening out). */
export function brickLduSolids(brick: Brick, lookup: PartLookup): LduBox[] {
  const part = requirePart(lookup, brick.partId);
  const origin = originLdu(brick, part);
  return part.solids.map((solid) => shift(turnBox(brick.r, localBox(part, solid)), origin));
}

/** World-grid box covering a brick's whole footprint and height (x and z in studs, y in plates). */
export function brickCellBox(brick: Brick, lookup: PartLookup): CellBox {
  const part = requirePart(lookup, brick.partId);
  return toCells(shift(turnBox(brick.r, localBox(part, wholeBox(part))), originLdu(brick, part)));
}

/** World-grid boxes of the cells a brick actually fills (arches leave their opening out). */
export function brickSolids(brick: Brick, lookup: PartLookup): CellBox[] {
  return brickLduSolids(brick, lookup).map(toCells);
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

/**
 * Where a brick's part origin (the middle of its footprint, at its bottom)
 * is in the world, in world units: part meshes are built around it, then
 * turned by the brick's orientation.
 */
export function brickOrigin(brick: Brick, lookup: PartLookup): Vec3 {
  const origin = originLdu(brick, requirePart(lookup, brick.partId));
  return { x: origin.x / LDU_PER_UNIT + 0, y: origin.y / LDU_PER_UNIT + 0, z: origin.z / LDU_PER_UNIT + 0 };
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
 * Whether a part turned this way has a level side of its own along world X:
 * its own X, or its own Z when its X stands upright. Each quarter turn about
 * the vertical flips it, which keeps turning a group in step.
 */
function liesAlongX(orientation: Orientation): boolean {
  const x = rotateVector(orientation, { x: 1, y: 0, z: 0 });
  const level = x.y === 0 ? x : rotateVector(orientation, { x: 0, y: 0, z: 1 });
  return level.x !== 0;
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
  const phaseEven = liesAlongX(dir === 1 ? first.r : compose(quarterTurn('y', -1), first.r));
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
      r: compose(quarterTurn('y', dir), brick.r),
    };
  });
}
