import { describe, expect, it } from 'bun:test';
import { PLATE_HEIGHT } from '../core/grid';
import { modelFromBricks } from '../core/model/model';
import { makeBrick } from '../core/model/testUtils';
import { getPart } from '../core/parts/catalog';
import { bricksFit, bricksOf, distinctPieces, selectedBricks, spatialIndexFor, worldBounds } from './selectors';
import { createHistory } from '../core/history';

const model = modelFromBricks([
  makeBrick({ id: 'a' }),
  makeBrick({ id: 'b', x: 4, colorId: 1 }),
  makeBrick({ id: 'c', x: 8, y: 3 }),
]);

describe('selectors', () => {
  it('builds the spatial index and brick list once per model', () => {
    expect(spatialIndexFor(model, getPart)).toBe(spatialIndexFor(model, getPart));
    expect(bricksOf(model)).toBe(bricksOf(model));
    expect(spatialIndexFor(model, getPart).owner(5, 0, 0)).toBe('b');
  });

  it('keeps caches for the latest models only, so undo snapshots do not pin indexes', () => {
    const models = [0, 1, 2].map((i) => modelFromBricks([makeBrick({ id: `m${i}`, x: i * 4 })]));
    const [first, second, third] = models as [typeof model, typeof model, typeof model];
    const original = spatialIndexFor(first, getPart);
    spatialIndexFor(second, getPart);
    spatialIndexFor(third, getPart);
    expect(spatialIndexFor(first, getPart)).not.toBe(original);
    expect(spatialIndexFor(first, getPart).owner(0, 0, 0)).toBe('m0');
  });

  it('counts distinct part and colour combinations', () => {
    expect(distinctPieces(model)).toBe(2);
    expect(distinctPieces(modelFromBricks([]))).toBe(0);
  });

  it('returns the selected bricks that still exist', () => {
    const state = { history: createHistory(model), selection: new Set(['c', 'gone']) };
    expect(selectedBricks(state).map((b) => b.id)).toEqual(['c']);
  });

  it('checks whether bricks fit', () => {
    expect(bricksFit(model, [makeBrick({ id: 'n', x: 2 })], getPart)).toBe(false);
    expect(bricksFit(model, [makeBrick({ id: 'n', x: 2 })], getPart, new Set(['a', 'b']))).toBe(true);
    expect(bricksFit(model, [makeBrick({ id: 'n', partId: 'nope' })], getPart)).toBe(false);
    expect(bricksFit(model, [makeBrick({ id: 'n', y: -3 })], getPart)).toBe(false);
  });

  it('measures world bounds with headroom for studs', () => {
    expect(worldBounds([], getPart)).toBeNull();
    const bounds = worldBounds(bricksOf(model), getPart);
    expect(bounds?.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(bounds?.max.x).toBe(12);
    expect(bounds?.max.y).toBeCloseTo(6.5 * PLATE_HEIGHT);
    expect(bounds?.max.z).toBe(2);
  });
});
