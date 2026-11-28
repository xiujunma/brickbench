#!/usr/bin/env bun
/**
 * Stands in for a coding agent that speaks the Agent Client Protocol, in
 * tests: answers initialize, session/new and session/prompt over stdio, one
 * JSON-RPC message a line. FAKE_ACP_MODE picks what a prompt does: echo (the
 * default), build (really places bricks through the MCP server session/new
 * names, asking leave first, and asks leave for a shell command it should be
 * refused), hang (until session/cancel), stubborn (hangs through
 * session/cancel), refuse, crash, fs (asks the client for a file, which it
 * does not offer), signin (session/new needs a login), mute (never answers
 * initialize), v2 (speaks version 2), failfirst (a session's first prompt
 * needs a login, the next does not), or chatty (two messages around a tool
 * call whose input comes in pieces, a request for leave naming the call by
 * its id alone, a running cost, and an update for another session),
 * messages (two messages back to back), byid (asks leave by a call's id
 * alone, announcing the call only in its first prompt), or reuse (announces
 * a BrickBench tool under an id, then a shell command under the same id),
 * twice (two BrickBench calls under one id in one prompt), or slowhello
 * (ignores SIGTERM and says hello late, then echoes).
 * FAKE_ACP_SYSTEM_PROMPT=1 has it take a system prompt; FAKE_ACP_PID_FILE and
 * FAKE_ACP_SESSION_FILE have it write its process id and session/new's
 * parameters there.
 */
import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

interface Block {
  readonly type: string;
  readonly text?: string;
}
interface McpServer {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: readonly { readonly name: string; readonly value: string }[];
}
interface Message {
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: unknown;
  readonly error?: unknown;
}

const mode = process.env['FAKE_ACP_MODE'] ?? 'echo';
const takesSystemPrompt = process.env['FAKE_ACP_SYSTEM_PROMPT'] === '1';
const SESSION = 'fake-session';

let server: McpServer | null = null;
let prompts = 0;
let cost = 0;
const pidFile = process.env['FAKE_ACP_PID_FILE'];
if (pidFile) writeFileSync(pidFile, String(process.pid));
if (mode === 'slowhello') process.on('SIGTERM', () => undefined);
let systemPrompt = '';
let sessions = 0;
let cancel: (() => void) | null = null;
let nextId = 1000;
const waiting = new Map<number | string, (result: unknown) => void>();

const send = (message: object): void => void process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const update = (value: object): void => send({ method: 'session/update', params: { sessionId: SESSION, update: value } });
const ask = (method: string, params: object): Promise<unknown> =>
  new Promise((resolve) => {
    const id = nextId;
    nextId += 1;
    waiting.set(id, resolve);
    send({ id, method, params });
  });
const say = (text: string): void => {
  // in two pieces, as agents stream
  const middle = Math.floor(text.length / 2);
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: text.slice(0, middle) } });
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: text.slice(middle) } });
};

/** Asks leave for a tool call as Claude Code's adapter does, and says which option came back. */
async function leaveFor(toolCall: object): Promise<string> {
  const options = [
    { optionId: 'allow-once', name: 'Yes', kind: 'allow_once' },
    { optionId: 'reject', name: 'No', kind: 'reject_once' },
  ];
  const answer = (await ask('session/request_permission', { sessionId: SESSION, toolCall, options })) as { outcome?: { outcome?: string; optionId?: string } };
  return answer.outcome?.optionId ?? answer.outcome?.outcome ?? 'nothing';
}

