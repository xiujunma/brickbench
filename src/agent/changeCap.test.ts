import { describe, expect, it } from 'bun:test';
import { createIdFactory } from '../core/model/ids';
import { getPart, PARTS } from '../core/parts/catalog';
import { createFinder } from '../core/parts/finder/finder';
import { createEditorStore } from '../state/store';
import { capReached, CHANGING_TOOLS, createChangeCap } from './changeCap';
import { runTool, type AgentHost } from './execute';
import { TOOL_NAMES, type ToolName, type ToolOutcome } from './protocol';

const refused = (): Promise<ToolOutcome> => Promise.resolve({ ok: false, error: 'No such brick' });
/** A call that answers ok but changes nothing, as placing only overlapping bricks does. */
const unchanged = (): Promise<ToolOutcome> => Promise.resolve({ ok: true, data: { placed: 0 } });

function counting(cap: number | null) {
  let limit = cap;
  let calls = 0;
  // a new object whenever a call changes the model
  let model = {};
  const changeCap = createChangeCap(
    () => limit,
    () => [model],
  );
  const change = (): void => void (model = {});
  const done = (): Promise<ToolOutcome> => {
    change();
    return Promise.resolve({ ok: true, data: { done: true } });
  };
  const call = (tool: string, outcome: () => Promise<ToolOutcome> = done) =>
    changeCap.run(tool, () => {
      calls += 1;
      return outcome();
    });
  return { changeCap, call, change, calls: () => calls, setLimit: (next: number | null) => void (limit = next) };
}

describe('a cap on the changes one request makes', () => {
  it('refuses a change once the request has made as many as the cap, without running it', async () => {
    const { changeCap, call, calls } = counting(2);
    changeCap.begin();
    expect(await call('place_bricks')).toEqual({ ok: true, data: { done: true } });
    expect(await call('paint_bricks')).toEqual({ ok: true, data: { done: true } });
    expect(await call('move_bricks')).toEqual({ ok: false, error: capReached(2) });
    expect(calls()).toBe(2);
  });

  it('counts only changes: reading the model and looking at it are free', async () => {
    const { changeCap, call, calls } = counting(1);
    changeCap.begin();
    await call('place_bricks');
    for (const tool of ['get_model', 'look', 'find_parts', 'list_colors']) expect((await call(tool)).ok).toBe(true);
    expect(calls()).toBe(5);
    expect((await call('remove_bricks')).ok).toBe(false);
  });

  it('knows of every tool whether it changes the model', () => {
    const reading: readonly ToolName[] = ['find_parts', 'get_model', 'list_colors', 'list_owned_parts', 'look'];
    expect([...CHANGING_TOOLS].sort()).toEqual(['clear_model', 'move_bricks', 'paint_bricks', 'place_bricks', 'remove_bricks', 'set_model_name', 'undo']);
    // a tool added later is one or the other
    expect([...TOOL_NAMES].sort()).toEqual([...(CHANGING_TOOLS as ReadonlySet<ToolName>), ...reading].sort());
  });

  it('gives a change back when the call left the model as it was', async () => {
    const { changeCap, call } = counting(1);
    changeCap.begin();
    expect((await call('place_bricks', unchanged)).ok).toBe(true);
    expect((await call('undo', unchanged)).ok).toBe(true);
    expect((await call('place_bricks')).ok).toBe(true);
    expect((await call('place_bricks')).ok).toBe(false);
  });

  it('does not count a change that was refused for its own reasons', async () => {
    const { changeCap, call } = counting(1);
    changeCap.begin();
    expect(await call('remove_bricks', refused)).toEqual({ ok: false, error: 'No such brick' });
    expect((await call('remove_bricks')).ok).toBe(true);
    expect((await call('remove_bricks')).ok).toBe(false);
  });

  it('starts counting afresh with each request', async () => {
    const { changeCap, call } = counting(1);
    changeCap.begin();
    await call('place_bricks');
    expect((await call('place_bricks')).ok).toBe(false);
    changeCap.end();
    changeCap.begin();
    expect((await call('place_bricks')).ok).toBe(true);
  });

  it('lets everything through with no cap, or outside a request', async () => {
    const none = counting(null);
    none.changeCap.begin();
    for (let i = 0; i < 5; i += 1) expect((await none.call('place_bricks')).ok).toBe(true);

    // a terminal agent between chat requests is not the chat's request
    const outside = counting(1);
    for (let i = 0; i < 3; i += 1) expect((await outside.call('place_bricks')).ok).toBe(true);
    outside.changeCap.begin();
    outside.changeCap.end();
    expect((await outside.call('place_bricks')).ok).toBe(true);
  });

  it('reads the cap when each change is asked for, so a new cap holds at once', async () => {
    const { changeCap, call, setLimit } = counting(null);
    changeCap.begin();
    await call('place_bricks');
    await call('place_bricks');
    setLimit(2);
    expect(await call('place_bricks')).toEqual({ ok: false, error: capReached(2) });
    setLimit(5);
    expect((await call('place_bricks')).ok).toBe(true);
  });

  it('holds when changes are asked for at once', async () => {
    const { changeCap, call, change } = counting(2);
    changeCap.begin();
    let finish = (): void => undefined;
    const slow = (): Promise<ToolOutcome> =>
      new Promise((resolve) => {
        finish = () => {
          change();
          resolve({ ok: true, data: null });
        };
      });
    const first = call('place_bricks', slow);
    const second = call('place_bricks');
    const third = call('place_bricks');
    expect((await second).ok).toBe(true);
    expect(await third).toEqual({ ok: false, error: capReached(2) });
    finish();
    expect((await first).ok).toBe(true);
  });

  it('gives a change back when it fails or throws', async () => {
    const { changeCap, call } = counting(1);
    changeCap.begin();
    let fail = (_reason: unknown): void => undefined;
    const pending = call('place_bricks', () => new Promise((_resolve, reject) => (fail = reject)));
    // while it runs, it holds the one change there is
    expect((await call('place_bricks')).ok).toBe(false);
    fail(new Error('the renderer broke'));
    await expect(pending).rejects.toThrow('the renderer broke');
    expect((await call('place_bricks')).ok).toBe(true);
  });

  it('does not take a change that fails after its request ended off the next request', async () => {
    const { changeCap, call } = counting(1);
    changeCap.begin();
    let fail = (): void => undefined;
    const late = call('place_bricks', () => new Promise((resolve) => (fail = () => resolve({ ok: false, error: 'gone' }))));
    changeCap.end();
    changeCap.begin();
    expect((await call('place_bricks')).ok).toBe(true);
    fail();
    await late;
    expect((await call('place_bricks')).ok).toBe(false);
  });

  it('says what happened in words the agent can pass on', () => {
    expect(capReached(1)).toContain('allows 1 change to the model for each chat request, and this one has made it.');
    expect(capReached(24)).toContain('allows 24 changes to the model for each chat request, and this one has made them.');
    expect(capReached(24)).toContain('tell the user what is left to do');
  });
});

