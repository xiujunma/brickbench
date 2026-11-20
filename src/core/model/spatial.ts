import { GRID_LIMIT, MAX_LAYER } from '../grid';
import type { PartLookup } from '../parts/types';
import { WHOLE_CELL, brickCellBox, brickCellQuarters } from './geometry';
import type { Brick } from './types';

/**
 * Answers "which brick fills this cell?" in constant time. Most cells are
 * filled whole by one brick; along the edges of a brick half a stud over,
 * a cell's quarters may hold different bricks, or none.
 */
export interface SpatialIndex {
  /** A brick filling any of the cell (x, y, z), x and z in whole studs. */
  owner(x: number, y: number, z: number): string | undefined;
  /** The brick filling the point (x, z) in layer y, x and z in studs (a stud's centre, say). */
  ownerAt(x: number, y: number, z: number): string | undefined;
  /** The bricks filling any of the quarters `mask` of the cell (x, y, z) (see brickCellQuarters). */
  ownersIn(x: number, y: number, z: number, mask: number): readonly string[];
}

const SPAN = 2 * GRID_LIMIT + 2;
const LAYERS = MAX_LAYER + 2;
const NOBODY: readonly string[] = [];

function inRange(x: number, y: number, z: number): boolean {
  return (
    Math.abs(x) <= GRID_LIMIT && Math.abs(z) <= GRID_LIMIT && y >= -1 && y <= MAX_LAYER
  );
}

function cellKey(x: number, y: number, z: number): number {
  return ((x + GRID_LIMIT + 1) * LAYERS + (y + 1)) * SPAN + (z + GRID_LIMIT + 1);
}

/** A cell's bricks: one in all of it, or one (or none) in each quarter. */
type Quarters = (string | undefined)[];

/** Filled cells, kept whole where they can be: only cells a brick fills in part hold quarters. */
class CellMap {
  private readonly cells = new Map<number, string | Quarters>();

  get size(): number {
    return this.cells.size;
  }

  fill(key: number, mask: number, id: string): void {
    if (mask === WHOLE_CELL) {
      this.cells.set(key, id);
      return;
    }
    const held = this.cells.get(key);
    const quarters: Quarters = typeof held === 'string' ? [held, held, held, held] : held ? [...held] : [undefined, undefined, undefined, undefined];
    for (let q = 0; q < 4; q++) if (mask & (1 << q)) quarters[q] = id;
    // a cell filled whole after all, by one brick, is kept whole
    const [first] = quarters;
    this.cells.set(key, first !== undefined && quarters.every((owner) => owner === first) ? first : quarters);
  }

  ownersIn(key: number, mask: number): readonly string[] {
    const held = this.cells.get(key);
    if (held === undefined) return NOBODY;
    if (typeof held === 'string') return [held];
    const owners = new Set<string>();
    for (let q = 0; q < 4; q++) {
      const owner = held[q];
      if (mask & (1 << q) && owner !== undefined) owners.add(owner);
    }
    return [...owners];
  }

  quarter(key: number, q: number): string | undefined {
    const held = this.cells.get(key);
    return typeof held === 'string' ? held : held?.[q];
  }
}

export function buildSpatialIndex(bricks: Iterable<Brick>, lookup: PartLookup): SpatialIndex {
  const cells = new CellMap();
  for (const brick of bricks) {
    for (const [x, y, z, mask] of brickCellQuarters(brick, lookup)) {
      if (inRange(x, y, z)) cells.fill(cellKey(x, y, z), mask, brick.id);
    }
  }
  const ownersIn = (x: number, y: number, z: number, mask: number): readonly string[] => (inRange(x, y, z) ? cells.ownersIn(cellKey(x, y, z), mask) : NOBODY);
  return {
    owner: (x, y, z) => ownersIn(x, y, z, WHOLE_CELL)[0],
    ownerAt: (x, y, z) => {
      const [cx, cz] = [Math.floor(x), Math.floor(z)];
      if (!inRange(cx, y, cz)) return undefined;
      // which quarter the point is in: its halves along x and z
      return cells.quarter(cellKey(cx, y, cz), (x - cx >= 0.5 ? 1 : 0) + (z - cz >= 0.5 ? 2 : 0));
    },
    ownersIn,
  };
}

/** Grows a set of filled cells one brick at a time, refusing bricks that overlap. */
export interface Occupancy {
  /** Adds the brick if none of its cells are taken; returns false (and adds nothing) otherwise. */
  tryAdd(brick: Brick): boolean;
  /** Cells filled so far, wholly or in part. */
  readonly cells: number;
}

export function createOccupancy(lookup: PartLookup): Occupancy {
  const taken = new CellMap();
  return {
    tryAdd(brick) {
      const cells = [...brickCellQuarters(brick, lookup)].map(([x, y, z, mask]) => [cellKey(x, y, z), mask] as const);
      if (cells.some(([key, mask]) => taken.ownersIn(key, mask).length > 0)) return false;
      for (const [key, mask] of cells) taken.fill(key, mask, brick.id);
      return true;
    },
    get cells() {
      return taken.size;
    },
  };
}

/** True when any candidate brick fills a cell (or the part of one it fills) owned by a brick outside `ignore`. */
export function collides(
  index: SpatialIndex,
  candidates: readonly Brick[],
  lookup: PartLookup,
  ignore: ReadonlySet<string> = new Set(),
): boolean {
  for (const brick of candidates) {
    for (const [x, y, z, mask] of brickCellQuarters(brick, lookup)) {
      if (index.ownersIn(x, y, z, mask).some((owner) => !ignore.has(owner))) return true;
    }
  }
  return false;
}

export function isOutOfBounds(brick: Brick, lookup: PartLookup): boolean {
  const box = brickCellBox(brick, lookup);
  return (
    box.y0 < 0 ||
    box.y1 > MAX_LAYER ||
    box.x0 < -GRID_LIMIT ||
    box.z0 < -GRID_LIMIT ||
    box.x1 > GRID_LIMIT ||
    box.z1 > GRID_LIMIT
  );
}
