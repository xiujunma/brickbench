import { describe, expect, it } from 'bun:test';
import { createViewPreferences, VIEW_KEY } from './viewPreferences';

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), items };
}

describe('view preferences', () => {
  it('leave ambient occlusion to the machine until it is chosen', () => {
    expect(createViewPreferences(memoryStorage()).store.getState()).toEqual({ ambientOcclusion: null });
    expect(createViewPreferences(null).store.getState()).toEqual({ ambientOcclusion: null });
  });

  it('remember the choice in this browser', () => {
    const storage = memoryStorage();
    createViewPreferences(storage).setAmbientOcclusion(false);
    expect(storage.items.get(VIEW_KEY)).toBe('{"ambientOcclusion":false}');
    expect(createViewPreferences(storage).store.getState()).toEqual({ ambientOcclusion: false });
  });

  it('treat damaged or blocked storage as nothing chosen, and keep a choice it cannot store', () => {
    expect(createViewPreferences(memoryStorage({ [VIEW_KEY]: 'not json' })).store.getState()).toEqual({ ambientOcclusion: null });
    expect(createViewPreferences(memoryStorage({ [VIEW_KEY]: '{"ambientOcclusion":"yes"}' })).store.getState()).toEqual({ ambientOcclusion: null });
    const blocked = {
      getItem: (): string => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('full');
      },
    };
    const preferences = createViewPreferences(blocked);
    expect(preferences.store.getState()).toEqual({ ambientOcclusion: null });
    preferences.setAmbientOcclusion(true);
    expect(preferences.store.getState()).toEqual({ ambientOcclusion: true });
  });
});
