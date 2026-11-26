import { PLATE_HEIGHT } from '../core/grid';
import { brickWorldBoxes, isLoose } from '../core/model/geometry';
import { allBricks, getBricks } from '../core/model/model';
import { buildSpatialIndex, collides, doubles, isOutOfBounds, type SpatialIndex } from '../core/model/spatial';
import type { Brick, Model } from '../core/model/types';
import { facingOf, spinOf } from '../core/orientation';
import type { PartLookup } from '../core/parts/types';
import type { ConnectTurn } from '../core/placement/connect';
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
const looseCache = recentCache<Brick[]>();

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

/**
 * How the part being built is held where it plugs in (see ConnectTurn):
 * turned by R and T, by the connection of its own C chose, and as far into
 * a hole as D pushed it. A pasted copy goes on as it fits best: R and T
 * turn the copy, not how it plugs in, and the connection chosen, like the
 * turn and the depth, is the active part's.
 */
export function buildTurn(state: Pick<EditorState, 'buildRotation' | 'buildVia' | 'buildDepth' | 'pastePayload'>): ConnectTurn {
  const { buildRotation, buildVia, buildDepth, pastePayload } = state;
  if (pastePayload) return { spin: 0, flipped: false };
  return { spin: spinOf(buildRotation), flipped: facingOf(buildRotation) !== '+y', ...(buildVia === null ? {} : { via: buildVia }), ...(buildDepth > 0 ? { deeper: buildDepth } : {}) };
}

export function currentModel(state: Pick<EditorState, 'history'>): Model {
  return state.history.present;
}

export function selectedBricks(state: Pick<EditorState, 'history' | 'selection'>): Brick[] {
  return getBricks(currentModel(state), state.selection);
}

/** A model's loose parts: the few that collisions do not see. */
function looseBricksOf(model: Model): Brick[] {
  return looseCache(model, () => bricksOf(model).filter(isLoose));
}

/**
 * True when the bricks are in the build area, only overlap bricks in
 * `ignore`, and none would stand in the very box another brick stands in
 * where collisions do not see it: a loose part's, or as a loose part.
 */
export function bricksFit(model: Model, bricks: readonly Brick[], lookup: PartLookup, ignore: ReadonlySet<string> = new Set()): boolean {
  if (bricks.some((b) => !lookup(b.partId) || isOutOfBounds(b, lookup))) return false;
  if (collides(spatialIndexFor(model, lookup), bricks, lookup, ignore)) return false;
  return !bricks.some((brick) => doubles(brick, isLoose(brick) ? model.bricks.values() : looseBricksOf(model), lookup, ignore));
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
