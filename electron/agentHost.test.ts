import { describe, expect, it } from 'bun:test';
import type { BridgeHandlers, TabSocket } from '../agent/bridge';
import { MAX_AGENT_MESSAGE, type AgentLinkEvent } from '../src/desktop/protocol';
import { waitFor } from '../src/testing/helpers';
import { createAgentHost, NO_CLAUDE, startDesktopBridge, type AgentWindow, type DesktopBridge } from './agentHost';

/** A window that keeps what it is told. */
function fakeWindow() {
  const events: AgentLinkEvent[] = [];
  let destroyed = false;
  const window: AgentWindow = {
    send: (channel, event) => {
      expect(channel).toBe('agent-events');
      events.push(event);
    },
    isDestroyed: () => destroyed,
  };
  return { window, events, destroy: () => void (destroyed = true) };
}

/** A bridge that keeps what tabs do, and says hello as the real one does. */
function fakeBridge(notes: readonly string[] = []) {
  const seen: string[] = [];
  const sockets: TabSocket[] = [];
  let stops = 0;
  const handlers = {
    websocket: {
      maxPayloadLength: 1,
      open: (socket: TabSocket) => {
        seen.push('open');
        sockets.push(socket);
        socket.send('{"kind":"hello"}');
      },
      message: (_socket: TabSocket, raw: string | Uint8Array) => void seen.push(`message ${String(raw).slice(0, 40)}`),
      close: () => void seen.push('close'),
    },
  } as unknown as BridgeHandlers;
  const bridge: DesktopBridge = {
    handlers,
    url: 'http://127.0.0.1:7425',
    notes,
    stop: () => {
      stops += 1;
      return Promise.resolve();
    },
  };
  return { bridge, seen, sockets, stops: () => stops };
}

/** A start the test finishes when it likes. */
function deferredStart() {
  const pending: { resolve: (bridge: DesktopBridge) => void; reject: (error: Error) => void }[] = [];
  const start = (): Promise<DesktopBridge> => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  return { start, pending };
}

function host(start: () => Promise<DesktopBridge>) {
  const reports: string[] = [];
  return { host: createAgentHost({ start, channel: 'agent-events', report: (message) => void reports.push(message) }), reports };
}

const hello = (id: string): AgentLinkEvent => ({ type: 'message', id, data: '{"kind":"hello"}' });

