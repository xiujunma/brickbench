import { describe, expect, it } from 'bun:test';
import { toPartDef } from '../core/ldraw/catalogIndex';
import { createIdFactory } from '../core/model/ids';
import { addBricks, allBricks, emptyModel } from '../core/model/model';
import type { Brick, Model } from '../core/model/types';
import { getPart } from '../core/parts/catalog';
import { clearModel, describeModel, moveBricks, paintBricks, placeBricks, removeBricks, type BuildContext } from './build';
import { parseToolInput, type ToolInput, type ToolName } from './protocol';

const context = (maxBricks?: number): BuildContext => ({ lookup: getPart, nextId: createIdFactory('t'), ...(maxBricks ? { maxBricks } : {}) });

/** Tool input as the agent would send it, defaults filled in. */
function input<T extends ToolName>(tool: T, raw: unknown): ToolInput<T> {
  const parsed = parseToolInput(tool, raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

const brick = (id: string, partId: string, x: number, y: number, z: number, colorId = 4): Brick => ({ id, partId, colorId, x, y, z, r: 0 });
const modelOf = (...bricks: Brick[]): Model => addBricks(emptyModel(), bricks);

/** A library Plate 2 × 2 Corner: three of the four cells of its box, the one at x 1, z 1 left free. */
const corner = toPartDef({
  id: 'test-corner', name: 'Plate 2 × 2 Corner', category: 'Plate', w: 2, d: 2, h: 1, origin: [0, 0.4, 0], snug: true,
  solids: [[0, 0, 0, 2, 1, 1], [0, 0, 1, 1, 1, 2]],
});
const withCorner = (id: string) => (id === corner.id ? corner : getPart(id));

describe('placing bricks', () => {
  it('places bricks, stacked in one call, as one change', () => {
    const { next, result } = placeBricks(
      emptyModel(),
      input('place_bricks', {
        bricks: [
          { part: 'brick-2x4', color: 4, x: 0, y: 0, z: 0 },
          { part: 'brick-2x4', color: 'blue', x: 0, y: 3, z: 0 },
        ],
      }),
      context(),
    );
    expect(result.placed).toBe(2);
    expect(result.ids).toHaveLength(2);
    expect(result.rejected).toEqual([]);
    expect(result.floating).toEqual([]);
    expect(result.brick_count).toBe(2);
    expect(allBricks(next).map((b) => [b.partId, b.colorId, b.y])).toEqual([
      ['brick-2x4', 4, 0],
      ['brick-2x4', 1, 3],
    ]);
  });

  it('says which brick is in the way, in the model or earlier in the same call', () => {
    const model = modelOf(brick('old', 'brick-2x4', 0, 0, 0));
    const { next, result } = placeBricks(
      model,
      input('place_bricks', {
        bricks: [
          { part: 'brick-2x4', color: 4, x: 2, y: 0, z: 0 },
          { part: 'brick-1x1', color: 4, x: 6, y: 0, z: 0 },
          { part: 'brick-1x1', color: 4, x: 6, y: 0, z: 0 },
        ],
      }),
      context(),
    );
    expect(result.placed).toBe(1);
    expect(result.rejected).toEqual([
      { index: 0, reason: expect.stringContaining('overlaps brick old') },
      { index: 2, reason: 'overlaps brick #1 of this call' },
    ]);
    expect(next.bricks.size).toBe(2);
  });

  it('turns parts a quarter at a time, the footprint turning with them', () => {
    const { next } = placeBricks(emptyModel(), input('place_bricks', { bricks: [{ part: 'brick-2x4', color: 4, x: 0, y: 0, z: 0, rotation: 1 }] }), context());
    // turned, a 2 × 4 runs 4 studs along z: a 1 × 1 at z = 3 overlaps, one at x = 2 does not
    const probe = (x: number, z: number) =>
      placeBricks(next, input('place_bricks', { bricks: [{ part: 'brick-1x1', color: 4, x, y: 0, z }] }), context()).result.placed;
    expect(probe(0, 3)).toBe(0);
    expect(probe(2, 0)).toBe(1);
  });

  it('explains parts, colours and places it cannot use', () => {
    const { result } = placeBricks(
      emptyModel(),
      input('place_bricks', {
        bricks: [
          { part: 'brick-9x9', color: 4, x: 0, y: 0, z: 0 },
          { part: 'brick-1x1', color: 'plaid', x: 0, y: 0, z: 0 },
          { part: 'brick-1x1', color: 99_999, x: 0, y: 0, z: 0 },
          { part: 'brick-2x4', color: 4, x: 511, y: 0, z: 0 },
        ],
      }),
      context(),
    );
    expect(result.placed).toBe(0);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      'unknown part "brick-9x9": search with find_parts',
      'unknown colour "plaid": see list_colors',
      'unknown colour "99999": see list_colors',
      expect.stringContaining('outside the build area'),
    ]);
  });

  it('keeps parts inside the build area, edges included', () => {
    const at = (x: number, y: number) =>
      placeBricks(emptyModel(), input('place_bricks', { bricks: [{ part: 'plate-1x1', color: 4, x, y, z: 0 }] }), context()).result;
    expect(at(511, 1022).placed).toBe(1);
    expect(at(-512, 0).placed).toBe(1);
    expect(at(512, 0).rejected[0]?.reason).toBe('outside the build area: whole parts must fit within x and z from -512 to 511 studs and y from 0 to 1022 plates');
    expect(at(0, 1023).placed).toBe(0);
  });

  it('takes colours by name or code, spelt either way', () => {
    const { next } = placeBricks(
      emptyModel(),
      input('place_bricks', {
        bricks: [
          { part: 'brick-1x1', color: 'Dark Bluish Gray', x: 0, y: 0, z: 0 },
          { part: 'brick-1x1', color: 'trans clear', x: 1, y: 0, z: 0 },
          { part: 'brick-1x1', color: '15', x: 2, y: 0, z: 0 },
        ],
      }),
      context(),
    );
    expect(allBricks(next).map((b) => b.colorId)).toEqual([72, 47, 15]);
  });

  it('places nothing when asked for all or nothing and one brick fails', () => {
    const model = emptyModel();
    const { next, result } = placeBricks(
      model,
      input('place_bricks', {
        all_or_nothing: true,
        bricks: [
          { part: 'brick-1x1', color: 4, x: 0, y: 0, z: 0 },
          { part: 'nope', color: 4, x: 1, y: 0, z: 0 },
        ],
      }),
      context(),
    );
    expect(next).toBe(model);
    expect(result.placed).toBe(0);
    expect(result.ids).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it('points out bricks with no chain of bricks down to the ground', () => {
    const { result } = placeBricks(
      emptyModel(),
      input('place_bricks', {
        bricks: [
          { part: 'brick-2x4', color: 4, x: 0, y: 0, z: 0 },
          { part: 'brick-2x4', color: 4, x: 0, y: 3, z: 0 },
          // overhangs the brick below by two studs…
          { part: 'brick-2x4', color: 4, x: 2, y: 6, z: 0 },
          // …and this plate hangs under the overhang
          { part: 'plate-1x2', color: 4, x: 4, y: 5, z: 0 },
          { part: 'plate-2x2', color: 4, x: 10, y: 9, z: 10 },
          // a pair joined to each other but to nothing else
          { part: 'brick-2x4', color: 4, x: 20, y: 6, z: 20 },
          { part: 'brick-2x4', color: 4, x: 20, y: 3, z: 20 },
        ],
      }),
      context(),
    );
    expect(result.placed).toBe(7);
    expect(result.floating).toEqual([4, 5, 6]);
  });

  it('joins bricks by the cells they fill, not by their whole boxes', () => {
    // the underside of the arch's top over its third stud
    const archTop = getPart('arch-1x6x2')?.solids.find((solid) => solid.x0 === 2)?.y0 ?? 0;
    expect(archTop).toBeGreaterThan(1);
    const { result } = placeBricks(
      emptyModel(),
      input('place_bricks', {
        bricks: [
          { part: corner.id, color: 4, x: 0, y: 0, z: 0 },
          // a brick over a cell the corner plate fills rests on it…
          { part: 'brick-1x1', color: 4, x: 0, y: 1, z: 0 },
          // …one over its missing corner does not
          { part: 'brick-1x1', color: 4, x: 1, y: 1, z: 1 },
          // a plate under the top of an arch hangs from it
          { part: 'arch-1x6x2', color: 4, x: 10, y: 0, z: 0 },
          { part: 'plate-1x2', color: 4, x: 12, y: archTop - 1, z: 0 },
          // and a corner plate's missing corner is free for a plate of its own
          { part: corner.id, color: 4, x: 0, y: 0, z: 5 },
          { part: 'plate-1x1', color: 4, x: 1, y: 0, z: 6 },
        ],
      }),
      { ...context(), lookup: withCorner },
    );
    expect(result.rejected).toEqual([]);
    expect(result.floating).toEqual([2]);
  });

  it('stops at the most bricks a model may hold', () => {
    const { result } = placeBricks(
      modelOf(brick('a', 'brick-1x1', 0, 0, 0)),
      input('place_bricks', {
        bricks: [
          { part: 'brick-1x1', color: 4, x: 1, y: 0, z: 0 },
          { part: 'brick-1x1', color: 4, x: 2, y: 0, z: 0 },
        ],
      }),
      context(2),
    );
    expect(result.placed).toBe(1);
    expect(result.rejected).toEqual([{ index: 1, reason: 'the model is full: it holds at most 2 bricks' }]);
  });
});

describe('changing bricks', () => {
  const house = (): Model =>
    modelOf(brick('a', 'brick-2x4', 0, 0, 0), brick('b', 'brick-2x4', 0, 3, 0, 1), brick('c', 'plate-2x2', 10, 0, 10, 15));

  it('removes bricks by id or by the region they reach into', () => {
    const byId = removeBricks(house(), input('remove_bricks', { ids: ['a', 'zz'] }), getPart);
    expect(byId.result).toEqual({ removed: 1, not_found: ['zz'], brick_count: 2 });
    const byRegion = removeBricks(house(), input('remove_bricks', { region: { min: { x: 0, y: 4, z: 0 }, max: { x: 3, y: 9, z: 1 } } }), getPart);
    expect(allBricks(byRegion.next).map((b) => b.id)).toEqual(['a', 'c']);
  });

  it('asks for ids or a region', () => {
    expect(() => removeBricks(house(), input('remove_bricks', {}), getPart)).toThrow('Give the ids of the bricks, a region, or both.');
  });

  it('finds bricks in a region by the cells they fill, not by their whole boxes', () => {
    // a plate in the corner plate's free corner: a region of just that cell holds the plate alone
    const model = modelOf(brick('corner', corner.id, 0, 0, 0), brick('dot', 'plate-1x1', 1, 0, 1));
    const cornerCell = { region: { min: { x: 1, y: 0, z: 1 }, max: { x: 1, y: 0, z: 1 } } };
    expect(allBricks(removeBricks(model, input('remove_bricks', cornerCell), withCorner).next).map((b) => b.id)).toEqual(['corner']);
    expect(paintBricks(model, input('paint_bricks', { ...cornerCell, color: 'blue' }), withCorner).result.painted).toBe(1);
    expect(describeModel(model, 'Corner', input('get_model', cornerCell), withCorner).bricks.map((b) => b.id)).toEqual(['dot']);
  });

  it('paints bricks by name of colour', () => {
    const { next, result } = paintBricks(house(), input('paint_bricks', { ids: ['a', 'c'], color: 'yellow' }), getPart);
    expect(result).toEqual({ painted: 2, not_found: [] });
    expect(allBricks(next).map((b) => b.colorId)).toEqual([14, 1, 14]);
    expect(() => paintBricks(house(), input('paint_bricks', { ids: ['a'], color: 'plaid' }), getPart)).toThrow('unknown colour "plaid"');
  });

  it('moves bricks together, unless they would hit others or leave the build area', () => {
    const moved = moveBricks(house(), input('move_bricks', { ids: ['a', 'b'], dx: 2 }), getPart);
    expect(moved.result).toEqual({ moved: 2, not_found: [] });
    expect(allBricks(moved.next).map((b) => b.x)).toEqual([2, 2, 10]);
    expect(() => moveBricks(house(), input('move_bricks', { ids: ['c'], dx: -10, dz: -10 }), getPart)).toThrow('would overlap brick a');
    expect(() => moveBricks(house(), input('move_bricks', { ids: ['c'], dx: 600 }), getPart)).toThrow('would leave the build area');
  });

  it('refuses a move that goes nowhere, rather than adding a step to undo', () => {
    expect(() => moveBricks(house(), input('move_bricks', { ids: ['a'] }), getPart)).toThrow('Nothing to move: give dx, dy or dz.');
  });

  it('clears the whole model', () => {
    const { next, result } = clearModel(house());
    expect(result).toEqual({ removed: 3 });
    expect(next.bricks.size).toBe(0);
  });
});

describe('describing the model', () => {
  const model = modelOf(brick('b', 'brick-2x4', 0, 3, 0, 1), brick('a', 'brick-2x4', 0, 0, 0), brick('c', 'plate-2x2', 10, 0, 10, 4));

  it('sums up parts, colours and size, and lists bricks bottom layer first', () => {
    const data = describeModel(model, 'Hut', input('get_model', {}), getPart);
    expect(data.name).toBe('Hut');
    expect(data.brick_count).toBe(3);
    expect(data.bounds).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 11, y: 5, z: 11 } });
    expect(data.parts).toEqual([
      { part: 'brick-2x4', name: 'Brick 2 × 4', w: 4, d: 2, h: 3, count: 2 },
      { part: 'plate-2x2', name: 'Plate 2 × 2', w: 2, d: 2, h: 1, count: 1 },
    ]);
    expect(data.colors).toEqual([
      { id: 4, name: 'Red', count: 2 },
      { id: 1, name: 'Blue', count: 1 },
    ]);
    expect(data.bricks.map((b) => b.id)).toEqual(['a', 'c', 'b']);
    expect(data.bricks[0]).toEqual({ id: 'a', part: 'brick-2x4', color: 4, x: 0, y: 0, z: 0, r: 0 });
    expect(data.truncated).toBe(false);
  });

  it('lists only bricks in a region, up to a limit', () => {
    const region = describeModel(model, 'Hut', input('get_model', { region: { min: { x: 9, y: 0, z: 9 }, max: { x: 20, y: 0, z: 20 } } }), getPart);
    expect(region.bricks.map((b) => b.id)).toEqual(['c']);
    expect(region.matching).toBe(1);
    const limited = describeModel(model, 'Hut', input('get_model', { limit: 1 }), getPart);
    expect(limited.bricks).toHaveLength(1);
    expect(limited.truncated).toBe(true);
    expect(describeModel(emptyModel(), 'Empty', input('get_model', {}), getPart).bounds).toBeNull();
  });
});
