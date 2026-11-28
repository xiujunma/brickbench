import { afterEach, describe, expect, it } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AgentEvent, AppMessage, BridgeMessage } from '../src/agent/protocol';
import { waitFor } from '../src/testing/helpers';
import { createAppLink } from './appLink';
import { createBridgeHandlers, type BridgeHandlers, type TabSocket } from './bridge';
import type { ChatRunner } from './chat';
import { serveWithNode, type NodeServer } from './nodeServer';

function scriptedRunner() {
  const requests: { prompt: string; fresh: boolean }[] = [];
  let emit: ((event: AgentEvent) => void) | null = null;
  let stops = 0;
  const runner: ChatRunner = {
    status: () => ({ available: true, name: 'Scripted agent' }),
    get running() {
      return emit !== null;
    },
    start(prompt, fresh, onEvent) {
      requests.push({ prompt, fresh });
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
afterEach(async () => {
  await server?.close();
  server = null;
});

/** Serves the handlers on this computer, as the desktop app does. */
async function serve(handlers: BridgeHandlers): Promise<string> {
  server = await serveWithNode((request) => handlers.fetch(request), 0);
  return server.url;
}

describe('the agent bridge', () => {
  it('lets an MCP client build in the open window', async () => {
    const { runner } = scriptedRunner();
    let url = '';
    const handlers = createBridgeHandlers(runner, { mcpUrl: () => `${url}/mcp` });
    url = await serve(handlers);
    const window = openWindow(handlers);
    expect(window.received[0]).toMatchObject({ kind: 'hello', agent: { available: true, name: 'Scripted agent' }, mcp: `${url}/mcp` });

    const client = new Client({ name: 'test-agent', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
    const result = await client.callTool({ name: 'get_model', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: '{"echo":"get_model"}' }]);
    await client.close();
    window.close();
  });

  it('reports its state and refuses what it does not serve', async () => {
    const { runner } = scriptedRunner();
    const url = await serve(createBridgeHandlers(runner));
    expect(await (await fetch(`${url}/health`)).json()).toEqual({ ok: true, tabs: 0, agent: { available: true, name: 'Scripted agent' } });
    expect((await fetch(`${url}/mcp`)).status).toBe(405);
    expect((await fetch(`${url}/elsewhere`)).status).toBe(404);
    // web pages no longer connect at all
    expect((await fetch(`${url}/app`)).status).toBe(404);
  });

  it('keeps out every web page and requests for other hosts', async () => {
    const { runner } = scriptedRunner();
    const handlers = createBridgeHandlers(runner);
    const url = await serve(handlers);
    // a page sends an Origin, even one served from this computer, and agents send none
    for (const origin of ['https://evil.example', 'http://localhost:5173', 'brickbench://app']) {
      expect((await fetch(`${url}/mcp`, { method: 'POST', headers: { Origin: origin } })).status).toBe(403);
    }
    // a DNS-rebinding page reaches 127.0.0.1 under its own name, which it sends as the Host
    const addressedTo = (host: string) => handlers.fetch(new Request('http://127.0.0.1:7425/health', { headers: { host } }));
    expect((await addressedTo('localhost:7425')).status).toBe(200);
    expect((await addressedTo('evil.example:7425')).status).toBe(403);
  });

  it('runs the chat in the asking window, one request at a time, and stops when asked', async () => {
    const script = scriptedRunner();
    const handlers = createBridgeHandlers(script.runner);
    const window = openWindow(handlers);
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

  it('shares its link with a runner that calls tools itself, and cuts the agent’s name to what the app takes', async () => {
    const link = createAppLink();
    const runner: ChatRunner = {
      status: () => ({ available: true, name: `Test AI · ${'m'.repeat(200)}`, detail: 'd'.repeat(1000) }),
      running: false,
      start: () => undefined,
      stop: () => undefined,
    };
    const window = openWindow(createBridgeHandlers(runner, { link }));
    const hello = window.received[0];
    expect(hello?.kind === 'hello' ? [hello.agent.name.length, hello.agent.detail?.length] : []).toEqual([80, 400]);
    expect(await link.call('get_model', {})).toEqual({ ok: true, data: { echo: 'get_model' } });
    window.close();
  });

  it('stops the agent when its window closes', async () => {
    const script = scriptedRunner();
    const window = openWindow(createBridgeHandlers(script.runner));
    window.send({ kind: 'chat', prompt: 'Build a wall', fresh: true });
    await waitFor(() => expect(script.requests).toHaveLength(1));
    window.close();
    expect(script.stops()).toBe(1);
  });
});
