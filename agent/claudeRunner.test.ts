import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '../src/agent/protocol';
import { waitFor } from '../src/testing/helpers';
import type { ChatRunner, RequestExtra } from './chat';
import { claudeArgs, createClaudeRunner, PROMPT_FILE, writePromptFile, type ClaudeRunnerOptions } from './claudeRunner';
import { CHAT_PROMPT, withOwnInstructions } from './guide';

const FAKE_CLAUDE = join(import.meta.dir, 'fixtures', 'fakeClaude.ts');

function fakeRunner(mode: string, extra: Partial<ClaudeRunnerOptions> = {}): ChatRunner {
  return createClaudeRunner({
    command: [process.execPath, FAKE_CLAUDE],
    mcpConfig: '/nowhere/brickbench-mcp.json',
    workDir: mkdtempSync(join(tmpdir(), 'brickbench-agent-test-')),
    env: { FAKE_CLAUDE_MODE: mode },
    ...extra,
  });
}

/** Runs one request to the end. */
function ask(runner: ChatRunner, prompt: string, fresh: boolean, extra?: RequestExtra): Promise<AgentEvent[]> {
  return new Promise((resolve) => {
    const events: AgentEvent[] = [];
    runner.start(
      prompt,
      fresh,
      (event) => {
        events.push(event);
        if (event.type === 'done') resolve(events);
      },
      extra,
    );
  });
}

const replyOf = (events: AgentEvent[]): string => events.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('');

