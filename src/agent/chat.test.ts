import { describe, expect, it } from 'bun:test';
import { chatReducer, createAgentChat, EMPTY_CHAT, type ChatState } from './chat';
import type { AppMessage } from './protocol';

const run = (...actions: Parameters<typeof chatReducer>[1][]): ChatState => actions.reduce(chatReducer, EMPTY_CHAT);

describe('the chat transcript', () => {
  it('shows the request, what the agent says and does, and when it is done', () => {
    const state = run(
      { type: 'ask', text: 'Build a red house' },
      { type: 'event', event: { type: 'started', model: 'claude-opus-5-5' } },
      { type: 'event', event: { type: 'text', text: 'I will start with the walls.' } },
      { type: 'event', event: { type: 'tool', tool: 'place_bricks', summary: 'Placed 24 bricks' } },
      { type: 'event', event: { type: 'tool', tool: 'look', summary: 'Looked from the front' } },
      { type: 'event', event: { type: 'text', text: 'Done: a house of 52 bricks.' } },
      { type: 'event', event: { type: 'done', ok: true, turns: 6, costUsd: 0.1234 } },
    );
    expect(state.running).toBe(false);
    expect(state.started).toBe(true);
    expect(state.entries.map(({ kind, text }) => [kind, text])).toEqual([
      ['user', 'Build a red house'],
      ['agent', 'I will start with the walls.'],
      ['tool', 'Placed 24 bricks'],
      ['tool', 'Looked from the front'],
      ['agent', 'Done: a house of 52 bricks.'],
      ['note', '6 turns · $0.12'],
    ]);
    expect(new Set(state.entries.map((e) => e.id)).size).toBe(state.entries.length);
  });

  it('runs one request at a time and shows failures', () => {
    const asked = run({ type: 'ask', text: 'Build' });
    expect(asked.running).toBe(true);
    expect(chatReducer(asked, { type: 'ask', text: 'Again' })).toBe(asked);
    const failed = chatReducer(asked, { type: 'event', event: { type: 'done', ok: false, error: 'Claude Code is not logged in.' } });
    expect(failed.running).toBe(false);
    expect(failed.entries.at(-1)).toMatchObject({ kind: 'error', text: 'Claude Code is not logged in.' });
    expect(chatReducer(asked, { type: 'event', event: { type: 'done', ok: false } }).entries.at(-1)?.text).toBe('The agent stopped.');
  });

  it('starts over on a new conversation', () => {
    const state = run({ type: 'ask', text: 'Build' }, { type: 'event', event: { type: 'done', ok: true } }, { type: 'reset' });
    expect(state).toEqual(EMPTY_CHAT);
  });
});

describe('talking to the agent', () => {
  function setup(connected = true) {
    const sent: AppMessage[] = [];
    const chat = createAgentChat({ send: (message) => (connected ? (sent.push(message), true) : false) });
    return { chat, sent, state: () => chat.store.getState() };
  }

  it('continues the conversation after the first request', () => {
    const { chat, sent } = setup();
    chat.ask('  Build a tower ');
    chat.receive({ type: 'done', ok: true });
    chat.ask('Make it taller');
    expect(sent).toEqual([
      { kind: 'chat', prompt: 'Build a tower', fresh: true },
      { kind: 'chat', prompt: 'Make it taller', fresh: false },
    ]);
    // not while the agent is working
    chat.newConversation();
    expect(chat.store.getState().started).toBe(true);
    chat.receive({ type: 'done', ok: true });
    chat.newConversation();
    chat.ask('Build a boat');
    expect(sent.at(-1)).toEqual({ kind: 'chat', prompt: 'Build a boat', fresh: true });
  });

  it('asks the agent to stop, and ignores empty requests', () => {
    const { chat, sent, state } = setup();
    chat.ask('   ');
    expect(sent).toEqual([]);
    chat.ask('Build');
    chat.stop();
    expect(sent.at(-1)).toEqual({ kind: 'stop' });
    expect(state().running).toBe(true);
  });

  it('says so when the bridge is not there', () => {
    const { chat, state } = setup(false);
    chat.ask('Build a tower');
    expect(state().running).toBe(false);
    expect(state().entries.at(-1)).toMatchObject({ kind: 'error', text: expect.stringContaining('bun run agent') });
  });
});

describe('losing the bridge mid-run', () => {
  it('stops waiting when the connection drops, so the user can ask again', () => {
    const sent: AppMessage[] = [];
    const chat = createAgentChat({ send: (message) => (sent.push(message), true) });
    chat.ask('Build');
    chat.connectionLost();
    expect(chat.store.getState().running).toBe(false);
    expect(chat.store.getState().entries.at(-1)).toMatchObject({ kind: 'error', text: expect.stringContaining('Lost the connection') });
    // nothing running: nothing to say
    const entries = chat.store.getState().entries.length;
    chat.connectionLost();
    expect(chat.store.getState().entries).toHaveLength(entries);
  });

  it('marks the start and end of each request, for undo', () => {
    const marks: string[] = [];
    const chat = createAgentChat({
      send: () => true,
      onRunStart: () => void marks.push('start'),
      onRunEnd: () => void marks.push('end'),
    });
    chat.ask('Build');
    chat.receive({ type: 'text', text: 'ok' });
    chat.receive({ type: 'done', ok: true });
    chat.ask('Again');
    chat.connectionLost();
    expect(marks).toEqual(['start', 'end', 'start', 'end']);
  });
});
