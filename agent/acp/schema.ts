/**
 * The parts of the Agent Client Protocol (version 1) the chat reads from an
 * agent, checked as they arrive; everything else an agent sends is passed
 * over. From the protocol's schema (agentclientprotocol/agent-client-protocol,
 * schema/v1/schema.json) as of November 2026.
 */
import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

/** JSON-RPC errors the protocol gives a meaning of its own. */
export const ACP_ERRORS = { authRequired: -32000 } as const;

// fields the protocol lets be null as well as missing are .nullish()
export const initializeResultSchema = z.object({
  protocolVersion: z.number().int(),
  agentCapabilities: z
    .object({
      sessionCapabilities: z.object({ systemPrompt: z.object({}).passthrough().nullish() }).passthrough().nullish(),
    })
    .passthrough()
    .nullish(),
});
export type InitializeResult = z.infer<typeof initializeResultSchema>;

export const newSessionResultSchema = z.object({ sessionId: z.string().min(1) });

export const STOP_REASONS = ['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'] as const;
export const promptResultSchema = z.object({ stopReason: z.enum(STOP_REASONS) });
export type StopReason = (typeof STOP_REASONS)[number];

/** A tool call as an agent reports it, or asks leave for it: only the fields the chat looks at. */
export const toolCallSchema = z
  .object({
    toolCallId: z.string(),
    title: z.string().nullish(),
    name: z.string().nullish(),
    kind: z.string().nullish(),
    status: z.string().nullish(),
    rawInput: z.unknown().optional(),
    _meta: z.record(z.string(), z.unknown()).nullish(),
  })
  .passthrough();
export type ToolCall = z.infer<typeof toolCallSchema>;

export const sessionUpdateSchema = z.object({
  sessionId: z.string(),
  update: z.discriminatedUnion('sessionUpdate', [
    z
      .object({ sessionUpdate: z.literal('agent_message_chunk'), content: z.object({ type: z.string(), text: z.string().nullish() }).passthrough(), messageId: z.string().nullish() })
      .passthrough(),
    toolCallSchema.extend({ sessionUpdate: z.literal('tool_call') }),
    toolCallSchema.extend({ sessionUpdate: z.literal('tool_call_update') }),
    z.object({ sessionUpdate: z.literal('usage_update'), cost: z.object({ amount: z.number(), currency: z.string() }).nullish() }).passthrough(),
  ]),
});
export type SessionUpdate = z.infer<typeof sessionUpdateSchema>['update'];

export const PERMISSION_KINDS = ['allow_once', 'allow_always', 'reject_once', 'reject_always'] as const;
export const permissionRequestSchema = z.object({
  sessionId: z.string(),
  toolCall: toolCallSchema,
  options: z.array(z.object({ optionId: z.string(), name: z.string().nullish(), kind: z.enum(PERMISSION_KINDS) }).passthrough()),
});
export type PermissionRequest = z.infer<typeof permissionRequestSchema>;
export type PermissionOutcome = { readonly outcome: { readonly outcome: 'selected'; readonly optionId: string } } | { readonly outcome: { readonly outcome: 'cancelled' } };

/** BrickBench's MCP server, as an agent starts it: a stdio server (no `type`), its environment as name and value pairs. */
export interface StdioMcpServer {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: readonly { readonly name: string; readonly value: string }[];
}
