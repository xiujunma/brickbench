import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent, AppMessage, BridgeMessage, ToolName } from '../../src/agent/protocol';
import { waitFor } from '../../src/testing/helpers';
import { createAccess } from '../access';
import { createBridgeHandlers, type BridgeHandlers, type TabSocket } from '../bridge';
import type { ChatRunner, RequestExtra } from '../chat';
import { unavailableRunner } from '../chat';
import { serveWithNode, type NodeServer } from '../nodeServer';
import { brickbenchTool, createAcpRunner, permissionFor } from './acpRunner';
import type { PermissionRequest } from './schema';

const FAKE_AGENT = join(import.meta.dir, '..', 'fixtures', 'fakeAcpAgent.ts');
/** BrickBench's MCP server for agents, run straight from its source by Bun, as the app's executable runs mcp.cjs. */
const MCP_ENTRY = join(import.meta.dir, '..', '..', 'electron', 'mcp.ts');

let folder = '';
let server: NodeServer | null = null;
const runners: ChatRunner[] = [];
afterEach(async () => {
  for (const runner of runners.splice(0)) runner.close?.();
  await server?.close();
  server = null;
  if (folder) await rm(folder, { recursive: true, force: true });
  folder = '';
});

/** A bridge with the app's window open, which keeps the tools it is asked to run, and a connection file with the chat's token. */
async function runningApp(): Promise<{ readonly connectionFile: string; readonly calls: string[] }> {
  folder = await mkdtemp(join(tmpdir(), 'brickbench-acp-'));
  let handlers: BridgeHandlers | null = null;
  server = await serveWithNode((request) => (handlers ? handlers.fetch(request) : new Response('Starting.', { status: 503 })), 0);
  const access = await createAccess({ folder, url: server.url });
  const ready = createBridgeHandlers(unavailableRunner('none'), { access });
  handlers = ready;
  const calls: string[] = [];
  const socket: TabSocket = {
    data: { tab: 1 },
    send(text) {
      const message = JSON.parse(text) as BridgeMessage;
      if (message.kind !== 'call') return;
      calls.push(message.tool);
      const reply: AppMessage = { kind: 'result', id: message.id, ok: true, data: { placed: 1 } };
      queueMicrotask(() => ready.tabs.message(socket, JSON.stringify(reply)));
    },
  };
  ready.tabs.open(socket);
  const connectionFile = join(folder, 'chat-connection.json');
  await writeFile(connectionFile, JSON.stringify({ url: server.url, token: access.chatToken }), { mode: 0o600 });
  return { connectionFile, calls };
}

interface Extra {
  readonly env?: Record<string, string>;
  readonly command?: readonly string[];
  readonly connectionFile?: string;
  readonly killAfterMs?: number;
}

function runner(mode: string, extra: Extra = {}): ChatRunner {
  const made = createAcpRunner({
    name: 'Fake',
    command: extra.command ?? [process.execPath, FAKE_AGENT],
    env: { ...(process.env as Record<string, string>), FAKE_ACP_MODE: mode, ...extra.env },
    workDir: tmpdir(),
    mcpServer: { name: 'brickbench', command: process.execPath, args: [MCP_ENTRY, extra.connectionFile ?? '/nowhere.json'], env: [] },
    instructions: 'Build with BrickBench.',
    signIn: 'Run fake login',
    killAfterMs: extra.killAfterMs ?? 300,
  });
  runners.push(made);
  return made;
}

/** Runs one request to its end, with every event on the way. */
function ask(chat: ChatRunner, prompt: string, fresh = false, extra?: RequestExtra): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  return new Promise((resolve) =>
    chat.start(
      prompt,
      fresh,
      (event) => {
        events.push(event);
        if (event.type === 'done') resolve(events);
      },
      extra,
    ),
  );
}

