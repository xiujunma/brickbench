/** BrickBench's build tools as an MCP server: each call runs in the open BrickBench tab. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_INPUTS, TOOL_NAMES, type ToolName, type ToolOutcome } from '../src/agent/protocol';
import type { AppLink } from './appLink';
import { SERVER_INSTRUCTIONS, TOOL_DESCRIPTIONS } from './guide';

export const SERVER_NAME = 'brickbench';
export const SERVER_VERSION = '1.0.0';

/** Tools that only read: clients may run them without asking. */
const READ_ONLY: ReadonlySet<ToolName> = new Set(['get_model', 'find_parts', 'list_colors', 'list_owned_parts', 'look']);

export function toCallToolResult(outcome: ToolOutcome): CallToolResult {
  if (!outcome.ok) return { content: [{ type: 'text', text: outcome.error }], isError: true };
  const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(outcome.data) }];
  if (outcome.image) content.push({ type: 'image', data: outcome.image.data, mimeType: outcome.image.mimeType });
  return { content };
}

export function createBrickBenchMcp(link: Pick<AppLink, 'call'>): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
  for (const name of TOOL_NAMES) {
    server.registerTool(
      name,
      {
        description: TOOL_DESCRIPTIONS[name],
        inputSchema: TOOL_INPUTS[name],
        annotations: { readOnlyHint: READ_ONLY.has(name), destructiveHint: name === 'clear_model' || name === 'remove_bricks' },
      },
      async (input: unknown) => toCallToolResult(await link.call(name, input)),
    );
  }
  return server;
}