async function build(): Promise<string> {
  if (!server) throw new Error('no MCP server in session/new');
  const env = { ...getDefaultEnvironment(), ...Object.fromEntries(server.env.map((pair) => [pair.name, pair.value])) };
  const client = new Client({ name: 'fake-acp-agent', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: server.command, args: [...server.args], env }));
  const first = { bricks: [{ part: 'brick-2x4', color: 'Red', x: 0, y: 0, z: 0 }, { part: 'brick-2x4', color: 'Red', x: 0, y: 3, z: 0 }] };
  const second = { bricks: [{ part: 'brick-2x4', color: 'Red', x: 0, y: 6, z: 0 }] };
  const leave: string[] = [];
  // a BrickBench tool, named as Claude Code's adapter names MCP tools
  leave.push(await leaveFor({ toolCallId: 't1', title: 'brickbench: place_bricks', rawInput: first }));
  update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'brickbench: place_bricks', name: 'mcp__brickbench__place_bricks', kind: 'other', status: 'pending', rawInput: first });
  const placed = await client.callTool({ name: 'place_bricks', arguments: first });
  update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: placed.isError ? 'failed' : 'completed' });
  // something else: a shell command, which BrickBench should refuse
  leave.push(await leaveFor({ toolCallId: 't2', title: 'rm -rf ~', kind: 'execute', rawInput: { command: 'rm -rf ~' } }));
  // refused: the agent reports it failed, which the chat has said already
  update({ sessionUpdate: 'tool_call_update', toolCallId: 't2', title: 'rm -rf ~', status: 'failed' });
  // a BrickBench tool, named as Codex names MCP tools
  update({ sessionUpdate: 'tool_call', toolCallId: 't3', title: 'mcp.brickbench.place_bricks', kind: 'execute', status: 'pending', rawInput: second });
  const more = await client.callTool({ name: 'place_bricks', arguments: second });
  update({ sessionUpdate: 'tool_call_update', toolCallId: 't3', status: more.isError ? 'failed' : 'completed' });
  update({ sessionUpdate: 'usage_update', used: 100, size: 1000, cost: { amount: 0.01, currency: 'USD' } });
  await client.close();
  const failed = placed.isError === true || more.isError === true;
  return failed ? 'The tower could not be built.' : `Built a **red** tower of 3 bricks. Leave: ${leave.join(', ')}.`;
}

/** Two messages around a tool call whose input comes in pieces, as real agents stream them. */
async function chatty(): Promise<void> {
  update({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'Let me check the grid.' } });
  // pending, its input still coming; BrickBench shows it once it runs
  update({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'brickbench: place_bricks', name: null, kind: null, status: 'pending', rawInput: {} });
  const bricks = Array.from({ length: 40 }, (_, i) => ({ part: 'plate-1x1', color: 'Red', x: i, y: 0, z: 0 }));
  update({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', rawInput: { bricks } });
  // leave asked for by the call's id alone
  const leave = await leaveFor({ toolCallId: 'c1', name: null });
  update({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'in_progress' });
  update({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed' });
  // something for another session, which is not this chat's
  send({ method: 'session/update', params: { sessionId: 'other-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Not for you.' } } } });
  cost += 0.05;
  update({ sessionUpdate: 'usage_update', used: 100, size: 1000, cost: { amount: cost, currency: 'USD' } });
  update({ sessionUpdate: 'agent_message_chunk', messageId: 'm2', content: { type: 'text', text: `Done: 40 bricks. Leave: ${leave}.` } });
}

async function prompt(params: Record<string, unknown>): Promise<object> {
  const blocks = (params['prompt'] as readonly Block[] | undefined) ?? [];
  const told = systemPrompt !== '' || blocks.length > 1;
  const asked = blocks.at(-1)?.text ?? '';
  if (mode === 'crash') {
    process.stderr.write('The fake agent fell over.\n');
    process.exit(3);
  }
  if (mode === 'refuse') return { stopReason: 'refusal' };
  prompts += 1;
  if (mode === 'failfirst' && prompts === 1) throw Object.assign(new Error('Authentication required'), { code: -32000 });
  if (mode === 'chatty') {
    await chatty();
    return { stopReason: 'end_turn' };
  }
  if (mode === 'messages') {
    update({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'One.' } });
    update({ sessionUpdate: 'agent_message_chunk', messageId: 'm2', content: { type: 'text', text: 'Two.' } });
    return { stopReason: 'end_turn' };
  }
  if (mode === 'byid') {
    if (prompts === 1) update({ sessionUpdate: 'tool_call', toolCallId: 'c9', title: 'brickbench: look', status: 'completed', rawInput: {} });
    // an id alone, but for an unrelated _meta, which names nothing
    say(`Leave: ${await leaveFor({ toolCallId: 'c9', _meta: { trace: 'x' } })}.`);
    return { stopReason: 'end_turn' };
  }
  if (mode === 'reuse') {
    if (prompts === 1) {
      update({ sessionUpdate: 'tool_call', toolCallId: 'c1', name: 'mcp__brickbench__look', title: 'brickbench: look', status: 'completed', rawInput: {} });
      say('Looked.');
    } else {
      update({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'rm -rf ~', kind: 'execute', status: 'pending', rawInput: { command: 'rm -rf ~' } });
      const named = await leaveFor({ toolCallId: 'c1', title: 'rm -rf ~' });
      const byId = await leaveFor({ toolCallId: 'c1' });
      say(`Leave: ${named}, ${byId}.`);
    }
    return { stopReason: 'end_turn' };
  }
  if (mode === 'twice') {
    update({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'brickbench: place_bricks', status: 'completed', rawInput: { bricks: [{}, {}] } });
    update({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'brickbench: look', status: 'completed', rawInput: { view: 'front' } });
    say('Twice.');
    return { stopReason: 'end_turn' };
  }
  if (mode === 'fs') {
    const got = await ask('fs/read_text_file', { sessionId: SESSION, path: '/etc/hosts' });
    say(`Asked for a file: ${JSON.stringify(got)}`);
    return { stopReason: 'end_turn' };
  }
  if (mode === 'hang' || mode === 'stubborn') {
    await new Promise<void>((resolve) => {
      if (mode === 'hang') cancel = resolve;
    });
    return { stopReason: 'cancelled' };
  }
  const reply = mode === 'build' ? await build() : `You said: ${asked}.${told ? ' I was told how BrickBench works.' : ''} Session ${sessions}.`;
  say(reply);
  return { stopReason: 'end_turn' };
}

