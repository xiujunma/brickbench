import { describe, expect, it } from 'bun:test';
import { waitFor } from '../testing/helpers';
import { createAgentLink, type SocketLike } from './link';
import type { AgentEvent, AppMessage, BridgeMessage, ToolOutcome } from './protocol';

class FakeSocket implements SocketLike {
  readonly sent: AppMessage[] = [];
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();
  closed = false;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: { data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(text: string): void {
    this.sent.push(JSON.parse(text) as AppMessage);
  }
  close(): void {
    this.closed = true;
    this.emit('close');
  }
  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
  deliver(message: BridgeMessage | string): void {
    this.emit('message', typeof message === 'string' ? message : JSON.stringify(message));
  }
}

function setup(
  runTool: (tool: string, input: unknown) => Promise<ToolOutcome> = async () => ({ ok: true, data: { fine: true } }),
  isFocused: () => boolean = () => true,
) {
  const sockets: FakeSocket[] = [];
  const events: AgentEvent[] = [];
  const timers: (() => void)[] = [];
  const link = createAgentLink({
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    runTool,
    isFocused,
    onAgentEvent: (event) => void events.push(event),
    schedule: (run) => {
      const timer = (): void => {
        timers.splice(timers.indexOf(timer), 1);
        run();
      };
      timers.push(timer);
      return () => void timers.splice(timers.indexOf(timer), 1);
    },
  });
  const socket = (): FakeSocket => {
    const last = sockets.at(-1);
    if (!last) throw new Error('no socket');
    return last;
  };
  return { link, sockets, socket, events, timers, state: () => link.store.getState() };
}

const COMMAND = 'claude mcp add brickbench -e ELECTRON_RUN_AS_NODE=1 -- /Applications/BrickBench.app/Contents/MacOS/BrickBench /agent/mcp.cjs';
const hello: BridgeMessage = { kind: 'hello', version: '1.0.0', agent: { available: true, name: 'Claude Code 2.1' }, terminal: { command: COMMAND, open: false } };

describe('the link to the agent bridge', () => {
  it('connects when asked, says this tab is in use, and learns which agent answers', () => {
    const { link, socket, state } = setup();
    expect(state().status).toBe('off');
    link.connect();
    link.connect();
    expect(state().status).toBe('connecting');
    socket().emit('open');
    socket().deliver(hello);
    expect(state()).toEqual({ status: 'connected', agent: { available: true, name: 'Claude Code 2.1' }, terminal: { command: COMMAND, open: false } });
    expect(socket().sent).toEqual([{ kind: 'active' }]);
    link.markActive();
    expect(socket().sent).toHaveLength(2);
  });

  it('asks the bridge to let agents in a terminal in, and shows they are once it says so', () => {
    const { link, socket, state } = setup();
    // not connected: nothing to ask
    expect(link.setTerminal(true)).toBe(false);
    link.connect();
    socket().emit('open');
    // a terminal message before hello changes nothing: there is nothing to change yet
    socket().deliver({ kind: 'terminal', open: true });
    expect(state().terminal).toBeNull();
    socket().deliver(hello);
    expect(link.setTerminal(true)).toBe(true);
    expect(socket().sent.at(-1)).toEqual({ kind: 'terminal', open: true });
    expect(state().terminal?.open).toBe(false);
    socket().deliver({ kind: 'terminal', open: true });
    expect(state().terminal).toEqual({ command: COMMAND, open: true });
  });

  it('lets a tab in the background connect without taking over', () => {
    const { link, socket } = setup(undefined, () => false);
    link.connect();
    socket().emit('open');
    expect(socket().sent).toEqual([]);
    link.markActive();
    expect(socket().sent).toEqual([{ kind: 'active' }]);
  });

  it('runs tool calls and answers them, pictures and failures included', async () => {
    const { link, socket } = setup(async (tool) =>
      tool === 'look' ? { ok: true, data: { view: 'iso' }, image: { data: 'eA==', mimeType: 'image/jpeg' } } : { ok: false, error: 'nope' },
    );
    link.connect();
    socket().emit('open');
    socket().deliver({ kind: 'call', id: 'c1', tool: 'look', input: {} });
    socket().deliver({ kind: 'call', id: 'c2', tool: 'remove_bricks', input: {} });
    await waitFor(() => expect(socket().sent).toHaveLength(3));
    expect(socket().sent.slice(1)).toEqual([
      { kind: 'result', id: 'c1', ok: true, data: { view: 'iso' }, image: { data: 'eA==', mimeType: 'image/jpeg' } },
      { kind: 'result', id: 'c2', ok: false, error: 'nope' },
    ]);
  });

  it('passes on what the agent is doing and ignores junk', () => {
    const { link, socket, events } = setup();
    link.connect();
    socket().emit('open');
    socket().deliver({ kind: 'agent', event: { type: 'text', text: 'Building…' } });
    socket().deliver('{"kind":"mystery"}');
    socket().deliver('not json');
    socket().emit('message', new ArrayBuffer(2));
    expect(events).toEqual([{ type: 'text', text: 'Building…' }]);
  });

  it('sends only while connected', () => {
    const { link, socket } = setup();
    expect(link.send({ kind: 'stop' })).toBe(false);
    link.connect();
    expect(link.send({ kind: 'stop' })).toBe(false);
    socket().emit('open');
    expect(link.send({ kind: 'stop' })).toBe(true);
  });

  it('keeps trying while the bridge is down, and stops when told to', () => {
    const { link, sockets, socket, timers, state } = setup();
    link.connect();
    socket().emit('error');
    socket().emit('close');
    expect(state().status).toBe('unreachable');
    expect(timers).toHaveLength(1);
    timers[0]?.();
    expect(sockets).toHaveLength(2);
    socket().emit('open');
    socket().deliver(hello);
    socket().emit('close');
    // it was connected: try again, and show it
    expect(state()).toEqual({ status: 'connecting', agent: null, terminal: null });
    timers[0]?.();
    socket().emit('open');
    link.disconnect();
    expect(state().status).toBe('off');
    expect(timers).toHaveLength(0);
    expect(socket().closed).toBe(true);
    // no more tries once off
    expect(sockets).toHaveLength(3);
  });
});
