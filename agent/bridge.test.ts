import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AgentEvent, AppMessage, BridgeMessage } from '../src/agent/protocol';
import { waitFor } from '../src/testing/helpers';
import { CONNECTION_FILE, createAccess, newToken, readConnection, type Access } from './access';
import { createAppLink, type AppLink } from './appLink';
import { createBridgeHandlers, type BridgeAccess, type BridgeHandlers, type TabSocket } from './bridge';
import { unavailableRunner, type ChatRunner, type RequestExtra } from './chat';
import { createChooser } from './chooser';
import { serveWithNode, type NodeServer } from './nodeServer';

const COMMAND = 'claude mcp add brickbench -e ELECTRON_RUN_AS_NODE=1 -- /app/BrickBench /agent/mcp.cjs';

function scriptedRunner() {
  const requests: { prompt: string; fresh: boolean; extra?: RequestExtra }[] = [];
  let emit: ((event: AgentEvent) => void) | null = null;
  let stops = 0;
  const runner: ChatRunner = {
    status: () => ({ available: true, name: 'Scripted agent' }),
    get running() {
      return emit !== null;
    },
    start(prompt, fresh, onEvent, extra) {
      requests.push({ prompt, fresh, ...(extra === undefined ? {} : { extra }) });
      emit = onEvent;
      onEvent({ type: 'started' });
    },
    stop() {
      stops += 1;
      const done = emit;
      emit = null;
      done?.({ type: 'done', ok: false, error: 'Stopped.' });
    },
  };
  const finish = (text: string): void => {
    const done = emit;
    emit = null;
    done?.({ type: 'text', text });
    done?.({ type: 'done', ok: true });
  };
  return { runner, requests, finish, stops: () => stops };
}

/** Access that lets nobody in over HTTP, for tests of the window's side. */
const NOBODY: BridgeAccess = { allows: () => false, terminalOpen: false, setTerminal: async () => undefined };

/** The desktop app's window, as the bridge sees it over IPC: answers every tool call by echoing the tool's name. */
function openWindow(handlers: BridgeHandlers) {
  const received: BridgeMessage[] = [];
  const send = (message: AppMessage): void => handlers.tabs.message(socket, JSON.stringify(message));
  const socket: TabSocket = {
    data: { tab: 1 },
    send(text) {
      const message = JSON.parse(text) as BridgeMessage;
      received.push(message);
      if (message.kind === 'call') queueMicrotask(() => send({ kind: 'result', id: message.id, ok: true, data: { echo: message.tool } }));
    },
  };
  handlers.tabs.open(socket);
  const events = (): AgentEvent[] => received.flatMap((m) => (m.kind === 'agent' ? [m.event] : []));
  return { socket, received, send, events, raw: (text: string) => handlers.tabs.message(socket, text), close: () => handlers.tabs.close(socket) };
}

let server: NodeServer | null = null;
let folder = '';
afterEach(async () => {
  await server?.close();
  server = null;
  if (folder) await rm(folder, { recursive: true, force: true });
  folder = '';
});

interface Running {
  readonly url: string;
  readonly access: Access;
  readonly handlers: BridgeHandlers;
  readonly connectionFile: string;
}

/** Starts a bridge as the desktop app does: its server first, then access for that address, then the handlers. */
async function startBridge(runner: ChatRunner, options: { readonly link?: AppLink; readonly terminalCommand?: string } = {}): Promise<Running> {
  folder = await mkdtemp(join(tmpdir(), 'brickbench-bridge-'));
  let handlers: BridgeHandlers | null = null;
  server = await serveWithNode((request) => (handlers ? handlers.fetch(request) : new Response('Starting.', { status: 503 })), 0);
  const access = await createAccess({ folder, url: server.url });
  handlers = createBridgeHandlers(runner, { access, ...options });
  return { url: server.url, access, handlers, connectionFile: join(folder, CONNECTION_FILE) };
}

const withToken = (token: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });
const call = (url: string, token: string, body: unknown) => fetch(`${url}/call`, withToken(token, { method: 'POST', body: JSON.stringify(body) }));

