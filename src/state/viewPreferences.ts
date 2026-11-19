/**
 * How the 3D view looks on this computer, kept in this browser apart from
 * any model: ambient occlusion on or off, or left to the machine.
 */
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

export interface ViewPreferences {
  /** On, off, or null to let the machine choose: on, unless WebGL runs on the CPU, where it is slow. */
  readonly ambientOcclusion: boolean | null;
}

export const VIEW_KEY = 'brickbench:view:v1';
const CHOSEN_BY_MACHINE: ViewPreferences = { ambientOcclusion: null };

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

export interface ViewPreferencesStore {
  readonly store: StoreApi<ViewPreferences>;
  setAmbientOcclusion(on: boolean): void;
}

/** What is usable of what was stored: anything damaged counts as not chosen. */
function read(storage: Storage | null): ViewPreferences {
  try {
    const stored: unknown = JSON.parse(storage?.getItem(VIEW_KEY) ?? 'null');
    const value = typeof stored === 'object' && stored !== null ? (stored as { ambientOcclusion?: unknown }).ambientOcclusion : undefined;
    return { ambientOcclusion: typeof value === 'boolean' ? value : null };
  } catch {
    // blocked storage or text that is not JSON: as if nothing was chosen
    return CHOSEN_BY_MACHINE;
  }
}

export function createViewPreferences(storage: Storage | null): ViewPreferencesStore {
  const store = createStore<ViewPreferences>(() => read(storage));
  return {
    store,
    setAmbientOcclusion: (on) => {
      store.setState({ ambientOcclusion: on });
      try {
        storage?.setItem(VIEW_KEY, JSON.stringify(store.getState()));
      } catch {
        // full or blocked storage: the choice holds until the page closes
      }
    },
  };
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const viewPreferences = createViewPreferences(browserStorage());

export function useViewPreferences<T>(selector: (state: ViewPreferences) => T): T {
  return useStore(viewPreferences.store, selector);
}
