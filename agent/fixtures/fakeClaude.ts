#!/usr/bin/env bun
/**
 * Stands in for `claude -p --output-format stream-json` in tests: reads the
 * prompt from stdin and prints the same kind of lines. FAKE_CLAUDE_MODE picks
 * what it does: echo (default), fail, old (an outdated CLI), hang, stubborn
 * (hangs and ignores SIGTERM), args, early (exits before reading the prompt),
 * split (sends a character in two pieces), or build, which really places
 * bricks through the MCP server named in --mcp-config; or, given selected
 * bricks, paints them blue, looking from the user's view first when it came
 * along. Build says back the user's own instructions.
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
const mode = process.env['FAKE_CLAUDE_MODE'] ?? 'echo';
if (mode === 'early') {
  // gone before reading the prompt, as a Claude Code that fails at start-up is
  process.stderr.write('Claude Code could not start: no login\n');
  process.exit(3);
}
const prompt = (await new Response(Bun.stdin.stream()).text()).trim();

/** BrickBench's MCP server, as --mcp-config names it. */
async function connect(): Promise<Client> {
  // --mcp-config takes a file or JSON, as Claude Code's does; the bridge hands a file, with its token in a header
  const given = valueOf('--mcp-config') ?? '{}';
  const text = given.trimStart().startsWith('{') ? given : await Bun.file(given).text();
  const config = JSON.parse(text) as { mcpServers?: { brickbench?: { url?: string; headers?: Record<string, string> } } };
  const server = config.mcpServers?.brickbench;
  if (!server?.url) throw new Error('no brickbench MCP server in --mcp-config');
  const client = new Client({ name: 'fake-claude', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers ?? {} } }));
  return client;
}

/** The ids of the bricks the user selected, from the lines that list them after the request's words. */
const selectedIds = (): string[] =>
  prompt
    .split('\n')
    .filter((line) => line.startsWith('{"id"'))
    .map((line) => (JSON.parse(line) as { id: string }).id);

/** What the user's own instructions said, after BrickBench's, in the file the runner hands over. */
async function ownInstructions(): Promise<string | undefined> {
  const file = valueOf('--append-system-prompt-file');
  const told = file ? await Bun.file(file).text() : '';
  return told.split("The user's own instructions for this chat:\n")[1];
}

/** Calls one of BrickBench's tools, telling of the call and its result as Claude Code does; says whether it failed. */
async function use(client: Client, id: string, tool: string, input: Record<string, unknown>): Promise<boolean> {
  say({ type: 'assistant', session_id: session, message: { content: [{ type: 'tool_use', id, name: `mcp__brickbench__${tool}`, input }] } });
  const result = await client.callTool({ name: tool, arguments: input });
  const failed = result.isError === true;
  say({ type: 'user', session_id: session, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: failed, content: result.content }] } });
  return failed;
}

async function paint(ids: readonly string[]): Promise<string> {
  const client = await connect();
  // the user sent their view: see the bricks as they do first
  if (prompt.includes('call look with view "user"')) await use(client, 't0', 'look', { view: 'user', highlight: ids });
  const failed = await use(client, 't1', 'paint_bricks', { ids, color: 'Blue' });
  await client.close();
  return failed ? 'The bricks could not be painted.' : `Painted the ${ids.length} selected bricks blue.`;
}

async function build(): Promise<string> {
  const client = await connect();
  // two calls, as a real agent makes: the user still undoes the whole request in one step
  const layers = [
    { bricks: [{ part: 'brick-2x4', color: 'Yellow', x: 0, y: 0, z: 0 }, { part: 'brick-2x4', color: 'Yellow', x: 0, y: 3, z: 0 }] },
    { bricks: [{ part: 'brick-2x4', color: 'Yellow', x: 0, y: 6, z: 0 }] },
  ];
  let failed = false;
  for (const [i, input] of layers.entries()) failed = (await use(client, `t${i}`, 'place_bricks', input)) || failed;
  await client.close();
  // markdown, as real agents reply
  return failed ? 'The tower could not be built.' : 'Built a **yellow** tower of 3 bricks:\n\n- 3 × `brick-2x4`, stacked';
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
if (mode === 'split') {
  // a line whose brick emoji is cut in two, as a pipe may deliver it
  const line = new TextEncoder().encode(`${JSON.stringify({ type: 'assistant', session_id: session, message: { content: [{ type: 'text', text: 'Built 🧱 bricks' }] } })}\n`);
  const middle = line.indexOf(0xf0) + 2;
  process.stdout.write(line.subarray(0, middle));
  await Bun.sleep(40);
  process.stdout.write(line.subarray(middle));
  say({ type: 'result', subtype: 'success', is_error: false, result: 'Built', session_id: session, num_turns: 1, total_cost_usd: 0 });
  process.exit(0);
}
async function work(): Promise<string> {
  const ids = selectedIds();
  const done = ids.length > 0 ? await paint(ids) : await build();
  const own = await ownInstructions();
  return own ? `${done}\n\nYou asked me to: ${own}` : done;
}

const reply = mode === 'args' ? JSON.stringify(args) : mode === 'build' ? await work() : `You said: ${prompt}`;
say({ type: 'assistant', session_id: session, message: { content: [{ type: 'text', text: reply }] } });
say({ type: 'result', subtype: 'success', is_error: false, result: reply, session_id: session, num_turns: 1, total_cost_usd: 0 });