describe('the cap on BrickBench’s own tools', () => {
  it('counts only the calls that changed the model or its name', async () => {
    const store = createEditorStore({ lookup: getPart, nextId: createIdFactory('s') });
    const host: AgentHost = {
      store,
      lookup: getPart,
      nextId: createIdFactory('a'),
      finder: () => createFinder(PARTS, []),
      loadLibrary: async () => true,
      look: async () => ({ data: 'aGVsbG8=', mimeType: 'image/jpeg' }),
    };
    const changeCap = createChangeCap(
      () => 2,
      () => [store.getState().history.present, store.getState().name],
    );
    const run = (tool: ToolName, input: unknown) => changeCap.run(tool, () => runTool(host, tool, input));
    const brick = (y: number) => ({ bricks: [{ part: 'brick-2x4', color: 'red', x: 0, y, z: 0 }] });
    changeCap.begin();
    expect((await run('place_bricks', brick(0))).ok).toBe(true);
    // the same brick again overlaps, and ids that are not there: no change
    expect((await run('place_bricks', brick(0))).ok).toBe(true);
    expect((await run('remove_bricks', { ids: ['nowhere'] })).ok).toBe(true);
    expect((await run('paint_bricks', { ids: ['nowhere'], color: 'blue' })).ok).toBe(true);
    expect((await run('get_model', {})).ok).toBe(true);
    expect(store.getState().history.present.bricks.size).toBe(1);
    // a new name is a change
    expect((await run('set_model_name', { name: 'Tower' })).ok).toBe(true);
    expect(await run('place_bricks', brick(3))).toEqual({ ok: false, error: capReached(2) });
    expect(store.getState().history.present.bricks.size).toBe(1);

    // a fresh request on a new model: clearing nothing and undoing past the start change nothing
    store.getState().newModel();
    changeCap.end();
    changeCap.begin();
    expect((await run('clear_model', { confirm: true })).ok).toBe(true);
    expect((await run('undo', { steps: 3 })).ok).toBe(true);
    expect((await run('place_bricks', brick(0))).ok).toBe(true);
    expect((await run('place_bricks', brick(3))).ok).toBe(true);
    expect(store.getState().history.present.bricks.size).toBe(2);
  });
});
