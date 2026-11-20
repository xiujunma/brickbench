import { GRID_LIMIT, LDU_PER_UNIT, MAX_LAYER, type Vec3 } from '../grid';
import type { PartLookup } from '../parts/types';
import { LDU_PER_PLATE, LDU_PER_STUD, WHOLE_CELL, brickCellBox, brickCellQuarters, brickLduSolids, isLoose, isOnGrid, type LduBox } from './geometry';
import type { Brick } from './types';

/**
 * Answers "which brick fills this cell?" in constant time. Most cells are
 * filled whole by one brick; along the edges of a brick half a stud over,
 * a cell's quarters may hold different bricks, or none. Bricks off the cell
 * grid (on their sides, or placed between) are kept as exact boxes, in
 * LDraw units, in each cell they reach into. Loose parts (at an angle, or
 * plugged into others) are left out: they fill no space here.
 */
export interface SpatialIndex {
  /** A brick filling any of the cell (x, y, z), x and z in whole studs. */
  owner(x: number, y: number, z: number): string | undefined;
  /** The brick filling the point (x, z) in layer y, x and z in studs (a stud's centre, say). */
  ownerAt(x: number, y: number, z: number): string | undefined;
  /** The bricks filling any of the quarters `mask` of the cell (x, y, z) (see brickCellQuarters). */
  ownersIn(x: number, y: number, z: number, mask: number): readonly string[];
  /** The bricks filling any of a box in LDraw units. */
  ownersInBox(box: LduBox): readonly string[];
  /** The brick filling a point given in world units, if one does. */
  ownerAtPoint(point: Vec3): string | undefined;
}

const SPAN = 2 * GRID_LIMIT + 2;
const LAYERS = MAX_LAYER + 2;
const NOBODY: readonly string[] = [];
/** Half a stud, in LDraw units: the size of a cell's quarters along x and z. */
const HALF_STUD = LDU_PER_STUD / 2;
/** How far into a layer a point "in" it is looked for among exact boxes: inside a stud standing on the layer's floor. */
const INTO_LAYER = 2;

function inRange(x: number, y: number, z: number): boolean {
  return Math.abs(x) <= GRID_LIMIT && Math.abs(z) <= GRID_LIMIT && y >= -1 && y <= MAX_LAYER;
}

function cellKey(x: number, y: number, z: number): number {
  return ((x + GRID_LIMIT + 1) * LAYERS + (y + 1)) * SPAN + (z + GRID_LIMIT + 1);
}

/** Half-open boxes overlap when they share some volume; touching faces do not count. */
export function overlaps(a: LduBox, b: LduBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1 && a.z0 < b.z1 && b.z0 < a.z1;
}

function contains(box: LduBox, x: number, y: number, z: number): boolean {
  return x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1 && z >= box.z0 && z < box.z1;
}

/** The quarter `q` of cell (x, y, z), in LDraw units: half qx along x and half qz along z, the layer's whole height. */
function quarterBox(x: number, y: number, z: number, q: number): LduBox {
  const x0 = x * LDU_PER_STUD + (q & 1 ? HALF_STUD : 0);
  const z0 = z * LDU_PER_STUD + (q & 2 ? HALF_STUD : 0);
  return { x0, y0: y * LDU_PER_PLATE, z0, x1: x0 + HALF_STUD, y1: (y + 1) * LDU_PER_PLATE, z1: z0 + HALF_STUD };
}

/** The cells a box shares volume with. */
function* cellsOf(box: LduBox): Generator<readonly [number, number, number]> {
  for (let x = Math.floor(box.x0 / LDU_PER_STUD); x * LDU_PER_STUD < box.x1; x++) {
    for (let y = Math.floor(box.y0 / LDU_PER_PLATE); y * LDU_PER_PLATE < box.y1; y++) {
      for (let z = Math.floor(box.z0 / LDU_PER_STUD); z * LDU_PER_STUD < box.z1; z++) yield [x, y, z];
    }
  }
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

  /** The bricks in the quarters `mask` of a cell. */
  ownersIn(key: number, mask: number, into: Set<string>): void {
    const held = this.cells.get(key);
    if (held === undefined) return;
    if (typeof held === 'string') {
      into.add(held);
      return;
    }
    for (let q = 0; q < 4; q++) {
      const owner = held[q];
      if (mask & (1 << q) && owner !== undefined) into.add(owner);
    }
  }

  /** The quarters of a cell that hold bricks, as a mask, or WHOLE_CELL for a cell one brick fills. */
  held(key: number): string | Quarters | undefined {
    return this.cells.get(key);
  }

  quarter(key: number, q: number): string | undefined {
    const held = this.cells.get(key);
    return typeof held === 'string' ? held : held?.[q];
  }
}

interface ExactBox {
  readonly id: string;
  readonly box: LduBox;
}

/**
 * Where bricks are: on-grid bricks by the cells (and quarters) they fill,
 * the others by their exact boxes, listed in every cell those reach into.
 */
class Space {
  private readonly grid = new CellMap();
  private readonly exact = new Map<number, ExactBox[]>();

  constructor(private readonly lookup: PartLookup) {}

  get cells(): number {
    return this.grid.size + this.exact.size;
  }

  add(brick: Brick): void {
    if (isLoose(brick)) return;
    if (isOnGrid(brick)) {
      for (const [x, y, z, mask] of brickCellQuarters(brick, this.lookup)) {
        if (inRange(x, y, z)) this.grid.fill(cellKey(x, y, z), mask, brick.id);
      }
      return;
    }
    for (const box of brickLduSolids(brick, this.lookup)) {
      for (const [x, y, z] of cellsOf(box)) {
        if (!inRange(x, y, z)) continue;
        const key = cellKey(x, y, z);
        const list = this.exact.get(key);
        if (list) list.push({ id: brick.id, box });
        else this.exact.set(key, [{ id: brick.id, box }]);
      }
    }
  }

