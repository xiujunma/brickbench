import { afterAll, describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppLink } from './appLink';
import { createChat, type ChatSetup } from './chatSetup';
import { MCP_CONFIG_FILE } from './claudeRunner';

const root = mkdtempSync(join(tmpdir(), 'brickbench-chat-setup-'));
const TOKEN = 'a'.repeat(43);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const fakeClaude = join(root, 'claude');
writeFileSync(fakeClaude, '#!/bin/sh\necho "9.9.9 (Claude Code)"\n');
chmodSync(fakeClaude, 0o755);

const setup = (env: Record<string, string>): ChatSetup => ({
  lookup: { env, platform: process.platform, home: join(root, 'home'), cwd: root },
  link: createAppLink(),
  mcp: { url: 'http://127.0.0.1:7425/mcp', token: TOKEN },
  workDir: root,
  noClaude: 'Install Claude Code, then try again.',
  restart: 'try again',
  // none of this computer's agents over ACP: tests that want some name them
  acpAgents: [],
});

/** BrickBench's MCP server, as agents over ACP would start it. */
const SERVER = { name: 'brickbench', command: '/app/BrickBench', args: ['/app/agent/mcp.cjs', '/tmp/chat-connection.json'], env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }] };

/** An agent over ACP on the PATH, under a name no real agent has, and one that is not there. */
const acpBin = join(root, 'acp-bin');
mkdirSync(acpBin, { recursive: true });
writeFileSync(join(acpBin, 'brickbench-test-acp'), '#!/bin/sh\nexit 0\n');
chmodSync(join(acpBin, 'brickbench-test-acp'), 0o755);
const SPECS = [
  { id: 'here', name: 'Here', program: 'brickbench-test-acp', args: ['--acp'], install: 'npm i -g here', signIn: 'Sign in to Here' },
  { id: 'gone', name: 'Gone', program: 'brickbench-test-gone', args: [], install: 'npm i -g gone', signIn: 'Sign in to Gone' },
];

