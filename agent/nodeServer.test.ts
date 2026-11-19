import { afterEach, describe, expect, it } from 'bun:test';
import { request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createAppLink } from './appLink';
import { createBridgeHandlers } from './bridge';
import { unavailableRunner } from './chat';
import { serveWithNode, type NodeServer } from './nodeServer';

const servers: NodeServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

async function serve(...args: Parameters<typeof serveWithNode>): Promise<NodeServer> {
  const server = await serveWithNode(...args);
  servers.push(server);
  return server;
}

describe('serving the bridge with Node', () => {
  it('hands requests to a web handler and its responses back, body, headers and all', async () => {
    const server = await serve(async (request) => {
      const body = request.method === 'POST' ? await request.text() : '';
      return Response.json({ method: request.method, path: new URL(request.url).pathname, host: request.headers.get('host'), body }, { headers: { 'x-bridge': 'yes' } });
    }, 0);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
    const got = await fetch(`${server.url}/health?x=1`);
    expect(got.headers.get('x-bridge')).toBe('yes');
    expect(await got.json()).toEqual({ method: 'GET', path: '/health', host: `127.0.0.1:${server.port}`, body: '' });
    expect(await (await fetch(`${server.url}/mcp`, { method: 'POST', body: '{"a":1}' })).json()).toMatchObject({ method: 'POST', body: '{"a":1}' });
  });

  it('refuses what it has no WebSockets for, requests too large, and handlers that break', async () => {
    const quiet = await serve(() => undefined, 0);
    expect((await fetch(`${quiet.url}/app`)).status).toBe(426);
    let read = 0;
    const echo = await serve(async (request) => {
      read += 1;
      return new Response(await request.text());
    }, 0);
    expect((await fetch(echo.url, { method: 'POST', body: new Uint8Array(5 * 1024 * 1024) })).status).toBe(413);
    // without saying how long: refused once it is too long
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 5; i++) controller.enqueue(new Uint8Array(1024 * 1024));
        controller.close();
      },
    });
    expect((await fetch(echo.url, { method: 'POST', body: stream, duplex: 'half' } as RequestInit)).status).toBe(413);
    expect(read).toBe(0);
    const broken = await serve(() => {
      throw new Error('boom');
    }, 0);
    expect((await fetch(broken.url)).status).toBe(500);
  });

  it('refuses, before reading a byte, requests for any host but this computer', async () => {
    let read = 0;
    const server = await serve(() => {
      read += 1;
      return new Response('ok');
    }, 0);
    const asked = await new Promise<number>((resolve, reject) => {
      // fetch sets Host from the address, so a raw request stands in for a rebinding page
      const request = httpRequest({ host: '127.0.0.1', port: server.port, method: 'POST', path: '/mcp', headers: { host: 'evil.example', 'content-length': '3' } }, (response) =>
        resolve(response.statusCode ?? 0),
      );
      request.on('error', reject);
      request.end('{}\n');
    });
    expect(asked).toBe(403);
    expect(read).toBe(0);
  });

  it('takes another port when its own is in use', async () => {
    const first = await serve(() => new Response('first'), 0);
    const second = await serve(() => new Response('second'), first.port);
    expect(second.port).not.toBe(first.port);
    expect(await (await fetch(second.url)).text()).toBe('second');
  });

  it('serves the bridge’s MCP server to agents, as the desktop app does', async () => {
    const link = createAppLink();
    const handlers = createBridgeHandlers(unavailableRunner('none here'), { link });
    const server = await serve((request) => handlers.fetch(request, { upgrade: () => false }), 0);
    expect(await (await fetch(`${server.url}/health`)).json()).toEqual({ ok: true, tabs: 0, agent: { available: false, name: 'No agent', detail: 'none here' } });
    const client = new Client({ name: 'test-agent', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`)));
    const result = await client.callTool({ name: 'get_model', arguments: {} });
    // no window is open, so the call says so
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('BrickBench is not open');
    await client.close();
  });
});
