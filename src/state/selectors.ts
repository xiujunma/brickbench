import { PLATE_HEIGHT } from '../core/grid';
import { brickWorldBoxes } from '../core/model/geometry';
import { allBricks, getBricks } from '../core/model/model';
import { buildSpatialIndex, collides, isOutOfBounds, type SpatialIndex } from '../core/model/spatial';
import type { Brick, Model } from '../core/model/types';
import type { PartLookup } from '../core/parts/types';
import type { EditorState } from './types';

/** Undo and redo flip between neighbouring snapshots, so two slots cover the common cases. */
const RECENT_MODELS = 2;

/**
 * Memoises a per-model value for the most recent models only. Keying a
 * WeakMap by model would keep a value alive for every undo snapshot.
 */
function recentCache<V>(): (model: Model, compute: () => V) => V {
  const entries: { readonly model: Model; readonly value: V }[] = [];
  return (model, compute) => {
    const hit = entries.find((entry) => entry.model === model);
    if (hit) return hit.value;
    const value = compute();
    entries.unshift({ model, value });
    entries.splice(RECENT_MODELS);
    return value;
  };
}

const indexCache = recentCache<SpatialIndex>();
const listCache = recentCache<Brick[]>();
const varietyCache = recentCache<number>();

/** Spatial index of a model, built once per model snapshot. */
export function spatialIndexFor(model: Model, lookup: PartLookup): SpatialIndex {
  return indexCache(model, () => buildSpatialIndex(model.bricks.values(), lookup));
}

export function bricksOf(model: Model): Brick[] {
  return listCache(model, () => allBricks(model));
}

/** Number of distinct part-and-colour combinations in a model. */
export function distinctPieces(model: Model): number {
  return varietyCache(model, () => new Set(bricksOf(model).map((b) => `${b.partId}|${b.colorId}`)).size);
}

export function currentModel(state: Pick<EditorState, 'history'>): Model {
  return state.history.present;
}

export function selectedBricks(state: Pick<EditorState, 'history' | 'selection'>): Brick[] {
  return getBricks(currentModel(state), state.selection);
}

/** True when the bricks are on the grid and only overlap bricks in `ignore`. */
export function bricksFit(model: Model, bricks: readonly Brick[], lookup: PartLookup, ignore: ReadonlySet<string> = new Set()): boolean {
  if (bricks.some((b) => !lookup(b.partId) || isOutOfBounds(b, lookup))) return false;
  return !collides(spatialIndexFor(model, lookup), bricks, lookup, ignore);
}

export interface WorldBounds {
  readonly min: { readonly x: number; readonly y: number; readonly z: number };
  readonly max: { readonly x: number; readonly y: number; readonly z: number };
}

export function worldBounds(bricks: readonly Brick[], lookup: PartLookup): WorldBounds | null {
  if (bricks.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const brick of bricks) {
    for (const box of brickWorldBoxes(brick, lookup)) {
      minX = Math.min(minX, box.min.x);
      minY = Math.min(minY, box.min.y);
      minZ = Math.min(minZ, box.min.z);
      maxX = Math.max(maxX, box.max.x);
      maxY = Math.max(maxY, box.max.y + PLATE_HEIGHT / 2);
      maxZ = Math.max(maxZ, box.max.z);
    }
  }
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}