describe('running Claude Code for the chat', () => {
  it('streams the reply and tells when it is done', async () => {
    const runner = fakeRunner('echo', { name: 'Claude Code 9.9' });
    expect(runner.status()).toMatchObject({ available: true, name: 'Claude Code 9.9' });
    const events = await ask(runner, 'Build a tower', true);
    expect(events).toEqual([
      { type: 'started', model: 'fake-model' },
      { type: 'text', text: 'You said: Build a tower' },
      { type: 'done', ok: true, turns: 1, costUsd: 0 },
    ]);
    expect(runner.running).toBe(false);
  });

  it('keeps a character whole when it comes in two pieces', async () => {
    expect(await ask(fakeRunner('split'), 'Build', true)).toContainEqual({ type: 'text', text: 'Built 🧱 bricks' });
  });

  it('says why when Claude Code ends before it reads the request', async () => {
    // a long prompt, so writing it finds the pipe already closed
    const done = (await ask(fakeRunner('early'), 'Build '.repeat(200_000), true)).at(-1);
    expect(done).toEqual({ type: 'done', ok: false, error: 'Claude Code stopped: Claude Code could not start: no login' });
  });

  it('hands over the prompt as text, even one that looks like a flag', async () => {
    expect(replyOf(await ask(fakeRunner('echo'), '--help', true))).toBe('You said: --help');
  });

  it('tells Claude Code the user’s own instructions after BrickBench’s, on each request, in a file only the user can read', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'brickbench-agent-test-'));
    const runner = fakeRunner('args', { workDir });
    const fileOf = (args: string[]): string | undefined => args[args.indexOf('--append-system-prompt-file') + 1];
    const first = JSON.parse(replyOf(await ask(runner, 'one', true, { instructions: 'Use pastel colours' }))) as string[];
    const file = fileOf(first) ?? '';
    expect(file).toBe(join(workDir, PROMPT_FILE));
    expect(readFileSync(file, 'utf8')).toBe(withOwnInstructions(CHAT_PROMPT, 'Use pastel colours'));
    expect(JSON.stringify(first)).not.toContain('pastel');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    // changed or gone the next time, even in the same conversation
    const second = JSON.parse(replyOf(await ask(runner, 'two', false))) as string[];
    expect(fileOf(second)).toBe(file);
    expect(readFileSync(file, 'utf8')).toBe(CHAT_PROMPT);
  });

  it('says so when it cannot write what Claude Code is told', async () => {
    const runner = fakeRunner('echo', { workDir: join(tmpdir(), 'brickbench-no-such-folder', 'deeper') });
    expect((await ask(runner, 'Build', true)).at(-1)).toMatchObject({ type: 'done', ok: false, error: expect.stringContaining('Could not start Claude Code') });
    expect(runner.running).toBe(false);
    expect(writePromptFile(mkdtempSync(join(tmpdir(), 'brickbench-agent-test-')), undefined)).toEndWith(PROMPT_FILE);
  });

  it('continues the conversation until a fresh one is asked for', async () => {
    const runner = fakeRunner('args');
    const first = JSON.parse(replyOf(await ask(runner, 'one', true))) as string[];
    expect(first).not.toContain('--resume');
    const second = JSON.parse(replyOf(await ask(runner, 'two', false))) as string[];
    expect(second.slice(second.indexOf('--resume'), second.indexOf('--resume') + 2)).toEqual(['--resume', 'fake-session-1']);
    const third = JSON.parse(replyOf(await ask(runner, 'three', true))) as string[];
    expect(third).not.toContain('--resume');
  });

  it('says why Claude Code could not run', async () => {
    expect((await ask(fakeRunner('fail'), 'Build', true)).at(-1)).toEqual({
      type: 'done',
      ok: false,
      error: 'Claude Code stopped: Invalid API key · Please run /login',
    });
    const missing = createClaudeRunner({ command: ['/nonexistent/claude'], mcpConfig: '/nowhere/brickbench-mcp.json', workDir: tmpdir() });
    expect((await ask(missing, 'Build', true)).at(-1)).toMatchObject({ type: 'done', ok: false, error: expect.stringContaining('Could not start Claude Code') });
  });

  it('tells the user to update a Claude Code too old for these options', async () => {
    expect((await ask(fakeRunner('old'), 'Build', true)).at(-1)).toMatchObject({
      type: 'done',
      ok: false,
      error: expect.stringContaining('too old for the chat: update it with `claude update`'),
    });
  });

  it('makes sure a run that ignores Stop does stop', async () => {
    const runner = fakeRunner('stubborn', { killAfterMs: 200 });
    const events: AgentEvent[] = [];
    runner.start('Build forever', true, (event) => void events.push(event));
    await waitFor(() => expect(events).toHaveLength(1), 5000);
    runner.stop();
    await waitFor(() => expect(events.at(-1)).toEqual({ type: 'done', ok: false, error: 'Stopped.' }), 5000);
    expect(runner.running).toBe(false);
  });

  it('stops when asked, and takes one request at a time', async () => {
    const runner = fakeRunner('hang');
    const events: AgentEvent[] = [];
    runner.start('Build forever', true, (event) => void events.push(event));
    await waitFor(() => expect(events).toEqual([{ type: 'started', model: 'fake-model' }]), 5000);
    expect(runner.running).toBe(true);
    const busy = await ask(runner, 'Something else', false);
    expect(busy).toEqual([{ type: 'done', ok: false, error: 'The agent is still working on the last request.' }]);
    runner.stop();
    await waitFor(() => expect(events.at(-1)).toEqual({ type: 'done', ok: false, error: 'Stopped.' }), 5000);
    expect(runner.running).toBe(false);
    runner.stop();
  });
});

describe('the Claude Code command line', () => {
  it('allows the BrickBench tools and nothing else, with the user’s login', () => {
    const args = claudeArgs({ command: ['claude'], mcpConfig: '/tmp/work/brickbench-mcp.json', workDir: '/tmp/work', model: 'opus', maxBudgetUsd: 2 }, 'sess-9', '/tmp/work/brickbench-prompt.md');
    const after = (flag: string): string | undefined => args[args.indexOf(flag) + 1];
    expect(args).toContain('-p');
    expect(args).toContain('--restricted');
    expect(args).toContain('--strict-mcp-config');
    expect(args).not.toContain('--bare');
    expect(after('--tools')).toBe('');
    // a file, so the token in it is not in the arguments anyone can list
    expect(after('--mcp-config')).toBe('/tmp/work/brickbench-mcp.json');
    expect(after('--allowedTools')).toBe('mcp__brickbench');
    expect(after('--permission-prompts')).toBe('none');
    // BrickBench's instructions and the user's own, in a file rather than the arguments
    expect(after('--append-system-prompt-file')).toBe('/tmp/work/brickbench-prompt.md');
    expect(args).not.toContain('--append-system-prompt');
    expect(after('--output-format')).toBe('stream-json');
    expect(after('--model')).toBe('opus');
    expect(after('--max-budget-usd')).toBe('2');
    expect(after('--resume')).toBe('sess-9');
  });
});