describe('a coding agent over the Agent Client Protocol', () => {
  it('answers in one message, with the instructions on a session’s first request where the agent takes no system prompt', async () => {
    const chat = runner('echo');
    expect(chat.status()).toMatchObject({ available: true, name: 'Fake' });
    expect(await ask(chat, 'Build a tower', true)).toEqual([
      { type: 'started' },
      { type: 'text', text: 'You said: Build a tower. I was told how BrickBench works. Session 1.' },
      { type: 'done', ok: true },
    ]);
    expect((await ask(chat, 'Taller')).filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'You said: Taller. Session 1.' }]);
    // a new conversation is a new session, told again
    expect((await ask(chat, 'Again', true)).filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'You said: Again. I was told how BrickBench works. Session 2.' }]);
  });

  it('gives the instructions as a system prompt where the agent takes one', async () => {
    const chat = runner('echo', { env: { FAKE_ACP_SYSTEM_PROMPT: '1' } });
    for (const prompt of ['One', 'Two']) {
      expect((await ask(chat, prompt)).filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: `You said: ${prompt}. I was told how BrickBench works. Session 1.` }]);
    }
  });

  it('gives the user’s own instructions with its own as a session starts, which keeps them', async () => {
    const own = { instructions: 'Use pastel colours' };
    const texts = async (chat: ChatRunner, prompt: string, fresh: boolean, extra?: RequestExtra) => (await ask(chat, prompt, fresh, extra)).filter((e) => e.type === 'text');
    // on the session's first request, where the agent takes no system prompt
    const plain = runner('echo');
    expect(await texts(plain, 'One', true, own)).toEqual([{ type: 'text', text: 'You said: One. I was told how BrickBench works. I was asked: Use pastel colours. Session 1.' }]);
    expect(await texts(plain, 'Two', false, own)).toEqual([{ type: 'text', text: 'You said: Two. Session 1.' }]);
    // as the system prompt, where it takes one
    const prompted = runner('echo', { env: { FAKE_ACP_SYSTEM_PROMPT: '1' } });
    expect(await texts(prompted, 'One', true, own)).toEqual([{ type: 'text', text: 'You said: One. I was told how BrickBench works. I was asked: Use pastel colours. Session 1.' }]);
    // new ones take hold with the next new chat
    expect(await texts(prompted, 'Two', true, { instructions: 'Use bright colours' })).toEqual([
      { type: 'text', text: 'You said: Two. I was told how BrickBench works. I was asked: Use bright colours. Session 2.' },
    ]);
  });

  it('builds through BrickBench’s MCP server, allowed its tools and refused anything else', async () => {
    const app = await runningApp();
    const events = await ask(runner('build', { connectionFile: app.connectionFile }), 'Build a red tower', true);
    expect(events).toEqual([
      { type: 'started' },
      { type: 'tool', tool: 'mcp__brickbench__place_bricks', summary: 'Placing 2 bricks' },
      { type: 'tool', tool: 'refused', summary: 'Not allowed: rm -rf ~. BrickBench lets agents use only its own tools.' },
      { type: 'tool', tool: 'mcp.brickbench.place_bricks', summary: 'Placing 1 brick' },
      { type: 'text', text: 'Built a **red** tower of 3 bricks. Leave: allow-once, reject.' },
      { type: 'done', ok: true, costUsd: 0.01 },
    ]);
    expect(app.calls).toEqual(['place_bricks', 'place_bricks']);
  });

  it('says how to sign in when the agent needs it', async () => {
    expect((await ask(runner('signin'), 'Build', true)).at(-1)).toEqual({ type: 'done', ok: false, error: 'Fake needs you to sign in first. Run fake login, then ask again.' });
  });

  it('stops a request when asked, and ends an agent that will not stop, starting it again next time', async () => {
    const hanging = runner('hang');
    const events: AgentEvent[] = [];
    hanging.start('Wait', true, (event) => void events.push(event));
    await waitFor(() => expect(events).toEqual([{ type: 'started' }]), 5000);
    // one request at a time
    expect((await ask(hanging, 'And this'))).toEqual([{ type: 'done', ok: false, error: 'The agent is still working on the last request.' }]);
    hanging.stop();
    await waitFor(() => expect(events.at(-1)).toEqual({ type: 'done', ok: false, error: 'Stopped.' }), 5000);
    expect(hanging.running).toBe(false);

    const stubborn = runner('stubborn');
    const first: AgentEvent[] = [];
    stubborn.start('Wait', true, (event) => void first.push(event));
    await waitFor(() => expect(first).toEqual([{ type: 'started' }]), 5000);
    stubborn.stop();
    await waitFor(() => expect(first.at(-1)).toEqual({ type: 'done', ok: false, error: 'Stopped.' }), 5000);
    const again: AgentEvent[] = [];
    stubborn.start('Wait again', false, (event) => void again.push(event));
    await waitFor(() => expect(again).toEqual([{ type: 'started' }]), 5000);
    stubborn.stop();
    await waitFor(() => expect(again.at(-1)?.type).toBe('done'), 5000);
  });

  it('says when the agent declines, falls over, cannot start, or asks for what BrickBench does not offer', async () => {
    expect((await ask(runner('refuse'), 'Build', true)).at(-1)).toEqual({ type: 'done', ok: false, error: 'Fake declined to do that.' });
    expect((await ask(runner('crash'), 'Build', true)).at(-1)).toEqual({ type: 'done', ok: false, error: 'Fake stopped: The fake agent fell over.' });
    expect((await ask(runner('echo', { command: ['/nonexistent/agent'] }), 'Build', true)).at(-1)).toMatchObject({
      type: 'done',
      ok: false,
      error: expect.stringContaining('Could not start Fake'),
    });
    const text = (await ask(runner('fs'), 'Read a file', true)).find((e) => e.type === 'text');
    expect(text?.type === 'text' ? text.text : '').toContain('-32601');
  });

  it('starts the agent afresh after it is closed', async () => {
    const chat = runner('echo');
    await ask(chat, 'One', true);
    chat.close?.();
    expect((await ask(chat, 'Two')).filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'You said: Two. I was told how BrickBench works. Session 1.' }]);
  });
});

