/**
 * The agent bridge: one local server that BrickBench tabs connect to over a
 * WebSocket (/app) and agents reach as an MCP server (/mcp). The app's chat
 * goes to a ChatRunner, which runs an agent that builds through /mcp too.
 * The handlers here run anywhere: startBridge serves them with Bun, and the
 * desktop app with Node, its window connecting over IPC instead.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { appMessageSchema, clampEvent, parseMessage, type AgentEvent } from '../src/agent/protocol';
import { createAppLink, type AppLink } from './appLink';
import type { AgentStatus, ChatRunner } from './chat';
import { createBrickBenchMcp, SERVER_VERSION } from './mcpServer';
import { isAllowedOrigin, isLocalHost } from './origins';

import { DEFAULT_PORT } from './settings';

export { DEFAULT_PORT };
/** A picture of the model must fit in one message. */
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const BUSY = 'The agent is still working on the last request. Stop it first, or wait for it to finish.';

export interface SocketData {
  readonly tab: number;
}

/** A connected BrickBench tab: a WebSocket from a browser, or the desktop app's window over IPC. */
export interface TabSocket {
  readonly data: SocketData;
  send(text: string): unknown;
}

/** What a WebSocket server offers a request (Bun.serve's upgrade); a server without WebSockets answers false. */
export interface Upgrader {
  upgrade(request: Request, options: { data: SocketData }): boolean;
}

/** What tabs say and do, from whichever socket they use. */
export interface TabHandlers {
  readonly maxPayloadLength: number;
  open(socket: TabSocket): void;
  message(socket: TabSocket, raw: string | Uint8Array): void;
  close(socket: TabSocket): void;
}

export interface BridgeHandlers {
  readonly fetch: (request: Request, server: Upgrader) => Response | Promise<Response> | undefined;
  readonly websocket: TabHandlers;
  readonly link: AppLink;
}

export interface HandlerOptions {
  /** The only pages let in; any page from this computer otherwise. */
  readonly onlyOrigins?: readonly string[];
  /** The link to BrickBench tabs, made here unless given, as when the chat's runner calls tools through it too. */
  readonly link?: AppLink;
  /** Where agents reach this bridge's MCP server, which each tab is told when it connects. */
  readonly mcpUrl?: () => string;
}

const forbidden = (why: string): Response => new Response(why, { status: 403 });

/** The longest agent name and detail the app takes; a longer one would leave it never hearing hello. */
const MAX_AGENT_NAME = 80;
const MAX_AGENT_DETAIL = 400;
const cut = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

/** The runner's status, cut to the lengths the app accepts. */
export function agentInfo(status: AgentStatus): AgentStatus {
  const name = cut(status.name, MAX_AGENT_NAME);
  return status.detail === undefined ? { ...status, name } : { ...status, name, detail: cut(status.detail, MAX_AGENT_DETAIL) };
}

/** Answers one MCP request with a server of its own: stateless, so any number of agents can call at once. */
async function answerMcp(link: AppLink, request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('This MCP server takes POST requests only.', { status: 405, headers: { allow: 'POST' } });
  const server = createBrickBenchMcp(link);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

export function createBridgeHandlers(runner: ChatRunner, options: HandlerOptions = {}): BridgeHandlers {
  const { onlyOrigins = [], link = createAppLink(), mcpUrl } = options;
  let chatting: TabSocket | null = null;
  let tabs = 0;

  const tell = (socket: TabSocket, event: AgentEvent): void => {
    try {
      link.send(socket, { kind: 'agent', event: clampEvent(event) });
    } catch {
      // the tab has gone; the run stops when its socket closes
    }
  };

  const startChat = (socket: TabSocket, prompt: string, fresh: boolean): void => {
    if (runner.running) {
      tell(socket, { type: 'done', ok: false, error: BUSY });
      return;
    }
    chatting = socket;
    // the agent builds in the tab the user is chatting in, whichever tab they look at meanwhile
    link.receive(socket, { kind: 'active' });
    link.pin(socket);
    runner.start(prompt, fresh, (event) => {
      tell(socket, event);
      if (event.type === 'done' && chatting === socket) {
        chatting = null;
        link.pin(null);
      }
    });
  };

  const onMessage = (socket: TabSocket, text: string): void => {
    const message = parseMessage(appMessageSchema, text);
    if (!message) return;
    if (message.kind === 'chat') startChat(socket, message.prompt, message.fresh);
    else if (message.kind === 'stop') {
      if (chatting === socket) runner.stop();
    } else link.receive(socket, message);
  };

  return {
    link,
    fetch(request, server) {
      if (!isLocalHost(request.headers.get('host'))) return forbidden('This bridge answers requests to localhost only.');
      const { pathname } = new URL(request.url);
      const origin = request.headers.get('origin');
      if (pathname === '/app') {
        if (!isAllowedOrigin(origin, onlyOrigins)) return forbidden('Only BrickBench served from this machine may connect.');
        tabs += 1;
        return server.upgrade(request, { data: { tab: tabs } }) ? undefined : new Response('Expected a WebSocket.', { status: 426 });
      }
      if (pathname === '/mcp') {
        // agents send no Origin; a web page always does, and must be one of ours
        if (origin !== null && !isAllowedOrigin(origin, onlyOrigins)) return forbidden('Web pages from other sites may not use this MCP server.');
        return answerMcp(link, request);
      }
      if (pathname === '/health') return Response.json({ ok: true, tabs: link.tabs, agent: agentInfo(runner.status()) });
      return new Response('BrickBench agent bridge. Agents connect to /mcp; BrickBench connects to /app.', { status: 404 });
    },
    websocket: {
      maxPayloadLength: MAX_MESSAGE_BYTES,
      open(socket) {
        link.attach(socket);
        link.send(socket, { kind: 'hello', version: SERVER_VERSION, agent: agentInfo(runner.status()), ...(mcpUrl ? { mcp: mcpUrl() } : {}) });
      },
      message(socket, raw) {
        onMessage(socket, typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
      },
      close(socket) {
        link.detach(socket);
        if (chatting === socket) {
          chatting = null;
          runner.stop();
        }
      },
    },
  };
}

export interface BridgeOptions {
  readonly runner: ChatRunner;
  /** 0 picks a free port. */
  readonly port?: number;
  readonly onlyOrigins?: readonly string[];
  /** The link to BrickBench tabs, when the runner needs it too. */
  readonly link?: AppLink;
}

export interface Bridge {
  readonly url: string;
  readonly link: AppLink;
  stop(): Promise<void>;
}

/** Starts the bridge on this machine only, with Bun. */
export function startBridge(options: BridgeOptions): Bridge {
  let url = '';
  const handlers = createBridgeHandlers(options.runner, { onlyOrigins: options.onlyOrigins ?? [], link: options.link, mcpUrl: () => `${url}/mcp` });
  const server = Bun.serve<SocketData>({
    hostname: '127.0.0.1',
    port: options.port ?? DEFAULT_PORT,
    fetch: (request, srv) => handlers.fetch(request, srv),
    websocket: handlers.websocket,
  });
  url = `http://127.0.0.1:${server.port}`;
  return {
    url,
    link: handlers.link,
    stop: async () => {
      options.runner.stop();
      await server.stop(true);
    },
  };
}
