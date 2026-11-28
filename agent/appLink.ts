/**
 * The bridge's side of the link to BrickBench tabs: tool calls go to the tab
 * the user last used and come back as results, each with a time limit.
 */
import type { AppMessage, BridgeMessage, ToolName, ToolOutcome } from '../src/agent/protocol';

/** The part of a WebSocket the link needs. */
export interface AppSocket {
  send(text: string): void;
}

/** Long enough for a big build or a picture of it; short enough that a hung tab doesn't hang the agent. */
export const CALL_TIMEOUT_MS = 60_000;

export const NOT_OPEN =
  'BrickBench is not open. Ask the user to open the BrickBench desktop app and its Agent panel (it connects to this bridge by itself), then try again.';

interface Pending {
  readonly socket: AppSocket;
  readonly resolve: (outcome: ToolOutcome) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface AppLink {
  /** A tab that connects waits its turn: calls go to it once it says it is in use, or if it is the only one. */
  attach(socket: AppSocket): void;
  detach(socket: AppSocket): void;
  /** Handles a result or an "active" note from a tab; other messages are the caller's. */
  receive(socket: AppSocket, message: AppMessage): void;
  /** Sends every call to this tab until unpinned, as while it is chatting with the agent. */
  pin(socket: AppSocket | null): void;
  /** Runs a tool in the pinned tab, or the one used last. Never rejects: problems come back as failed outcomes for the agent. */
  call(tool: ToolName, input: unknown, timeoutMs?: number): Promise<ToolOutcome>;
  send(socket: AppSocket, message: BridgeMessage): void;
  readonly tabs: number;
}

export function createAppLink(newId: () => string = () => crypto.randomUUID()): AppLink {
  // most recently active last
  const sockets: AppSocket[] = [];
  const pending = new Map<string, Pending>();
  let pinned: AppSocket | null = null;

  const settle = (id: string, outcome: ToolOutcome): void => {
    const call = pending.get(id);
    if (!call) return;
    clearTimeout(call.timer);
    pending.delete(id);
    call.resolve(outcome);
  };

  const send = (socket: AppSocket, message: BridgeMessage): void => socket.send(JSON.stringify(message));

  return {
    attach(socket) {
      if (!sockets.includes(socket)) sockets.unshift(socket);
    },
    detach(socket) {
      const at = sockets.indexOf(socket);
      if (at !== -1) sockets.splice(at, 1);
      if (pinned === socket) pinned = null;
      for (const [id, call] of pending) {
        if (call.socket === socket) settle(id, { ok: false, error: 'BrickBench was closed before it answered.' });
      }
    },
    receive(socket, message) {
      if (message.kind === 'active') {
        // to the front of the queue, its calls still running
        const at = sockets.indexOf(socket);
        if (at === -1) return;
        sockets.splice(at, 1);
        sockets.push(socket);
      } else if (message.kind === 'result') {
        if (pending.get(message.id)?.socket !== socket) return;
        settle(
          message.id,
          message.ok
            ? { ok: true, data: message.data ?? null, ...(message.image ? { image: message.image } : {}) }
            : { ok: false, error: message.error ?? 'BrickBench could not do that.' },
        );
      }
    },
    pin(socket) {
      pinned = socket;
    },
    call(tool, input, timeoutMs = CALL_TIMEOUT_MS) {
      const socket = pinned ?? sockets.at(-1);
      if (!socket) return Promise.resolve({ ok: false, error: NOT_OPEN });
      const id = newId();
      return new Promise<ToolOutcome>((resolve) => {
        const timer = setTimeout(
          () => settle(id, { ok: false, error: `BrickBench did not answer within ${Math.round(timeoutMs / 1000)} s. Is its tab still open?` }),
          timeoutMs,
        );
        pending.set(id, { socket, resolve, timer });
        try {
          send(socket, { kind: 'call', id, tool, input });
        } catch (error: unknown) {
          settle(id, { ok: false, error: `Could not reach BrickBench: ${error instanceof Error ? error.message : String(error)}` });
        }
      });
    },
    send,
    get tabs() {
      return sockets.length;
    },
  };
}