/** Whether a process is still there. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A file for the stand-in to write its process id to, and a way to read it once it has. */
async function pidFile(): Promise<{ readonly file: string; readonly pid: () => Promise<number> }> {
  const dir = await mkdtemp(join(tmpdir(), 'brickbench-acp-pid-'));
  folder ||= dir;
  const file = join(dir, `agent-${Math.random().toString(36).slice(2)}.pid`);
  return {
    file,
    pid: async () => {
      await waitFor(() => expect(Bun.file(file).size).toBeGreaterThan(0), 5000);
      return Number(await Bun.file(file).text());
    },
  };
}

describe('an agent’s program, from start to end', () => {
  it('stops an agent still starting, and keeps none that finishes starting after it is closed', async () => {
    const first = await pidFile();
    const mute = runner('mute', { env: { FAKE_ACP_PID_FILE: first.file } });
    const events: AgentEvent[] = [];
    mute.start('Build', true, (event) => void events.push(event));
    const pid = await first.pid();
    mute.stop();
    await waitFor(() => expect(events.at(-1)).toEqual({ type: 'done', ok: false, error: 'Stopped.' }), 3000);
    expect(mute.running).toBe(false);
    await waitFor(() => expect(isAlive(pid)).toBe(false), 3000);

    const second = await pidFile();
    const closing = runner('mute', { env: { FAKE_ACP_PID_FILE: second.file } });
    closing.start('Build', true, () => undefined);
    const other = await second.pid();
    closing.close?.();
    await waitFor(() => expect(isAlive(other)).toBe(false), 3000);
  });

  it('cancels a request the agent is working on, without waiting to end its program', async () => {
    const chat = runner('hang', { killAfterMs: 10_000 });
    const events: AgentEvent[] = [];
    chat.start('Wait', true, (event) => void events.push(event));
    await waitFor(() => expect(events).toEqual([{ type: 'started' }]), 5000);
    const asked = Date.now();
    chat.stop();
    await waitFor(() => expect(events.at(-1)).toEqual({ type: 'done', ok: false, error: 'Stopped.' }), 3000);
    // well before the program would have been ended
    expect(Date.now() - asked).toBeLessThan(3000);
  });

  it('starts a new agent after one falls over, and ends the program when closed', async () => {
    const crashing = runner('crash');
    for (const _ of [1, 2]) {
      expect((await ask(crashing, 'Build', true)).at(-1)).toEqual({ type: 'done', ok: false, error: 'Fake stopped: The fake agent fell over.' });
    }
    const file = await pidFile();
    const chat = runner('echo', { env: { FAKE_ACP_PID_FILE: file.file } });
    await ask(chat, 'One', true);
    const pid = await file.pid();
    expect(isAlive(pid)).toBe(true);
    chat.close?.();
    await waitFor(() => expect(isAlive(pid)).toBe(false), 3000);
  });

  it('says when an agent speaks another version of the protocol', async () => {
    expect((await ask(runner('v2'), 'Build', true)).at(-1)).toEqual({
      type: 'done',
      ok: false,
      error: 'Fake speaks version 2 of the Agent Client Protocol, and BrickBench version 1.',
    });
  });

  it('gives the instructions again when a session’s first request did not go through', async () => {
    const chat = runner('failfirst');
    expect((await ask(chat, 'Build', true)).at(-1)).toMatchObject({ type: 'done', ok: false, error: expect.stringContaining('sign in') });
    expect((await ask(chat, 'Build')).filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'You said: Build. I was told how BrickBench works. Session 1.' }]);
  });

  it('shows each message apart, a tool call once its input is in, what each request cost, and only this session’s news', async () => {
    const chat = runner('chatty');
    const expected = (cost: number): AgentEvent[] => [
      { type: 'started' },
      { type: 'text', text: 'Let me check the grid.' },
      // leave was asked by the call's id alone, and given: it is BrickBench's
      { type: 'tool', tool: 'brickbench: place_bricks', summary: 'Placing 40 bricks' },
      { type: 'text', text: 'Done: 40 bricks. Leave: allow-once.' },
      { type: 'done', ok: true, costUsd: cost },
    ];
    expect(await ask(chat, 'Build', true)).toEqual(expected(0.05));
    // the session's running total is $0.10 now; this request cost $0.05 of it
    const second = await ask(chat, 'Again');
    expect(second.at(-1)).toMatchObject({ type: 'done', ok: true });
    expect((second.at(-1) as { costUsd?: number }).costUsd).toBeCloseTo(0.05, 5);
    // a new session's running total starts again
    expect((await ask(chat, 'Afresh', true)).at(-1)).toEqual({ type: 'done', ok: true, costUsd: 0.05 });
  });

  it('shows two messages back to back as two', async () => {
    expect((await ask(runner('messages'), 'Talk', true)).filter((e) => e.type === 'text')).toEqual([
      { type: 'text', text: 'One.' },
      { type: 'text', text: 'Two.' },
    ]);
  });

  it('judges leave asked by a call’s id alone by what this session announced, and nothing older', async () => {
    const chat = runner('byid');
    expect((await ask(chat, 'Look', true)).filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'Leave: allow-once.' }]);
    // a new session: the call announced in the old one is not this session's
    const events = await ask(chat, 'Look again', true);
    expect(events.filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'Leave: reject.' }]);
  });

  it('shows two calls under one id in one request as two', async () => {
    expect((await ask(runner('twice'), 'Go', true)).filter((e) => e.type === 'tool')).toEqual([
      { type: 'tool', tool: 'brickbench: place_bricks', summary: 'Placing 2 bricks' },
      { type: 'tool', tool: 'brickbench: look', summary: 'Looking at the model from the front' },
    ]);
  });

  it('lets go of an agent stopped while starting, even one that says hello late, and starts another next time', async () => {
    const file = await pidFile();
    const chat = runner('slowhello', { env: { FAKE_ACP_PID_FILE: file.file }, killAfterMs: 2000 });
    const events: AgentEvent[] = [];
    chat.start('Build', true, (event) => void events.push(event));
    const first = await file.pid();
    chat.stop();
    await waitFor(() => expect(events.at(-1)).toEqual({ type: 'done', ok: false, error: 'Stopped.' }), 3000);
    await Bun.write(file.file, '');
    expect((await ask(chat, 'Build')).at(-1)).toEqual({ type: 'done', ok: true });
    expect(await file.pid()).not.toBe(first);
  });

  it('does not let an id used again carry a BrickBench tool over to something else', async () => {
    const chat = runner('reuse');
    await ask(chat, 'Look', true);
    const events = await ask(chat, 'And now');
    expect(events).toContainEqual({ type: 'tool', tool: 'refused', summary: 'Not allowed: rm -rf ~. BrickBench lets agents use only its own tools.' });
    // whether the request names the call or gives its id alone
    expect(events.filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'Leave: reject, reject.' }]);
  });
});

