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

  it('fills in defaults and explains bad input', () => {
    expect(parseToolInput('undo', undefined)).toEqual({ ok: true, value: { steps: 1 } });
    expect(parseToolInput('undo', { steps: 0 })).toMatchObject({ ok: false, error: expect.stringContaining('steps:') });
  });
});
