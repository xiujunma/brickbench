import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { AppMessage, BridgeMessage } from '../src/agent/protocol';
import { waitFor } from '../src/testing/helpers';
import { CONNECTION_FILE, createAccess, newToken, type Access } from './access';
import { createBridgeHandlers, type BridgeHandlers, type TabSocket } from './bridge';
import { unavailableRunner } from './chat';
import { connectionLink, NOT_LET_IN, serveStdio, TOO_SLOW } from './mcpStdio';
import { serveWithNode, type NodeServer } from './nodeServer';

let server: NodeServer | null = null;
let folder = '';
afterEach(async () => {
  await server?.close();
  server = null;
  if (folder) await rm(folder, { recursive: true, force: true });
  folder = '';
});

/** A bridge with the app's window open, answering every tool call by echoing it, as the desktop app runs one. */
async function runningApp(): Promise<{ readonly access: Access; readonly connectionFile: string; readonly url: string }> {
  folder = await mkdtemp(join(tmpdir(), 'brickbench-stdio-'));
  let handlers: BridgeHandlers | null = null;
  server = await serveWithNode((request) => (handlers ? handlers.fetch(request) : new Response('Starting.', { status: 503 })), 0);
  const access = await createAccess({ folder, url: server.url });
  const ready = createBridgeHandlers(unavailableRunner('no chat here'), { access });
  handlers = ready;
  const socket: TabSocket = {
    data: { tab: 1 },
    send(text) {
      const message = JSON.parse(text) as BridgeMessage;
      const reply: AppMessage = { kind: 'result', id: message.kind === 'call' ? message.id : '', ok: true, data: { echo: message.kind === 'call' ? message.tool : '' } };
      if (message.kind === 'call') queueMicrotask(() => ready.tabs.message(socket, JSON.stringify(reply)));
    },
  };
  ready.tabs.open(socket);
  return { access, connectionFile: join(folder, CONNECTION_FILE), url: server.url };
}

/** The agent's end of the server's stdio: messages in, replies out, one JSON message a line. */
function agentEnd() {
  const input = new PassThrough();
  const output = new PassThrough();
  const replies: { id?: number; result?: unknown; error?: unknown }[] = [];
  let buffer = '';
  output.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    for (let at = buffer.indexOf('\n'); at !== -1; at = buffer.indexOf('\n')) {
      replies.push(JSON.parse(buffer.slice(0, at)) as (typeof replies)[number]);
      buffer = buffer.slice(at + 1);
    }
  });
  const send = (message: object): void => void input.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const reply = async (id: number) => {
    await waitFor(() => expect(replies.some((r) => r.id === id)).toBe(true));
    return replies.find((r) => r.id === id);
  };
  return { input, output, send, reply };
}

describe('BrickBench’s MCP server for agents in a terminal', () => {
  it('runs each call in the app the connection file points to, with its token', async () => {
    const app = await runningApp();
    await app.access.setTerminal(true);
    const link = connectionLink(app.connectionFile);
    expect(await link.call('get_model', {})).toEqual({ ok: true, data: { echo: 'get_model' } });
  });

  it('says how to let agents in a terminal in when they are not, or when the app has gone', async () => {
    const app = await runningApp();
    // never let in: no connection file
    expect(await connectionLink(app.connectionFile).call('get_model', {})).toEqual({ ok: false, error: NOT_LET_IN });
    // a file whose token the app no longer takes
    await writeFile(app.connectionFile, JSON.stringify({ url: app.url, token: newToken() }));
    expect(await connectionLink(app.connectionFile).call('get_model', {})).toEqual({ ok: false, error: NOT_LET_IN });
    // a file left behind by an app that has closed
    await writeFile(app.connectionFile, JSON.stringify({ url: 'http://127.0.0.1:9', token: newToken() }));
    expect(await connectionLink(app.connectionFile).call('get_model', {})).toEqual({ ok: false, error: NOT_LET_IN });
  });

  it('says so when the app answers with something else', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brickbench-stdio-'));
    folder = dir;
    const file = join(dir, CONNECTION_FILE);
    await writeFile(file, JSON.stringify({ url: 'http://127.0.0.1:7425', token: newToken() }));
    const answering = (response: Response) => connectionLink(file, { fetch: (async () => response) as unknown as typeof fetch });
    expect(await answering(new Response('busy', { status: 503 })).call('get_model', {})).toEqual({ ok: false, error: 'BrickBench could not take that call (HTTP 503).' });
    expect(await answering(new Response('not json')).call('get_model', {})).toMatchObject({ ok: false, error: expect.stringContaining('not a tool result') });
    expect(await answering(Response.json({ ok: 'maybe' })).call('get_model', {})).toMatchObject({ ok: false, error: expect.stringContaining('not a tool result') });
    // an app that never answers: the agent hears so, and that it may still be working
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error)))) as unknown as typeof fetch;
    expect(await connectionLink(file, { fetch: hanging, timeoutMs: 20 }).call('get_model', {})).toEqual({ ok: false, error: TOO_SLOW });
  });

  it('serves the tools over stdio until the agent closes its end', async () => {
    const app = await runningApp();
    await app.access.setTerminal(true);
    const agent = agentEnd();
    const serving = serveStdio({ connectionFile: app.connectionFile, input: agent.input, output: agent.output });
    agent.send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-agent', version: '1.0.0' } } });
    expect(await agent.reply(1)).toMatchObject({ result: { serverInfo: { name: 'brickbench' } } });
    agent.send({ method: 'notifications/initialized' });
    agent.send({ id: 2, method: 'tools/list' });
    const tools = (await agent.reply(2))?.result as { tools: { name: string }[] };
    expect(tools.tools.map((tool) => tool.name)).toContain('place_bricks');
    agent.send({ id: 3, method: 'tools/call', params: { name: 'get_model', arguments: {} } });
    expect(await agent.reply(3)).toMatchObject({ result: { content: [{ type: 'text', text: '{"echo":"get_model"}' }] } });

    // let out: the next call says how to let them in again, and the agent can tell the user
    await app.access.setTerminal(false);
    agent.send({ id: 4, method: 'tools/call', params: { name: 'get_model', arguments: {} } });
    expect(await agent.reply(4)).toMatchObject({ result: { isError: true, content: [{ type: 'text', text: NOT_LET_IN }] } });
    agent.input.end();
    await serving;
  });

  it('answers a call still running when the agent closes its end', async () => {
    const app = await runningApp();
    await app.access.setTerminal(true);
    const agent = agentEnd();
    const serving = serveStdio({ connectionFile: app.connectionFile, input: agent.input, output: agent.output });
    agent.send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-agent', version: '1.0.0' } } });
    await agent.reply(1);
    agent.send({ id: 2, method: 'tools/call', params: { name: 'get_model', arguments: {} } });
    agent.input.end();
    await serving;
    expect(await agent.reply(2)).toMatchObject({ result: { content: [{ type: 'text', text: '{"echo":"get_model"}' }] } });
  });
});
