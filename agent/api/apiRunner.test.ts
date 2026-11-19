import { afterEach, describe, expect, it } from 'bun:test';
import type { AgentEvent, ToolName, ToolOutcome } from '../../src/agent/protocol';
import { waitFor } from '../../src/testing/helpers';
import type { ChatRunner } from '../chat';
import { API_INSTRUCTIONS } from '../guide';
import { createApiRunner, visibleText, type ApiRunnerOptions } from './apiRunner';
import { chatCompletions } from './chatCompletions';
import { responsesApi } from './responses';
import { PICTURE_REMOVED } from './types';

type Answer = unknown | ((body: Record<string, unknown>) => Response | Promise<Response>);

const servers: { stop(force: boolean): unknown }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

/** A stand-in model API: answers each request with the next scripted answer, and keeps what it was sent. */
function fakeApi(...answers: Answer[]) {
  const bodies: Record<string, unknown>[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      const next = answers.shift();
      if (next === undefined) return new Response('{"error":{"message":"No more answers"}}', { status: 500 });
      return typeof next === 'function' ? next(body) : Response.json(next);
    },
  });
  servers.push(server);
  return { baseUrl: `http://127.0.0.1:${server.port}/v1`, bodies };
}

/** BrickBench's side: answers every call, and look with a picture. */
function fakeTools(outcomes: Partial<Record<ToolName, ToolOutcome>> = {}) {
  const calls: { tool: ToolName; input: unknown }[] = [];
  const run = (tool: ToolName, input: unknown): Promise<ToolOutcome> => {
    calls.push({ tool, input });
    const outcome = outcomes[tool] ?? (tool === 'look' ? { ok: true, data: { view: 'iso' }, image: { data: 'UElD', mimeType: 'image/jpeg' } } : { ok: true, data: { did: tool } });
    return Promise.resolve(outcome);
  };
  return { calls, run };
}

function runner(baseUrl: string, tools: Pick<ReturnType<typeof fakeTools>, 'run'> = fakeTools(), extra: Partial<ApiRunnerOptions> = {}): ChatRunner {
  return createApiRunner({ label: 'Test AI', baseUrl, model: 'test-1', format: chatCompletions, tools: tools.run, retryDelaysMs: [], ...extra });
}

function ask(chat: ChatRunner, prompt: string, fresh = false): Promise<AgentEvent[]> {
  return new Promise((resolve) => {
    const events: AgentEvent[] = [];
    chat.start(prompt, fresh, (event) => {
      events.push(event);
      if (event.type === 'done') resolve(events);
    });
  });
}

const doneOf = (events: AgentEvent[]) => events.at(-1);
const say = (content: string) => ({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] });
const call = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const calls = (...toolCalls: unknown[]) => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: toolCalls }, finish_reason: 'tool_calls' }] });
const messagesOf = (body: Record<string, unknown> | undefined) => (body?.['messages'] ?? []) as Record<string, unknown>[];
const httpError = (status: number, message: string) => () => new Response(JSON.stringify({ error: { message } }), { status });

