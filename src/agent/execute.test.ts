import { describe, expect, it } from 'bun:test';
import { createIdFactory } from '../core/model/ids';
import { allBricks } from '../core/model/model';
import { getPart, PARTS } from '../core/parts/catalog';
import { createFinder } from '../core/parts/finder/finder';
import { createEditorStore } from '../state/store';
import { runTool, type AgentHost, type LookRequest } from './execute';

function setup(overrides: Partial<AgentHost> = {}) {
  const store = createEditorStore({ lookup: getPart, nextId: createIdFactory('s') });
  const looks: LookRequest[] = [];
  let libraryLoads = 0;
  const host: AgentHost = {
    store,
    lookup: getPart,
    nextId: createIdFactory('a'),
    finder: () => createFinder(PARTS, []),
    loadLibrary: async () => {
      libraryLoads += 1;
      return true;
    },
    look: async (request) => {
      looks.push(request);
      return { data: 'aGVsbG8=', mimeType: 'image/jpeg' };
    },
    ...overrides,
  };
  return { host, store, looks, libraryLoads: () => libraryLoads, bricks: () => allBricks(store.getState().history.present) };
}

const placeTwo = { bricks: [{ part: 'brick-2x4', color: 'red', x: 0, y: 0, z: 0 }, { part: 'brick-2x4', color: 'red', x: 0, y: 3, z: 0 }] };

describe('running agent tools', () => {
  it('builds in the editor as one step the user can undo', async () => {
    const { host, store, bricks } = setup();
    const outcome = await runTool(host, 'place_bricks', placeTwo);
    expect(outcome).toMatchObject({ ok: true, data: { placed: 2, brick_count: 2 } });
    expect(bricks()).toHaveLength(2);
    store.getState().undo();
    expect(bricks()).toHaveLength(0);
  });

  it('turns bad input and impossible requests into messages for the agent', async () => {
    const { host } = setup();
    expect(await runTool(host, 'teleport', {})).toEqual({ ok: false, error: 'Unknown tool "teleport".' });
    const invalid = await runTool(host, 'place_bricks', { bricks: [] });
    expect(invalid).toMatchObject({ ok: false, error: expect.stringContaining('Invalid input for place_bricks. bricks:') });
    expect(await runTool(host, 'remove_bricks', {})).toEqual({ ok: false, error: 'Give the ids of the bricks, a region, or both.' });
  });

  it('describes, finds, paints, moves, removes and clears', async () => {
    const { host, bricks } = setup();
    const placed = await runTool(host, 'place_bricks', placeTwo);
    const ids = placed.ok ? (placed.data as { ids: string[] }).ids : [];
    expect(await runTool(host, 'get_model', {})).toMatchObject({ ok: true, data: { name: 'Untitled model', brick_count: 2 } });
    expect(await runTool(host, 'find_parts', { query: 'two by four brick', limit: 1 })).toEqual({
      ok: true,
      data: { parts: [{ part: 'brick-2x4', name: 'Brick 2 × 4', w: 4, d: 2, h: 3, source: 'basic' }], total: expect.any(Number) },
    });
    expect(await runTool(host, 'paint_bricks', { ids, color: 'Yellow' })).toEqual({ ok: true, data: { painted: 2, not_found: [] } });
    expect(await runTool(host, 'move_bricks', { ids, dx: 5 })).toEqual({ ok: true, data: { moved: 2, not_found: [] } });
    expect(bricks().map((b) => [b.colorId, b.x])).toEqual([
      [14, 5],
      [14, 5],
    ]);
    expect(await runTool(host, 'remove_bricks', { ids: [ids[1]] })).toMatchObject({ ok: true, data: { removed: 1 } });
    expect(await runTool(host, 'clear_model', { confirm: true })).toEqual({ ok: true, data: { removed: 1 } });
    expect(bricks()).toHaveLength(0);
  });

  it('lists colours, renames the model and undoes steps', async () => {
    const { host, store, bricks } = setup();
    const colours = await runTool(host, 'list_colors', {});
    expect(colours.ok && (colours.data as { colors: { name: string }[] }).colors.map((c) => c.name)).toContain('Dark Bluish Grey');
    expect(await runTool(host, 'set_model_name', { name: '  Little house ' })).toEqual({ ok: true, data: { name: 'Little house' } });
    expect(store.getState().name).toBe('Little house');
    await runTool(host, 'place_bricks', placeTwo);
    await runTool(host, 'paint_bricks', { region: { min: { x: 0, y: 0, z: 0 }, max: { x: 9, y: 9, z: 9 } }, color: 1 });
    expect(await runTool(host, 'undo', { steps: 5 })).toEqual({ ok: true, data: { undone: 2, brick_count: 0 } });
    expect(bricks()).toHaveLength(0);
  });

  it('loads the LDraw library before placing or finding its parts', async () => {
    const { host, libraryLoads } = setup();
    await runTool(host, 'place_bricks', placeTwo);
    expect(libraryLoads()).toBe(0);
    const outcome = await runTool(host, 'place_bricks', { bricks: [{ part: 'ldraw:3001', color: 4, x: 0, y: 6, z: 0 }] });
    expect(libraryLoads()).toBe(1);
    // this test's library is empty, so the part stays unknown
    expect(outcome).toMatchObject({ ok: true, data: { placed: 0, rejected: [{ index: 0, reason: expect.stringContaining('unknown part') }] } });
    await runTool(host, 'find_parts', { query: 'hinge' });
    expect(libraryLoads()).toBe(2);
  });

  it('still builds with the basic parts when the library cannot load', async () => {
    const { host } = setup({
      loadLibrary: async () => {
        throw new Error('offline');
      },
    });
    expect(await runTool(host, 'find_parts', { query: 'brick 2x4', limit: 1 })).toMatchObject({ ok: true, data: { parts: [{ part: 'brick-2x4' }] } });
  });

  it('shows the model, outlining bricks the agent asks about', async () => {
    const { host, looks } = setup();
    const placed = await runTool(host, 'place_bricks', placeTwo);
    const ids = placed.ok ? (placed.data as { ids: string[] }).ids : [];
    const outcome = await runTool(host, 'look', { view: 'front', highlight: [ids[0], 'gone'] });
    expect(outcome).toEqual({
      ok: true,
      data: { view: 'front', brick_count: 2, highlighted: 1 },
      image: { data: 'aGVsbG8=', mimeType: 'image/jpeg' },
    });
    expect(looks[0]?.view).toBe('front');
    expect(looks[0]?.highlight.map((b) => b.id)).toEqual(ids.slice(0, 1));
    expect(looks[0]?.bricks).toHaveLength(2);
  });

  it('says when there is nothing to look at, and when the picture fails', async () => {
    const empty = setup();
    expect(await runTool(empty.host, 'look', {})).toEqual({ ok: true, data: { view: 'iso', brick_count: 0, note: 'The model is empty: there is nothing to see yet.' } });
    const broken = setup({
      look: async () => {
        throw new Error('WebGL is off');
      },
    });
    await runTool(broken.host, 'place_bricks', placeTwo);
    expect(await runTool(broken.host, 'look', {})).toEqual({ ok: false, error: 'BrickBench could not draw the model: WebGL is off' });
  });
});
