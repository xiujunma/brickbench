/**
 * Answers the app's chat by running Claude Code headless, once per request,
 * with the user's own login. It may use the BrickBench tools and nothing else:
 * no shell, no files, none of the user's hooks or plugins. Node's child
 * processes start it, so this runs in Bun and in the desktop app alike.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentEvent } from '../src/agent/protocol';
import type { AgentStatus, ChatRunner } from './chat';
import { createStreamReader, type StreamReader } from './claudeStream';
import { CHAT_PROMPT, withOwnInstructions } from './guide';

/** The tail of Claude Code's error output worth showing. */
const MAX_STDERR = 4000;
const MAX_FAILURE = 600;
/** How long Stop waits for Claude Code to exit before ending it outright. */
const KILL_AFTER_MS = 3000;

/** The bridge's MCP server, and the token that lets the chat's agent in. */
export interface McpServerAccess {
  /** Such as http://127.0.0.1:7425/mcp. */
  readonly url: string;
  readonly token: string;
}

export const MCP_CONFIG_FILE = 'brickbench-mcp.json';

/**
 * Writes the MCP config Claude Code reads: the bridge's server, with the
 * chat's token, in a file only the user can read (not in its arguments,
 * which anyone on the computer can list). Returns its path.
 */
export async function writeMcpConfig(folder: string, server: McpServerAccess): Promise<string> {
  const path = join(folder, MCP_CONFIG_FILE);
  const config = { mcpServers: { brickbench: { type: 'http', url: server.url, headers: { Authorization: `Bearer ${server.token}` } } } };
  await writeFile(path, JSON.stringify(config), { mode: 0o600 });
  return path;
}

export const PROMPT_FILE = 'brickbench-prompt.md';

/**
 * Writes what Claude Code is told for a request, BrickBench's instructions
 * with the user's own after them, in a file only the user can read: the
 * user's own may be personal, and arguments anyone on the computer can list.
 * Returns its path.
 */
export function writePromptFile(folder: string, own: string | undefined): string {
  const path = join(folder, PROMPT_FILE);
  writeFileSync(path, withOwnInstructions(CHAT_PROMPT, own), { mode: 0o600 });
  return path;
}

export interface ClaudeRunnerOptions {
  /** How to start Claude Code, e.g. ['/opt/homebrew/bin/claude']; tests pass a fake. */
  readonly command: readonly string[];
  /** The MCP config file (writeMcpConfig) naming the bridge's server, which Claude Code builds through. */
  readonly mcpConfig: string;
  /** An empty folder to run in, so no project's files or CLAUDE.md come along. */
  readonly workDir: string;
  /** Shown in the chat, e.g. "Claude Code 2.1.323". */
  readonly name?: string;
  readonly model?: string | undefined;
  readonly maxBudgetUsd?: number | undefined;
  readonly env?: Readonly<Record<string, string>>;
  readonly killAfterMs?: number;
}

/** Claude Code's arguments for one request: resuming a conversation if there is one, told what `promptFile` says (writePromptFile). */
export function claudeArgs(options: ClaudeRunnerOptions, resume: string | null, promptFile: string): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    // the user's settings files (hooks, plugins) stay out; their login does not
    '--restricted',
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    options.mcpConfig,
    '--allowedTools',
    'mcp__brickbench',
    '--permission-prompts',
    'none',
    '--append-system-prompt-file',
    promptFile,
    ...(options.model ? ['--model', options.model] : []),
    ...(options.maxBudgetUsd ? ['--max-budget-usd', String(options.maxBudgetUsd)] : []),
    ...(resume ? ['--resume', resume] : []),
  ];
}

/** The output's lines, as they come. */
async function* lines(chunks: AsyncIterable<Uint8Array | string>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of chunks) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let end = buffer.indexOf('\n');
    while (end !== -1) {
      yield buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      end = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  if (buffer) yield buffer;
}

