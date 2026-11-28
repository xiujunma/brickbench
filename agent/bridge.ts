/**
 * The agent bridge: the desktop app's window talks to it over IPC, and agents
 * reach it as an MCP server (/mcp). The app's chat goes to a ChatRunner,
 * which runs an agent that builds through /mcp too. Web pages never reach it:
 * the agent works only in the desktop app. The handlers here need no
 * Electron; the desktop app serves them with Node (agent/nodeServer.ts).
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { appMessageSchema, clampEvent, parseMessage, type AgentEvent } from '../src/agent/protocol';
import { createAppLink, type AppLink } from './appLink';
import type { AgentStatus, ChatRunner } from './chat';
import { createBrickBenchMcp, SERVER_VERSION } from './mcpServer';
import { isLocalHost } from './origins';

import { DEFAULT_PORT } from './settings';

export { DEFAULT_PORT };
const BUSY = 'The agent is still working on the last request. Stop it first, or wait for it to finish.';

export interface SocketData {
  readonly tab: number;
}

/** A connected BrickBench window: the desktop app's, over IPC. */
export interface TabSocket {
  readonly data: SocketData;
  send(text: string): unknown;
}

/** What the window says and does, over its socket. */
export interface TabHandlers {
  open(socket: TabSocket): void;
  message(socket: TabSocket, raw: string): void;
  close(socket: TabSocket): void;
}

export interface BridgeHandlers {
  readonly fetch: (request: Request) => Response | Promise<Response>;
  readonly tabs: TabHandlers;
  readonly link: AppLink;
}

export interface HandlerOptions {
  /** The link to the window, made here unless given, as when the chat's runner calls tools through it too. */
  readonly link?: AppLink;
  /** Where agents reach this bridge's MCP server, which the window is told when it connects. */
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
  const { link = createAppLink(), mcpUrl } = options;
  let chatting: TabSocket | null = null;

  const tell = (socket: TabSocket, event: AgentEvent): void => {
    try {
      link.send(socket, { kind: 'agent', event: clampEvent(event) });
    } catch {
      // the window has gone; the run stops when its socket closes
    }
  };

  const startChat = (socket: TabSocket, prompt: string, fresh: boolean): void => {
    if (runner.running) {
      tell(socket, { type: 'done', ok: false, error: BUSY });
      return;
    }
    chatting = socket;
    // the agent builds where the user is chatting
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
    fetch(request) {
      if (!isLocalHost(request.headers.get('host'))) return forbidden('This bridge answers requests to localhost only.');
      const { pathname } = new URL(request.url);
      if (pathname === '/mcp') {
        // agents send no Origin; a web page always does, and none may build here
        if (request.headers.get('origin') !== null) return forbidden('Web pages may not use this MCP server.');
        return answerMcp(link, request);
      }
      if (pathname === '/health') return Response.json({ ok: true, tabs: link.tabs, agent: agentInfo(runner.status()) });
      return new Response('BrickBench agent bridge. Agents connect to /mcp.', { status: 404 });
    },
    tabs: {
      open(socket) {
        link.attach(socket);
        link.send(socket, { kind: 'hello', version: SERVER_VERSION, agent: agentInfo(runner.status()), ...(mcpUrl ? { mcp: mcpUrl() } : {}) });
      },
      message(socket, raw) {
        onMessage(socket, raw);
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
