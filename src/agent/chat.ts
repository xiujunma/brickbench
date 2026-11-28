/** The agent chat: a transcript built from what the user asks and what the agent says and does. */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AgentEvent, AppMessage } from './protocol';

export type ChatEntryKind = 'user' | 'agent' | 'tool' | 'error' | 'note';

export interface ChatEntry {
  readonly id: number;
  readonly kind: ChatEntryKind;
  readonly text: string;
}

export interface ChatState {
  readonly entries: readonly ChatEntry[];
  readonly running: boolean;
  /** The agent has had a request, so the next one continues the conversation. */
  readonly started: boolean;
  readonly nextId: number;
}

export const EMPTY_CHAT: ChatState = { entries: [], running: false, started: false, nextId: 1 };

export type ChatAction =
  /** `note` says what went with the words, such as the selected bricks. */
  | { readonly type: 'ask'; readonly text: string; readonly note?: string | null }
  /** A request that never reached the agent. */
  | { readonly type: 'undelivered'; readonly text: string; readonly reason: string }
  | { readonly type: 'event'; readonly event: AgentEvent }
  | { readonly type: 'reset' };

/** Old entries go first, so a long session stays light. */
const MAX_ENTRIES = 400;

export const CONNECTION_LOST = 'Lost the connection to the agent bridge, so the agent stopped. Ask again once it is back.';

/** When there is no bridge to ask yet: the desktop app starts it when the Agent panel connects. */
export const BRIDGE_NOT_RUNNING = 'The agent bridge has not started yet. Wait a moment, then ask again.';

function append(state: ChatState, kind: ChatEntryKind, text: string): ChatState {
  const entries = [...state.entries, { id: state.nextId, kind, text }].slice(-MAX_ENTRIES);
  return { ...state, entries, nextId: state.nextId + 1 };
}

function costNote(event: Extract<AgentEvent, { type: 'done' }>): string | null {
  const parts: string[] = [];
  if (event.turns !== undefined) parts.push(`${event.turns} ${event.turns === 1 ? 'turn' : 'turns'}`);
  if (event.costUsd !== undefined) parts.push(`$${event.costUsd.toFixed(2)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function onEvent(state: ChatState, event: AgentEvent): ChatState {
  switch (event.type) {
    case 'started':
      return state;
    case 'text':
      return append(state, 'agent', event.text);
    case 'tool':
      return append(state, 'tool', event.summary);
    case 'done': {
      if (!event.ok) return { ...append(state, 'error', event.error ?? 'The agent stopped.'), running: false };
      const note = costNote(event);
      return { ...(note ? append(state, 'note', note) : state), running: false };
    }
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'ask': {
      if (state.running) return state;
      const asked = append(state, 'user', action.text);
      return { ...(action.note ? append(asked, 'note', action.note) : asked), running: true, started: true };
    }
    case 'undelivered':
      return { ...append(append(state, 'user', action.text), 'error', action.reason), running: false };
    case 'event':
      return onEvent(state, action.event);
    case 'reset':
      return EMPTY_CHAT;
  }
}

/** What goes with a request besides its words. */
export interface AskExtra {
  /** For the agent, after the words: the selected bricks, the user's view. */
  readonly context?: string | null;
  /** The user's own instructions for the agent. */
  readonly instructions?: string;
  /** For the chat, under the words. */
  readonly note?: string | null;
}

export interface AgentChat {
  readonly store: StoreApi<ChatState>;
  /** Sends a request, with what goes with it: the agent reads the context after the words; the chat shows the note. Says whether it went. */
  ask(prompt: string, extra?: AskExtra): boolean;
  receive(event: AgentEvent): void;
  stop(): void;
  newConversation(): void;
  /** The link to the bridge broke: whatever was running has stopped with it. */
  connectionLost(): void;
}

export interface AgentChatDeps {
  readonly send: (message: AppMessage) => boolean;
  /** A request has gone to the agent. */
  readonly onRunStart?: () => void;
  /** The agent has finished with it, however it ended. */
  readonly onRunEnd?: () => void;
}

export function createAgentChat(deps: AgentChatDeps): AgentChat {
  const store = createStore<ChatState>(() => EMPTY_CHAT);
  const dispatch = (action: ChatAction): void => store.setState(chatReducer(store.getState(), action), true);
  const receive = (event: AgentEvent): void => {
    const wasRunning = store.getState().running;
    dispatch({ type: 'event', event });
    if (wasRunning && !store.getState().running) deps.onRunEnd?.();
  };
  return {
    store,
    ask(prompt, extra = {}) {
      const text = prompt.trim();
      const state = store.getState();
      if (text === '' || state.running) return false;
      const instructions = extra.instructions?.trim();
      const message: AppMessage = {
        kind: 'chat',
        prompt: text,
        fresh: !state.started,
        ...(extra.context ? { context: extra.context } : {}),
        ...(instructions ? { instructions } : {}),
      };
      if (!deps.send(message)) {
        dispatch({ type: 'undelivered', text, reason: BRIDGE_NOT_RUNNING });
        return false;
      }
      dispatch({ type: 'ask', text, note: extra.note ?? null });
      deps.onRunStart?.();
      return true;
    },
    receive,
    connectionLost() {
      if (store.getState().running) receive({ type: 'done', ok: false, error: CONNECTION_LOST });
    },
    stop: () => void deps.send({ kind: 'stop' }),
    newConversation() {
      if (!store.getState().running) dispatch({ type: 'reset' });
    },
  };
}
