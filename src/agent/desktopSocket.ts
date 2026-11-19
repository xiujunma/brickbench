/**
 * The Agent panel's socket in the desktop app: the app runs the agent
 * bridge itself and talks to the page over IPC, which this dresses as the
 * WebSocket the link would use in a browser. Each socket names its
 * connection, and hears only what is said to it.
 */
import { toAgentLinkEvent, type DesktopAgentApi } from '../desktop/protocol';
import type { SocketLike } from './link';

type EventType = 'open' | 'message' | 'close' | 'error';
type Listener = (event: { data?: unknown }) => void;

const newId = (): string => crypto.randomUUID();

export function desktopSocket(agent: DesktopAgentApi, id = newId()): SocketLike {
  const listeners: Record<EventType, Listener[]> = { open: [], message: [], close: [], error: [] };
  let state: 'connecting' | 'open' | 'closed' = 'connecting';
  let stopListening: () => void = () => undefined;

  const emit = (type: EventType, event: { data?: unknown } = {}): void => {
    for (const listener of [...listeners[type]]) listener(event);
  };
  const finish = (): void => {
    if (state === 'closed') return;
    state = 'closed';
    stopListening();
    emit('close');
  };

  stopListening = agent.onEvent((value) => {
    const event = toAgentLinkEvent(value);
    if (!event || event.id !== id || state === 'closed') return;
    if (event.type === 'close') finish();
    else if (event.type === 'open') {
      state = 'open';
      emit('open');
    } else if (state === 'open') emit('message', { data: event.data });
  });
  // the app answers after this returns, by when the link listens
  agent.open(id);

  return {
    send(text) {
      if (state === 'open') agent.send(id, text);
    },
    close() {
      if (state === 'closed') return;
      agent.close(id);
      finish();
    },
    addEventListener(type, listener) {
      listeners[type].push(listener);
    },
  };
}
