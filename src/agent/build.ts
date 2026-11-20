/**
 * The build tools agents call, as pure changes to a model: each returns the
 * next model and what to tell the agent. A whole call that cannot be done
 * throws a BuildError whose message is written for the agent.
 */
import { GRID_LIMIT, MAX_LAYER, normalizeRotation } from '../core/grid';
import { MAX_BRICKS } from '../core/io/modelFile';
import { brickCellQuarters, brickLduSolids, isOnGrid, type LduBox } from '../core/model/geometry';
import type { IdFactory } from '../core/model/ids';
import { addBricks, allBricks, emptyModel, recolorBricks, removeBricks as withoutBricks, replaceBricks } from '../core/model/model';
import { firstOverlap, isOutOfBounds, type SpatialIndex } from '../core/model/spatial';
import type { Brick, Model } from '../core/model/types';
import type { PartLookup } from '../core/parts/types';
import { spatialIndexFor } from '../state/selectors';
import { resolveColour } from './catalog';
import { touchesRegion } from './describe';
import type { BrickSpec, Region, ToolInput } from './protocol';

export class BuildError extends Error {}

export interface BuildContext {
  readonly lookup: PartLookup;
  readonly nextId: IdFactory;
  /** Most bricks the model may hold; MAX_BRICKS unless a test says otherwise. */
  readonly maxBricks?: number;
}

export interface Change<T> {
  readonly next: Model;
  readonly result: T;
}

const OUT_OF_BOUNDS = `outside the build area: whole parts must fit within x and z from -${GRID_LIMIT} to ${GRID_LIMIT - 1} studs and y from 0 to ${MAX_LAYER - 1} plates`;

function describeBrick(model: Model, id: string, lookup: PartLookup): string {
  const brick = model.bricks.get(id);
  if (!brick) return id;
  return `${id} (${lookup(brick.partId)?.name ?? brick.partId} at x ${brick.x}, y ${brick.y}, z ${brick.z})`;
}

/** The brick a spec asks for, or why it cannot be one. */
function candidate(spec: BrickSpec, context: BuildContext): Brick | string {
  const part = context.lookup(spec.part);
  if (!part) return `unknown part "${spec.part}": search with find_parts`;
  const colorId = resolveColour(spec.color);
  if (colorId === null) return `unknown colour "${spec.color}": see list_colors`;
  const brick: Brick = { id: context.nextId(), partId: part.id, colorId, x: spec.x, y: spec.y, z: spec.z, r: normalizeRotation(spec.rotation) };
  return isOutOfBounds(brick, context.lookup) ? OUT_OF_BOUNDS : brick;
}

/** The quarters of a cell a brick fills (see brickCellQuarters), each as a key. */
function quarterKeys(x: number, y: number, z: number, mask: number): string[] {
  return [0, 1, 2, 3].filter((q) => mask & (1 << q)).map((q) => `${x},${y},${z},${q}`);
}

/** What a new brick would overlap: a brick in the model, or one placed earlier in the same call. */
function overlap(brick: Brick, model: Model, index: SpatialIndex, claimed: ReadonlyMap<string, number>, lookup: PartLookup): string | null {
  for (const [x, y, z, mask] of brickCellQuarters(brick, lookup)) {
    const [owner] = index.ownersIn(x, y, z, mask);
    if (owner !== undefined) return `overlaps brick ${describeBrick(model, owner, lookup)}`;
    const earlier = quarterKeys(x, y, z, mask).map((key) => claimed.get(key)).find((at) => at !== undefined);
    if (earlier !== undefined) return `overlaps brick #${earlier} of this call`;
  }
  return null;
}

/** A box grown by one LDraw unit on every side: what touches it overlaps this. */
function grown(box: LduBox): LduBox {
  return { x0: box.x0 - 1, y0: box.y0 - 1, z0: box.z0 - 1, x1: box.x1 + 1, y1: box.y1 + 1, z1: box.z1 + 1 };
}

/**
 * Bricks it rests on or hangs from: those filling a cell just below or just
 * above one of its own, so nothing joins through the missing corner of an
 * L-shaped plate, and a plate can hang from the top of an arch. Parts off
 * the grid (on their sides, on side studs) join whatever they touch.
 */
function neighbours(brick: Brick, model: Model, index: SpatialIndex, lookup: PartLookup): string[] {
  const found = new Set<string>();
  const onGrid = isOnGrid(brick);
  if (onGrid) {
    // the same quarters below and above: bricks half a stud over join only where they overlap
    for (const [x, y, z, mask] of brickCellQuarters(brick, lookup)) {
      for (const owner of [...index.ownersIn(x, y - 1, z, mask), ...index.ownersIn(x, y + 1, z, mask)]) {
        if (owner !== brick.id) found.add(owner);
      }
    }
  }
  for (const box of brickLduSolids(brick, lookup)) {
    for (const owner of index.ownersInBox(grown(box))) {
      const other = model.bricks.get(owner);
      if (owner !== brick.id && other && (!onGrid || !isOnGrid(other))) found.add(owner);
    }
  }
  return [...found];
}

/** Bricks with no chain of bricks, each resting on or hanging from the next, down to the ground. */
export function floatingBricks(model: Model, lookup: PartLookup): ReadonlySet<string> {
  const index = spatialIndexFor(model, lookup);
  const grounded = allBricks(model).filter((b) => b.y === 0);
  const reached = new Set(grounded.map((b) => b.id));
  const queue = [...grounded];
  for (let brick = queue.pop(); brick; brick = queue.pop()) {
    for (const id of neighbours(brick, model, index, lookup)) {
      const next = model.bricks.get(id);
      if (next && !reached.has(id)) {
        reached.add(id);
        queue.push(next);
      }
    }
  }
  return new Set([...model.bricks.keys()].filter((id) => !reached.has(id)));
}

