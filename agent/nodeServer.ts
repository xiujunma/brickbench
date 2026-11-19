/**
 * Serves the bridge's HTTP side (the MCP server and /health) with Node's
 * http module, as the desktop app's main process does: the same handlers as
 * `bun run agent`, minus WebSockets, which the app's window has no need of.
 * Requests for other hosts, and large ones, are refused before they are read.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isLocalHost } from './origins';

/** The largest request taken: MCP calls are small (2,000 bricks are some 200 KB), and pictures come the other way. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export type FetchHandler = (request: Request) => Response | Promise<Response> | undefined;

export interface NodeServer {
  /** Such as http://127.0.0.1:7425. */
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

class TooLarge extends Error {}

async function readBody(request: IncomingMessage): Promise<ArrayBuffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const piece = chunk as Buffer;
    size += piece.length;
    if (size > MAX_BODY_BYTES) throw new TooLarge();
    chunks.push(piece);
  }
  // a copy of its own, not a view into Node's pool
  return new Uint8Array(Buffer.concat(chunks)).buffer;
}

/** Node's request as a web Request, for handlers written for any runtime. */
export async function toWebRequest(request: IncomingMessage, origin: string): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const one of value) headers.append(name, one);
    else if (value !== undefined) headers.set(name, value);
  }
  const body = await readBody(request);
  return new Request(new URL(request.url ?? '/', origin).href, { method: request.method ?? 'GET', headers, ...(body ? { body } : {}) });
}

async function sendResponse(response: Response, out: ServerResponse): Promise<void> {
  out.statusCode = response.status;
  response.headers.forEach((value, name) => out.setHeader(name, value));
  if (response.body) {
    for await (const chunk of response.body) out.write(chunk);
  }
  out.end();
}

function refuse(request: IncomingMessage, out: ServerResponse, status: number, why: string): void {
  // what is left of the body is read and dropped, so the client hears the answer rather than a broken connection
  request.resume();
  out.statusCode = status;
  out.setHeader('connection', 'close');
  out.end(why);
}

async function answer(handler: FetchHandler, origin: string, request: IncomingMessage, out: ServerResponse): Promise<void> {
  // before reading anything: the bridge is for this computer, and its requests are small
  if (!isLocalHost(request.headers.host ?? null)) {
    refuse(request, out, 403, 'This bridge answers requests to localhost only.');
    return;
  }
  if (Number(request.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
    refuse(request, out, 413, 'Too large.');
    return;
  }
  try {
    const response = (await handler(await toWebRequest(request, origin))) ?? new Response('Expected a WebSocket.', { status: 426 });
    await sendResponse(response, out);
  } catch (error: unknown) {
    if (out.headersSent) {
      out.destroy();
      return;
    }
    if (error instanceof TooLarge) refuse(request, out, 413, 'Too large.');
    else refuse(request, out, 500, 'The bridge could not answer.');
  }
}

function listenOn(server: Server, port: number, hostname: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error): void => reject(error);
    server.once('error', failed);
    server.listen(port, hostname, () => {
      server.off('error', failed);
      resolve();
    });
  });
}

/**
 * Serves `handler` on this computer only: on `port` when it is free, else on
 * any free port (a bridge from `bun run agent` may have the usual one).
 */
export async function serveWithNode(handler: FetchHandler, port: number, hostname = '127.0.0.1'): Promise<NodeServer> {
  let origin = '';
  const server = createServer((request, out) => void answer(handler, origin, request, out));
  try {
    await listenOn(server, port, hostname);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || port === 0) throw error;
    await listenOn(server, 0, hostname);
  }
  const bound = (server.address() as AddressInfo).port;
  origin = `http://${hostname}:${bound}`;
  return {
    url: origin,
    port: bound,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
