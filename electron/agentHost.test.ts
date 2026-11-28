import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONNECTION_FILE, readConnection } from '../agent/access';
import type { BridgeHandlers, TabSocket } from '../agent/bridge';
import { MAX_AGENT_MESSAGE, type AgentLinkEvent } from '../src/desktop/protocol';
import { waitFor } from '../src/testing/helpers';
import { createAgentHost, MCP_SCRIPT, NO_CLAUDE, startDesktopBridge, type AgentWindow, type BridgeSetup, type DesktopBridge } from './agentHost';

/** Whether a process is still there. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The bundled server for agents in a terminal, as far as the bridge cares: a file to copy. */
const SERVER = '// mcp.cjs\n';

/** A folder for the bridge and a server to copy into it, under a root of their own to clean up. */
async function bridgeSetup(): Promise<BridgeSetup & { readonly root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'brickbench-desktop-bridge-'));
  const serverScript = join(root, 'bundled-mcp.cjs');
  await writeFile(serverScript, SERVER);
  return { root, folder: join(root, 'agent'), executable: '/app/BrickBench', serverScript };
}

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
    tabs: {
      open: (socket: TabSocket) => {
        seen.push('open');
        sockets.push(socket);
        socket.send('{"kind":"hello"}');
      },
      message: (_socket: TabSocket, raw: string) => void seen.push(`message ${raw.slice(0, 40)}`),
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

  it('runs a real bridge whose MCP server answers on this computer, with the server for agents in a terminal beside it, and stops it', async () => {
    const setup = await bridgeSetup();
    // a copy left by an older app is replaced
    await mkdir(setup.folder, { recursive: true });
    await writeFile(join(setup.folder, MCP_SCRIPT), '// an older mcp.cjs\n');
    const bridge = await startDesktopBridge({ BRICKBENCH_AGENT_PORT: '7493', BRICKBENCH_CLAUDE: '/nowhere/claude' }, setup);
    const connectionFile = join(setup.folder, CONNECTION_FILE);
    try {
      expect(bridge.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(bridge.notes).toEqual([]);
      expect(await (await fetch(`${bridge.url}/health`)).json()).toEqual({ ok: true, tabs: 0, agent: { available: false, name: 'No agent', detail: NO_CLAUDE } });
      // no WebSockets here: the window talks over IPC; no web page may use the MCP server, and no agent without a token
      expect((await fetch(`${bridge.url}/app`)).status).toBe(404);
      expect((await fetch(`${bridge.url}/mcp`, { method: 'POST', headers: { Origin: 'http://localhost:5173' } })).status).toBe(403);
      expect((await fetch(`${bridge.url}/mcp`, { method: 'POST' })).status).toBe(401);
      // a fresh copy of the server, which the window is told how to add to Claude Code
      expect(await readFile(join(setup.folder, MCP_SCRIPT), 'utf8')).toBe(SERVER);
      const said: string[] = [];
      bridge.handlers.tabs.open({ data: { tab: 1 }, send: (text) => void said.push(text) });
      expect(JSON.parse(said[0] ?? '{}')).toMatchObject({
        kind: 'hello',
        terminal: { command: `claude mcp add brickbench -e ELECTRON_RUN_AS_NODE=1 -- /app/BrickBench ${join(setup.folder, MCP_SCRIPT)}`, open: false },
      });
      // the window lets agents in a terminal in: their file appears, and goes when the bridge stops
      bridge.handlers.tabs.message({ data: { tab: 1 }, send: () => undefined }, JSON.stringify({ kind: 'terminal', open: true }));
      await waitFor(() => expect(existsSync(connectionFile)).toBe(true));
      expect(await readConnection(connectionFile)).not.toBeNull();
    } finally {
      await bridge.stop();
    }
    expect(await readConnection(connectionFile)).toBeNull();
    await rm(setup.root, { recursive: true, force: true });
    expect(fetch(`${bridge.url}/health`)).rejects.toThrow();
  });

  it('offers agents in a terminal nothing, and lets none in, when their server cannot be put in place', async () => {
    const setup = await bridgeSetup();
    // the box was left ticked
    await mkdir(setup.folder, { recursive: true });
    await writeFile(join(setup.folder, 'settings.json'), JSON.stringify({ terminal: true }));
    const bridge = await startDesktopBridge({ BRICKBENCH_AGENT_PORT: '7493', BRICKBENCH_CLAUDE: '/nowhere/claude' }, { ...setup, serverScript: join(setup.root, 'missing.cjs') });
    try {
      expect(bridge.notes).toEqual([expect.stringContaining('Agents in a terminal cannot connect')]);
      expect(await readConnection(join(setup.folder, CONNECTION_FILE))).toBeNull();
      const said: string[] = [];
      bridge.handlers.tabs.open({ data: { tab: 1 }, send: (text) => void said.push(text) });
      expect(JSON.parse(said[0] ?? '{}')).not.toHaveProperty('terminal');
    } finally {
      await bridge.stop();
      await rm(setup.root, { recursive: true, force: true });
    }
  });

  it('runs a coding agent over ACP chosen by the window, gives it a connection file only the user can read, and ends it when the bridge stops', async () => {
    const setup = await bridgeSetup();
    const pidFile = join(setup.root, 'agent.pid');
    const sessionFile = join(setup.root, 'session.json');
    const env = {
      BRICKBENCH_AGENT_PORT: '7493',
      BRICKBENCH_CLAUDE: '/nowhere/claude',
      BRICKBENCH_ACP_COMMAND: JSON.stringify([process.execPath, join(import.meta.dir, '..', 'agent', 'fixtures', 'fakeAcpAgent.ts')]),
      FAKE_ACP_MODE: 'hang',
      FAKE_ACP_PID_FILE: pidFile,
      FAKE_ACP_SESSION_FILE: sessionFile,
      PATH: process.env['PATH'] ?? '',
    };
    const bridge = await startDesktopBridge(env, setup);
    let pid = 0;
    try {
      const said: string[] = [];
      const socket: TabSocket = { data: { tab: 1 }, send: (text) => void said.push(text) };
      bridge.handlers.tabs.open(socket);
      bridge.handlers.tabs.message(socket, JSON.stringify({ kind: 'choose', agent: 'custom' }));
      await waitFor(() => expect(said).toHaveLength(2));
      expect(JSON.parse(said[1] ?? '{}')).toMatchObject({ kind: 'hello', agents: { chosen: 'custom' } });
      bridge.handlers.tabs.message(socket, JSON.stringify({ kind: 'chat', prompt: 'Wait', fresh: true }));
      await waitFor(() => expect(existsSync(sessionFile)).toBe(true), 5000);
      const params = JSON.parse(await readFile(sessionFile, 'utf8')) as { mcpServers: { name: string; command: string; args: string[]; env: unknown[] }[] };
      const connection = params.mcpServers[0]?.args[1] ?? '';
      expect(params.mcpServers[0]).toEqual({
        name: 'brickbench',
        command: '/app/BrickBench',
        args: [join(setup.folder, MCP_SCRIPT), connection],
        env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }],
      });
      expect(JSON.parse(await readFile(connection, 'utf8'))).toMatchObject({ url: bridge.url });
      if (process.platform !== 'win32') expect((await stat(connection)).mode & 0o777).toBe(0o600);
      pid = Number(await readFile(pidFile, 'utf8'));
      expect(isAlive(pid)).toBe(true);
    } finally {
      await bridge.stop();
    }
    // the agent's program, kept running between requests, ended with the bridge
    await waitFor(() => expect(isAlive(pid)).toBe(false), 5000);
    await rm(setup.root, { recursive: true, force: true });
  });

  it('gives up cleanly on a setting that is malformed, leaving its port free and no agent in a terminal let in', async () => {
    const setup = await bridgeSetup();
    await mkdir(setup.folder, { recursive: true });
    await writeFile(join(setup.folder, 'settings.json'), JSON.stringify({ terminal: true }));
    try {
      await expect(startDesktopBridge({ BRICKBENCH_AGENT_PORT: '7493', BRICKBENCH_AGENT_PROVIDER: 'nonsense' }, setup)).rejects.toThrow(
        'BRICKBENCH_AGENT_PROVIDER must be one of',
      );
      expect(await readConnection(join(setup.folder, CONNECTION_FILE))).toBeNull();
      const again = await startDesktopBridge({ BRICKBENCH_AGENT_PORT: '7493', BRICKBENCH_CLAUDE: '/nowhere/claude' }, setup);
      try {
        expect(again.url).toBe('http://127.0.0.1:7493');
      } finally {
        await again.stop();
      }
    } finally {
      await rm(setup.root, { recursive: true, force: true });
    }
  });
});
