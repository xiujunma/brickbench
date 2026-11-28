/**
 * JSON-RPC 2.0 over a pair of streams, one message a line, as the Agent
 * Client Protocol runs over an agent's stdio: requests and notifications go
 * both ways. Requests the other side makes go to one handler; its errors
 * are answered as JSON-RPC errors, never thrown here.
 */
import type { Readable, Writable } from 'node:stream';

/** A line longer than this is not a message anyone sends: dropped, with the rest read on. */
const MAX_LINE = 32 * 1024 * 1024;

/** JSON-RPC's own error codes, and the one for a method nobody handles. */
export const RPC_ERRORS = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;

/** An error the other side answered with, or that ended a request: the connection closed. */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

/** A request from the other side: its answer is what this resolves to, or the RpcError it rejects with. */
export type RequestHandler = (method: string, params: unknown) => Promise<unknown>;
export type NotificationHandler = (method: string, params: unknown) => void;

export interface RpcPeer {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  /** Rejects every request still waiting, as when the other side has gone. */
  close(reason?: string): void;
}

export interface RpcHandlers {
  readonly onRequest: RequestHandler;
  readonly onNotification: NotificationHandler;
}

export interface RpcOptions {
  /**
   * Whether the end of the input closes the connection, with a reason of its
   * own: true unless the owner closes it itself, as when a child process's
   * own end says better why (what it printed to stderr).
   */
  readonly closeOnEnd?: boolean;
}

type Id = number | string;

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: RpcError) => void;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is Id => typeof value === 'number' || typeof value === 'string';

export function createRpc(input: Readable, output: Writable, handlers: RpcHandlers, options: RpcOptions = {}): RpcPeer {
  const pending = new Map<Id, Pending>();
  let nextId = 1;
  let closed = false;

  const write = (message: object): void => {
    if (closed) return;
    output.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  };

  const answer = (id: Id, method: string, params: unknown): void => {
    handlers.onRequest(method, params).then(
      (result) => write({ id, result: result ?? null }),
      (error: unknown) => {
        const failure = error instanceof RpcError ? error : new RpcError(RPC_ERRORS.internal, error instanceof Error ? error.message : String(error));
        write({ id, error: { code: failure.code, message: failure.message, ...(failure.data === undefined ? {} : { data: failure.data }) } });
      },
    );
  };

  const settle = (message: Record<string, unknown>, id: Id): void => {
    const waiting = pending.get(id);
    if (!waiting) return;
    pending.delete(id);
    const error = message['error'];
    if (isObject(error)) {
      const code = typeof error['code'] === 'number' ? error['code'] : RPC_ERRORS.internal;
      waiting.reject(new RpcError(code, typeof error['message'] === 'string' ? error['message'] : 'The agent answered with an error.', error['data']));
    } else waiting.resolve(message['result']);
  };

  const receive = (line: string): void => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isObject(message)) return;
    const { id, method } = message;
    if (typeof method === 'string') {
      if (isId(id)) answer(id, method, message['params']);
      else handlers.onNotification(method, message['params']);
    } else if (isId(id)) settle(message, id);
  };

  let buffer = '';
  const decoder = new TextDecoder();
  input.on('data', (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line) receive(line);
    }
    if (buffer.length > MAX_LINE) buffer = '';
  });

  const close = (reason = 'The agent has gone.'): void => {
    if (closed) return;
    closed = true;
    for (const waiting of pending.values()) waiting.reject(new RpcError(RPC_ERRORS.internal, reason));
    pending.clear();
  };
  if (options.closeOnEnd ?? true) {
    input.once('end', () => close());
    input.once('close', () => close());
  }

  return {
    request(method, params) {
      if (closed) return Promise.reject(new RpcError(RPC_ERRORS.internal, 'The agent has gone.'));
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        write({ id, method, ...(params === undefined ? {} : { params }) });
      });
    },
    notify(method, params) {
      write({ method, ...(params === undefined ? {} : { params }) });
    },
    close,
  };
}
