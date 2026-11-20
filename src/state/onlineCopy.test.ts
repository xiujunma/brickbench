import { describe, expect, it } from 'bun:test';
import { DEFAULT_SCENE } from '../core/io/modelFile';
import { emptyModel } from '../core/model/model';
import { getPart } from '../core/parts/catalog';
import { followOpenModel, onlineCopy, ONLINE_COPY_KEY, readOnlineCopy, restoreOnlineCopy, setOnlineCopy, writeOnlineCopy } from './onlineCopy';
import { stubGlobal, unstubAllGlobals } from '../testing/helpers';
import { createEditorStore } from './store';

const COPY = { id: 'abcdefghjkmnpqrs', revision: 2, owner: 'ownerownerowner1' };

function newStore() {
  let n = 0;
  return createEditorStore({ lookup: getPart, nextId: () => `id${n++}` });
}

describe('the online copy of the open model', () => {
  it('stays while the model is built on, undone and redone', () => {
    const store = newStore();
    const stop = followOpenModel(store);
    setOnlineCopy(COPY);
    store.getState().placePayload({ x: 0, y: 0, z: 0 });
    store.getState().undo();
    store.getState().redo();
    store.getState().setName('Renamed');
    expect(onlineCopy()).toEqual(COPY);
    stop();
  });

  it('goes when another model is opened, or a new one started', () => {
    const store = newStore();
    const stop = followOpenModel(store);
    store.getState().placePayload({ x: 0, y: 0, z: 0 });
    setOnlineCopy(COPY);
    store.getState().loadDocument({ name: 'Other', model: emptyModel(), settings: DEFAULT_SCENE });
    expect(onlineCopy()).toBeNull();
    setOnlineCopy(COPY);
    store.getState().newModel();
    expect(onlineCopy()).toBeNull();
    stop();
  });

  it('is kept in storage, and anything damaged there counts as none', () => {
    const storage = new Map<string, string>();
    const local = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    };
    writeOnlineCopy(local, COPY);
    expect(readOnlineCopy(local)).toEqual(COPY);
    writeOnlineCopy(local, null);
    expect(readOnlineCopy(local)).toBeNull();
    for (const damaged of ['{', '"text"', '{"id":"a","owner":"b","revision":0}', '{"id":"a","owner":"b"}']) {
      storage.set(ONLINE_COPY_KEY, damaged);
      expect(readOnlineCopy(local)).toBeNull();
    }
  });

  it('comes back at start-up with a model that came back whole, and not otherwise', () => {
    const storage = new Map([[ONLINE_COPY_KEY, JSON.stringify(COPY)]]);
    stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null } });
    try {
      restoreOnlineCopy(true);
      expect(onlineCopy()).toEqual(COPY);
      restoreOnlineCopy(false);
      expect(onlineCopy()).toBeNull();
      stubGlobal('window', {
        get localStorage(): Storage {
          throw new Error('storage is blocked');
        },
      });
      setOnlineCopy(COPY);
      restoreOnlineCopy(true);
      expect(onlineCopy()).toBeNull();
    } finally {
      unstubAllGlobals();
    }
  });
});