  ownersIn(x: number, y: number, z: number, mask: number): readonly string[] {
    if (!inRange(x, y, z)) return NOBODY;
    const key = cellKey(x, y, z);
    const owners = new Set<string>();
    this.grid.ownersIn(key, mask, owners);
    const exact = this.exact.get(key);
    if (exact) {
      for (const { id, box } of exact) {
        for (let q = 0; q < 4; q++) {
          if (mask & (1 << q) && overlaps(box, quarterBox(x, y, z, q))) {
            owners.add(id);
            break;
          }
        }
      }
    }
    return owners.size === 0 ? NOBODY : [...owners];
  }

  ownersInBox(box: LduBox): readonly string[] {
    const owners = new Set<string>();
    for (const [x, y, z] of cellsOf(box)) {
      if (!inRange(x, y, z)) continue;
      const key = cellKey(x, y, z);
      const held = this.grid.held(key);
      if (typeof held === 'string') owners.add(held);
      else if (held) {
        for (let q = 0; q < 4; q++) {
          const owner = held[q];
          if (owner !== undefined && overlaps(box, quarterBox(x, y, z, q))) owners.add(owner);
        }
      }
      for (const entry of this.exact.get(key) ?? []) if (overlaps(box, entry.box)) owners.add(entry.id);
    }
    return owners.size === 0 ? NOBODY : [...owners];
  }

  /** The brick at a point in LDraw units. */
  ownerAtLdu(x: number, y: number, z: number): string | undefined {
    const [cx, cy, cz] = [Math.floor(x / LDU_PER_STUD), Math.floor(y / LDU_PER_PLATE), Math.floor(z / LDU_PER_STUD)];
    if (!inRange(cx, cy, cz)) return undefined;
    const key = cellKey(cx, cy, cz);
    // which quarter the point is in: its halves along x and z
    const onGrid = this.grid.quarter(key, (x - cx * LDU_PER_STUD >= HALF_STUD ? 1 : 0) + (z - cz * LDU_PER_STUD >= HALF_STUD ? 2 : 0));
    if (onGrid !== undefined) return onGrid;
    return this.exact.get(key)?.find((entry) => contains(entry.box, x, y, z))?.id;
  }

  /** True when the brick would share space with one not in `ignore`; never, for a loose part. */
  blocks(brick: Brick, ignore: ReadonlySet<string>): boolean {
    if (isLoose(brick)) return false;
    const outside = (owners: readonly string[]): boolean => owners.some((owner) => !ignore.has(owner));
    if (isOnGrid(brick)) {
      for (const [x, y, z, mask] of brickCellQuarters(brick, this.lookup)) if (outside(this.ownersIn(x, y, z, mask))) return true;
      return false;
    }
    return brickLduSolids(brick, this.lookup).some((box) => outside(this.ownersInBox(box)));
  }
}

function indexOf(space: Space): SpatialIndex {
  return {
    owner: (x, y, z) => space.ownersIn(x, y, z, WHOLE_CELL)[0],
    ownerAt: (x, y, z) => space.ownerAtLdu(x * LDU_PER_STUD, y * LDU_PER_PLATE + INTO_LAYER, z * LDU_PER_STUD),
    ownersIn: (x, y, z, mask) => space.ownersIn(x, y, z, mask),
    ownersInBox: (box) => space.ownersInBox(box),
    ownerAtPoint: (point) => space.ownerAtLdu(point.x * LDU_PER_UNIT, point.y * LDU_PER_UNIT, point.z * LDU_PER_UNIT),
  };
}

export function buildSpatialIndex(bricks: Iterable<Brick>, lookup: PartLookup): SpatialIndex {
  const space = new Space(lookup);
  for (const brick of bricks) space.add(brick);
  return indexOf(space);
}

/** Grows a set of filled cells one brick at a time, refusing bricks that overlap. */
export interface Occupancy {
  /** Adds the brick if it shares no space with those added; returns false (and adds nothing) otherwise. */
  tryAdd(brick: Brick): boolean;
  /** Cells filled so far, wholly or in part. */
  readonly cells: number;
}

export function createOccupancy(lookup: PartLookup): Occupancy {
  const space = new Space(lookup);
  const none: ReadonlySet<string> = new Set();
  return {
    tryAdd(brick) {
      if (space.blocks(brick, none)) return false;
      space.add(brick);
      return true;
    },
    get cells() {
      return space.cells;
    },
  };
}

/** The first brick outside `ignore` a brick would share space with, if any; none, for a loose part. */
export function firstOverlap(index: SpatialIndex, brick: Brick, lookup: PartLookup, ignore: ReadonlySet<string> = new Set()): string | undefined {
  if (isLoose(brick)) return undefined;
  const outside = (owners: readonly string[]): string | undefined => owners.find((owner) => !ignore.has(owner));
  if (isOnGrid(brick)) {
    for (const [x, y, z, mask] of brickCellQuarters(brick, lookup)) {
      const owner = outside(index.ownersIn(x, y, z, mask));
      if (owner !== undefined) return owner;
    }
    return undefined;
  }
  for (const box of brickLduSolids(brick, lookup)) {
    const owner = outside(index.ownersInBox(box));
    if (owner !== undefined) return owner;
  }
  return undefined;
}

/** True when any candidate brick shares space with a brick outside `ignore`. */
export function collides(
  index: SpatialIndex,
  candidates: readonly Brick[],
  lookup: PartLookup,
  ignore: ReadonlySet<string> = new Set(),
): boolean {
  return candidates.some((brick) => firstOverlap(index, brick, lookup, ignore) !== undefined);
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
