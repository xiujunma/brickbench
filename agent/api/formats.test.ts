import { describe, expect, it } from 'bun:test';
import { chatCompletions } from './chatCompletions';
import { responsesApi } from './responses';
import { PICTURE_REMOVED, PICTURES_NOTE, ReplyError, type ToolSpec } from './types';

const TOOLS: readonly ToolSpec[] = [{ name: 'look', description: 'Draw the model.', parameters: { type: 'object', properties: {} } }];
const PICTURE = { data: 'AAAA', mimeType: 'image/jpeg' };
const ASK_REASONING = { encryptedReasoning: true };

describe('the Chat Completions format', () => {
  it('sends the instructions as the system message, then the conversation and the tools as functions', () => {
    expect(chatCompletions.body('m', 'Be brief.', [chatCompletions.user('hi')], TOOLS, ASK_REASONING)).toEqual({
      model: 'm',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'hi' },
      ],
      tools: [{ type: 'function', function: { name: 'look', description: 'Draw the model.', parameters: { type: 'object', properties: {} } } }],
      stream: false,
    });
  });

  it('reads a reply that calls tools, keeping it with the calls as the model wrote them', () => {
    const reply = chatCompletions.read({
      choices: [
        {
          message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'look', arguments: '{"view":"top"}' } }] },
          finish_reason: 'tool_calls',
        },
      ],
    });
    expect(reply.text).toBe('');
    expect(reply.calls).toEqual([{ id: 'c1', name: 'look', arguments: '{"view":"top"}' }]);
    expect(reply.items).toEqual([
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'look', arguments: '{"view":"top"}' } }] },
    ]);
    expect(reply.cutShort).toBeNull();
  });

  it('gives calls without ids ids of their own, and writes arguments sent as objects back as text', () => {
    const reply = chatCompletions.read({ choices: [{ message: { content: '', tool_calls: [{ function: { name: 'look', arguments: { view: 'top' } } }] } }] });
    const [call] = reply.calls;
    expect(call?.id).toMatch(/^call_/);
    expect(reply.items).toEqual([
      { role: 'assistant', content: '', tool_calls: [{ id: call?.id, type: 'function', function: { name: 'look', arguments: '{"view":"top"}' } }] },
    ]);
  });

  it('keeps every field of the provider’s own, reasoning too, for the request’s later rounds', () => {
    const message = {
      role: 'assistant',
      content: null,
      reasoning_content: 'Thinking it over',
      reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque' }],
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'look', arguments: '{}' }, extra_content: { google: { thought_signature: 'sig' } } }],
    };
    expect(chatCompletions.read({ choices: [{ message, finish_reason: 'tool_calls' }] }).items).toEqual([message]);
  });

  it('sends back arguments that were not JSON as an empty object, and leaves out an empty list of calls', () => {
    const reply = chatCompletions.read({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'look', arguments: '{"view":' } }] } }] });
    expect(reply.calls[0]?.arguments).toBe('{"view":');
    expect(reply.items).toEqual([{ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'look', arguments: '{}' } }] }]);
    expect(chatCompletions.read({ choices: [{ message: { role: 'assistant', content: 'Done.', tool_calls: [] } }] }).items).toEqual([{ role: 'assistant', content: 'Done.' }]);
    expect(chatCompletions.read({ choices: [{ message: { role: 'assistant', content: null, refusal: 'No.' } }] }).items).toEqual([{ role: 'assistant', content: '', refusal: 'No.' }]);
  });

  it('takes each request’s reasoning out once the user asks something new', () => {
    const conversation = [
      chatCompletions.user('hi'),
      { role: 'assistant', content: 'Hello', reasoning_content: 'r', reasoning: 'r', reasoning_details: [] },
      { role: 'tool', tool_call_id: 'c1', content: '{}', reasoning: 'not a reply' },
    ];
    const settled = chatCompletions.settled(conversation);
    expect(settled).toEqual([conversation[0], { role: 'assistant', content: 'Hello' }, conversation[2]]);
    expect(settled[0]).toBe(conversation[0]);
    expect(conversation[1]).toHaveProperty('reasoning_content');
  });

  it('reads text in parts, refusals, and replies cut short', () => {
    expect(chatCompletions.read({ choices: [{ message: { content: [{ type: 'text', text: 'Bu' }, { type: 'text', text: 'ilt.' }] } }] }).text).toBe('Built.');
    expect(chatCompletions.read({ choices: [{ message: { content: null, refusal: 'I cannot.' } }] }).text).toBe('I cannot.');
    expect(chatCompletions.read({ choices: [{ message: { content: 'Half' }, finish_reason: 'length' }] }).cutShort).toBe('length');
    expect(chatCompletions.read({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }).cutShort).toBe('filter');
  });

  it('refuses a reply with no message, giving the provider’s reason if it sent one', () => {
    expect(() => chatCompletions.read({ choices: [] })).toThrow(ReplyError);
    expect(() => chatCompletions.read('nope')).toThrow('could not read');
    expect(() => chatCompletions.read({ error: { message: 'Upstream timed out' } })).toThrow('could not answer: Upstream timed out');
  });

  it('answers each call, then shows any pictures as the user’s message', () => {
    expect(chatCompletions.results([{ id: 'c1', text: '{}' }])).toEqual([{ role: 'tool', tool_call_id: 'c1', content: '{}' }]);
    expect(chatCompletions.results([{ id: 'c1', text: '{}', picture: PICTURE }, { id: 'c2', text: '[]' }])).toEqual([
      { role: 'tool', tool_call_id: 'c1', content: '{}' },
      { role: 'tool', tool_call_id: 'c2', content: '[]' },
      { role: 'user', content: [{ type: 'text', text: PICTURES_NOTE }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }] },
    ]);
  });

  it('counts pictures, and takes out all but the last ones asked to keep', () => {
    const conversation = [
      chatCompletions.user('hi'),
      ...chatCompletions.results([{ id: 'a', text: '', picture: PICTURE }]),
      ...chatCompletions.results([{ id: 'b', text: '', picture: PICTURE }]),
    ];
    expect(chatCompletions.pictures(conversation)).toBe(2);
    const lighter = chatCompletions.withoutPictures(conversation, 1);
    expect(chatCompletions.pictures(lighter)).toBe(1);
    expect(lighter[2]).toEqual({ role: 'user', content: [{ type: 'text', text: PICTURES_NOTE }, { type: 'text', text: PICTURE_REMOVED }] });
    expect(lighter[4]).toBe(conversation[4]);
    expect(chatCompletions.pictures(chatCompletions.withoutPictures(conversation, 0))).toBe(0);
    // the conversation itself is left as it was
    expect(chatCompletions.pictures(conversation)).toBe(2);
  });
});

