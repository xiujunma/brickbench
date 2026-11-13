/**
 * Reads Claude Code's `--output-format stream-json` output, one JSON object
 * per line, into the events the chat shows. Lines it does not know are skipped.
 */
import { z } from 'zod';
import type { AgentEvent } from '../src/agent/protocol';

const BRICKBENCH_PREFIX = 'mcp__brickbench__';
const MAX_ERROR_LENGTH = 300;

const block = z.object({ type: z.string() }).passthrough();
const initLine = z.object({ type: z.literal('system'), subtype: z.literal('init'), session_id: z.string().optional(), model: z.string().optional() });
const messageLine = z.object({ type: z.enum(['assistant', 'user']), message: z.object({ content: z.array(block) }) });
const resultLine = z.object({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  session_id: z.string().optional(),
  num_turns: z.number().int().nonnegative().optional(),
  total_cost_usd: z.number().nonnegative().optional(),
});
const textBlock = z.object({ type: z.literal('text'), text: z.string() });
const toolUseBlock = z.object({ type: z.literal('tool_use'), name: z.string(), input: z.unknown() });
const toolResultBlock = z.object({
  type: z.literal('tool_result'),
  is_error: z.boolean().optional(),
  content: z.union([z.string(), z.array(block)]).optional(),
});

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** A few words on what a tool call does, for the chat. */
export function toolSummary(name: string, input: unknown): string {
  if (!name.startsWith(BRICKBENCH_PREFIX)) return `Using ${name}`;
  const value = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  switch (name.slice(BRICKBENCH_PREFIX.length)) {
    case 'place_bricks':
      return `Placing ${plural(Array.isArray(value['bricks']) ? value['bricks'].length : 0, 'brick', 'bricks')}`;
    case 'find_parts':
      return `Searching parts for “${String(value['query'] ?? '')}”`;
    case 'paint_bricks':
      return `Painting bricks ${String(value['color'] ?? '')}`.trim();
    case 'set_model_name':
      return `Naming the model “${String(value['name'] ?? '')}”`;
    case 'look':
      return typeof value['view'] === 'string' && value['view'] !== 'iso' ? `Looking at the model from the ${value['view']}` : 'Looking at the model';
    case 'undo':
      return typeof value['steps'] === 'number' && value['steps'] > 1 ? `Undoing ${value['steps']} steps` : 'Undoing the last step';
    case 'get_model':
      return 'Reading the model';
    case 'move_bricks':
      return 'Moving bricks';
    case 'remove_bricks':
      return 'Removing bricks';
    case 'clear_model':
      return 'Clearing the model';
    case 'list_colors':
      return 'Reading the colours';
    default:
      return `Using ${name.slice(BRICKBENCH_PREFIX.length)}`;
  }
}

function firstLine(content: z.infer<typeof toolResultBlock>['content']): string {
  const text = typeof content === 'string' ? content : (content ?? []).map((part) => textBlock.safeParse(part).data?.text ?? '').join(' ');
  return (text.split('\n')[0] ?? '').slice(0, MAX_ERROR_LENGTH);
}

function blockEvents(content: readonly z.infer<typeof block>[]): AgentEvent[] {
  return content.flatMap((part): AgentEvent[] => {
    const text = textBlock.safeParse(part);
    if (text.success) return text.data.text.trim() ? [{ type: 'text', text: text.data.text }] : [];
    const use = toolUseBlock.safeParse(part);
    if (use.success) {
      const tool = use.data.name.startsWith(BRICKBENCH_PREFIX) ? use.data.name.slice(BRICKBENCH_PREFIX.length) : use.data.name;
      return [{ type: 'tool', tool, summary: toolSummary(use.data.name, use.data.input) }];
    }
    const result = toolResultBlock.safeParse(part);
    if (result.success && result.data.is_error) return [{ type: 'tool', tool: 'error', summary: `Refused: ${firstLine(result.data.content)}` }];
    return [];
  });
}

function doneEvent(result: z.infer<typeof resultLine>): AgentEvent {
  const ok = !result.is_error && result.subtype === 'success';
  const error = ok ? undefined : result.result?.trim() || `The agent stopped: ${result.subtype}.`;
  return {
    type: 'done',
    ok,
    ...(error ? { error: error.slice(0, MAX_ERROR_LENGTH) } : {}),
    ...(result.num_turns !== undefined ? { turns: result.num_turns } : {}),
    ...(result.total_cost_usd !== undefined ? { costUsd: result.total_cost_usd } : {}),
  };
}

export interface StreamReader {
  /** Events from one line of output. */
  read(line: string): AgentEvent[];
  /** The conversation to resume next time, once Claude Code has said. */
  readonly sessionId: string | null;
  /** Whether the run's final result has arrived. */
  readonly finished: boolean;
}

export function createStreamReader(): StreamReader {
  let sessionId: string | null = null;
  let finished = false;
  const parse = (line: string): unknown => {
    try {
      return JSON.parse(line);
    } catch {
      // not a JSON line (a warning, say): nothing for the chat
      return null;
    }
  };
  return {
    read(line) {
      const json = parse(line);
      const init = initLine.safeParse(json);
      if (init.success) {
        sessionId = init.data.session_id ?? sessionId;
        return [{ type: 'started', ...(init.data.model ? { model: init.data.model } : {}) }];
      }
      const message = messageLine.safeParse(json);
      if (message.success) return blockEvents(message.data.message.content);
      const result = resultLine.safeParse(json);
      if (!result.success) return [];
      sessionId = result.data.session_id ?? sessionId;
      finished = true;
      return [doneEvent(result.data)];
    },
    get sessionId() {
      return sessionId;
    },
    get finished() {
      return finished;
    },
  };
}
