/**
 * Answers the app's chat by running Claude Code headless, once per request,
 * with the user's own login. It may use the BrickBench tools and nothing else:
 * no shell, no files, none of the user's hooks or plugins.
 */
import type { AgentEvent } from '../src/agent/protocol';
import type { AgentStatus, ChatRunner } from './chat';
import { createStreamReader, type StreamReader } from './claudeStream';

export const CHAT_PROMPT = `You are building in BrickBench, a LEGO-style brick builder the user has open in their browser, using the brickbench tools. The user is chatting with you from inside BrickBench and sees every change as you make it.
- Plan briefly, then build. Look at your work with the look tool before you say you are done, and fix what is off.
- If a request is unclear, make a sensible choice and say what you chose instead of asking.
- Keep replies short and plain: what you built and anything the user should know. No code, and no talk of tool names.`;

/** The tail of Claude Code's error output worth showing. */
const MAX_STDERR = 4000;
const MAX_FAILURE = 600;
/** How long Stop waits for Claude Code to exit before ending it outright. */
const KILL_AFTER_MS = 3000;

export interface ClaudeRunnerOptions {
  /** How to start Claude Code, e.g. ['/opt/homebrew/bin/claude']; tests pass a fake. */
  readonly command: readonly string[];
  /** The bridge's MCP endpoint, which Claude Code builds through. */
  readonly mcpUrl: string;
  /** An empty folder to run in, so no project's files or CLAUDE.md come along. */
  readonly workDir: string;
  /** Shown in the chat, e.g. "Claude Code 2.1.323". */
  readonly name?: string;
  readonly model?: string | undefined;
  readonly maxBudgetUsd?: number | undefined;
  readonly env?: Readonly<Record<string, string>>;
  readonly killAfterMs?: number;
}

export function claudeArgs(options: ClaudeRunnerOptions, resume: string | null): string[] {
  const mcpConfig = JSON.stringify({ mcpServers: { brickbench: { type: 'http', url: options.mcpUrl } } });
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
    mcpConfig,
    '--allowedTools',
    'mcp__brickbench',
    '--permission-prompts',
    'none',
    '--append-system-prompt',
    CHAT_PROMPT,
    ...(options.model ? ['--model', options.model] : []),
    ...(options.maxBudgetUsd ? ['--max-budget-usd', String(options.maxBudgetUsd)] : []),
    ...(resume ? ['--resume', resume] : []),
  ];
}

async function* lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  let buffer = '';
  for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    let end = buffer.indexOf('\n');
    while (end !== -1) {
      yield buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      end = buffer.indexOf('\n');
    }
  }
  if (buffer) yield buffer;
}

/** Why a run ended without a result, from what Claude Code printed. */
function failure(stderr: string, code: number): string {
  if (/unknown option/i.test(stderr)) return 'This Claude Code is too old for the chat: update it with `claude update`, then restart the bridge.';
  const last = stderr.trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(-MAX_FAILURE);
  return last ? `Claude Code stopped: ${last}` : `Claude Code stopped unexpectedly (exit code ${code}).`;
}

interface Run {
  readonly process: Bun.Subprocess<'pipe', 'pipe', 'pipe'>;
  stopped: boolean;
}

export function createClaudeRunner(options: ClaudeRunnerOptions): ChatRunner {
  let current: Run | null = null;
  let sessionId: string | null = null;

  const pump = async (run: Run, reader: StreamReader, onEvent: (event: AgentEvent) => void): Promise<void> => {
    const stderr = new Response(run.process.stderr).text();
    // "done" waits for Claude Code to exit, so that once it is sent the next request can start
    let done: AgentEvent | null = null;
    for await (const line of lines(run.process.stdout)) {
      for (const event of reader.read(line)) {
        if (event.type === 'done') done = event;
        else onEvent(event);
      }
    }
    const code = await run.process.exited;
    sessionId = reader.sessionId ?? sessionId;
    current = null;
    onEvent(done ?? { type: 'done', ok: false, error: run.stopped ? 'Stopped.' : failure((await stderr).slice(-MAX_STDERR), code) });
  };

  return {
    status: (): AgentStatus => ({ available: true, name: options.name ?? 'Claude Code', detail: 'Runs on this computer with your Claude Code login.' }),
    get running() {
      return current !== null;
    },
    start(prompt, fresh, onEvent) {
      if (current) {
        onEvent({ type: 'done', ok: false, error: 'The agent is still working on the last request.' });
        return;
      }
      if (fresh) sessionId = null;
      let run: Run;
      try {
        const process = Bun.spawn([...options.command, ...claudeArgs(options, sessionId)], {
          cwd: options.workDir,
          env: { ...Bun.env, ...options.env },
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
        });
        run = { process, stopped: false };
      } catch (error: unknown) {
        onEvent({ type: 'done', ok: false, error: `Could not start Claude Code: ${error instanceof Error ? error.message : String(error)}` });
        return;
      }
      current = run;
      // the prompt goes in on stdin, so text that looks like a flag stays text
      run.process.stdin.write(prompt);
      void run.process.stdin.end();
      void pump(run, createStreamReader(), onEvent).catch((error: unknown) => {
        current = null;
        onEvent({ type: 'done', ok: false, error: `Lost touch with Claude Code: ${error instanceof Error ? error.message : String(error)}` });
      });
    },
    stop() {
      const run = current;
      if (!run) return;
      run.stopped = true;
      run.process.kill();
      // a run that ignores the polite request still has to end
      setTimeout(() => {
        if (current === run) run.process.kill('SIGKILL');
      }, options.killAfterMs ?? KILL_AFTER_MS);
    },
  };
}
