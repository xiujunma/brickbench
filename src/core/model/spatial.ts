import { GRID_LIMIT, MAX_LAYER } from '../grid';
import type { PartLookup } from '../parts/types';
import { brickCellBox, brickCells } from './geometry';
import type { Brick } from './types';

/** Answers "which brick fills this cell?" in constant time. */
export interface SpatialIndex {
  owner(x: number, y: number, z: number): string | undefined;
}

const SPAN = 2 * GRID_LIMIT + 2;
const LAYERS = MAX_LAYER + 2;

function inRange(x: number, y: number, z: number): boolean {
  return (
    Math.abs(x) <= GRID_LIMIT && Math.abs(z) <= GRID_LIMIT && y >= -1 && y <= MAX_LAYER
  );
}

function cellKey(x: number, y: number, z: number): number {
  return ((x + GRID_LIMIT + 1) * LAYERS + (y + 1)) * SPAN + (z + GRID_LIMIT + 1);
}

export function buildSpatialIndex(bricks: Iterable<Brick>, lookup: PartLookup): SpatialIndex {
  const cells = new Map<number, string>();
  for (const brick of bricks) {
    for (const [x, y, z] of brickCells(brick, lookup)) {
      if (inRange(x, y, z)) cells.set(cellKey(x, y, z), brick.id);
    }
  }
  return { owner: (x, y, z) => (inRange(x, y, z) ? cells.get(cellKey(x, y, z)) : undefined) };
}

/** Grows a set of filled cells one brick at a time, refusing bricks that overlap. */
export interface Occupancy {
  /** Adds the brick if none of its cells are taken; returns false (and adds nothing) otherwise. */
  tryAdd(brick: Brick): boolean;
  /** Total cells filled so far. */
  readonly cells: number;
}

export function createOccupancy(lookup: PartLookup): Occupancy {
  const taken = new Set<number>();
  return {
    tryAdd(brick) {
      const keys = [...brickCells(brick, lookup)].map(([x, y, z]) => cellKey(x, y, z));
      if (keys.some((key) => taken.has(key))) return false;
      for (const key of keys) taken.add(key);
      return true;
    },
    get cells() {
      return taken.size;
    },
  };
}

/** True when any candidate brick fills a cell owned by a brick outside `ignore`. */
export function collides(
  index: SpatialIndex,
  candidates: readonly Brick[],
  lookup: PartLookup,
  ignore: ReadonlySet<string> = new Set(),
): boolean {
  for (const brick of candidates) {
    for (const [x, y, z] of brickCells(brick, lookup)) {
      const owner = index.owner(x, y, z);
      if (owner !== undefined && !ignore.has(owner)) return true;
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
