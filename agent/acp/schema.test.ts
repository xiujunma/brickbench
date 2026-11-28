import { describe, expect, it } from 'bun:test';
import { initializeResultSchema, permissionRequestSchema, sessionUpdateSchema } from './schema';

describe('what BrickBench reads of an agent over ACP', () => {
  it('takes null wherever version 1 of the protocol allows it', () => {
    for (const agentCapabilities of [null, { sessionCapabilities: null }, { sessionCapabilities: { systemPrompt: null } }]) {
      expect(initializeResultSchema.safeParse({ protocolVersion: 1, agentCapabilities }).success).toBe(true);
    }
    const update = (value: object) => sessionUpdateSchema.safeParse({ sessionId: 's', update: value }).success;
    expect(update({ sessionUpdate: 'tool_call', toolCallId: 't', title: null, name: null, kind: null, status: null, _meta: null })).toBe(true);
    expect(update({ sessionUpdate: 'tool_call_update', toolCallId: 't', title: null, status: null })).toBe(true);
    expect(update({ sessionUpdate: 'agent_message_chunk', messageId: null, content: { type: 'text', text: null } })).toBe(true);
    expect(update({ sessionUpdate: 'usage_update', used: 1, size: 2, cost: null })).toBe(true);
    expect(
      permissionRequestSchema.safeParse({ sessionId: 's', toolCall: { toolCallId: 't', title: null, kind: null }, options: [{ optionId: 'o', name: null, kind: 'allow_once' }] }).success,
    ).toBe(true);
  });

  it('passes over updates it does not read, and refuses what is not one', () => {
    expect(sessionUpdateSchema.safeParse({ sessionId: 's', update: { sessionUpdate: 'plan', entries: [] } }).success).toBe(false);
    expect(initializeResultSchema.safeParse({ protocolVersion: '1' }).success).toBe(false);
    expect(permissionRequestSchema.safeParse({ sessionId: 's', toolCall: { toolCallId: 't' }, options: [{ optionId: 'o', kind: 'maybe' }] }).success).toBe(false);
  });
});
