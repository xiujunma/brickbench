import { describe, expect, it } from 'bun:test';
import { PassThrough } from 'node:stream';
import { waitFor } from '../../src/testing/helpers';
import { createRpc, RPC_ERRORS, RpcError, type RpcHandlers } from './rpc';

/** Two peers wired to each other, as a client and an agent over a child process's stdio. */
function pair(left: RpcHandlers, right: RpcHandlers) {
  const toRight = new PassThrough();
  const toLeft = new PassThrough();
  return { a: createRpc(toLeft, toRight, left), b: createRpc(toRight, toLeft, right), toRight, toLeft };
}

const ignore: RpcHandlers = { onRequest: async () => null, onNotification: () => undefined };

describe('JSON-RPC over a pair of streams', () => {
  it('sends requests both ways and matches their answers, errors included', async () => {
    const heard: [string, unknown][] = [];
    const { a, b } = pair(ignore, {
      onRequest: async (method, params) => {
        if (method === 'add') return (params as { x: number; y: number }).x + (params as { x: number; y: number }).y;
        throw new RpcError(RPC_ERRORS.methodNotFound, `No ${method} here.`, { method });
      },
      onNotification: (method, params) => void heard.push([method, params]),
    });
    expect(await Promise.all([a.request('add', { x: 2, y: 3 }), a.request('add', { x: 10, y: -1 })])).toEqual([5, 9]);
    const failure = await a.request('divide').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RpcError);
    expect(failure).toMatchObject({ code: RPC_ERRORS.methodNotFound, message: 'No divide here.', data: { method: 'divide' } });
    a.notify('update', { n: 1 });
    await waitFor(() => expect(heard).toEqual([['update', { n: 1 }]]));
    // and the other way round
    expect(await b.request('anything')).toBeNull();
  });

  it('answers a handler that throws something other than an RpcError as an internal error', async () => {
    const { a } = pair(ignore, {
      onRequest: async () => {
        throw new Error('boom');
      },
      onNotification: () => undefined,
    });
    expect(await a.request('x').catch((error: unknown) => error)).toMatchObject({ code: RPC_ERRORS.internal, message: 'boom' });
  });

  it('reads lines that come in pieces, skips junk, and ends waiting requests when the other side goes', async () => {
    const toPeer = new PassThrough();
    const fromPeer = new PassThrough();
    const heard: string[] = [];
    const peer = createRpc(fromPeer, toPeer, { onRequest: async () => null, onNotification: (method) => void heard.push(method) });
    const asked = peer.request('slow');
    fromPeer.write('{"jsonrpc":"2.0","method":"one"');
    fromPeer.write('}\nnot json\n[1,2]\n\n{"jsonrpc":"2.0","method":"two"}\n');
    await waitFor(() => expect(heard).toEqual(['one', 'two']));
    fromPeer.end();
    expect(await asked.catch((error: unknown) => error)).toMatchObject({ message: 'The agent has gone.' });
    expect(await peer.request('again').catch((error: unknown) => error)).toBeInstanceOf(RpcError);
  });

  it('leaves closing to its owner when asked, with the owner’s reason', async () => {
    const input = new PassThrough();
    const peer = createRpc(input, new PassThrough(), ignore, { closeOnEnd: false });
    const asked = peer.request('slow');
    input.end();
    await Bun.sleep(10);
    // the input's end alone did not end it
    let settled = false;
    void asked.finally(() => void (settled = true)).catch(() => undefined);
    await Bun.sleep(10);
    expect(settled).toBe(false);
    peer.close('Codex stopped: no login.');
    expect(await asked.catch((error: unknown) => error)).toMatchObject({ message: 'Codex stopped: no login.' });
  });

  it('writes one message a line, as JSON-RPC 2.0', async () => {
    const out = new PassThrough();
    let written = '';
    out.on('data', (chunk: Buffer) => void (written += chunk.toString('utf8')));
    const peer = createRpc(new PassThrough(), out, ignore);
    void peer.request('initialize', { protocolVersion: 1 }).catch(() => undefined);
    peer.notify('session/cancel', { sessionId: 's' });
    await waitFor(() => expect(written.trim().split('\n')).toHaveLength(2));
    const lines = written
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as unknown);
    expect(lines).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } },
      { jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 's' } },
    ]);
    peer.close('stopped');
  });
});
