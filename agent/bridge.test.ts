import { afterEach, describe, expect, it } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AgentEvent, AppMessage, BridgeMessage } from '../src/agent/protocol';
import { waitFor } from '../src/testing/helpers';
import { createAppLink } from './appLink';
import { createBridgeHandlers, startBridge, type Bridge } from './bridge';
import type { ChatRunner } from './chat';

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

/** A BrickBench tab: answers every tool call by echoing the tool's name. */
async function openTab(bridge: Bridge) {
  const received: BridgeMessage[] = [];
  const socket = new WebSocket(`${bridge.url.replace('http', 'ws')}/app`, { headers: { Origin: 'http://localhost:5173' } });
  const send = (message: AppMessage): void => socket.send(JSON.stringify(message));
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as BridgeMessage;
    received.push(message);
    if (message.kind === 'call') send({ kind: 'result', id: message.id, ok: true, data: { echo: message.tool } });
  });
  await waitFor(() => expect(received[0]?.kind).toBe('hello'));
  const events = (): AgentEvent[] => received.flatMap((m) => (m.kind === 'agent' ? [m.event] : []));
  return { socket, received, send, events };
}

let bridge: Bridge | null = null;
afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

describe('the agent bridge', () => {
  it('lets an MCP client build in the open tab', async () => {
    const { runner } = scriptedRunner();
    bridge = startBridge({ runner, port: 0 });
    const tab = await openTab(bridge);
    expect(tab.received[0]).toMatchObject({ kind: 'hello', agent: { available: true, name: 'Scripted agent' } });

    const client = new Client({ name: 'test-agent', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${bridge.url}/mcp`)));
    const result = await client.callTool({ name: 'get_model', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: '{"echo":"get_model"}' }]);
    await client.close();
    tab.socket.close();
  });

  it('reports its state and refuses what it does not serve', async () => {
    const { runner } = scriptedRunner();
    bridge = startBridge({ runner, port: 0 });
    expect(await (await fetch(`${bridge.url}/health`)).json()).toEqual({ ok: true, tabs: 0, agent: { available: true, name: 'Scripted agent' } });
    expect((await fetch(`${bridge.url}/mcp`)).status).toBe(405);
    expect((await fetch(`${bridge.url}/elsewhere`)).status).toBe(404);
    expect((await fetch(`${bridge.url}/app`, { headers: { Origin: 'http://localhost:5173' } })).status).toBe(426);
  });

  it('keeps out pages from other sites and requests for other hosts', async () => {
    const { runner } = scriptedRunner();
    bridge = startBridge({ runner, port: 0 });
    expect((await fetch(`${bridge.url}/app`, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await fetch(`${bridge.url}/mcp`, { method: 'POST', headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    // a DNS-rebinding page reaches 127.0.0.1 under its own name, which it sends as the Host
    const handlers = createBridgeHandlers(runner);
    const addressedTo = (host: string) => handlers.fetch(new Request('http://127.0.0.1:7425/health', { headers: { host } }), { upgrade: () => false });
    expect((await addressedTo('localhost:7425'))?.status).toBe(200);
    expect((await addressedTo('evil.example:7425'))?.status).toBe(403);
  });

  it('runs the chat in the asking tab, one request at a time, and stops when asked', async () => {
    const script = scriptedRunner();
    bridge = startBridge({ runner: script.runner, port: 0 });
    const tab = await openTab(bridge);
    tab.send({ kind: 'chat', prompt: 'Build a tower', fresh: true });
    await waitFor(() => expect(tab.events()).toEqual([{ type: 'started' }]));
    expect(script.requests).toEqual([{ prompt: 'Build a tower', fresh: true }]);

    tab.send({ kind: 'chat', prompt: 'And a moat', fresh: false });
    await waitFor(() => expect(tab.events().at(-1)).toMatchObject({ type: 'done', ok: false, error: expect.stringContaining('still working') }));
    script.finish('Done: a tower of 12 bricks.');
    await waitFor(() => expect(tab.events().slice(-2)).toEqual([{ type: 'text', text: 'Done: a tower of 12 bricks.' }, { type: 'done', ok: true }]));

    tab.send({ kind: 'chat', prompt: 'Taller', fresh: false });
    tab.send({ kind: 'stop' });
    await waitFor(() => expect(script.stops()).toBe(1));
    // junk is ignored
    tab.socket.send('not json');
    tab.socket.send(new TextEncoder().encode(JSON.stringify({ kind: 'active' })));
    tab.socket.close();
  });

  it('shares its link with a runner that calls tools itself, and cuts the agent’s name to what the app takes', async () => {
    const link = createAppLink();
    const runner: ChatRunner = {
      status: () => ({ available: true, name: `Test AI · ${'m'.repeat(200)}`, detail: 'd'.repeat(1000) }),
      running: false,
      start: () => undefined,
      stop: () => undefined,
    };
    bridge = startBridge({ runner, port: 0, link });
    const tab = await openTab(bridge);
    const hello = tab.received[0];
    expect(hello?.kind === 'hello' ? [hello.agent.name.length, hello.agent.detail?.length] : []).toEqual([80, 400]);
    expect(await link.call('get_model', {})).toEqual({ ok: true, data: { echo: 'get_model' } });
    tab.socket.close();
  });

  it('stops the agent when its tab closes', async () => {
    const script = scriptedRunner();
    bridge = startBridge({ runner: script.runner, port: 0 });
    const tab = await openTab(bridge);
    tab.send({ kind: 'chat', prompt: 'Build a wall', fresh: true });
    await waitFor(() => expect(script.requests).toHaveLength(1));
    tab.socket.close();
    await waitFor(() => expect(script.stops()).toBe(1));
  });
});
