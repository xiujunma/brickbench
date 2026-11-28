import { describe, expect, it } from 'bun:test';
import { createIdFactory } from '../core/model/ids';
import { allBricks } from '../core/model/model';
import { getPart, PARTS } from '../core/parts/catalog';
import { createFinder } from '../core/parts/finder/finder';
import { TOO_COSTLY_MESSAGE } from '../core/parts/pattern';
import { createEditorStore } from '../state/store';
import type { OwnedList } from '../core/inventory/stock';
import { NO_USER_VIEW_NOTE, runTool, type AgentHost, type LookRequest } from './execute';
import { VIEW_DIRECTIONS } from './views';
import { NO_LISTS_NOTE } from './owned';

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
      data: { parts: [{ part: 'brick-2x4', name: 'Brick 2 × 4', w: 4, d: 2, h: 3, source: 'basic', pattern: 'B[oooo]{2}=3001' }], total: expect.any(Number) },
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

  it('finds parts by part pattern, and says when a pattern does not read', async () => {
    const { host } = setup();
    expect(await runTool(host, 'find_parts', { query: 'S45[oo/..]' })).toEqual({
      ok: true,
      data: { parts: [{ part: 'slope45-2x2', name: 'Slope 45° 2 × 2', w: 2, d: 2, h: 3, source: 'basic', pattern: 'S45[oo/..]^3=3039' }], total: 1 },
    });
    const ids = async (query: string): Promise<string[]> => {
      const outcome = await runTool(host, 'find_parts', { query, limit: 50 });
      return outcome.ok ? (outcome.data as { parts: { part: string }[] }).parts.map((p) => p.part) : [];
    };
    expect(await ids('B1x(1|2)')).toEqual(['brick-1x1', 'brick-1x2']);
    expect(await ids('R[o]^1')).toEqual(['round-plate-1x1']);
    const broken = await runTool(host, 'find_parts', { query: 'P2x4 [oo' });
    expect(broken).toMatchObject({ ok: true, data: { parts: [], note: expect.stringContaining('A “[” needs its “]” (at character 6)') } });
    // words that only look like patterns stay words
    expect(await ids('BAR')).toEqual([]);
    expect(await runTool(host, 'find_parts', { query: 'BRICK 2x4', limit: 1 })).toMatchObject({ ok: true, data: { parts: [{ part: 'brick-2x4' }] } });
  });

  it('takes back any part’s own pattern, however long', async () => {
    const { host } = setup();
    const long = `*[${'#_'.repeat(60)}]^3`;
    expect(await runTool(host, 'find_parts', { query: long })).toMatchObject({ ok: true, data: { parts: [], total: 0 } });
  });

  it('says when a pattern asks too much of a search', async () => {
    const { host } = setup({ finder: () => createFinder(PARTS, [], 100) });
    expect(await runTool(host, 'find_parts', { query: '[(o|.)*(oo|.o){2}]{1,16}' })).toEqual({ ok: false, error: `${TOO_COSTLY_MESSAGE}.` });
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
    expect(looks[0]?.direction).toEqual(VIEW_DIRECTIONS.front);
    expect(looks[0]?.highlight.map((b) => b.id)).toEqual(ids.slice(0, 1));
    expect(looks[0]?.bricks).toHaveLength(2);
  });

  it('looks from where the user looks when asked, or as iso, saying why, without their view to go by', async () => {
    const turned = { x: 0.5, y: -0.5, z: -0.7 };
    const withCamera = setup({ userView: () => turned });
    await runTool(withCamera.host, 'place_bricks', placeTwo);
    const seen = await runTool(withCamera.host, 'look', { view: 'user' });
    expect(seen).toMatchObject({ ok: true, data: { view: 'user', brick_count: 2 } });
    expect(seen.ok && (seen.data as Record<string, unknown>)['note']).toBeUndefined();
    expect(withCamera.looks[0]?.direction).toEqual(turned);
    for (const without of [setup(), setup({ userView: () => null })]) {
      await runTool(without.host, 'place_bricks', placeTwo);
      expect(await runTool(without.host, 'look', { view: 'user' })).toMatchObject({ ok: true, data: { view: 'iso', note: NO_USER_VIEW_NOTE } });
      expect(without.looks[0]?.direction).toEqual(VIEW_DIRECTIONS.iso);
    }
    // the fixed views never ask where the user looks
    let asked = 0;
    const fixed = setup({
      userView: () => {
        asked += 1;
        return turned;
      },
    });
    await runTool(fixed.host, 'place_bricks', placeTwo);
    await runTool(fixed.host, 'look', { view: 'front' });
    expect(asked).toBe(0);
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

const MY_SETS: readonly OwnedList[] = [
  {
    id: 'shop',
    name: 'Flower Shop',
    catalogue: 'rebrickable',
    copies: 2,
    lots: [
      { part: '3001', colour: 4, quantity: 1 },
      { part: '3023b', colour: 15, quantity: 3 },
    ],
    unmatched: [],
  },
];

describe("building with the user's own parts", () => {
  it('lists the parts the user owns with how many the model leaves', async () => {
    const { host } = setup({ ownedLists: () => MY_SETS });
    await runTool(host, 'place_bricks', { bricks: [{ part: 'brick-2x4', color: 'red', x: 0, y: 0, z: 0 }] });
    expect(await runTool(host, 'list_owned_parts', {})).toEqual({
      ok: true,
      data: {
        lists: [{ name: 'Flower Shop', copies: 2 }],
        parts: [
          { part: 'brick-2x4', name: 'Brick 2 × 4', w: 4, d: 2, h: 3, color: 4, color_name: 'Red', owned: 2, used: 1, left: 1 },
          { part: 'plate-1x2', name: 'Plate 1 × 2', w: 2, d: 1, h: 1, color: 15, color_name: 'White', owned: 6, used: 0, left: 6 },
        ],
        total: 2,
        truncated: false,
      },
    });
  });

  it('narrows the list by words, colour and what is left', async () => {
    const { host } = setup({ ownedLists: () => MY_SETS });
    const parts = async (input: object) => {
      const outcome = await runTool(host, 'list_owned_parts', input);
      return outcome.ok ? (outcome.data as { parts: { part: string }[] }).parts.map((p) => p.part) : outcome.error;
    };
    expect(await parts({ query: 'plate' })).toEqual(['plate-1x2']);
    expect(await parts({ query: 'red' })).toEqual(['brick-2x4']);
    expect(await parts({ limit: 1 })).toEqual(['brick-2x4']);
    await runTool(host, 'place_bricks', {
      bricks: [
        { part: 'brick-2x4', color: 'red', x: 0, y: 0, z: 0 },
        { part: 'brick-2x4', color: 'red', x: 0, y: 3, z: 0 },
      ],
    });
    expect(await parts({ only_left: true })).toEqual(['plate-1x2']);
  });

  it('says when the user has added no parts lists', async () => {
    const { host } = setup();
    expect(await runTool(host, 'list_owned_parts', {})).toEqual({ ok: true, data: { lists: [], parts: [], total: 0, note: NO_LISTS_NOTE } });
    expect(await runTool(host, 'find_parts', { query: 'brick 2x4', limit: 1, owned_only: true })).toMatchObject({ ok: true, data: { note: NO_LISTS_NOTE } });
  });

  it('finds owned parts only when asked, with the colours the user has', async () => {
    const { host } = setup({ ownedLists: () => MY_SETS });
    expect(await runTool(host, 'find_parts', { query: 'brick', limit: 2, owned_only: true })).toEqual({
      ok: true,
      data: {
        parts: [{ part: 'brick-2x4', name: 'Brick 2 × 4', w: 4, d: 2, h: 3, source: 'basic', pattern: 'B[oooo]{2}=3001', owned: [{ color: 4, color_name: 'Red', left: 2 }] }],
        total: 1,
      },
    });
    // @owned keeps a part pattern to the user's parts, owned_only or not
    expect(await runTool(host, 'find_parts', { query: '@owned B' })).toMatchObject({ ok: true, data: { parts: [{ part: 'brick-2x4' }], total: 1 } });
    const any = await runTool(host, 'find_parts', { query: 'brick 1x2', limit: 1 });
    expect(any).toMatchObject({ ok: true, data: { parts: [{ part: 'brick-1x2', owned: [] }] } });
  });

  it('says which parts the model now uses more of than the user owns', async () => {
    const { host } = setup({ ownedLists: () => MY_SETS });
    const three = await runTool(host, 'place_bricks', {
      bricks: [
        { part: 'brick-2x4', color: 'red', x: 0, y: 0, z: 0 },
        { part: 'brick-2x4', color: 'red', x: 0, y: 3, z: 0 },
        { part: 'brick-2x4', color: 'red', x: 0, y: 6, z: 0 },
        { part: 'plate-1x2', color: 'white', x: 4, y: 0, z: 0 },
      ],
    });
    expect(three).toMatchObject({ ok: true, data: { placed: 4, over_owned: [{ part: 'brick-2x4', color: 4, owned: 2, used: 3 }] } });
    const noSets = setup();
    const plain = await runTool(noSets.host, 'place_bricks', placeTwo);
    expect(plain.ok && 'over_owned' in (plain.data as object)).toBe(false);
  });

  it('says when painting uses up more of a colour than the user owns', async () => {
    const { host } = setup({ ownedLists: () => MY_SETS });
    const placed = await runTool(host, 'place_bricks', { bricks: [0, 3, 6].map((y) => ({ part: 'brick-2x4', color: 'blue', x: 0, y, z: 0 })) });
    const ids = placed.ok ? (placed.data as { ids: string[] }).ids : [];
    expect(await runTool(host, 'paint_bricks', { ids: ids.slice(0, 2), color: 'red' })).toEqual({ ok: true, data: { painted: 2, not_found: [], over_owned: [] } });
    expect(await runTool(host, 'paint_bricks', { ids, color: 'red' })).toEqual({
      ok: true,
      data: { painted: 3, not_found: [], over_owned: [{ part: 'brick-2x4', color: 4, owned: 2, used: 3 }] },
    });
  });
});
