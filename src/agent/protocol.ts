/**
 * What passes between the agent bridge (a local Bun server) and the app: the
 * build tools an agent may call, and the messages that carry calls, results
 * and chat. Imported by both sides, so it stays free of browser code.
 */
import { z } from 'zod';
import { GRID_LIMIT, MAX_LAYER } from '../core/grid';

/** Most bricks one call may place, move, paint or name. */
export const MAX_BATCH = 2000;
/** Most bricks get_model lists by default and at all. */
export const DEFAULT_LIST_LIMIT = 400;
export const MAX_LIST_LIMIT = 2000;
export const MAX_PROMPT_LENGTH = 8000;

const int = z.number().int();
const studs = int.min(-GRID_LIMIT).max(GRID_LIMIT);
const layer = int.min(0).max(MAX_LAYER);
/** An LDraw colour code (4 is red) or a colour name ("Dark Bluish Grey", "red"). */
const colour = z.union([int.min(0).max(100_000), z.string().trim().min(1).max(40)]);
const brickIds = z.array(z.string().min(1).max(40)).min(1).max(MAX_BATCH);
const cell = z.object({ x: studs, y: layer, z: studs });

/** Grid cells from `min` to `max`, both included; a brick is in it if any of its cells is. */
export const regionSchema = z.object({ min: cell, max: cell });
export type Region = z.infer<typeof regionSchema>;

export const brickSpecSchema = z.object({
  part: z.string().trim().min(1).max(64),
  color: colour,
  x: studs,
  y: layer,
  z: studs,
  rotation: int.min(0).max(3).default(0),
});
export type BrickSpec = z.infer<typeof brickSpecSchema>;

/** Input shapes per tool: MCP turns them into JSON Schema, the app validates against them again. */
export const TOOL_INPUTS = {
  get_model: {
    region: regionSchema.optional(),
    limit: int.min(0).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  },
  find_parts: {
    query: z.string().trim().min(1).max(120),
    limit: int.min(1).max(50).default(12),
  },
  list_colors: {},
  place_bricks: {
    bricks: z.array(brickSpecSchema).min(1).max(MAX_BATCH),
    all_or_nothing: z.boolean().default(false),
  },
  remove_bricks: { ids: brickIds.optional(), region: regionSchema.optional() },
  paint_bricks: { ids: brickIds.optional(), region: regionSchema.optional(), color: colour },
  move_bricks: {
    ids: brickIds.optional(),
    region: regionSchema.optional(),
    dx: int.min(-2 * GRID_LIMIT).max(2 * GRID_LIMIT).default(0),
    dy: int.min(-MAX_LAYER).max(MAX_LAYER).default(0),
    dz: int.min(-2 * GRID_LIMIT).max(2 * GRID_LIMIT).default(0),
  },
  clear_model: { confirm: z.literal(true) },
  set_model_name: { name: z.string().trim().min(1).max(120) },
  look: {
    view: z.enum(['iso', 'front', 'back', 'left', 'right', 'top']).default('iso'),
    highlight: z.array(z.string().min(1).max(40)).max(MAX_BATCH).default([]),
  },
  undo: { steps: int.min(1).max(20).default(1) },
} as const;

export type ToolName = keyof typeof TOOL_INPUTS;
export const TOOL_NAMES = Object.keys(TOOL_INPUTS) as ToolName[];
export type ToolInput<T extends ToolName> = z.infer<z.ZodObject<(typeof TOOL_INPUTS)[T]>>;
export type View = ToolInput<'look'>['view'];

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOL_INPUTS, name);
}

/** Validates a tool's input; the message says what is wrong in words an agent can act on. */
export function parseToolInput<T extends ToolName>(tool: T, input: unknown): { ok: true; value: ToolInput<T> } | { ok: false; error: string } {
  const parsed = z.object(TOOL_INPUTS[tool]).safeParse(input ?? {});
  // zod's inferred type cannot follow the generic tool name; the schema is the one ToolInput<T> names
  if (parsed.success) return { ok: true, value: parsed.data as unknown as ToolInput<T> };
  const issues = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`);
  return { ok: false, error: `Invalid input for ${tool}. ${issues.join('; ')}` };
}

/** A tool's outcome: JSON for the agent, and for `look` a picture. */
export type ToolOutcome =
  | { readonly ok: true; readonly data: unknown; readonly image?: { readonly data: string; readonly mimeType: 'image/jpeg' | 'image/png' } }
  | { readonly ok: false; readonly error: string };

const imageSchema = z.object({ data: z.string().max(12_000_000), mimeType: z.enum(['image/jpeg', 'image/png']) });

/** The longest each field of an agent event may be. */
const EVENT_LIMITS = { model: 80, text: 100_000, tool: 80, summary: 400, error: 2000 } as const;

/** Things the chat shows while an agent works. */
export const agentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('started'), model: z.string().max(EVENT_LIMITS.model).optional() }),
  z.object({ type: z.literal('text'), text: z.string().max(EVENT_LIMITS.text) }),
  z.object({ type: z.literal('tool'), tool: z.string().max(EVENT_LIMITS.tool), summary: z.string().max(EVENT_LIMITS.summary) }),
  z.object({
    type: z.literal('done'),
    ok: z.boolean(),
    error: z.string().max(EVENT_LIMITS.error).optional(),
    costUsd: z.number().nonnegative().optional(),
    turns: z.number().int().nonnegative().optional(),
  }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;

const cut = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

/** An event cut to the lengths the app accepts: one it would refuse leaves the chat waiting for ever. */
export function clampEvent(event: AgentEvent): AgentEvent {
  switch (event.type) {
    case 'started':
      return event.model === undefined ? event : { ...event, model: cut(event.model, EVENT_LIMITS.model) };
    case 'text':
      return { ...event, text: cut(event.text, EVENT_LIMITS.text) };
    case 'tool':
      return { ...event, tool: cut(event.tool, EVENT_LIMITS.tool), summary: cut(event.summary, EVENT_LIMITS.summary) };
    case 'done':
      return event.error === undefined ? event : { ...event, error: cut(event.error, EVENT_LIMITS.error) };
  }
}

/** Bridge → app. */
export const bridgeMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hello'),
    version: z.string().max(40),
    agent: z.object({ available: z.boolean(), name: z.string().max(80), detail: z.string().max(400).optional() }),
  }),
  z.object({ kind: z.literal('call'), id: z.string().min(1).max(64), tool: z.string().max(64), input: z.unknown() }),
  z.object({ kind: z.literal('agent'), event: agentEventSchema }),
]);
export type BridgeMessage = z.infer<typeof bridgeMessageSchema>;

/** App → bridge. */
export const appMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('result'),
    id: z.string().min(1).max(64),
    ok: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().max(4000).optional(),
    image: imageSchema.optional(),
  }),
  z.object({ kind: z.literal('chat'), prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH), fresh: z.boolean() }),
  z.object({ kind: z.literal('stop') }),
  /** This tab is the one the user is looking at: calls go here. */
  z.object({ kind: z.literal('active') }),
]);
export type AppMessage = z.infer<typeof appMessageSchema>;

/** Parses one socket message; null when it is not one (not JSON, or not this shape). */
export function parseMessage<T>(schema: z.ZodType<T>, text: string): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    // not JSON: not a message
    return null;
  }
}