export interface PlaceResult {
  readonly placed: number;
  readonly ids: readonly string[];
  readonly rejected: readonly { readonly index: number; readonly reason: string }[];
  /** Indexes, in this call, of placed bricks with nothing holding them up. */
  readonly floating: readonly number[];
  readonly brick_count: number;
}

export function placeBricks(model: Model, input: ToolInput<'place_bricks'>, context: BuildContext): Change<PlaceResult> {
  const { lookup } = context;
  const maxBricks = context.maxBricks ?? MAX_BRICKS;
  const index = spatialIndexFor(model, lookup);
  const claimed = new Map<string, number>();
  const placed: { readonly brick: Brick; readonly index: number }[] = [];
  const rejected: { index: number; reason: string }[] = [];
  input.bricks.forEach((spec, i) => {
    const brick = candidate(spec, context);
    if (typeof brick === 'string') {
      rejected.push({ index: i, reason: brick });
      return;
    }
    const reason =
      model.bricks.size + placed.length >= maxBricks
        ? `the model is full: it holds at most ${maxBricks.toLocaleString('en')} bricks`
        : overlap(brick, model, index, claimed, lookup);
    if (reason !== null) {
      rejected.push({ index: i, reason });
      return;
    }
    for (const [x, y, z, mask] of brickCellQuarters(brick, lookup)) for (const key of quarterKeys(x, y, z, mask)) claimed.set(key, i);
    placed.push({ brick, index: i });
  });
  if (placed.length === 0 || (input.all_or_nothing && rejected.length > 0)) {
    return { next: model, result: { placed: 0, ids: [], rejected, floating: [], brick_count: model.bricks.size } };
  }
  const next = addBricks(model, placed.map((p) => p.brick));
  const floating = floatingBricks(next, lookup);
  return {
    next,
    result: {
      placed: placed.length,
      ids: placed.map((p) => p.brick.id),
      rejected,
      floating: placed.filter((p) => floating.has(p.brick.id)).map((p) => p.index),
      brick_count: next.bricks.size,
    },
  };
}

interface Picked {
  readonly bricks: readonly Brick[];
  readonly notFound: readonly string[];
}

/** The bricks a call names by id, reaches with a region, or both. */
function pick(model: Model, ids: readonly string[] | undefined, region: Region | undefined, lookup: PartLookup): Picked {
  if (!ids && !region) throw new BuildError('Give the ids of the bricks, a region, or both.');
  const chosen = new Map<string, Brick>();
  const notFound: string[] = [];
  for (const id of ids ?? []) {
    const brick = model.bricks.get(id);
    if (brick) chosen.set(id, brick);
    else notFound.push(id);
  }
  if (region) for (const brick of model.bricks.values()) if (touchesRegion(brick, region, lookup)) chosen.set(brick.id, brick);
  return { bricks: [...chosen.values()], notFound };
}

export function removeBricks(
  model: Model,
  input: ToolInput<'remove_bricks'>,
  lookup: PartLookup,
): Change<{ readonly removed: number; readonly not_found: readonly string[]; readonly brick_count: number }> {
  const { bricks, notFound } = pick(model, input.ids, input.region, lookup);
  const next = bricks.length > 0 ? withoutBricks(model, bricks.map((b) => b.id)) : model;
  return { next, result: { removed: bricks.length, not_found: notFound, brick_count: next.bricks.size } };
}

export function paintBricks(
  model: Model,
  input: ToolInput<'paint_bricks'>,
  lookup: PartLookup,
): Change<{ readonly painted: number; readonly not_found: readonly string[] }> {
  const colorId = resolveColour(input.color);
  if (colorId === null) throw new BuildError(`unknown colour "${input.color}": see list_colors`);
  const { bricks, notFound } = pick(model, input.ids, input.region, lookup);
  const next = recolorBricks(model, bricks.map((b) => b.id), colorId);
  return { next, result: { painted: bricks.length, not_found: notFound } };
}

export function moveBricks(
  model: Model,
  input: ToolInput<'move_bricks'>,
  lookup: PartLookup,
): Change<{ readonly moved: number; readonly not_found: readonly string[] }> {
  if (input.dx === 0 && input.dy === 0 && input.dz === 0) throw new BuildError('Nothing to move: give dx, dy or dz.');
  const { bricks, notFound } = pick(model, input.ids, input.region, lookup);
  const moved = bricks.map((b) => ({ ...b, x: b.x + input.dx, y: b.y + input.dy, z: b.z + input.dz }));
  if (moved.some((b) => isOutOfBounds(b, lookup))) throw new BuildError(`The bricks would leave the build area: ${OUT_OF_BOUNDS}.`);
  const index = spatialIndexFor(model, lookup);
  const moving = new Set(bricks.map((b) => b.id));
  for (const brick of moved) {
    const owner = firstOverlap(index, brick, lookup, moving);
    if (owner !== undefined) {
      throw new BuildError(`Nothing moved: brick ${brick.id} would overlap brick ${describeBrick(model, owner, lookup)}.`);
    }
  }
  const next = moved.length > 0 ? replaceBricks(model, moved) : model;
  return { next, result: { moved: bricks.length, not_found: notFound } };
}

export function clearModel(model: Model): Change<{ readonly removed: number }> {
  return { next: model.bricks.size > 0 ? emptyModel() : model, result: { removed: model.bricks.size } };
}

export { describeModel } from './describe';
