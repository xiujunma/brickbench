import { afterAll, describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppLink } from './appLink';
import { createChat, type ChatSetup } from './chatSetup';

const root = mkdtempSync(join(tmpdir(), 'brickbench-chat-setup-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const fakeClaude = join(root, 'claude');
writeFileSync(fakeClaude, '#!/bin/sh\necho "9.9.9 (Claude Code)"\n');
chmodSync(fakeClaude, 0o755);

const setup = (env: Record<string, string>): ChatSetup => ({
  lookup: { env, platform: process.platform, home: join(root, 'home'), cwd: root },
  link: createAppLink(),
  mcpUrl: 'http://127.0.0.1:7425/mcp',
  workDir: root,
  noClaude: 'Install Claude Code, then try again.',
  restart: 'try again',
});

describe('setting up the chat', () => {
  it('runs Claude Code when it is installed, as its own version', async () => {
    const chat = await createChat(setup({ BRICKBENCH_CLAUDE: fakeClaude }));
    expect(chat.runner.status()).toMatchObject({ available: true, name: 'Claude Code 9.9.9' });
    expect(chat.notes).toEqual([]);
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
});