describe('a chat with a model behind an API', () => {
  it('builds through tool calls, then answers, with the instructions, tools and model it was set up with', async () => {
    const api = fakeApi(calls(call('c1', 'place_bricks', { bricks: [{ part: 'brick-2x4', color: 'Red', x: 0, y: 0, z: 0 }] })), say('Built a red brick.'));
    const tools = fakeTools();
    const events = await ask(runner(api.baseUrl, tools), 'One red brick');
    expect(events).toEqual([
      { type: 'started', model: 'test-1' },
      { type: 'tool', tool: 'place_bricks', summary: 'Placing 1 brick' },
      { type: 'text', text: 'Built a red brick.' },
      { type: 'done', ok: true, turns: 2 },
    ]);
    expect(tools.calls).toEqual([{ tool: 'place_bricks', input: { bricks: [{ part: 'brick-2x4', color: 'Red', x: 0, y: 0, z: 0, rotation: 0 }], all_or_nothing: false } }]);
    const [first, second] = api.bodies;
    expect(first?.['model']).toBe('test-1');
    expect(messagesOf(first)[0]).toEqual({ role: 'system', content: API_INSTRUCTIONS });
    expect((first?.['tools'] as unknown[]).length).toBe(12);
    expect(messagesOf(second).slice(2)).toEqual([
      { role: 'assistant', content: null, tool_calls: [call('c1', 'place_bricks', { bricks: [{ part: 'brick-2x4', color: 'Red', x: 0, y: 0, z: 0 }] })] },
      { role: 'tool', tool_call_id: 'c1', content: '{"did":"place_bricks"}' },
    ]);
  });

  it('describes itself by who runs the model and where', () => {
    expect(runner('http://x/v1', fakeTools(), { apiKey: 'k', keyVariable: 'TEST_KEY' }).status()).toEqual({
      available: true,
      name: 'Test AI · test-1',
      detail: 'Runs on Test AI with your API key (TEST_KEY).',
    });
    expect(runner('http://x/v1', fakeTools(), { local: true }).status().detail).toBe('Runs on this computer with Test AI.');
    expect(runner('http://gpu.lan:8000/v1').status().detail).toBe('Runs on Test AI, at http://gpu.lan:8000/v1.');
  });

  it('shows the model the pictures look draws, after the tools’ answers', async () => {
    const api = fakeApi(calls(call('c1', 'look', {})), say('Looks good.'));
    await ask(runner(api.baseUrl), 'Look');
    expect(messagesOf(api.bodies[1]).slice(3)).toEqual([
      { role: 'tool', tool_call_id: 'c1', content: '{"view":"iso"}' },
      {
        role: 'user',
        content: [
          { type: 'text', text: expect.stringContaining('pictures') },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,UElD' } },
        ],
      },
    ]);
  });

  it('carries the conversation on to the next request, without old pictures, until a fresh one starts', async () => {
    const api = fakeApi(calls(call('c1', 'look', {})), calls(call('c2', 'look', {})), say('One.'), say('Two.'), say('Three.'));
    const chat = runner(api.baseUrl);
    await ask(chat, 'first', true);
    await ask(chat, 'second');
    const second = JSON.stringify(api.bodies[3]);
    expect(second).toContain('first');
    expect(second).toContain('One.');
    // the last picture stays, the one before it goes
    expect(second.split('data:image/jpeg').length - 1).toBe(1);
    expect(second).toContain(PICTURE_REMOVED);
    await ask(chat, 'third', true);
    expect(messagesOf(api.bodies[4]).map((message) => message['content'])).toEqual([API_INSTRUCTIONS, 'third']);
  });

  it('works the same over the Responses API, sending back every output item as it came', async () => {
    const reasoning = { id: 'rs_1', type: 'reasoning', summary: [], encrypted_content: 'opaque' };
    const lookCall = { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'look', arguments: '{"view":"top"}' };
    const api = fakeApi(
      { status: 'completed', output: [reasoning, lookCall] },
      { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'A tidy roof.' }] }] },
    );
    const events = await ask(runner(api.baseUrl, fakeTools(), { format: responsesApi }), 'Check the roof');
    expect(events.map((event) => event.type)).toEqual(['started', 'tool', 'text', 'done']);
    expect(events[1]).toEqual({ type: 'tool', tool: 'look', summary: 'Looking at the model from the top' });
    expect(api.bodies[0]).toMatchObject({ instructions: API_INSTRUCTIONS, input: [{ role: 'user', content: 'Check the roof' }], store: false });
    expect(api.bodies[1]?.['input']).toEqual([
      { role: 'user', content: 'Check the roof' },
      reasoning,
      lookCall,
      { type: 'function_call_output', call_id: 'call_1', output: '{"view":"iso"}' },
      { role: 'user', content: [{ type: 'input_text', text: expect.any(String) }, { type: 'input_image', image_url: 'data:image/jpeg;base64,UElD', detail: 'high' }] },
    ]);
  });

  it('tells the chat about refused calls, and the model why', async () => {
    const api = fakeApi(calls(call('c1', 'place_bricks', { bricks: [] }), call('c2', 'paint_bricks', { ids: ['a'], color: 'Blue' })), say('Sorry.'));
    const tools = fakeTools({ paint_bricks: { ok: false, error: 'No brick with id a.\nMore detail' } });
    const events = await ask(runner(api.baseUrl, tools), 'Paint');
    expect(events.filter((event) => event.type === 'tool')).toEqual([
      { type: 'tool', tool: 'place_bricks', summary: 'Placing 0 bricks' },
      { type: 'tool', tool: 'error', summary: expect.stringMatching(/^Refused: Invalid input for place_bricks/) },
      { type: 'tool', tool: 'paint_bricks', summary: 'Painting bricks Blue' },
      { type: 'tool', tool: 'error', summary: 'Refused: No brick with id a.' },
    ]);
    expect(messagesOf(api.bodies[1]).slice(3).map((message) => message['content'])).toEqual([
      expect.stringMatching(/^Error: Invalid input for place_bricks/),
      'Error: No brick with id a.\nMore detail',
    ]);
  });

  it('carries on without pictures for a model that cannot see, and says so', async () => {
    const api = fakeApi(
      calls(call('c1', 'look', {})),
      httpError(400, 'This model does not support image input'),
      calls(call('c2', 'look', {})),
      say('Done.'),
    );
    const events = await ask(runner(api.baseUrl), 'Look twice');
    expect(events).toContainEqual({ type: 'tool', tool: 'note', summary: 'test-1 cannot see pictures, so it carries on without them' });
    expect(doneOf(events)).toEqual({ type: 'done', ok: true, turns: 3 });
    const retried = JSON.stringify(api.bodies[2]);
    expect(retried).not.toContain('data:image');
    const last = messagesOf(api.bodies[3]);
    expect(JSON.stringify(last)).not.toContain('data:image');
    expect(last.at(-1)).toEqual({ role: 'tool', tool_call_id: 'c2', content: expect.stringContaining('No picture: this model cannot see them') });
  });

  it('knows a refusal of pictures that comes as a 404, as OpenRouter’s does', async () => {
    const api = fakeApi(calls(call('c1', 'look', {})), httpError(404, 'No endpoints found that support image input'), say('Fine.'));
    const events = await ask(runner(api.baseUrl), 'Look');
    expect(events).toContainEqual({ type: 'tool', tool: 'note', summary: 'test-1 cannot see pictures, so it carries on without them' });
    expect(doneOf(events)).toEqual({ type: 'done', ok: true, turns: 2 });
  });

  it('starts the next request without pictures when one has failed, whatever the reason', async () => {
    const api = fakeApi(calls(call('c1', 'look', {})), httpError(500, 'Something broke'), say('Back.'));
    const chat = runner(api.baseUrl);
    expect(doneOf(await ask(chat, 'Look'))).toMatchObject({ ok: false });
    await ask(chat, 'Try again');
    expect(JSON.stringify(api.bodies[2])).not.toContain('data:image');
    expect(JSON.stringify(api.bodies[2])).toContain(PICTURE_REMOVED);
  });

  it('stops asking for encrypted reasoning when the model has none to give', async () => {
    const api = fakeApi(httpError(400, 'Encrypted content is not supported with this model.'), {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hi.' }] }],
    });
    expect(doneOf(await ask(runner(api.baseUrl, fakeTools(), { format: responsesApi }), 'Hi'))).toEqual({ type: 'done', ok: true, turns: 1 });
    expect(api.bodies[0]).toHaveProperty('include');
    expect(api.bodies[1]).not.toHaveProperty('include');
  });

  it('sends a reply’s reasoning back while its calls go on, and not once the user asks something new', async () => {
    const thinking = { choices: [{ message: { role: 'assistant', content: null, reasoning_content: 'plan', tool_calls: [call('c1', 'get_model', {})] }, finish_reason: 'tool_calls' }] };
    const api = fakeApi(thinking, { choices: [{ message: { role: 'assistant', content: 'Done.', reasoning_content: 'wrap up' } }] }, say('Again.'));
    const chat = runner(api.baseUrl);
    await ask(chat, 'Build');
    expect(messagesOf(api.bodies[1])[2]).toMatchObject({ reasoning_content: 'plan' });
    await ask(chat, 'More');
    expect(JSON.stringify(api.bodies[2])).not.toContain('reasoning_content');
  });

  it('lets a refusal that is not about pictures through as an error', async () => {
    const api = fakeApi(calls(call('c1', 'look', {})), httpError(400, 'Unsupported parameter: temperature'));
    expect(doneOf(await ask(runner(api.baseUrl), 'Look'))).toEqual({ type: 'done', ok: false, error: 'Test AI refused the request (HTTP 400: Unsupported parameter: temperature).' });
  });

  it('stops when asked, mid-request, and keeps the conversation fit to go on', async () => {
    let release = (): void => undefined;
    const api = fakeApi(
      () => new Promise<Response>((resolve) => (release = () => resolve(Response.json(say('too late'))))),
      say('Fine.'),
    );
    const chat = runner(api.baseUrl);
    const asking = ask(chat, 'Build a castle');
    await waitFor(() => expect(api.bodies).toHaveLength(1));
    expect(chat.running).toBe(true);
    chat.stop();
    expect(doneOf(await asking)).toEqual({ type: 'done', ok: false, error: 'Stopped.' });
    expect(chat.running).toBe(false);
    release();
    expect(doneOf(await ask(chat, 'Smaller, then'))).toEqual({ type: 'done', ok: true, turns: 1 });
    expect(messagesOf(api.bodies[1]).map((message) => message['role'])).toEqual(['system', 'user', 'user']);
  });

  it('answers the calls it did not get to once stopped, so the model knows', async () => {
    const api = fakeApi(calls(call('c1', 'get_model', {}), call('c2', 'clear_model', { confirm: true })), say('Ok.'));
    let chat: ChatRunner | null = null;
    const tools = fakeTools();
    const slowTools = {
      calls: tools.calls,
      run: (tool: ToolName, input: unknown) => {
        chat?.stop();
        return tools.run(tool, input);
      },
    };
    chat = runner(api.baseUrl, slowTools);
    expect(doneOf(await ask(chat, 'Start over'))).toEqual({ type: 'done', ok: false, error: 'Stopped.' });
    expect(tools.calls.map((made) => made.tool)).toEqual(['get_model']);
    await ask(chat, 'Never mind');
    // the user stopped while the first call ran, so it may have run; the second never did
    expect(messagesOf(api.bodies[1]).slice(3, 5)).toEqual([
      { role: 'tool', tool_call_id: 'c1', content: 'Error: Stopped by the user while it ran: it may have been done, in part or in full.' },
      { role: 'tool', tool_call_id: 'c2', content: 'Not run: the user stopped the request.' },
    ]);
  });

  it('stops at once while a tab takes its time over a call, telling the model the call may have run', async () => {
    const api = fakeApi(calls(call('c1', 'place_bricks', { bricks: [{ part: 'brick-2x4', color: 'Red', x: 0, y: 0, z: 0 }] })), say('Ok.'));
    const hung = { run: () => new Promise<ToolOutcome>(() => undefined) };
    const chat = runner(api.baseUrl, hung);
    const asking = ask(chat, 'Build');
    await waitFor(() => expect(chat.running).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const stopped = Date.now();
    chat.stop();
    const events = await asking;
    expect(Date.now() - stopped).toBeLessThan(500);
    expect(doneOf(events)).toEqual({ type: 'done', ok: false, error: 'Stopped.' });
    // a stopped call is no refusal
    expect(events.filter((event) => event.type === 'tool' && event.tool === 'error')).toEqual([]);
    await ask(chat, 'Never mind');
    expect(messagesOf(api.bodies[1])[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: expect.stringContaining('Stopped by the user while it ran') });
  });

  it('keeps going when a tool fails outright', async () => {
    const api = fakeApi(calls(call('c1', 'get_model', {})), say('Hm.'));
    const broken = { run: () => Promise.reject(new Error('socket closed')) };
    const events = await ask(runner(api.baseUrl, broken), 'Read');
    expect(events).toContainEqual({ type: 'tool', tool: 'error', summary: 'Refused: BrickBench could not run it: socket closed' });
    expect(doneOf(events)).toEqual({ type: 'done', ok: true, turns: 2 });
  });

  it('takes one request at a time', async () => {
    const api = fakeApi(() => new Promise<Response>((resolve) => setTimeout(() => resolve(Response.json(say('Done.'))), 50)));
    const chat = runner(api.baseUrl);
    const first = ask(chat, 'one');
    expect(await ask(chat, 'two')).toEqual([{ type: 'done', ok: false, error: 'The agent is still working on the last request.' }]);
    expect(doneOf(await first)).toEqual({ type: 'done', ok: true, turns: 1 });
  });

  it('stops a model that keeps calling tools', async () => {
    const api = fakeApi(calls(call('a', 'get_model', {})), calls(call('b', 'get_model', {})), calls(call('c', 'get_model', {})));
    expect(doneOf(await ask(runner(api.baseUrl, fakeTools(), { maxRounds: 2 }), 'Loop'))).toEqual({
      type: 'done',
      ok: false,
      error: 'Stopped after 2 rounds of tool calls, the most one request may take. Ask again to carry on.',
      turns: 2,
    });
  });

  it('says when a reply was cut short', async () => {
    const api = fakeApi({ choices: [{ message: { content: 'I will now' }, finish_reason: 'length' }] }, { choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] });
    const chat = runner(api.baseUrl);
    expect(doneOf(await ask(chat, 'Talk'))).toEqual({ type: 'done', ok: false, error: 'The reply was cut short: the model ran out of room. Ask it to carry on.', turns: 1 });
    expect(doneOf(await ask(chat, 'Talk'))).toEqual({ type: 'done', ok: false, error: "Test AI's content filter stopped the reply.", turns: 1 });
  });
});

