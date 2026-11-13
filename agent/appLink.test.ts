import { describe, expect, it } from 'bun:test';
import type { AppMessage, BridgeMessage } from '../src/agent/protocol';
import { createAppLink, NOT_OPEN, type AppSocket } from './appLink';

function tab() {
  const sent: BridgeMessage[] = [];
  const socket: AppSocket = { send: (text) => void sent.push(JSON.parse(text) as BridgeMessage) };
  const lastCall = () => {
    const call = sent.findLast((m) => m.kind === 'call');
    if (!call || call.kind !== 'call') throw new Error('no call sent');
    return call;
  };
  return { socket, sent, lastCall };
}

const result = (id: string, rest: Partial<Extract<AppMessage, { kind: 'result' }>> = {}): AppMessage => ({ kind: 'result', id, ok: true, ...rest });

describe('the link to BrickBench tabs', () => {
  it('sends a call to the tab and hands back its answer', async () => {
    let n = 0;
    const link = createAppLink(() => `c${++n}`);
    const a = tab();
    link.attach(a.socket);
    const answer = link.call('get_model', { limit: 5 });
    expect(a.lastCall()).toEqual({ kind: 'call', id: 'c1', tool: 'get_model', input: { limit: 5 } });
    link.receive(a.socket, result('c1', { data: { brick_count: 3 } }));
    expect(await answer).toEqual({ ok: true, data: { brick_count: 3 } });
  });

  it('passes on pictures and failures', async () => {
    const link = createAppLink(() => 'only');
    const a = tab();
    link.attach(a.socket);
    const look = link.call('look', {});
    link.receive(a.socket, result('only', { data: { view: 'iso' }, image: { data: 'abc', mimeType: 'image/jpeg' } }));
    expect(await look).toEqual({ ok: true, data: { view: 'iso' }, image: { data: 'abc', mimeType: 'image/jpeg' } });
    const failed = link.call('remove_bricks', {});
    link.receive(a.socket, { kind: 'result', id: 'only', ok: false, error: 'Give the ids' });
    expect(await failed).toEqual({ ok: false, error: 'Give the ids' });
    const vague = link.call('remove_bricks', {});
    link.receive(a.socket, { kind: 'result', id: 'only', ok: false });
    expect(await vague).toEqual({ ok: false, error: 'BrickBench could not do that.' });
  });

  it('calls the tab the user used last; tabs that connect in the background wait their turn', async () => {
    const link = createAppLink(() => 'x');
    const a = tab();
    const b = tab();
    link.attach(a.socket);
    link.attach(b.socket);
    expect(link.tabs).toBe(2);
    void link.call('get_model', {});
    expect(a.sent).toHaveLength(1);
    link.receive(b.socket, { kind: 'active' });
    void link.call('get_model', {});
    expect(b.sent).toHaveLength(1);
    // another tab cannot answer for it
    link.receive(a.socket, result('x'));
    link.detach(a.socket);
    link.detach(b.socket);
    expect(link.tabs).toBe(0);
  });

  it('keeps a call going when its tab says it is in use again', async () => {
    const link = createAppLink(() => 'k');
    const a = tab();
    link.attach(a.socket);
    const answer = link.call('look', {});
    link.receive(a.socket, { kind: 'active' });
    link.receive(a.socket, result('k', { data: 'fine' }));
    expect(await answer).toEqual({ ok: true, data: 'fine' });
  });

  it('sends a chat’s calls to the chatting tab, whichever tab the user uses meanwhile', () => {
    const link = createAppLink(() => 'p');
    const a = tab();
    const b = tab();
    link.attach(a.socket);
    link.attach(b.socket);
    link.pin(a.socket);
    link.receive(b.socket, { kind: 'active' });
    void link.call('place_bricks', {});
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(0);
    link.pin(null);
    void link.call('place_bricks', {});
    expect(b.sent).toHaveLength(1);
    // a pinned tab that closes no longer gets calls
    link.pin(a.socket);
    link.detach(a.socket);
    void link.call('place_bricks', {});
    expect(b.sent).toHaveLength(2);
  });

  it('answers the agent when no tab is open, a tab closes or it takes too long', async () => {
    const link = createAppLink(() => 'y');
    expect(await link.call('get_model', {})).toEqual({ ok: false, error: NOT_OPEN });
    const a = tab();
    link.attach(a.socket);
    const closing = link.call('get_model', {});
    link.detach(a.socket);
    expect(await closing).toEqual({ ok: false, error: 'BrickBench was closed before it answered.' });
    link.attach(a.socket);
    expect(await link.call('look', {}, 5)).toEqual({ ok: false, error: expect.stringContaining('did not answer within') });
    // a late answer is ignored
    link.receive(a.socket, result('y'));
  });

  it('reports a tab it cannot write to', async () => {
    const link = createAppLink();
    link.attach({
      send: () => {
        throw new Error('socket is closed');
      },
    });
    expect(await link.call('get_model', {})).toEqual({ ok: false, error: 'Could not reach BrickBench: socket is closed' });
  });
});
