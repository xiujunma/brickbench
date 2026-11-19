/**
 * BrickBench's tools as functions a model may call: the same tools, schemas
 * and descriptions the MCP server gives Claude Code, run in the open tab.
 */
import { z } from 'zod';
import { isToolName, parseToolInput, TOOL_INPUTS, TOOL_NAMES, type ToolName, type ToolOutcome } from '../../src/agent/protocol';
import { TOOL_DESCRIPTIONS } from '../guide';
import type { ToolCall, ToolSpec } from './types';

/** Runs a tool in BrickBench, as the bridge's link to the tab does. */
export type ToolRunner = (tool: ToolName, input: unknown) => Promise<ToolOutcome>;

function parametersOf(name: ToolName): Readonly<Record<string, unknown>> {
  // as the model writes the arguments: fields with defaults may be left out
  const { $schema: _dialect, ...schema } = z.toJSONSchema(z.object(TOOL_INPUTS[name]), { io: 'input' });
  return schema;
}

export const TOOL_SPECS: readonly ToolSpec[] = TOOL_NAMES.map((name) => ({ name, description: TOOL_DESCRIPTIONS[name], parameters: parametersOf(name) }));

type Arguments = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string };

/** The call's arguments as a value: servers send JSON text, a few an object. */
export function argumentsOf(raw: unknown): Arguments {
  if (typeof raw !== 'string') return { ok: true, value: raw ?? {} };
  if (raw.trim() === '') return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (error: unknown) {
    return { ok: false, error: `The arguments were not valid JSON (${error instanceof Error ? error.message : String(error)}). Send them again as one JSON object.` };
  }
}

/** Runs one call; a call that names no tool, or whose arguments do not fit, comes back failed for the model to put right. */
export async function runCall(call: ToolCall, run: ToolRunner): Promise<ToolOutcome> {
  if (!isToolName(call.name)) return { ok: false, error: `There is no tool called "${call.name}". The tools are ${TOOL_NAMES.join(', ')}.` };
  const args = argumentsOf(call.arguments);
  if (!args.ok) return args;
  const input = parseToolInput(call.name, args.value);
  return input.ok ? run(call.name, input.value) : input;
}
