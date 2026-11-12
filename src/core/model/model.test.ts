import { describe, expect, it } from 'bun:test';
import {
  addBricks,
  allBricks,
  emptyModel,
  getBricks,
  modelFromBricks,
  recolorBricks,
  removeBricks,
  replaceBricks,
  translateBricks,
} from './model';
import { createIdFactory } from './ids';
import { makeBrick } from './testUtils';

describe('model operations', () => {
  it('starts empty', () => {
    expect(allBricks(emptyModel())).toEqual([]);
  });

  it('adds bricks without mutating the original model', () => {
    const original = emptyModel();
    const next = addBricks(original, [makeBrick({ id: 'a' }), makeBrick({ id: 'b', x: 4 })]);
    expect(original.bricks.size).toBe(0);
    expect(allBricks(next).map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('refuses duplicate ids', () => {
    const model = modelFromBricks([makeBrick({ id: 'a' })]);
    expect(() => addBricks(model, [makeBrick({ id: 'a' })])).toThrow(/duplicate/i);
  });

  it('removes bricks by id and returns the same model when nothing changes', () => {
    const model = modelFromBricks([makeBrick({ id: 'a' }), makeBrick({ id: 'b' })]);
    const next = removeBricks(model, ['a', 'missing']);
    expect(allBricks(next).map((b) => b.id)).toEqual(['b']);
    expect(allBricks(model)).toHaveLength(2);
    expect(removeBricks(model, ['missing'])).toBe(model);
  });

  it('translates only the chosen bricks', () => {
    const model = modelFromBricks([makeBrick({ id: 'a' }), makeBrick({ id: 'b', x: 10 })]);
    const next = translateBricks(model, ['a'], { x: 1, y: 3, z: -2 });
    expect(next.bricks.get('a')).toMatchObject({ x: 1, y: 3, z: -2 });
    expect(next.bricks.get('b')).toMatchObject({ x: 10, y: 0, z: 0 });
    expect(model.bricks.get('a')).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it('recolours bricks and skips no-op updates', () => {
    const model = modelFromBricks([makeBrick({ id: 'a', colorId: 4 })]);
    expect(recolorBricks(model, ['a'], 1).bricks.get('a')?.colorId).toBe(1);
    expect(recolorBricks(model, ['a'], 4)).toBe(model);
  });

  it('replaces bricks with new placements', () => {
    const model = modelFromBricks([makeBrick({ id: 'a' })]);
    const next = replaceBricks(model, [makeBrick({ id: 'a', x: 5, r: 1 })]);
    expect(next.bricks.get('a')).toMatchObject({ x: 5, r: 1 });
  });

  it('gets existing bricks in the requested order', () => {
    const model = modelFromBricks([makeBrick({ id: 'a' }), makeBrick({ id: 'b' })]);
    expect(getBricks(model, ['b', 'nope', 'a']).map((b) => b.id)).toEqual(['b', 'a']);
  });
});

describe('id factory', () => {
  it('creates unique ids', () => {
    const next = createIdFactory();
    const ids = Array.from({ length: 500 }, () => next());
    expect(new Set(ids).size).toBe(500);
    expect(ids.every((id) => /^b[a-z0-9]+$/.test(id))).toBe(true);
  });
});
