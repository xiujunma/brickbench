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
  | { readonly type: 'ask'; readonly text: string }
  /** A request that never reached the agent. */
  | { readonly type: 'undelivered'; readonly text: string; readonly reason: string }
  | { readonly type: 'event'; readonly event: AgentEvent }
  | { readonly type: 'reset' };

/** Old entries go first, so a long session stays light. */
const MAX_ENTRIES = 400;

export const CONNECTION_LOST = 'Lost the connection to the agent bridge, so the agent stopped. Ask again once it is back.';

export const BRIDGE_NOT_RUNNING =
  'The agent bridge is not running. In a terminal in the BrickBench folder, run `bun run agent`, then ask again.';

/** The same, in the desktop app, which starts the bridge itself when the Agent panel connects. */
export const DESKTOP_BRIDGE_NOT_RUNNING = 'The agent bridge has not started yet. Wait a moment, then ask again.';

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
    case 'ask':
      return state.running ? state : { ...append(state, 'user', action.text), running: true, started: true };
    case 'undelivered':
      return { ...append(append(state, 'user', action.text), 'error', action.reason), running: false };
    case 'event':
      return onEvent(state, action.event);
    case 'reset':
      return EMPTY_CHAT;
  }
}

export interface AgentChat {
  readonly store: StoreApi<ChatState>;
  ask(prompt: string): void;
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
  /** What to say when there is no bridge to ask: how to start one differs in a browser and in the desktop app. */
  readonly notRunning?: string;
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
    ask(prompt) {
      const text = prompt.trim();
      const state = store.getState();
      if (text === '' || state.running) return;
      if (deps.send({ kind: 'chat', prompt: text, fresh: !state.started })) {
        dispatch({ type: 'ask', text });
        deps.onRunStart?.();
      } else dispatch({ type: 'undelivered', text, reason: deps.notRunning ?? BRIDGE_NOT_RUNNING });
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