describe('the agent bridge', () => {
  it('lets the chat’s own agent build in the open window over MCP, with its token, and nobody without it', async () => {
    const { runner } = scriptedRunner();
    const bridge = await startBridge(runner);
    const window = openWindow(bridge.handlers);
    expect(window.received[0]).toMatchObject({ kind: 'hello', agent: { available: true, name: 'Scripted agent' } });

    const client = new Client({ name: 'test-agent', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${bridge.url}/mcp`), { requestInit: withToken(bridge.access.chatToken) }));
    const result = await client.callTool({ name: 'get_model', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: '{"echo":"get_model"}' }]);
    await client.close();

    const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
    expect((await fetch(`${bridge.url}/mcp`, { method: 'POST', body: JSON.stringify(initialize) })).status).toBe(401);
    expect((await fetch(`${bridge.url}/mcp`, withToken(newToken(), { method: 'POST', body: JSON.stringify(initialize) }))).status).toBe(401);
    window.close();
  });

  it('reports its state and refuses what it does not serve', async () => {
    const { runner } = scriptedRunner();
    const { url, access } = await startBridge(runner);
    expect(await (await fetch(`${url}/health`)).json()).toEqual({ ok: true, tabs: 0, agent: { available: true, name: 'Scripted agent' } });
    expect((await fetch(`${url}/mcp`, withToken(access.chatToken))).status).toBe(405);
    expect((await fetch(`${url}/call`, withToken(access.chatToken))).status).toBe(405);
    expect((await fetch(`${url}/elsewhere`)).status).toBe(404);
    // web pages no longer connect at all
    expect((await fetch(`${url}/app`)).status).toBe(404);
  });

  it('keeps out every web page, even with a token, and requests for other hosts', async () => {
    const { runner } = scriptedRunner();
    const { url, access, handlers } = await startBridge(runner);
    // a page sends an Origin, even one served from this computer, and agents send none
    for (const origin of ['https://evil.example', 'http://localhost:5173', 'brickbench://app']) {
      for (const path of ['/mcp', '/call']) {
        expect((await fetch(`${url}${path}`, withToken(access.chatToken, { method: 'POST', headers: { Origin: origin } }))).status).toBe(403);
      }
    }
    // a DNS-rebinding page reaches 127.0.0.1 under its own name, which it sends as the Host
    const addressedTo = (host: string) => handlers.fetch(new Request('http://127.0.0.1:7425/health', { headers: { host } }));
    expect((await addressedTo('localhost:7425')).status).toBe(200);
    expect((await addressedTo('evil.example:7425')).status).toBe(403);
  });

  it('runs tool calls for agents in a terminal only while the user lets them in', async () => {
    const { runner } = scriptedRunner();
    const bridge = await startBridge(runner, { terminalCommand: COMMAND });
    const window = openWindow(bridge.handlers);
    expect(window.received[0]).toMatchObject({ kind: 'hello', terminal: { command: COMMAND, open: false } });
    expect(await readConnection(bridge.connectionFile)).toBeNull();

    window.send({ kind: 'terminal', open: true });
    await waitFor(() => expect(window.received.at(-1)).toEqual({ kind: 'terminal', open: true }));
    const connection = await readConnection(bridge.connectionFile);
    expect(connection?.url).toBe(bridge.url);
    const token = connection?.token ?? '';
    const answer = await call(bridge.url, token, { tool: 'get_model', input: {} });
    expect(await answer.json()).toEqual({ ok: true, data: { echo: 'get_model' } });
    // the chat's own token works here too; anything else is not a call
    expect((await call(bridge.url, bridge.access.chatToken, { tool: 'look', input: { view: 'front' } })).status).toBe(200);
    expect((await call(bridge.url, token, { tool: 'rm -rf', input: {} })).status).toBe(400);
    expect((await call(bridge.url, token, ['get_model'])).status).toBe(400);
    expect((await fetch(`${bridge.url}/call`, withToken(token, { method: 'POST', body: 'not json' }))).status).toBe(400);

    window.send({ kind: 'terminal', open: false });
    await waitFor(() => expect(window.received.at(-1)).toEqual({ kind: 'terminal', open: false }));
    expect(await readConnection(bridge.connectionFile)).toBeNull();
    expect((await call(bridge.url, token, { tool: 'get_model', input: {} })).status).toBe(401);
    window.close();
  });

  it('offers agents in a terminal nothing without a command, and says how things stand when the switch fails', async () => {
    const { runner } = scriptedRunner();
    const plain = openWindow(createBridgeHandlers(runner, { access: NOBODY }));
    expect(plain.received[0]).not.toHaveProperty('terminal');
    plain.send({ kind: 'terminal', open: true });
    await Bun.sleep(10);
    expect(plain.received).toHaveLength(1);

    const failing: BridgeAccess = { ...NOBODY, setTerminal: () => Promise.reject(new Error('disk full')) };
    const window = openWindow(createBridgeHandlers(runner, { access: failing, terminalCommand: COMMAND }));
    window.send({ kind: 'terminal', open: true });
    await waitFor(() => expect(window.received.at(-1)).toEqual({ kind: 'terminal', open: false }));
  });

  it('offers the agents the chat can run, and has another answer when the window chooses it, never mid-request', async () => {
    const claude = scriptedRunner();
    const codex = scriptedRunner();
    const chooser = await createChooser({
      entries: [
        { option: { id: 'claude', name: 'Claude Code', ready: true }, make: () => claude.runner },
        { option: { id: 'codex', name: 'Codex', ready: true }, make: () => ({ ...codex.runner, status: () => ({ available: true, name: 'Codex' }) }) },
        { option: { id: 'vibe', name: 'Mistral Vibe', ready: false, detail: `Not installed. ${'x'.repeat(600)}` }, make: () => unavailableRunner('no') },
      ],
      first: 'claude',
    });
    const window = openWindow(createBridgeHandlers(chooser.runner, { access: NOBODY, chooser }));
    const first = window.received[0];
    expect(first).toMatchObject({ kind: 'hello', agent: { name: 'Scripted agent' }, agents: { chosen: 'claude' } });
    // a long detail is cut to what the app takes
    expect(first?.kind === 'hello' ? first.agents?.options[2]?.detail?.length : 0).toBe(400);

    // mid-request, the choice stays as it was, and the window hears so
    window.send({ kind: 'chat', prompt: 'Build', fresh: true });
    window.send({ kind: 'choose', agent: 'codex' });
    await waitFor(() => expect(window.received.filter((m) => m.kind === 'hello')).toHaveLength(2));
    expect(window.received.at(-1)).toMatchObject({ kind: 'hello', agents: { chosen: 'claude' } });
    claude.finish('Done.');

    window.send({ kind: 'choose', agent: 'codex' });
    await waitFor(() => expect(window.received.filter((m) => m.kind === 'hello')).toHaveLength(3));
    expect(window.received.at(-1)).toMatchObject({ kind: 'hello', agent: { name: 'Codex' }, agents: { chosen: 'codex' } });
    window.send({ kind: 'chat', prompt: 'Build', fresh: true });
    expect(codex.requests).toEqual([{ prompt: 'Build', fresh: true }]);
    window.close();
  });

  it('runs the chat in the asking window, one request at a time, and stops when asked', async () => {
    const script = scriptedRunner();
    const window = openWindow(createBridgeHandlers(script.runner, { access: NOBODY }));
    window.send({ kind: 'chat', prompt: 'Build a tower', fresh: true });
    expect(window.events()).toEqual([{ type: 'started' }]);
    expect(script.requests).toEqual([{ prompt: 'Build a tower', fresh: true }]);

    window.send({ kind: 'chat', prompt: 'And a moat', fresh: false });
    expect(window.events().at(-1)).toMatchObject({ type: 'done', ok: false, error: expect.stringContaining('still working') });
    script.finish('Done: a tower of 12 bricks.');
    expect(window.events().slice(-2)).toEqual([{ type: 'text', text: 'Done: a tower of 12 bricks.' }, { type: 'done', ok: true }]);

    window.send({ kind: 'chat', prompt: 'Taller', fresh: false });
    window.send({ kind: 'stop' });
    expect(script.stops()).toBe(1);
    // junk is ignored
    window.raw('not json');
    window.raw(JSON.stringify({ kind: 'active' }));
    window.close();
  });

  it('gives the agent what went with the words after them, and the user’s own instructions', () => {
    const script = scriptedRunner();
    const window = openWindow(createBridgeHandlers(script.runner, { access: NOBODY }));
    window.send({ kind: 'chat', prompt: 'Paint these blue', fresh: true, context: 'The user has 2 bricks selected', instructions: 'Use pastel colours' });
    expect(script.requests).toEqual([{ prompt: 'Paint these blue\n\nThe user has 2 bricks selected', fresh: true, extra: { instructions: 'Use pastel colours' } }]);
    script.finish('Done.');
    window.send({ kind: 'chat', prompt: 'Thanks', fresh: false });
    expect(script.requests.at(-1)).toStrictEqual({ prompt: 'Thanks', fresh: false });
    window.close();
  });

  it('shares its link with a runner that calls tools itself, and cuts the agent’s name to what the app takes', async () => {
    const link = createAppLink();
    const runner: ChatRunner = {
      status: () => ({ available: true, name: `Test AI · ${'m'.repeat(200)}`, detail: 'd'.repeat(1000) }),
      running: false,
      start: () => undefined,
      stop: () => undefined,
    };
    const window = openWindow(createBridgeHandlers(runner, { access: NOBODY, link }));
    const hello = window.received[0];
    expect(hello?.kind === 'hello' ? [hello.agent.name.length, hello.agent.detail?.length] : []).toEqual([80, 400]);
    expect(await link.call('get_model', {})).toEqual({ ok: true, data: { echo: 'get_model' } });
    window.close();
  });

  it('stops the agent when its window closes', async () => {
    const script = scriptedRunner();
    const window = openWindow(createBridgeHandlers(script.runner, { access: NOBODY }));
    window.send({ kind: 'chat', prompt: 'Build a wall', fresh: true });
    await waitFor(() => expect(script.requests).toHaveLength(1));
    window.close();
    expect(script.stops()).toBe(1);
  });
});
