/**
 * The agent bridge: the desktop app's window talks to it over IPC, the chat's
 * own agent reaches it as an MCP server (/mcp), and agents in a terminal
 * through `BrickBench --mcp` (agent/mcpStdio.ts, which posts to /call). Both
 * show a token (agent/access.ts). The app's chat goes to a ChatRunner. Web
 * pages never reach it: the agent works only in the desktop app. The
 * handlers here need no Electron; the desktop app serves them with Node
 * (agent/nodeServer.ts).
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { appMessageSchema, clampEvent, parseMessage, TOOL_NAMES, type AgentEvent, type BridgeMessage, type ToolName } from '../src/agent/protocol';
import type { Access } from './access';
import { createAppLink, type AppLink } from './appLink';
import type { AgentStatus, ChatRunner } from './chat';
import type { AgentChoices, Chooser } from './chooser';
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

/** What the bridge needs of access: whom to let in, and the switch for agents in a terminal. */
export type BridgeAccess = Pick<Access, 'allows' | 'terminalOpen' | 'setTerminal'>;

export interface HandlerOptions {
  /** Who may call the tools: every MCP request and tool call shows a token this lets in. */
  readonly access: BridgeAccess;
  /** The link to the window, made here unless given, as when the chat's runner calls tools through it too. */
  readonly link?: AppLink;
  /**
   * How an agent in a terminal starts BrickBench as its MCP server, which the
   * window shows with the switch that lets them in; without it there is no switch.
   */
  readonly terminalCommand?: string;
  /** The agents the chat can run, which the window offers to choose among; without it there is no choice. */
  readonly chooser?: Pick<Chooser, 'choices' | 'choose'>;
}

const forbidden = (why: string): Response => new Response(why, { status: 403 });
const unauthorized = (): Response =>
  new Response('This bridge takes calls only with a token BrickBench gives its agents.', { status: 401, headers: { 'www-authenticate': 'Bearer' } });

/** A tool call from `BrickBench --mcp`. */
const callSchema = z.object({ tool: z.enum(TOOL_NAMES as [ToolName, ...ToolName[]]), input: z.unknown() });
const NOT_A_CALL = 'A tool call is a JSON object: {"tool": name, "input": arguments}.';

/** The longest agent name and detail the app takes; a longer one would leave it never hearing hello. */
const MAX_AGENT_NAME = 80;
const MAX_AGENT_DETAIL = 400;
const MAX_AGENT_OPTIONS = 24;
const cut = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

/** The agents to choose among, cut to the lengths and number the app accepts. */
export function offered(choices: AgentChoices): { chosen: string; options: { id: string; name: string; ready: boolean; detail?: string }[] } {
  return {
    chosen: choices.chosen,
    options: choices.options.slice(0, MAX_AGENT_OPTIONS).map((option) => ({
      id: option.id,
      name: cut(option.name, MAX_AGENT_NAME),
      ready: option.ready,
      ...(option.detail === undefined ? {} : { detail: cut(option.detail, MAX_AGENT_DETAIL) }),
    })),
  };
}

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

/** Runs one tool call in the window and answers with its outcome, as `BrickBench --mcp` asks. */
async function answerCall(link: AppLink, request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Tool calls take POST requests only.', { status: 405, headers: { allow: 'POST' } });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(NOT_A_CALL, { status: 400 });
  }
  const call = callSchema.safeParse(body);
  if (!call.success) return new Response(NOT_A_CALL, { status: 400 });
  return Response.json(await link.call(call.data.tool, call.data.input));
}

export function createBridgeHandlers(runner: ChatRunner, options: HandlerOptions): BridgeHandlers {
  const { access, link = createAppLink(), terminalCommand, chooser } = options;
  let chatting: TabSocket | null = null;

  /** What the window hears when it connects, and again when the agent changes: who answers, and its choices. */
  const hello = (): BridgeMessage => ({
    kind: 'hello',
    version: SERVER_VERSION,
    agent: agentInfo(runner.status()),
    ...(terminalCommand === undefined ? {} : { terminal: { command: terminalCommand, open: access.terminalOpen } }),
    ...(chooser === undefined ? {} : { agents: offered(chooser.choices()) }),
  });

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

  /** Lets agents in a terminal in or out, as the window asks, then tells it how things stand. */
  const setTerminal = async (socket: TabSocket, open: boolean): Promise<void> => {
    if (terminalCommand === undefined) return;
    try {
      await access.setTerminal(open);
    } catch {
      // the connection file could not be written or removed: the window hears how things stand
    }
    try {
      link.send(socket, { kind: 'terminal', open: access.terminalOpen });
    } catch {
      // the window has gone
    }
  };

  /** Has another agent answer the chat, as the window asks, unless one is at work; then says hello again either way. */
  const chooseAgent = async (socket: TabSocket, id: string): Promise<void> => {
    if (chooser === undefined) return;
    await chooser.choose(id).catch(() => false);
    try {
      link.send(socket, hello());
    } catch {
      // the window has gone
    }
  };

  const onMessage = (socket: TabSocket, text: string): void => {
    const message = parseMessage(appMessageSchema, text);
    if (!message) return;
    if (message.kind === 'chat') startChat(socket, message.prompt, message.fresh);
    else if (message.kind === 'stop') {
      if (chatting === socket) runner.stop();
    } else if (message.kind === 'terminal') void setTerminal(socket, message.open);
    else if (message.kind === 'choose') void chooseAgent(socket, message.agent);
    else link.receive(socket, message);
  };

  return {
    link,
    fetch(request) {
      if (!isLocalHost(request.headers.get('host'))) return forbidden('This bridge answers requests to localhost only.');
      const { pathname } = new URL(request.url);
      if (pathname === '/mcp' || pathname === '/call') {
        // agents send no Origin; a web page always does, and none may build here
        if (request.headers.get('origin') !== null) return forbidden('Web pages may not use this bridge.');
        if (!access.allows(request)) return unauthorized();
        return pathname === '/mcp' ? answerMcp(link, request) : answerCall(link, request);
      }
      if (pathname === '/health') return Response.json({ ok: true, tabs: link.tabs, agent: agentInfo(runner.status()) });
      return new Response('BrickBench agent bridge. Agents connect to /mcp, with a token.', { status: 404 });
    },
    tabs: {
      open(socket) {
        link.attach(socket);
        link.send(socket, hello());
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