async function answer(method: string, params: Record<string, unknown>): Promise<object> {
  switch (method) {
    case 'initialize':
      if (mode === 'mute') return new Promise(() => undefined);
      if (mode === 'slowhello') await new Promise((resolve) => setTimeout(resolve, 300));
      return {
        protocolVersion: mode === 'v2' ? 2 : 1,
        agentCapabilities: { mcpCapabilities: { http: false, sse: false }, ...(takesSystemPrompt ? { sessionCapabilities: { systemPrompt: {} } } : {}) },
        authMethods: [],
      };
    case 'session/new': {
      if (mode === 'signin') throw Object.assign(new Error('Authentication required'), { code: -32000 });
      server = ((params['mcpServers'] as readonly McpServer[] | undefined) ?? [])[0] ?? null;
      const sessionFile = process.env['FAKE_ACP_SESSION_FILE'];
      if (sessionFile) writeFileSync(sessionFile, JSON.stringify(params));
      const given = params['systemPrompt'] as { content?: readonly Block[] } | undefined;
      systemPrompt = given?.content?.map((block) => block.text ?? '').join('') ?? '';
      sessions += 1;
      // a session's running cost starts again
      cost = 0;
      return { sessionId: SESSION };
    }
    case 'session/prompt':
      return prompt(params);
    default:
      throw Object.assign(new Error(`No ${method} here.`), { code: -32601 });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8').on('data', (chunk: string) => {
  buffer += chunk;
  for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
    const line = buffer.slice(0, end).trim();
    buffer = buffer.slice(end + 1);
    if (!line) continue;
    const message = JSON.parse(line) as Message;
    if (message.method !== undefined && message.id !== undefined) {
      const { id, method } = message;
      answer(method, message.params ?? {}).then(
        (result) => send({ id, result }),
        (error: unknown) => send({ id, error: { code: (error as { code?: number }).code ?? -32603, message: error instanceof Error ? error.message : String(error) } }),
      );
    } else if (message.method === 'session/cancel') cancel?.();
    else if (message.id !== undefined) waiting.get(message.id)?.(message.error === undefined ? message.result : { error: message.error });
  }
});
process.stdin.on('end', () => process.exit(0));