/** Why a run ended without a result, from what Claude Code printed. */
function failure(stderr: string, code: number): string {
  if (/unknown option/i.test(stderr)) return 'This Claude Code is too old for the chat: update it with `claude update`, then ask again.';
  const last = stderr.trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(-MAX_FAILURE);
  return last ? `Claude Code stopped: ${last}` : `Claude Code stopped unexpectedly (exit code ${code}).`;
}

interface Run {
  readonly child: ChildProcessWithoutNullStreams;
  /** Settles when Claude Code has exited, with its exit code, or could not start, with why. */
  readonly ended: Promise<{ readonly code: number; readonly error: Error | null }>;
  /** The tail of what it printed to stderr. */
  readonly stderr: () => string;
  stopped: boolean;
}

/** Starts Claude Code: with Node's child processes, so the bridge runs in the desktop app as well as in Bun. */
function launch(options: ClaudeRunnerOptions, args: readonly string[]): Run {
  const [command = 'claude', ...before] = options.command;
  const child = spawn(command, [...before, ...args], {
    cwd: options.workDir,
    env: { ...process.env, ...options.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const ended = new Promise<{ code: number; error: Error | null }>((resolve) => {
    child.once('error', (error) => resolve({ code: -1, error }));
    child.once('close', (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), error: null }));
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (text: string) => {
    stderr = (stderr + text).slice(-MAX_STDERR);
  });
  // gone before it read the prompt: how it ended says why
  child.stdin.on('error', () => undefined);
  return { child, ended, stderr: () => stderr, stopped: false };
}

export function createClaudeRunner(options: ClaudeRunnerOptions): ChatRunner {
  let current: Run | null = null;
  let sessionId: string | null = null;

  const pump = async (run: Run, reader: StreamReader, onEvent: (event: AgentEvent) => void): Promise<void> => {
    // "done" waits for Claude Code to exit, so that once it is sent the next request can start
    let done: AgentEvent | null = null;
    try {
      for await (const line of lines(run.child.stdout)) {
        for (const event of reader.read(line)) {
          if (event.type === 'done') done = event;
          else onEvent(event);
        }
      }
    } catch {
      // the output broke off: how Claude Code ended says why
    }
    const { code, error } = await run.ended;
    sessionId = reader.sessionId ?? sessionId;
    current = null;
    if (error && !done) onEvent({ type: 'done', ok: false, error: `Could not start Claude Code: ${error.message}` });
    else onEvent(done ?? { type: 'done', ok: false, error: run.stopped ? 'Stopped.' : failure(run.stderr(), code) });
  };

  return {
    status: (): AgentStatus => ({ available: true, name: options.name ?? 'Claude Code', detail: 'Runs on this computer with your Claude Code login.' }),
    get running() {
      return current !== null;
    },
    start(prompt, fresh, onEvent, extra) {
      if (current) {
        onEvent({ type: 'done', ok: false, error: 'The agent is still working on the last request.' });
        return;
      }
      if (fresh) sessionId = null;
      let run: Run;
      try {
        run = launch(options, claudeArgs(options, sessionId, writePromptFile(options.workDir, extra?.instructions)));
      } catch (error: unknown) {
        onEvent({ type: 'done', ok: false, error: `Could not start Claude Code: ${error instanceof Error ? error.message : String(error)}` });
        return;
      }
      current = run;
      // the prompt goes in on stdin, so text that looks like a flag stays text
      run.child.stdin.end(prompt);
      void pump(run, createStreamReader(), onEvent).catch((error: unknown) => {
        current = null;
        onEvent({ type: 'done', ok: false, error: `Lost touch with Claude Code: ${error instanceof Error ? error.message : String(error)}` });
      });
    },
    stop() {
      const run = current;
      if (!run) return;
      run.stopped = true;
      run.child.kill();
      // a run that ignores the polite request still has to end
      setTimeout(() => {
        if (current === run) run.child.kill('SIGKILL');
      }, options.killAfterMs ?? KILL_AFTER_MS);
    },
  };
}
