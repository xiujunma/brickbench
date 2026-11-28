/**
 * BrickBench's tools as an MCP server over stdio, for agents in a terminal:
 * what `BrickBench --mcp` runs (electron/main.ts). Each call goes to the
 * running app's bridge, found, with the token that lets it in, in the
 * connection file the app writes while the user lets agents in a terminal
 * in. Without that file every call says how to let them in, so the agent
 * can tell the user; with it, an agent added once keeps working each time
 * the app opens.
 */
import type { Readable, Writable } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { toolOutcomeSchema, type ToolOutcome } from '../src/agent/protocol';
import { readConnection } from './access';
import { CALL_TIMEOUT_MS, type AppLink } from './appLink';
import { createBrickBenchMcp } from './mcpServer';

export const NOT_LET_IN =
  'BrickBench is not letting agents in a terminal build right now. Ask the user to open the BrickBench desktop app and, in its Agent panel, turn on "Let agents in a terminal build here", then try again.';

export const TOO_SLOW =
  'BrickBench did not answer in time, and may still be working on that call. Look at the model with get_model before trying again.';

/** A little longer than the app gives a call, so its own time limit speaks first. */
const REQUEST_TIMEOUT_MS = CALL_TIMEOUT_MS + 5_000;

export interface LinkOptions {
  readonly fetch?: typeof fetch;
  /** How long a call may take before the agent hears it did not; REQUEST_TIMEOUT_MS unless a test says otherwise. */
  readonly timeoutMs?: number;
}

const isTimeout = (error: unknown): boolean => error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

/** Runs each tool call in the app the connection file points to, with its token. */
export function connectionLink(connectionFile: string, options: LinkOptions = {}): Pick<AppLink, 'call'> {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  return {
    async call(tool: string, input: unknown): Promise<ToolOutcome> {
      const connection = await readConnection(connectionFile);
      if (!connection) return { ok: false, error: NOT_LET_IN };
      let response: Response;
      try {
        response = await fetchImpl(`${connection.url}/call`, {
          method: 'POST',
          headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ tool, input }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error: unknown) {
        // too slow, or nothing answers there: the app closed without tidying up
        return { ok: false, error: isTimeout(error) ? TOO_SLOW : NOT_LET_IN };
      }
      if (response.status === 401) return { ok: false, error: NOT_LET_IN };
      if (!response.ok) return { ok: false, error: `BrickBench could not take that call (HTTP ${response.status}).` };
      try {
        const parsed = toolOutcomeSchema.safeParse(await response.json());
        if (parsed.success) return parsed.data;
      } catch {
        // not JSON: said below
      }
      return { ok: false, error: 'BrickBench answered with something that is not a tool result.' };
    },
  };
}

export interface StdioOptions {
  /** Where the app writes its address and the token for agents in a terminal. */
  readonly connectionFile: string;
  /** The agent's end: stdin and stdout unless a test says otherwise. */
  readonly input?: Readable;
  readonly output?: Writable;
  readonly fetch?: typeof fetch;
}

/** Serves the tools over stdio until the agent closes its end, answering every call it made first. */
export async function serveStdio(options: StdioOptions): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const link = connectionLink(options.connectionFile, options.fetch ? { fetch: options.fetch } : {});
  const pending = new Set<Promise<ToolOutcome>>();
  const server = createBrickBenchMcp({
    call: (tool, input) => {
      const outcome = link.call(tool, input);
      pending.add(outcome);
      void outcome.finally(() => pending.delete(outcome));
      return outcome;
    },
  });
  const ended = new Promise<void>((resolve) => {
    input.once('end', resolve);
    input.once('close', resolve);
  });
  await server.connect(new StdioServerTransport(input, output));
  await ended;
  // an agent may close its end with calls still running: they are answered first
  await Promise.allSettled([...pending]);
  await new Promise((resolve) => setImmediate(resolve));
  await server.close();
}
