import type { Vec3 } from '../grid';
import type { Brick, Model } from './types';

/**
 * Pure model operations. Each returns a new model (or the same one when
 * nothing changed) and never mutates its input.
 */
export function emptyModel(): Model {
  return { bricks: new Map() };
}

export function modelFromBricks(bricks: Iterable<Brick>): Model {
  return addBricks(emptyModel(), [...bricks]);
}

export function allBricks(model: Model): Brick[] {
  return [...model.bricks.values()];
}

export function getBricks(model: Model, ids: Iterable<string>): Brick[] {
  const found: Brick[] = [];
  for (const id of ids) {
    const brick = model.bricks.get(id);
    if (brick) found.push(brick);
  }
  return found;
}

export function addBricks(model: Model, bricks: readonly Brick[]): Model {
  if (bricks.length === 0) return model;
  const next = new Map(model.bricks);
  for (const brick of bricks) {
    if (next.has(brick.id)) throw new Error(`Duplicate brick id: ${brick.id}`);
    next.set(brick.id, brick);
  }
  return { ...model, bricks: next };
}

export function removeBricks(model: Model, ids: Iterable<string>): Model {
  const doomed = [...ids].filter((id) => model.bricks.has(id));
  if (doomed.length === 0) return model;
  const next = new Map(model.bricks);
  for (const id of doomed) next.delete(id);
  return { ...model, bricks: next };
}

/** Inserts or replaces bricks by id. */
export function replaceBricks(model: Model, bricks: readonly Brick[]): Model {
  if (bricks.length === 0) return model;
  const next = new Map(model.bricks);
  for (const brick of bricks) next.set(brick.id, brick);
  return { ...model, bricks: next };
}

function mapBricks(model: Model, ids: Iterable<string>, update: (brick: Brick) => Brick): Model {
  const changed: Brick[] = [];
  for (const brick of getBricks(model, ids)) {
    const updated = update(brick);
    if (updated !== brick) changed.push(updated);
  }
  return replaceBricks(model, changed);
}

export function translateBricks(model: Model, ids: Iterable<string>, delta: Vec3): Model {
  if (delta.x === 0 && delta.y === 0 && delta.z === 0) return model;
  return mapBricks(model, ids, (b) => ({ ...b, x: b.x + delta.x, y: b.y + delta.y, z: b.z + delta.z }));
}

export function recolorBricks(model: Model, ids: Iterable<string>, colorId: number): Model {
  return mapBricks(model, ids, (b) => (b.colorId === colorId ? b : { ...b, colorId }));
}
