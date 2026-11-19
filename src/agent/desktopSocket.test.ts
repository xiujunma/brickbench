import { describe, expect, it } from 'bun:test';
import type { DesktopAgentApi } from '../desktop/protocol';
import { desktopSocket } from './desktopSocket';

/** The desktop app's side, driven by the test. */
function fakeApp() {
  const listeners = new Set<(event: unknown) => void>();
  const calls: string[] = [];
  const agent: DesktopAgentApi = {
    open: (id) => void calls.push(`open ${id}`),
    send: (id, text) => void calls.push(`send ${id} ${text}`),
    close: (id) => void calls.push(`close ${id}`),
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { agent, calls, tell: (event: unknown) => listeners.forEach((listener) => listener(event)), listening: () => listeners.size };
}

function record(socket: ReturnType<typeof desktopSocket>) {
  const seen: string[] = [];
  socket.addEventListener('open', () => void seen.push('open'));
  socket.addEventListener('message', (event) => void seen.push(`message ${String(event.data)}`));
  socket.addEventListener('close', () => void seen.push('close'));
  return seen;
}

describe('the Agent panel’s socket in the desktop app', () => {
  it('connects through the app, then carries messages both ways', () => {
    const app = fakeApp();
    const socket = desktopSocket(app.agent, 'a');
    const seen = record(socket);
    expect(app.calls).toEqual(['open a']);
    // nothing goes before the app says it is connected
    socket.send('early');
    app.tell({ type: 'message', id: 'a', data: 'too soon' });
    app.tell({ type: 'open', id: 'a' });
    app.tell({ type: 'message', id: 'a', data: '{"kind":"hello"}' });
    socket.send('{"kind":"active"}');
    expect(seen).toEqual(['open', 'message {"kind":"hello"}']);
    expect(app.calls).toEqual(['open a', 'send a {"kind":"active"}']);
  });

  it('hears only what is said to its own connection', () => {
    const app = fakeApp();
    const older = desktopSocket(app.agent, 'old');
    older.close();
    const seen = record(desktopSocket(app.agent, 'new'));
    app.tell({ type: 'open', id: 'new' });
    // a reply from the run the older connection started, sent after it closed
    app.tell({ type: 'message', id: 'old', data: '{"kind":"agent"}' });
    app.tell({ type: 'close', id: 'old' });
    expect(seen).toEqual(['open']);
  });

  it('closes when the app says so, or when asked, once', () => {
    const app = fakeApp();
    const socket = desktopSocket(app.agent, 'a');
    const seen = record(socket);
    app.tell({ type: 'open', id: 'a' });
    app.tell({ type: 'close', id: 'a' });
    app.tell({ type: 'message', id: 'a', data: 'late' });
    socket.close();
    expect(seen).toEqual(['open', 'close']);
    expect(app.calls).toEqual(['open a']);
    expect(app.listening()).toBe(0);

    const other = fakeApp();
    const asked = desktopSocket(other.agent);
    const closed = record(asked);
    asked.close();
    asked.close();
    expect(closed).toEqual(['close']);
    expect(other.calls).toEqual([expect.stringMatching(/^open [\w-]+$/), expect.stringMatching(/^close [\w-]+$/)]);
  });

  it('ignores anything from the app that is not an event', () => {
    const app = fakeApp();
    const seen = record(desktopSocket(app.agent, 'a'));
    app.tell({ type: 'open', id: 'a' });
    app.tell({ type: 'message', id: 'a', data: 42 });
    app.tell({ type: 'close' });
    app.tell('close');
    expect(seen).toEqual(['open']);
  });
});
