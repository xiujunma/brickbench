#!/usr/bin/env bun
/**
 * Stands in for `claude -p --output-format stream-json` in tests: reads the
 * prompt from stdin and prints the same kind of lines. FAKE_CLAUDE_MODE picks
 * what it does: echo (default), fail, old (an outdated CLI), hang, stubborn
 * (hangs and ignores SIGTERM), args, or build, which really places bricks
 * through the MCP server named in --mcp-config.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('0.0.0 (Fake Claude)\n');
  process.exit(0);
}
const valueOf = (flag: string): string | undefined => {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};
const say = (value: unknown): void => void process.stdout.write(`${JSON.stringify(value)}\n`);
const session = valueOf('--resume') ?? 'fake-session-1';
const prompt = (await new Response(Bun.stdin.stream()).text()).trim();
const mode = process.env['FAKE_CLAUDE_MODE'] ?? 'echo';

async function build(): Promise<string> {
  const config = JSON.parse(valueOf('--mcp-config') ?? '{}') as { mcpServers?: { brickbench?: { url?: string } } };
  const url = config.mcpServers?.brickbench?.url;
  if (!url) throw new Error('no brickbench MCP server in --mcp-config');
  const client = new Client({ name: 'fake-claude', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  // two calls, as a real agent makes: the user still undoes the whole request in one step
  const layers = [
    { bricks: [{ part: 'brick-2x4', color: 'Yellow', x: 0, y: 0, z: 0 }, { part: 'brick-2x4', color: 'Yellow', x: 0, y: 3, z: 0 }] },
    { bricks: [{ part: 'brick-2x4', color: 'Yellow', x: 0, y: 6, z: 0 }] },
  ];
  let failed = false;
  for (const [i, input] of layers.entries()) {
    say({ type: 'assistant', session_id: session, message: { content: [{ type: 'tool_use', id: `t${i}`, name: 'mcp__brickbench__place_bricks', input }] } });
    const result = await client.callTool({ name: 'place_bricks', arguments: input });
    failed ||= result.isError === true;
    say({ type: 'user', session_id: session, message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, is_error: result.isError === true, content: result.content }] } });
  }
  await client.close();
  return failed ? 'The tower could not be built.' : 'Built a yellow tower of 3 bricks.';
}

if (mode === 'old') {
  process.stderr.write("error: unknown option '--restricted'\n");
  process.exit(1);
}
if (mode === 'stubborn') process.on('SIGTERM', () => undefined);
if (mode === 'fail') {
  process.stderr.write('Invalid API key · Please run /login\n');
  process.exit(1);
}
say({ type: 'system', subtype: 'init', session_id: session, model: 'fake-model', tools: [] });
if (mode === 'hang' || mode === 'stubborn') await new Promise(() => undefined);
const reply = mode === 'args' ? JSON.stringify(args) : mode === 'build' ? await build() : `You said: ${prompt}`;
say({ type: 'assistant', session_id: session, message: { content: [{ type: 'text', text: reply }] } });
say({ type: 'result', subtype: 'success', is_error: false, result: reply, session_id: session, num_turns: 1, total_cost_usd: 0 });