describe('the Responses format', () => {
  it('sends instructions, the conversation as input and flat function tools, storing nothing', () => {
    expect(responsesApi.body('m', 'Be brief.', [responsesApi.user('hi')], TOOLS, ASK_REASONING)).toEqual({
      model: 'm',
      instructions: 'Be brief.',
      input: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', name: 'look', description: 'Draw the model.', parameters: { type: 'object', properties: {} }, strict: false }],
      store: false,
      include: ['reasoning.encrypted_content'],
    });
    expect(responsesApi.body('m', '', [], TOOLS, { encryptedReasoning: false })).not.toHaveProperty('include');
  });

  it('reads text and calls, and keeps every output item exactly as it came, reasoning too', () => {
    const output = [
      { id: 'rs_1', type: 'reasoning', summary: [], encrypted_content: 'secret' },
      { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'On it.', annotations: [] }] },
      { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'look', arguments: '{}', status: 'completed' },
    ];
    const reply = responsesApi.read({ status: 'completed', output, error: null });
    expect(reply.text).toBe('On it.');
    expect(reply.calls).toEqual([{ id: 'call_1', name: 'look', arguments: '{}' }]);
    expect(reply.items).toEqual(output);
    expect(reply.items[0]).toBe(output[0]);
    expect(reply.cutShort).toBeNull();
  });

  it('keeps no reasoning that was cut off before what it led to', () => {
    const thought = { id: 'rs_1', type: 'reasoning', summary: [] };
    expect(responsesApi.read({ status: 'incomplete', output: [thought], incomplete_details: { reason: 'max_output_tokens' } }).items).toEqual([]);
    const said = { type: 'message', content: [{ type: 'output_text', text: 'So' }] };
    expect(responsesApi.read({ status: 'incomplete', output: [thought, said, thought] }).items).toEqual([thought, said]);
  });

  it('carries earlier requests on as they were, reasoning and all', () => {
    const conversation = [responsesApi.user('hi'), { id: 'rs_1', type: 'reasoning', encrypted_content: 'x' }];
    expect(responsesApi.settled(conversation)).toEqual(conversation);
  });

  it('reads refusals and replies that stopped early', () => {
    const refusal = { type: 'message', content: [{ type: 'refusal', refusal: 'No.' }] };
    expect(responsesApi.read({ output: [refusal] }).text).toBe('No.');
    const cut = (reason: string | null) => responsesApi.read({ status: 'incomplete', output: [], incomplete_details: reason === null ? null : { reason } }).cutShort;
    expect(cut('max_output_tokens')).toBe('length');
    expect(cut('content_filter')).toBe('filter');
    expect(cut('max_messages')).toBe('max_messages');
    expect(cut(null)).toBe('incomplete');
  });

  it('turns a failed response into an error with the provider’s reason', () => {
    expect(() => responsesApi.read({ status: 'failed', output: [], error: { message: 'Overloaded' } })).toThrow('could not answer: Overloaded');
    expect(() => responsesApi.read({ status: 'failed', output: [], error: {} })).toThrow('no reason given');
    expect(() => responsesApi.read({ output: 'none' })).toThrow(ReplyError);
  });

  it('answers each call, then shows pictures as the user’s message', () => {
    expect(responsesApi.results([{ id: 'c1', text: '{}', picture: PICTURE }])).toEqual([
      { type: 'function_call_output', call_id: 'c1', output: '{}' },
      { role: 'user', content: [{ type: 'input_text', text: PICTURES_NOTE }, { type: 'input_image', image_url: 'data:image/jpeg;base64,AAAA', detail: 'high' }] },
    ]);
    expect(responsesApi.results([{ id: 'c1', text: 'x' }])).toEqual([{ type: 'function_call_output', call_id: 'c1', output: 'x' }]);
  });

  it('takes out earlier pictures, leaving a note in each one’s place', () => {
    const conversation = [...responsesApi.results([{ id: 'a', text: '', picture: PICTURE }]), ...responsesApi.results([{ id: 'b', text: '', picture: PICTURE }])];
    expect(responsesApi.pictures(conversation)).toBe(2);
    const lighter = responsesApi.withoutPictures(conversation, 1);
    expect(lighter[1]).toEqual({ role: 'user', content: [{ type: 'input_text', text: PICTURES_NOTE }, { type: 'input_text', text: PICTURE_REMOVED }] });
    expect(responsesApi.pictures(lighter)).toBe(1);
  });
});
