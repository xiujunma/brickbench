import { describe, expect, it } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TOOL_NAMES, type ToolName, type ToolOutcome } from '../src/agent/protocol';
import { createBrickBenchMcp, toCallToolResult } from './mcpServer';

async function connect(answer: (tool: ToolName, input: unknown) => ToolOutcome) {
  const calls: { tool: ToolName; input: unknown }[] = [];
  const server = createBrickBenchMcp({
    call: async (tool, input) => {
      calls.push({ tool, input });
      return answer(tool, input);
    },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientSide);
  return { client, calls };
}

describe('the BrickBench MCP server', () => {
  it('offers every build tool, with instructions on the grid', async () => {
    const { client } = await connect(() => ({ ok: true, data: null }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    const place = tools.find((t) => t.name === 'place_bricks');
    expect(place?.inputSchema.properties).toHaveProperty('bricks');
    expect(place?.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((t) => t.name === 'look')?.annotations?.readOnlyHint).toBe(true);
    expect(client.getInstructions()).toContain('a brick is 3 plates tall');
  });

  it('passes calls to BrickBench and its answers back, pictures included', async () => {
    const { client, calls } = await connect((tool) =>
      tool === 'look' ? { ok: true, data: { view: 'iso' }, image: { data: 'aGk=', mimeType: 'image/jpeg' } } : { ok: true, data: { placed: 1 } },
    );
    const placed = await client.callTool({ name: 'place_bricks', arguments: { bricks: [{ part: 'brick-2x4', color: 4, x: 0, y: 0, z: 0 }] } });
    expect(placed.content).toEqual([{ type: 'text', text: '{"placed":1}' }]);
    expect(calls[0]).toEqual({ tool: 'place_bricks', input: { bricks: [{ part: 'brick-2x4', color: 4, x: 0, y: 0, z: 0, rotation: 0 }], all_or_nothing: false } });
    const look = await client.callTool({ name: 'look', arguments: {} });
    expect(look.content).toEqual([
      { type: 'text', text: '{"view":"iso"}' },
      { type: 'image', data: 'aGk=', mimeType: 'image/jpeg' },
    ]);
  });

  it('reports failures as tool errors the agent can read', async () => {
    const { client } = await connect(() => ({ ok: false, error: 'BrickBench is not open.' }));
    const result = await client.callTool({ name: 'get_model', arguments: {} });
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'BrickBench is not open.' }] });
    // input the schema refuses never reaches BrickBench
    const invalid = await client.callTool({ name: 'clear_model', arguments: {} });
    expect(invalid.isError).toBe(true);
  });

  it('turns outcomes into tool results', () => {
    expect(toCallToolResult({ ok: true, data: [1] })).toEqual({ content: [{ type: 'text', text: '[1]' }] });
  });
});