describe('the agent bridge in the desktop app', () => {
  it('starts when the window’s panel connects, says so, then carries messages both ways', async () => {
    const fake = fakeBridge(['A note for the person.']);
    const { host: agent, reports } = host(() => Promise.resolve(fake.bridge));
    const win = fakeWindow();
    agent.open(win.window, 'a');
    await waitFor(() => expect(win.events).toEqual([{ type: 'open', id: 'a' }, hello('a')]));
    agent.send(win.window, 'a', '{"kind":"active"}');
    // not for this connection, not text, too long, or from elsewhere
    agent.send(win.window, 'b', '{"kind":"stop"}');
    agent.send(win.window, 'a', 42);
    agent.send(win.window, 'a', 'x'.repeat(MAX_AGENT_MESSAGE + 1));
    agent.send(fakeWindow().window, 'a', '{"kind":"stop"}');
    expect(fake.seen).toEqual(['open', 'message {"kind":"active"}']);
    expect(reports).toEqual(['A note for the person.']);
  });

  it('takes no connection without a proper id', async () => {
    let starts = 0;
    const { host: agent } = host(() => {
      starts += 1;
      return Promise.resolve(fakeBridge().bridge);
    });
    agent.open(fakeWindow().window, 'not an id!');
    agent.open(fakeWindow().window, undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(starts).toBe(0);
  });

  it('hands a reconnecting window the same bridge, and the last connection nothing more', async () => {
    const fake = fakeBridge();
    let starts = 0;
    const { host: agent } = host(() => {
      starts += 1;
      return Promise.resolve(fake.bridge);
    });
    const win = fakeWindow();
    agent.open(win.window, 'a');
    await waitFor(() => expect(fake.seen).toEqual(['open']));
    agent.open(win.window, 'b');
    await waitFor(() => expect(win.events.slice(2)).toEqual([{ type: 'close', id: 'a' }, { type: 'open', id: 'b' }, hello('b')]));
    expect(starts).toBe(1);
    // the first connection's run, still finishing, says nothing to the second
    fake.sockets[0]?.send('{"kind":"agent","event":{"type":"done","ok":false}}');
    expect(win.events).toHaveLength(5);
  });

  it('stops when the panel disconnects, and only for its own connection', async () => {
    const fake = fakeBridge();
    const { host: agent } = host(() => Promise.resolve(fake.bridge));
    const win = fakeWindow();
    agent.open(win.window, 'a');
    await waitFor(() => expect(fake.seen).toEqual(['open']));
    agent.close(win.window, 'b');
    agent.close(fakeWindow().window, 'a');
    expect(fake.stops()).toBe(0);
    agent.close(win.window, 'a');
    await waitFor(() => expect(fake.stops()).toBe(1));
    expect(fake.seen).toEqual(['open', 'close']);
    await agent.stop();
    expect(fake.stops()).toBe(1);
  });

  it('tells a page that is still there when the bridge stops, so it reconnects', async () => {
    const fake = fakeBridge();
    const { host: agent } = host(() => Promise.resolve(fake.bridge));
    const win = fakeWindow();
    agent.open(win.window, 'a');
    await waitFor(() => expect(win.events).toHaveLength(2));
    await agent.stop();
    expect(win.events.at(-1)).toEqual({ type: 'close', id: 'a' });
    expect(fake.stops()).toBe(1);
  });

  it('says it closed when the bridge cannot start, and tries again on the next connection', async () => {
    const fake = fakeBridge();
    let fail = true;
    const { host: agent, reports } = host(() => (fail ? Promise.reject(new Error('BRICKBENCH_AGENT_API must be chat or responses')) : Promise.resolve(fake.bridge)));
    const win = fakeWindow();
    agent.open(win.window, 'a');
    await waitFor(() => expect(win.events).toEqual([{ type: 'close', id: 'a' }]));
    expect(reports).toEqual(['The agent bridge could not start: BRICKBENCH_AGENT_API must be chat or responses']);
    fail = false;
    agent.open(win.window, 'b');
    await waitFor(() => expect(win.events.at(-1)).toEqual(hello('b')));
  });

  it('never runs two bridges, when a stop and a new connection come while one starts', async () => {
    for (const late of ['fails', 'succeeds'] as const) {
      const deferred = deferredStart();
      const first = fakeBridge();
      const second = fakeBridge();
      const { host: agent } = host(deferred.start);
      const win = fakeWindow();
      agent.open(win.window, 'a');
      await waitFor(() => expect(deferred.pending).toHaveLength(1));
      void agent.stop();
      agent.open(win.window, 'b');
      // the second start waits for the first, and for the stop
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(deferred.pending).toHaveLength(1);
      if (late === 'fails') deferred.pending[0]?.reject(new Error('busy'));
      else deferred.pending[0]?.resolve(first.bridge);
      await waitFor(() => expect(deferred.pending).toHaveLength(2));
      if (late === 'succeeds') expect(first.stops()).toBe(1);
      deferred.pending[1]?.resolve(second.bridge);
      await waitFor(() => expect(win.events.at(-1)).toEqual(hello('b')));
      expect(win.events.filter((event) => event.id === 'a')).toEqual([{ type: 'close', id: 'a' }]);
      await agent.stop();
      expect(second.stops()).toBe(1);
    }
  });

  it('tells a window that has gone nothing', async () => {
    const gone = fakeWindow();
    const { host: agent } = host(() => Promise.resolve(fakeBridge().bridge));
    gone.destroy();
    agent.open(gone.window, 'a');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(gone.events).toEqual([]);
  });

  it('runs a real bridge whose MCP server answers on this computer, and stops it', async () => {
    const bridge = await startDesktopBridge({ BRICKBENCH_AGENT_PORT: '7493', BRICKBENCH_CLAUDE: '/nowhere/claude' });
    try {
      expect(bridge.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(await (await fetch(`${bridge.url}/health`)).json()).toEqual({ ok: true, tabs: 0, agent: { available: false, name: 'No agent', detail: NO_CLAUDE } });
      // no WebSockets here: the window talks over IPC
      expect((await fetch(`${bridge.url}/app`, { headers: { Origin: 'http://localhost:5173' } })).status).toBe(426);
      expect((await fetch(`${bridge.url}/app`)).status).toBe(403);
    } finally {
      await bridge.stop();
    }
    expect(fetch(`${bridge.url}/health`)).rejects.toThrow();
  });

  it('gives up cleanly on a setting that is malformed, leaving its port free', async () => {
    await expect(startDesktopBridge({ BRICKBENCH_AGENT_PORT: '7493', BRICKBENCH_AGENT_PROVIDER: 'nonsense' })).rejects.toThrow('BRICKBENCH_AGENT_PROVIDER must be one of');
    const again = await startDesktopBridge({ BRICKBENCH_AGENT_PORT: '7493', BRICKBENCH_CLAUDE: '/nowhere/claude' });
    try {
      expect(again.url).toBe('http://127.0.0.1:7493');
    } finally {
      await again.stop();
    }
  });
});
