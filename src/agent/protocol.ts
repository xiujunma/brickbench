/**
 * What passes between the agent bridge (a local Bun server) and the app: the
 * build tools an agent may call, and the messages that carry calls, results
 * and chat. Imported by both sides, so it stays free of browser code.
 */
import { z } from 'zod';
import { GRID_LIMIT, MAX_LAYER, isStudPosition } from '../core/grid';
import { MAX_PATTERN_LENGTH } from '../core/parts/pattern';

/** Most bricks one call may place, move, paint or name. */
export const MAX_BATCH = 2000;
/** Most bricks get_model lists by default and at all. */
export const DEFAULT_LIST_LIMIT = 400;
export const MAX_LIST_LIMIT = 2000;
export const MAX_PROMPT_LENGTH = 8000;
/** The most a request's context (selected bricks, the user's view) and the user's own instructions may hold. */
export const MAX_CONTEXT_LENGTH = 40_000;
export const MAX_INSTRUCTIONS_LENGTH = 4000;
/** Most owned parts list_owned_parts lists by default and at all. */
export const DEFAULT_OWNED_LIST = 200;
export const MAX_OWNED_LIST = 2000;

const int = z.number().int();
const studs = int.min(-GRID_LIMIT).max(GRID_LIMIT);
/** Where a part stands: on whole studs, or half a stud over, as on a jumper plate's stud. */
const standing = z.number().min(-GRID_LIMIT).max(GRID_LIMIT).refine(isStudPosition, 'a whole or half stud');
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
  x: standing,
  y: layer,
  z: standing,
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
    // as long as a part pattern may be, so a part's own pattern can always be sent back
    query: z.string().trim().min(1).max(MAX_PATTERN_LENGTH),
    limit: int.min(1).max(50).default(12),
    owned_only: z.boolean().default(false),
  },
  list_colors: {},
  list_owned_parts: {
    query: z.string().trim().max(120).default(''),
    only_left: z.boolean().default(false),
    limit: int.min(1).max(MAX_OWNED_LIST).default(DEFAULT_OWNED_LIST),
  },
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
    view: z.enum(['iso', 'front', 'back', 'left', 'right', 'top', 'user']).default('iso'),
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

/** A tool's outcome as it travels, checked on arrival: from the app's bridge to `BrickBench --mcp`. */
export const toolOutcomeSchema: z.ZodType<ToolOutcome> = z.union([
  z.object({ ok: z.literal(true), data: z.unknown(), image: imageSchema.optional() }),
  z.object({ ok: z.literal(false), error: z.string().max(4000) }),
]);

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
    /**
     * Agents in a terminal: whether they are let in, and the command that
     * starts BrickBench as their MCP server (`BrickBench --mcp`), shown to copy.
     */
    terminal: z
      .object({
        command: z
          .string()
          .max(2000)
          .regex(/^claude mcp add brickbench -e ELECTRON_RUN_AS_NODE=1 -- [^\r\n]+$/),
        open: z.boolean(),
      })
      .optional(),
    /** The agents the chat can run, and which is chosen: Claude Code, a model behind an API, coding agents over ACP. */
    agents: z
      .object({
        chosen: z.string().max(40),
        options: z
          .array(z.object({ id: z.string().min(1).max(40), name: z.string().max(80), ready: z.boolean(), detail: z.string().max(400).optional() }))
          .max(24),
      })
      .optional(),
  }),
  z.object({ kind: z.literal('call'), id: z.string().min(1).max(64), tool: z.string().max(64), input: z.unknown() }),
  z.object({ kind: z.literal('agent'), event: agentEventSchema }),
  /** Whether agents in a terminal are let in, once a change the app asked for is done. */
  z.object({ kind: z.literal('terminal'), open: z.boolean() }),
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
  z.object({
    kind: z.literal('chat'),
    prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
    fresh: z.boolean(),
    /** What goes with the words: the bricks the user has selected, their view. */
    context: z.string().max(MAX_CONTEXT_LENGTH).optional(),
    /** The user's own instructions for the chat. */
    instructions: z.string().max(MAX_INSTRUCTIONS_LENGTH).optional(),
  }),
  z.object({ kind: z.literal('stop') }),
  /** This tab is the one the user is looking at: calls go here. */
  z.object({ kind: z.literal('active') }),
  /** Let agents in a terminal in, or out. */
  z.object({ kind: z.literal('terminal'), open: z.boolean() }),
  /** Have this agent answer the chat from now on; the bridge says hello again once it does. */
  z.object({ kind: z.literal('choose'), agent: z.string().min(1).max(40) }),
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