describe('setting up the chat', () => {
  it('runs Claude Code when it is installed, as its own version, with the chat’s token in a file only the user can read', async () => {
    const chat = await createChat(setup({ BRICKBENCH_CLAUDE: fakeClaude }));
    expect(chat.runner.status()).toMatchObject({ available: true, name: 'Claude Code 9.9.9' });
    expect(chat.notes).toEqual([]);
    const config = join(root, MCP_CONFIG_FILE);
    expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({
      mcpServers: { brickbench: { type: 'http', url: 'http://127.0.0.1:7425/mcp', headers: { Authorization: `Bearer ${TOKEN}` } } },
    });
    if (process.platform !== 'win32') expect(statSync(config).mode & 0o777).toBe(0o600);
  });

  it('says how to put it right when Claude Code is not installed', async () => {
    const chat = await createChat(setup({ BRICKBENCH_CLAUDE: join(root, 'nowhere', 'claude') }));
    expect(chat.runner.status()).toEqual({ available: false, name: 'No agent', detail: 'Install Claude Code, then try again.' });
  });

  it('says so when Claude Code is there but will not start', async () => {
    const broken = join(root, 'broken-claude');
    writeFileSync(broken, '#!/bin/sh\necho "env: node: No such file or directory" >&2\nexit 127\n');
    chmodSync(broken, 0o755);
    const chat = await createChat(setup({ BRICKBENCH_CLAUDE: broken }));
    expect(chat.runner.status()).toMatchObject({ available: false, detail: `Claude Code is at ${broken}, but it did not start: env: node: No such file or directory` });
  });

  it('says npm’s Claude Code cannot start on Windows, and how to put that right', async () => {
    const npm = join(root, 'Roaming', 'npm');
    mkdirSync(npm, { recursive: true });
    writeFileSync(join(npm, 'claude.cmd'), '@node cli.js %*');
    const chat = await createChat({ ...setup({ APPDATA: join(root, 'Roaming'), Path: '' }), lookup: { env: { APPDATA: join(root, 'Roaming'), Path: '' }, platform: 'win32', home: join(root, 'home'), cwd: root } });
    expect(chat.runner.status().detail).toBe(
      `Claude Code is installed through npm here (${join(npm, 'claude.cmd')}), which BrickBench cannot start. Install it with Claude Code's own installer (https://code.claude.com), then try again.`,
    );
  });

  it('runs a model behind an API when one is chosen, with notes for the user', async () => {
    const chat = await createChat(setup({ BRICKBENCH_AGENT_PROVIDER: 'ollama', BRICKBENCH_AGENT_MODEL: 'qwen3.5:9b', BRICKBENCH_AGENT_BUDGET_USD: '2' }));
    expect(chat.runner.status()).toMatchObject({ available: true, name: 'Ollama · qwen3.5:9b' });
    expect(chat.notes).toEqual([expect.stringContaining('BRICKBENCH_AGENT_BUDGET_USD')]);
  });

  it('runs the API’s model’s tool calls through the link to BrickBench', async () => {
    const replies = [
      { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_model', arguments: '{}' } }] } }] },
      { choices: [{ message: { role: 'assistant', content: 'Read it.' } }] },
    ];
    const api = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json(replies.shift()) });
    const calls: string[] = [];
    try {
      const chat = await createChat({
        ...setup({ BRICKBENCH_AGENT_PROVIDER: 'custom', BRICKBENCH_AGENT_BASE_URL: `http://127.0.0.1:${api.port}/v1`, BRICKBENCH_AGENT_MODEL: 'm' }),
        link: { call: (tool) => (calls.push(tool), Promise.resolve({ ok: true, data: { bricks: [] } })) },
      });
      const done = await new Promise((resolve) => chat.runner.start('What is there?', true, (event) => event.type === 'done' && resolve(event)));
      expect(done).toEqual({ type: 'done', ok: true, turns: 2 });
      expect(calls).toEqual(['get_model']);
    } finally {
      await api.stop(true);
    }
  });

  it('says what is missing for an API, and stops on a setting that is malformed', async () => {
    const chat = await createChat(setup({ BRICKBENCH_AGENT_PROVIDER: 'xai' }));
    expect(chat.runner.status()).toMatchObject({ available: false, detail: 'Set XAI_API_KEY to your xAI API key, then try again.' });
    expect(createChat(setup({ BRICKBENCH_AGENT_PROVIDER: 'claude', BRICKBENCH_CLAUDE: fakeClaude, BRICKBENCH_AGENT_BUDGET_USD: 'lots' }))).rejects.toThrow('BRICKBENCH_AGENT_BUDGET_USD');
  });

  it('offers Claude Code, a model behind an API, and the agents over ACP that are here, with how to install the rest', async () => {
    if (process.platform === 'win32') return;
    const env = { BRICKBENCH_CLAUDE: fakeClaude, BRICKBENCH_AGENT_PROVIDER: 'ollama', BRICKBENCH_AGENT_MODEL: 'qwen3.5:9b', PATH: acpBin };
    const chat = await createChat({ ...setup(env), acpAgents: SPECS, acp: { mcpServer: SERVER } });
    expect(chat.chooser.choices()).toEqual({
      chosen: 'api',
      options: [
        { id: 'claude', name: 'Claude Code', ready: true },
        { id: 'api', name: 'Ollama · qwen3.5:9b', ready: true },
        { id: 'here', name: 'Here', ready: true },
        { id: 'gone', name: 'Gone', ready: false, detail: 'Not installed. Install it with: npm i -g gone' },
      ],
    });
    expect(await chat.chooser.choose('here')).toBe(true);
    expect(chat.runner.status()).toMatchObject({ available: true, name: 'Here' });
    expect(await chat.chooser.choose('gone')).toBe(false);
  });

  it('cannot run agents over ACP without the server BrickBench gives them, and says why', async () => {
    if (process.platform === 'win32') return;
    const chat = await createChat({ ...setup({ BRICKBENCH_CLAUDE: fakeClaude, PATH: acpBin }), acpAgents: SPECS, acp: { unavailable: 'No server for them here.' } });
    expect(chat.chooser.choices().options.find((option) => option.id === 'here')).toEqual({ id: 'here', name: 'Here', ready: false, detail: 'No server for them here.' });
  });

  it('starts with the agent chosen last time, unless the environment names one', async () => {
    if (process.platform === 'win32') return;
    const folder = join(root, 'remembered');
    mkdirSync(folder, { recursive: true });
    const env = { BRICKBENCH_CLAUDE: fakeClaude, PATH: acpBin };
    const first = await createChat({ ...setup(env), acpAgents: SPECS, acp: { mcpServer: SERVER }, folder });
    expect(first.chooser.choices().chosen).toBe('claude');
    expect(await first.chooser.choose('here')).toBe(true);
    expect(JSON.parse(readFileSync(join(folder, 'chat.json'), 'utf8'))).toEqual({ agent: 'here' });
    const again = await createChat({ ...setup(env), acpAgents: SPECS, acp: { mcpServer: SERVER }, folder });
    expect(again.chooser.choices().chosen).toBe('here');
    const named = await createChat({ ...setup({ ...env, BRICKBENCH_AGENT_PROVIDER: 'claude' }), acpAgents: SPECS, acp: { mcpServer: SERVER }, folder });
    expect(named.chooser.choices().chosen).toBe('claude');
    // a choice that is not one is as if never made
    writeFileSync(join(folder, 'chat.json'), '{"agent":42}');
    expect((await createChat({ ...setup(env), acpAgents: SPECS, acp: { mcpServer: SERVER }, folder })).chooser.choices().chosen).toBe('claude');
  });
});
