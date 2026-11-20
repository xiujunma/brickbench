import { brickCellBox, brickSolids } from '../core/model/geometry';
import { allBricks } from '../core/model/model';
import type { Brick, Model } from '../core/model/types';
import type { PartLookup } from '../core/parts/types';
import { colourName, partInfo, type PartInfo } from './catalog';
import type { Region, ToolInput } from './protocol';

interface Cell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A brick as agents see and name it. */
export interface BrickView {
  readonly id: string;
  readonly part: string;
  readonly color: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly r: number;
  /** At an angle or plugged into another part: placed exactly, r only the nearest square turn. */
  readonly loose?: true;
}

export interface ModelView {
  readonly name: string;
  readonly brick_count: number;
  /** The cells the model fills, both corners included; null when empty. */
  readonly bounds: { readonly min: Cell; readonly max: Cell } | null;
  readonly parts: readonly (PartInfo & { readonly count: number })[];
  readonly colors: readonly { readonly id: number; readonly name: string; readonly count: number }[];
  /** Bottom layer first, then front to back, left to right. */
  readonly bricks: readonly BrickView[];
  /** Bricks in the region asked about (all of them without one). */
  readonly matching: number;
  readonly truncated: boolean;
}

function boundsOf(bricks: readonly Brick[], lookup: PartLookup): ModelView['bounds'] {
  if (bricks.length === 0) return null;
  const boxes = bricks.map((b) => brickCellBox(b, lookup));
  return {
    min: { x: Math.min(...boxes.map((b) => b.x0)), y: Math.min(...boxes.map((b) => b.y0)), z: Math.min(...boxes.map((b) => b.z0)) },
    max: { x: Math.max(...boxes.map((b) => b.x1)) - 1, y: Math.max(...boxes.map((b) => b.y1)) - 1, z: Math.max(...boxes.map((b) => b.z1)) - 1 },
  };
}

function countBy<K>(items: readonly Brick[], key: (brick: Brick) => K): [K, number][] {
  const counts = new Map<K, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

/**
 * Whether a cell the brick fills lies in a region (corners in any order, both
 * included): the free corner of an L-shaped plate is not the plate's.
 */
export function touchesRegion(brick: Brick, region: Region, lookup: PartLookup): boolean {
  const overlaps = (lo: number, hi: number, a: number, b: number): boolean => lo <= Math.max(a, b) && hi > Math.min(a, b);
  return brickSolids(brick, lookup).some(
    (box) =>
      overlaps(box.x0, box.x1, region.min.x, region.max.x) &&
      overlaps(box.y0, box.y1, region.min.y, region.max.y) &&
      overlaps(box.z0, box.z1, region.min.z, region.max.z),
  );
}

/** What get_model tells an agent: a summary of the whole model and its bricks, or those in a region. */
export function describeModel(model: Model, name: string, input: ToolInput<'get_model'>, lookup: PartLookup): ModelView {
  const bricks = allBricks(model);
  const region = input.region;
  const matching = (region ? bricks.filter((b) => touchesRegion(b, region, lookup)) : bricks).sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
  const parts = countBy(bricks, (b) => b.partId).flatMap(([partId, count]) => {
    const part = lookup(partId);
    return part ? [{ ...partInfo(part), count }] : [];
  });
  return {
    name,
    brick_count: bricks.length,
    bounds: boundsOf(bricks, lookup),
    parts,
    colors: countBy(bricks, (b) => b.colorId).map(([id, count]) => ({ id, name: colourName(id), count })),
    bricks: matching.slice(0, input.limit).map((b) => ({ id: b.id, part: b.partId, color: b.colorId, x: b.x, y: b.y, z: b.z, r: b.r, ...(b.m ? { loose: true as const } : {}) })),
    matching: matching.length,
    truncated: matching.length > input.limit,
  };
}