describe('what the chat says when the API fails', () => {
  const failing = async (answer: Answer, extra: Partial<ApiRunnerOptions> = {}) => doneOf(await ask(runner(fakeApi(answer).baseUrl, fakeTools(), extra), 'Hi'));

  it('names the key that was refused, and the model that is missing', async () => {
    expect(await failing(httpError(401, 'Incorrect API key'), { keyVariable: 'TEST_KEY' })).toEqual({
      type: 'done',
      ok: false,
      error: 'Test AI did not accept the API key in TEST_KEY (HTTP 401: Incorrect API key).',
    });
    expect(await failing(httpError(403, 'Not allowed'))).toMatchObject({ error: 'Test AI refused access (HTTP 403: Not allowed). Check that the API key may use test-1.' });
    const missing = fakeApi(httpError(404, 'model "test-1" not found'));
    expect(doneOf(await ask(runner(missing.baseUrl), 'Hi'))).toMatchObject({
      error: `Test AI answered “model "test-1" not found” (HTTP 404). Check that test-1 is one of its models, and that ${missing.baseUrl} is its API's address.`,
    });
  });

  it('tells rate limits and a chat too long for the model from other refusals', async () => {
    expect(await failing(httpError(429, 'Slow down'))).toMatchObject({ error: 'Test AI is limiting requests, or the account is out of credit (HTTP 429: Slow down).' });
    expect(await failing(httpError(400, "This model's maximum context length is 128000 tokens"))).toMatchObject({ error: 'This chat is now too long for test-1. Start a new chat.' });
  });

  it('asks whether a model on this computer is running when it cannot be reached', async () => {
    const gone = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
    const baseUrl = `http://127.0.0.1:${gone.port}/v1`;
    await gone.stop(true);
    const done = doneOf(await ask(runner(baseUrl, fakeTools(), { local: true, label: 'Ollama' }), 'Hi'));
    expect(done).toMatchObject({ ok: false });
    expect(done?.type === 'done' ? done.error : '').toStartWith(`Could not reach Ollama at ${baseUrl}: is Ollama running? (`);
  });

  it('says when the model takes too long, or sends something that is not a reply', async () => {
    expect(await failing(() => new Promise<Response>((resolve) => setTimeout(() => resolve(Response.json(say('late'))), 1000)), { timeoutMs: 30 })).toMatchObject({
      error: 'Test AI did not answer within 1 s.',
    });
    expect(await failing(() => new Response('<html>'))).toMatchObject({ error: 'Test AI sent a reply that is not JSON.' });
    expect(await failing({ choices: [] })).toMatchObject({ error: 'Test AI sent a reply BrickBench could not read: it has no message' });
  });
});

describe('the text the user sees', () => {
  it('leaves out what a model thinks aloud', () => {
    expect(visibleText('<think>hmm, a tower</think>\n\nBuilt a tower.')).toBe('Built a tower.');
    expect(visibleText('<think>still thinking')).toBe('');
    expect(visibleText('  Plain.  ')).toBe('Plain.');
  });
});
