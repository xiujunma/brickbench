import { beforeEach, describe, expect, it } from 'bun:test';
import { DEFAULT_SCENE } from '../core/io/modelFile';
import { createIdFactory } from '../core/model/ids';
import { modelFromBricks } from '../core/model/model';
import { makeBrick } from '../core/model/testUtils';
import { getPart } from '../core/parts/catalog';
import { shownImport } from './importReport';
import { createPartLibrary } from './library';
import { MAX_LDRAW_BYTES, openLDrawModel, type OpenDependencies } from './ldrawOpen';
import { createEditorStore } from './store';

/** Two basic bricks; with a baseplate from the parts library too. */
const WALL = ['0 Wall', '1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat', '1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3001.dat'].join('\n');
const WALL_ON_BASEPLATE = `${WALL}\n1 2 0 0 0 1 0 0 0 1 0 0 0 1 3811.dat`;

const offline = createPartLibrary('/ldraw/', () => Promise.reject(new TypeError('offline')));
const builtWithout = createPartLibrary('/ldraw/', () => Promise.resolve(new Response('nope', { status: 404 })));
let editor = createEditorStore({ lookup: getPart, nextId: createIdFactory('t') });
const agree = (library: OpenDependencies['library']): OpenDependencies => ({ editor, library, confirm: () => true });

const state = () => editor.getState();
const lastToast = () => state().toasts.at(-1);
const file = (text: string, name = 'wall.ldr') => new File([text], name);

describe('openLDrawModel', () => {
  beforeEach(() => {
    editor = createEditorStore({ lookup: getPart, nextId: createIdFactory('t') });
    // someone's model, which only a confirmed open may replace
    state().loadDocument({ name: 'Mine', settings: DEFAULT_SCENE, model: modelFromBricks([makeBrick({ id: 'a' }), makeBrick({ id: 'b', x: 6 }), makeBrick({ id: 'c', x: 12 })]) });
  });

  it('keeps the model when the parts library failed to load and parts are missing for it', async () => {
    await openLDrawModel(file(WALL_ON_BASEPLATE), 'ldraw', agree(offline));
    expect(lastToast()).toMatchObject({ tone: 'error', message: 'The parts library could not be loaded, so “Wall” was not opened. Check your connection and try again.' });
    expect(state().name).toBe('Mine');
    expect(state().history.present.bricks.size).toBe(3);
  });

  it('still opens a model of basic parts when the library failed to load', async () => {
    await openLDrawModel(file(WALL), 'ldraw', agree(offline));
    expect(lastToast()).toMatchObject({ tone: 'success', message: 'Opened “Wall”: all 2 parts came in.' });
    expect(state().history.present.bricks.size).toBe(2);
    expect(state().dialog).toBeNull();
  });

  it('opens what it can without a parts library, and says why the rest is missing', async () => {
    await openLDrawModel(file(WALL_ON_BASEPLATE), 'ldraw', agree(builtWithout));
    expect(lastToast()).toMatchObject({ tone: 'success', message: 'Opened “Wall”: 2 of 3 parts came in.' });
    expect(shownImport()?.note).toContain('built without the LDraw parts library');
    expect(state().dialog).toBe('import-report');
  });

  it('asks first, saying how much will come in, and keeps the model when told to', async () => {
    const asked: string[] = [];
    const decline = (prompt: string): boolean => {
      asked.push(prompt);
      return false;
    };
    await openLDrawModel(file(WALL_ON_BASEPLATE), 'ldraw', { editor, library: builtWithout, confirm: decline });
    expect(asked).toEqual(['Open “Wall”? 2 of its 3 parts can come in.']);
    expect(state().name).toBe('Mine');
  });

  it('keeps the model when none of the parts can come in, and shows why', async () => {
    await openLDrawModel(file('0 Motor\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 u9241.dat', 'motor.ldr'), 'ldraw', agree(builtWithout));
    expect(lastToast()).toMatchObject({ tone: 'error', message: 'None of the parts in “Motor” could come in, so the current model stays.' });
    expect(shownImport()?.report).toMatchObject({ parts: 1, placed: 0 });
    expect(state().history.present.bricks.size).toBe(3);
  });

  it('says what is wrong with files it cannot open', async () => {
    await openLDrawModel(file('0 Just a title'), 'ldraw', agree(builtWithout));
    expect(lastToast()).toMatchObject({ tone: 'error', message: 'There are no parts in this file.' });
    await openLDrawModel(file('not a zip', 'whale.io'), 'studio', agree(builtWithout));
    expect(lastToast()).toMatchObject({ tone: 'error', message: 'This is not a Studio file BrickBench can read.' });
    const huge = file('0 Huge');
    Object.defineProperty(huge, 'size', { value: MAX_LDRAW_BYTES + 1 });
    await openLDrawModel(huge, 'ldraw', agree(builtWithout));
    expect(lastToast()).toMatchObject({ tone: 'error', message: 'That file is too large to open (over 64 MB).' });
    expect(state().name).toBe('Mine');
  });
});