describe('which tool calls are BrickBench’s', () => {
  const call = (fields: Record<string, unknown>) => ({ toolCallId: 't', ...fields });
  it('knows BrickBench’s tools by the names agents give them, and nothing else', () => {
    const tools: (ToolName | null)[] = [
      brickbenchTool(call({ name: 'mcp__brickbench__look', title: 'brickbench: look' })),
      brickbenchTool(call({ title: 'brickbench: place_bricks' })),
      brickbenchTool(call({ title: 'mcp.brickbench.get_model' })),
      brickbenchTool(call({ title: 'Find parts', _meta: { 'gemini-cli': { mcp: { server_name: 'brickbench', tool_name: 'find_parts' } } } })),
    ];
    expect(tools).toEqual(['look', 'place_bricks', 'get_model', 'find_parts']);
    for (const other of [
      call({ name: 'mcp__brickbench__rm' }),
      call({ name: 'mcp__evil__look', title: 'evil: look' }),
      call({ title: 'mcp.brickbench.look extra' }),
      call({ title: 'Look', _meta: { 'gemini-cli': { mcp: { server_name: 'evil', tool_name: 'look' } } } }),
      call({ title: 'rm -rf ~' }),
    ]) {
      expect(brickbenchTool(other)).toBeNull();
    }
  });

  it('allows BrickBench’s tools, refuses the rest, and cancels when no option fits', () => {
    const request = (title: string, kinds: readonly ('allow_once' | 'allow_always' | 'reject_once' | 'reject_always')[]): PermissionRequest => ({
      sessionId: 's',
      toolCall: { toolCallId: 't', title },
      options: kinds.map((kind) => ({ optionId: `o-${kind}`, kind })),
    });
    expect(permissionFor(request('brickbench: look', ['reject_once', 'allow_always', 'allow_once']))).toEqual({ outcome: { outcome: { outcome: 'selected', optionId: 'o-allow_once' } }, allowed: true });
    expect(permissionFor(request('brickbench: look', ['allow_always']))).toEqual({ outcome: { outcome: { outcome: 'selected', optionId: 'o-allow_always' } }, allowed: true });
    expect(permissionFor(request('rm -rf ~', ['allow_once', 'reject_always']))).toEqual({ outcome: { outcome: { outcome: 'selected', optionId: 'o-reject_always' } }, allowed: false });
    expect(permissionFor(request('rm -rf ~', ['allow_once']))).toEqual({ outcome: { outcome: { outcome: 'cancelled' } }, allowed: false });
  });
});
