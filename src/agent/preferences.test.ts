import { describe, expect, it } from 'bun:test';
import {
  capFromDraft,
  clampCap,
  createPreferences,
  DEFAULT_CHANGE_CAP,
  DEFAULT_PREFERENCES,
  loadPreferences,
  MAX_CHANGE_CAP,
  MIN_CHANGE_CAP,
  PREFERENCES_KEY,
} from './preferences';

function memoryStorage(initial?: string) {
  const items = new Map<string, string>(initial === undefined ? [] : [[PREFERENCES_KEY, initial]]);
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe('the chat settings as kept', () => {
  it('start as they do when nothing is kept, or storage is missing', () => {
    expect(loadPreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(loadPreferences(memoryStorage())).toEqual(DEFAULT_PREFERENCES);
    expect(DEFAULT_PREFERENCES).toEqual({ attachSelection: true, attachView: false, instructions: '', changeCap: null });
  });

  it('come back as they were kept', () => {
    const kept = { attachSelection: false, attachView: true, instructions: 'Use pastel colours', changeCap: 12 };
    expect(loadPreferences(memoryStorage(JSON.stringify(kept)))).toEqual(kept);
  });

  it('start as they do one by one when one is kept wrong or missing, keeping the others', () => {
    const kept = { attachSelection: false, attachView: 'yes', instructions: 'x'.repeat(5000), changeCap: MAX_CHANGE_CAP + 1 };
    expect(loadPreferences(memoryStorage(JSON.stringify(kept)))).toEqual({ ...DEFAULT_PREFERENCES, attachSelection: false });
    expect(loadPreferences(memoryStorage(JSON.stringify({ instructions: 'Keep it small' })))).toEqual({ ...DEFAULT_PREFERENCES, instructions: 'Keep it small' });
    expect(loadPreferences(memoryStorage(JSON.stringify({ changeCap: 2.5 })))).toEqual(DEFAULT_PREFERENCES);
  });

  it('start as they do when what is kept is not settings at all', () => {
    for (const raw of ['not json', 'null', '[]', '"text"', '42']) expect(loadPreferences(memoryStorage(raw))).toEqual(DEFAULT_PREFERENCES);
  });

  it('start as they do when storage cannot be read', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    };
    expect(loadPreferences(blocked)).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('the chat settings store', () => {
  it('keeps each change', () => {
    const storage = memoryStorage();
    const store = createPreferences(storage);
    store.setState({ attachView: true, changeCap: 30 });
    expect(JSON.parse(storage.items.get(PREFERENCES_KEY) ?? '{}')).toEqual({ ...DEFAULT_PREFERENCES, attachView: true, changeCap: 30 });
    // and the next store starts from them
    expect(createPreferences(storage).getState()).toEqual({ ...DEFAULT_PREFERENCES, attachView: true, changeCap: 30 });
  });

  it('still holds the settings when they cannot be kept', () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };
    const store = createPreferences(full);
    store.setState({ instructions: 'Build big' });
    expect(store.getState().instructions).toBe('Build big');
    const none = createPreferences(null);
    none.setState({ attachSelection: false });
    expect(none.getState().attachSelection).toBe(false);
  });
});

describe('a cap as typed', () => {
  it('is a whole number in range', () => {
    expect(clampCap(12)).toBe(12);
    expect(clampCap(2.4)).toBe(2);
    expect(clampCap(0)).toBe(MIN_CHANGE_CAP);
    expect(clampCap(-5)).toBe(MIN_CHANGE_CAP);
    expect(clampCap(10_000)).toBe(MAX_CHANGE_CAP);
  });

  it('is the starting cap when it is no number at all', () => {
    expect(clampCap(Number.NaN)).toBe(DEFAULT_CHANGE_CAP);
    expect(clampCap(Number.POSITIVE_INFINITY)).toBe(DEFAULT_CHANGE_CAP);
  });
});

describe('a cap as the user leaves the field', () => {
  it('is the number typed, brought into range', () => {
    expect(capFromDraft('30', 24)).toBe(30);
    expect(capFromDraft(' 7 ', 24)).toBe(7);
    expect(capFromDraft('2.6', 24)).toBe(3);
    expect(capFromDraft('0', 24)).toBe(MIN_CHANGE_CAP);
    expect(capFromDraft('999', 24)).toBe(MAX_CHANGE_CAP);
  });

  it('stays as it was while nothing usable is typed', () => {
    expect(capFromDraft('', 12)).toBe(12);
    expect(capFromDraft('   ', 12)).toBe(12);
    expect(capFromDraft('abc', 12)).toBe(12);
  });
});
