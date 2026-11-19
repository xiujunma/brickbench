/**
 * The app's end of the link to the agent bridge: a WebSocket that runs the
 * tool calls agents make, passes on chat events, and keeps reconnecting
 * while the user wants it.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { bridgeMessageSchema, parseMessage, type AgentEvent, type AppMessage, type ToolOutcome } from './protocol';

/** The part of a WebSocket the link needs. */
export interface SocketLike {
  send(text: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: { data?: unknown }) => void): void;
}

/** off: not wanted · connecting: on the way, or reconnecting · unreachable: no bridge is running. */
export type LinkStatus = 'off' | 'connecting' | 'connected' | 'unreachable';

export interface AgentInfo {
  readonly available: boolean;
  readonly name: string;
  readonly detail?: string | undefined;
}

export interface AgentLinkState {
  readonly status: LinkStatus;
  /** The agent behind the bridge's chat, once the bridge has said. */
  readonly agent: AgentInfo | null;
  /** Where agents in a terminal reach the bridge's MCP server, once it has said. */
  readonly mcpUrl: string | null;
}

export interface AgentLinkDeps {
  readonly url: string;
  readonly createSocket: (url: string) => SocketLike;
  readonly runTool: (tool: string, input: unknown) => Promise<ToolOutcome>;
  readonly onAgentEvent: (event: AgentEvent) => void;
  /** Whether the user is looking at this tab; one in the background connects without taking over. */
  readonly isFocused?: () => boolean;
  /** Runs `run` after `delayMs`; returns a cancel function. setTimeout unless a test says otherwise. */
  readonly schedule?: (run: () => void, delayMs: number) => () => void;
}

export interface AgentLink {
  readonly store: StoreApi<AgentLinkState>;
  connect(): void;
  disconnect(): void;
  /** Sends a message if connected; says whether it did. */
  send(message: AppMessage): boolean;
  /** Tells the bridge this is the tab the user is using, so agents build here. */
  markActive(): void;
}

const FIRST_RETRY_MS = 2000;
const MAX_RETRY_MS = 15_000;

const defaultSchedule = (run: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
};

function resultMessage(id: string, outcome: ToolOutcome): AppMessage {
  if (!outcome.ok) return { kind: 'result', id, ok: false, error: outcome.error };
  return { kind: 'result', id, ok: true, data: outcome.data, ...(outcome.image ? { image: outcome.image } : {}) };
}

export function createAgentLink(deps: AgentLinkDeps): AgentLink {
  const store = createStore<AgentLinkState>(() => ({ status: 'off', agent: null, mcpUrl: null }));
  const schedule = deps.schedule ?? defaultSchedule;
  let socket: SocketLike | null = null;
  let open = false;
  let wanted = false;
  let retryMs = FIRST_RETRY_MS;
  let cancelRetry: (() => void) | null = null;

  const send = (message: AppMessage): boolean => {
    if (!socket || !open) return false;
    socket.send(JSON.stringify(message));
    return true;
  };

  const answer = (id: string, tool: string, input: unknown): void => {
    deps
      .runTool(tool, input)
      .catch((error: unknown): ToolOutcome => ({ ok: false, error: `BrickBench could not do that: ${String(error)}` }))
      .then((outcome) => send(resultMessage(id, outcome)));
  };

  const onMessage = (data: unknown): void => {
    if (typeof data !== 'string') return;
    const message = parseMessage(bridgeMessageSchema, data);
    if (!message) return;
    if (message.kind === 'hello') store.setState({ status: 'connected', agent: message.agent, mcpUrl: message.mcp ?? null });
    else if (message.kind === 'call') answer(message.id, message.tool, message.input);
    else deps.onAgentEvent(message.event);
  };

  const attempt = (): void => {
    cancelRetry = null;
    const current = deps.createSocket(deps.url);
    socket = current;
    open = false;
    current.addEventListener('open', () => {
      if (socket !== current) return;
      open = true;
      retryMs = FIRST_RETRY_MS;
      store.setState({ status: 'connected' });
      if (deps.isFocused?.() ?? true) send({ kind: 'active' });
    });
    current.addEventListener('message', (event) => {
      if (socket === current) onMessage(event.data);
    });
    current.addEventListener('close', () => {
      if (socket !== current) return;
      const wasOpen = open;
      socket = null;
      open = false;
      store.setState({ status: wasOpen ? 'connecting' : 'unreachable', agent: null, mcpUrl: null });
      cancelRetry = schedule(attempt, retryMs);
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    });
  };

  return {
    store,
    connect() {
      if (wanted) return;
      wanted = true;
      store.setState({ status: 'connecting' });
      attempt();
    },
    disconnect() {
      wanted = false;
      cancelRetry?.();
      cancelRetry = null;
      const current = socket;
      socket = null;
      open = false;
      current?.close();
      store.setState({ status: 'off', agent: null, mcpUrl: null });
    },
    send,
    markActive: () => void send({ kind: 'active' }),
  };
}
