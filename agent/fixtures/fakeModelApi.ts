#!/usr/bin/env bun
/**
 * Stands in for a model behind an API in the desktop tests, as GPT, Grok or a
 * model on Ollama are, over both wire formats: the Responses API and Chat
 * Completions. Each request it builds a small red wall in two rounds of tool
 * calls, looks at it, then says how many pictures it was shown. Like the real
 * APIs it refuses a request that leaves out its earlier reasoning (reasoning
 * items, or reasoning_content), or that asks to be stored. FAKE_MODEL_PORT
 * sets its port.
 */
const port = Number(process.env['FAKE_MODEL_PORT'] ?? '7496');

interface Item {
  readonly type?: string;
  readonly role?: string;
  readonly content?: unknown;
  readonly encrypted_content?: string;
  readonly reasoning_content?: string;
}

type Step = { readonly call: string; readonly args: unknown } | { readonly text: string };

const WALL = [
  { part: 'brick-2x4', color: 'Red', x: 0, y: 0, z: 0 },
  { part: 'brick-2x4', color: 'Red', x: 4, y: 0, z: 0 },
];

/** What to do next, from the rounds since the user asked. */
function step(round: number, since: readonly Item[]): Step {
  if (round === 0) return { call: 'place_bricks', args: { bricks: WALL } };
  if (round === 1) return { call: 'look', args: { view: 'front' } };
  const pictures = JSON.stringify(since).split('data:image/jpeg;base64,').length - 1;
  return { text: `Built a red wall of 2 bricks. I was shown ${pictures === 1 ? '1 picture' : `${pictures} pictures`}.` };
}

const refuse = (message: string): Response => Response.json({ error: { message } }, { status: 400 });
const thought = (round: number): string => `thought-${round}`;
const expectedThoughts = (rounds: number): string => JSON.stringify(Array.from({ length: rounds }, (_, i) => thought(i)));

/** The items since the user's last question: one with text, not the pictures sent as theirs. */
function sinceAsked(items: readonly Item[]): readonly Item[] {
  return items.slice(items.findLastIndex((item) => item.role === 'user' && typeof item.content === 'string') + 1);
}

function responses(body: { readonly input?: readonly Item[]; readonly store?: boolean }): Response {
  if (body.store !== false) return refuse('Expected store: false');
  const since = sinceAsked(body.input ?? []);
  const round = since.filter((item) => item.type === 'function_call_output').length;
  const thoughts = since.filter((item) => item.type === 'reasoning').map((item) => item.encrypted_content);
  if (JSON.stringify(thoughts) !== expectedThoughts(round)) return refuse('Reasoning items must be passed back with the function calls they led to.');
  const reasoning = { id: `rs_${round}`, type: 'reasoning', summary: [], encrypted_content: thought(round) };
  const next = step(round, since);
  const item =
    'call' in next
      ? { id: `fc_${round}`, type: 'function_call', call_id: `call_${round}`, name: next.call, arguments: JSON.stringify(next.args), status: 'completed' }
      : { id: `msg_${round}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: next.text, annotations: [] }] };
  return Response.json({ id: 'resp_fake', object: 'response', status: 'completed', output: [reasoning, item], error: null });
}

function chatCompletions(body: { readonly messages?: readonly Item[] }): Response {
  const since = sinceAsked(body.messages ?? []);
  const round = since.filter((item) => item.role === 'tool').length;
  const thoughts = since.filter((item) => item.role === 'assistant').map((item) => item.reasoning_content);
  if (JSON.stringify(thoughts) !== expectedThoughts(round)) return refuse('reasoning_content must be passed back during tool calls.');
  const next = step(round, since);
  const message =
    'call' in next
      ? { role: 'assistant', content: null, reasoning_content: thought(round), tool_calls: [{ id: `call_${round}`, type: 'function', function: { name: next.call, arguments: JSON.stringify(next.args) } }] }
      : { role: 'assistant', content: next.text, reasoning_content: thought(round) };
  return Response.json({ id: 'chat_fake', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: 'call' in next ? 'tool_calls' : 'stop' }] });
}

Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/health') return Response.json({ ok: true });
    if (request.method === 'POST' && pathname === '/v1/responses') return responses((await request.json()) as never);
    if (request.method === 'POST' && pathname === '/v1/chat/completions') return chatCompletions((await request.json()) as never);
    return new Response('Not found', { status: 404 });
  },
});
process.stdout.write(`Fake model API on http://127.0.0.1:${port}/v1\n`);
