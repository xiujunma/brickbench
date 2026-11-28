/**
 * The chat's settings, kept in the desktop app's storage: what goes with
 * each request (the selected bricks, the user's view), the user's own
 * instructions for the agent, and an optional cap on the changes one request
 * may make.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { z } from 'zod';
import { MAX_INSTRUCTIONS_LENGTH } from './protocol';

export interface AgentPreferences {
  /** The selected bricks go with each request, so "these" means something to the agent. */
  readonly attachSelection: boolean;
  /** The user's view goes with each request: the agent looks from where they do. */
  readonly attachView: boolean;
  /** The user's own instructions, added to the agent's for the chat. */
  readonly instructions: string;
  /** The most changes one request may make; null for no cap. */
  readonly changeCap: number | null;
}

/** A cap, once one is set, between these. */
export const MIN_CHANGE_CAP = 1;
export const MAX_CHANGE_CAP = 200;
/** The cap that ticking "Limit changes" starts at. */
export const DEFAULT_CHANGE_CAP = 24;

export const DEFAULT_PREFERENCES: AgentPreferences = { attachSelection: true, attachView: false, instructions: '', changeCap: null };

export const PREFERENCES_KEY = 'brickbench:agent:preferences:v1';

// a setting kept wrong, or not kept, starts as it does; the others stay as kept
const preferencesSchema = z.object({
  attachSelection: z.boolean().catch(DEFAULT_PREFERENCES.attachSelection),
  attachView: z.boolean().catch(DEFAULT_PREFERENCES.attachView),
  instructions: z.string().max(MAX_INSTRUCTIONS_LENGTH).catch(DEFAULT_PREFERENCES.instructions),
  changeCap: z.number().int().min(MIN_CHANGE_CAP).max(MAX_CHANGE_CAP).nullable().catch(DEFAULT_PREFERENCES.changeCap),
});

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/** The settings kept last time; each one not kept as it should be starts as it does. */
export function loadPreferences(storage: Storage | null): AgentPreferences {
  try {
    const raw = storage?.getItem(PREFERENCES_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = preferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_PREFERENCES;
  } catch {
    // storage blocked, or not JSON: as they start
    return DEFAULT_PREFERENCES;
  }
}

/** The settings, kept as they change; a store that cannot keep them still holds them for now. */
export function createPreferences(storage: Storage | null): StoreApi<AgentPreferences> {
  const store = createStore<AgentPreferences>(() => loadPreferences(storage));
  store.subscribe((preferences) => {
    try {
      storage?.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
      // storage full or blocked: the settings hold until the app closes
    }
  });
  return store;
}

/** A cap as the user types it: a whole number in range, or the nearest one. */
export function clampCap(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CHANGE_CAP;
  return Math.min(MAX_CHANGE_CAP, Math.max(MIN_CHANGE_CAP, Math.round(value)));
}

/** The cap a typed number stands for, brought into range; `current` while nothing usable is typed. */
export function capFromDraft(draft: string, current: number): number {
  const typed = draft.trim() === '' ? Number.NaN : Number(draft);
  return Number.isFinite(typed) ? clampCap(typed) : current;
}
