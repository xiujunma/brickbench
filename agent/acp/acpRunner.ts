/**
 * Answers the app's chat with a coding agent that speaks the Agent Client
 * Protocol (Codex, Gemini CLI, OpenCode, Grok Build, Mistral Vibe, or any
 * other), as SolidCraft's chat does. BrickBench starts the agent's program
 * on this computer, where it runs with the user's own login, opens a session
 * whose only tools are BrickBench's MCP server, and passes each request on.
 * It declares no file system or terminal, allows the agent its BrickBench
 * tools, and refuses anything else the agent asks leave for.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { TOOL_NAMES, type AgentEvent, type ToolName } from '../../src/agent/protocol';
import type { AgentStatus, ChatRunner } from '../chat';
import { withOwnInstructions } from '../guide';
import { summarizeTool } from '../toolSummary';
import { createRpc, RPC_ERRORS, RpcError, type RpcPeer } from './rpc';
import {
  ACP_ERRORS,
  initializeResultSchema,
  newSessionResultSchema,
  permissionRequestSchema,
  promptResultSchema,
  PROTOCOL_VERSION,
  sessionUpdateSchema,
  type PermissionOutcome,
  type PermissionRequest,
  type SessionUpdate,
  type StdioMcpServer,
  type StopReason,
  type ToolCall,
} from './schema';

const MAX_STDERR = 4000;
const MAX_FAILURE = 600;
/** How long Stop waits for the agent to finish the request before ending its program outright. */
const KILL_AFTER_MS = 3000;
const BUSY = 'The agent is still working on the last request.';

export interface AcpRunnerOptions {
  /** Shown in the chat, such as "Codex". */
  readonly name: string;
  /** The agent's program and its arguments for ACP mode, the program as an absolute path. */
  readonly command: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /** An empty folder: where the agent runs, and its sessions' working folder. */
  readonly workDir: string;
  /** BrickBench's MCP server, which the agent starts for its tools. */
  readonly mcpServer: StdioMcpServer;
  /** How the chat's agent should work: added to the agent's system prompt where it takes that, else to the first request. */
  readonly instructions: string;
  /** How to sign in to this agent, for when it says it needs that. */
  readonly signIn: string;
  /** BrickBench's version, as the agent is told. */
  readonly version?: string;
  readonly killAfterMs?: number;
}

/** The BrickBench tools, as the agent's MCP server is named. */
const SERVER = 'brickbench';

const isToolName = (name: string | undefined): name is ToolName => name !== undefined && (TOOL_NAMES as readonly string[]).includes(name);
const field = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined);

/**
 * The BrickBench tool a call is, by the names agents give MCP tools, or
 * null: Claude Code's adapter calls it mcp__brickbench__look and titles it
 * "brickbench: look", Codex titles it mcp.brickbench.look, and Gemini CLI
 * names the server and tool in its _meta.
 */
export function brickbenchTool(call: ToolCall): ToolName | null {
  const named = /^mcp__brickbench__(\w+)$/.exec(call.name ?? '')?.[1];
  const titled = /^(?:brickbench: |mcp\.brickbench\.)(\w+)$/.exec(call.title ?? '')?.[1];
  const gemini = field(field(call._meta, 'gemini-cli'), 'mcp');
  const fromGemini = field(gemini, 'server_name') === SERVER ? field(gemini, 'tool_name') : undefined;
  const tool = named ?? titled ?? (typeof fromGemini === 'string' ? fromGemini : undefined);
  return isToolName(tool) ? tool : null;
}

/** The answer to a request for leave: yes to BrickBench's tools, no to anything else, by whichever option says so. */
export function permissionFor(request: PermissionRequest): { readonly outcome: PermissionOutcome; readonly allowed: boolean } {
  const allowed = brickbenchTool(request.toolCall) !== null;
  const kinds = allowed ? (['allow_once', 'allow_always'] as const) : (['reject_once', 'reject_always'] as const);
  const option = kinds.map((kind) => request.options.find((o) => o.kind === kind)).find((o) => o !== undefined);
  return { outcome: option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : { outcome: { outcome: 'cancelled' } }, allowed };
}

/** A line for the chat on a tool call: BrickBench's own in words, anything else by its title. */
function summaryOf(call: ToolCall): string {
  const tool = brickbenchTool(call);
  return tool ? summarizeTool(tool, call.rawInput) : (call.title ?? 'Using a tool');
}

interface Agent {
  readonly child: ChildProcessWithoutNullStreams;
  readonly rpc: RpcPeer;
  /** It has said hello; until then it is only starting, and Stop ends it. */
  ready: boolean;
  /** The agent takes instructions in its system prompt (session/new's systemPrompt). */
  systemPrompt: boolean;
  sessionId: string | null;
  /** The session has had the instructions. */
  instructed: boolean;
  /** The session's tool calls so far, as reported: a request for leave may name one by its id alone. */
  readonly calls: Map<string, ToolCall>;
  /** What the session has cost so far, in US dollars: usage_update gives the running total. */
  costUsd: number;
}

/** One request, from the user's prompt to the agent's stop. */
interface Turn {
  readonly onEvent: (event: AgentEvent) => void;
  text: string;
  /** The message the text so far belongs to: another one starts a message of its own in the chat. */
  messageId: string | null;
  stopped: boolean;
  /** The session's cost when the request began, and what the request has cost since. */
  costAtStart: number;
  costUsd: number | undefined;
  /** Tool calls already shown in the chat, or refused. */
  readonly shown: Set<string>;
}

class Stopped extends Error {}

/** What the chat keeps of a tool call: the fields it reads, and not, say, a picture the call returned. */
function slim(call: ToolCall): ToolCall {
  const { toolCallId, title, name, kind, status, rawInput, _meta } = call;
  return { toolCallId, title, name, kind, status, rawInput, _meta };
}

/** A tool call with what an update says of it laid over what was known: blanks leave fields as they were. */
function laidOver(known: ToolCall | undefined, update: ToolCall): ToolCall {
  const given = Object.fromEntries(Object.entries(slim(update)).filter((entry) => entry[1] !== undefined && entry[1] !== null));
  return { ...known, ...given, toolCallId: update.toolCallId };
}

/**
 * The call a request for leave is about: as the request names it, when it
 * names it at all (a title, a name or _meta), else as the agent announced it
 * under that id, for the protocol lets a request give the id alone.
 */
function askedAbout(known: ToolCall | undefined, asked: ToolCall): ToolCall {
  // of _meta, only what brickbenchTool reads names a call
  const names = [asked.title, asked.name, field(asked._meta, 'gemini-cli')].some((value) => value !== undefined && value !== null);
  return names ? slim(asked) : laidOver(known, asked);
}

/** Whether a tool call is running or done: while pending, its input may still be coming. */
function isUnderway(call: ToolCall): boolean {
  const status = call.status ?? (call.rawInput === undefined || call.rawInput === null ? 'pending' : 'in_progress');
  return status !== 'pending';
}

export function createAcpRunner(options: AcpRunnerOptions): ChatRunner {
  const { name } = options;
  const killAfterMs = options.killAfterMs ?? KILL_AFTER_MS;
  let agent: Agent | null = null;
  let turn: Turn | null = null;
  let stderr = '';

  const flush = (current: Turn): void => {
    const text = current.text.trim();
    current.text = '';
    if (text) current.onEvent({ type: 'text', text });
  };

  const onUpdate = (live: Agent, current: Turn, update: SessionUpdate): void => {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        if (update.content.type !== 'text' || typeof update.content.text !== 'string') return;
        const id = update.messageId ?? null;
        if (id !== null && current.messageId !== null && id !== current.messageId) flush(current);
        if (id !== null) current.messageId = id;
        current.text += update.content.text;
        return;
      }
      case 'tool_call':
      case 'tool_call_update': {
        // an announcement starts the call afresh, even under an id used before, to be shown again; an update adds to it
        const announced = update.sessionUpdate === 'tool_call';
        if (announced) current.shown.delete(update.toolCallId);
        const call = announced ? slim(update) : laidOver(live.calls.get(update.toolCallId), update);
        live.calls.set(call.toolCallId, call);
        if (current.shown.has(call.toolCallId) || !isUnderway(call)) return;
        current.shown.add(call.toolCallId);
        flush(current);
        current.onEvent({ type: 'tool', tool: call.name ?? call.title ?? 'tool', summary: summaryOf(call) });
        return;
      }
      case 'usage_update':
        if (update.cost?.currency === 'USD') {
          live.costUsd = update.cost.amount;
          current.costUsd = Math.max(0, update.cost.amount - current.costAtStart);
        }
        return;
    }
  };

  const onRequest = async (method: string, params: unknown): Promise<unknown> => {
    if (method !== 'session/request_permission') throw new RpcError(RPC_ERRORS.methodNotFound, `BrickBench does not offer ${method}.`);
    const parsed = permissionRequestSchema.safeParse(params);
    if (!parsed.success) throw new RpcError(RPC_ERRORS.invalidParams, 'Not a request for leave BrickBench understands.');
    const live = agent;
    const current = turn;
    if (!live || !current || current.stopped) return { outcome: { outcome: 'cancelled' } };
    const call = askedAbout(live.calls.get(parsed.data.toolCall.toolCallId), parsed.data.toolCall);
    const { outcome, allowed } = permissionFor({ ...parsed.data, toolCall: call });
    if (!allowed) {
      current.shown.add(call.toolCallId);
      flush(current);
      current.onEvent({ type: 'tool', tool: 'refused', summary: `Not allowed: ${call.title ?? 'something else'}. BrickBench lets agents use only its own tools.` });
    }
    return outcome;
  };

  const onNotification = (method: string, params: unknown): void => {
    if (method !== 'session/update') return;
    const parsed = sessionUpdateSchema.safeParse(params);
    const live = agent;
    if (!parsed.success || !turn || !live || parsed.data.sessionId !== live.sessionId) return;
    onUpdate(live, turn, parsed.data.update);
  };

  const end = (child: ChildProcessWithoutNullStreams): void => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill();
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, killAfterMs).unref();
  };

  /** Starts the agent's program, kept as the agent at once so Stop can end it, and says hello: its protocol version, and whether it takes a system prompt. */
  const startAgent = async (): Promise<Agent> => {
    const [program = '', ...args] = options.command;
    stderr = '';
    const child = spawn(program, args, { cwd: options.workDir, env: { ...options.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stderr.setEncoding('utf8').on('data', (text: string) => {
      stderr = (stderr + text).slice(-MAX_STDERR);
    });
    child.stdin.on('error', () => undefined);
    // the program's own end closes the connection, once what it printed to stderr has come in
    const rpc = createRpc(child.stdout, child.stdin, { onRequest, onNotification }, { closeOnEnd: false });
    const starting: Agent = { child, rpc, ready: false, systemPrompt: false, sessionId: null, instructed: false, calls: new Map(), costUsd: 0 };
    agent = starting;
    child.once('error', (error) => rpc.close(`Could not start ${name}: ${error.message}`));
    child.once('close', (code) => {
      const said = stderr.trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(-MAX_FAILURE);
      rpc.close(said ? `${name} stopped: ${said}` : `${name} stopped (exit code ${code ?? 'none'}).`);
      if (agent === starting) agent = null;
    });
    try {
      const hello = initializeResultSchema.parse(
        await rpc.request('initialize', {
          protocolVersion: PROTOCOL_VERSION,
          // no file system and no terminal: the agent's tools here are BrickBench's
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: 'BrickBench', version: options.version ?? '1.0.0' },
        }),
      );
      if (hello.protocolVersion !== PROTOCOL_VERSION) {
        throw new Error(`${name} speaks version ${hello.protocolVersion} of the Agent Client Protocol, and BrickBench version ${PROTOCOL_VERSION}.`);
      }
      starting.systemPrompt = hello.agentCapabilities?.sessionCapabilities?.systemPrompt != null;
      starting.ready = true;
      return starting;
    } catch (error: unknown) {
      if (agent === starting) agent = null;
      end(child);
      throw error;
    }
  };

  /** A new session, with BrickBench's MCP server as its tools, and the instructions where the agent takes them. */
  const openSession = async (live: Agent, instructions: string): Promise<void> => {
    const result = newSessionResultSchema.parse(
      await live.rpc.request('session/new', {
        cwd: options.workDir,
        mcpServers: [options.mcpServer],
        ...(live.systemPrompt ? { systemPrompt: { mode: 'append', content: [{ type: 'text', text: instructions }] } } : {}),
        // for Claude Code's adapter: none of Claude Code's own tools, and none of the user's settings files
        _meta: { claudeCode: { options: { tools: [], settingSources: [] } } },
      }),
    );
    live.sessionId = result.sessionId;
    live.instructed = live.systemPrompt;
    live.calls.clear();
    live.costUsd = 0;
  };

  const doneFor = (reason: StopReason, current: Turn): AgentEvent => {
    const cost = current.costUsd === undefined ? {} : { costUsd: current.costUsd };
    switch (reason) {
      case 'end_turn':
        return { type: 'done', ok: true, ...cost };
      case 'cancelled':
        return { type: 'done', ok: false, error: 'Stopped.' };
      case 'refusal':
        return { type: 'done', ok: false, error: `${name} declined to do that.` };
      case 'max_tokens':
        return { type: 'done', ok: false, error: `${name} stopped: its reply ran too long.` };
      case 'max_turn_requests':
        return { type: 'done', ok: false, error: `${name} stopped: it reached its limit of steps for one request.` };
    }
  };

  const describe = (error: unknown): string => {
    if (error instanceof RpcError && error.code === ACP_ERRORS.authRequired) return `${name} needs you to sign in first. ${options.signIn}, then ask again.`;
    if (error instanceof Error && error.name === 'ZodError') return `${name} answered in a way BrickBench does not understand.`;
    return error instanceof Error ? error.message : String(error);
  };

  const run = async (current: Turn, prompt: string, fresh: boolean, own: string | undefined): Promise<AgentEvent> => {
    // BrickBench's instructions and the user's own, as they are when a session begins
    const instructions = withOwnInstructions(options.instructions, own);
    const live = agent?.ready ? agent : await startAgent();
    if (current.stopped) throw new Stopped();
    if (fresh || live.sessionId === null) await openSession(live, instructions);
    if (current.stopped) throw new Stopped();
    current.onEvent({ type: 'started' });
    current.costAtStart = live.costUsd;
    const instructing = !live.instructed;
    const blocks = [...(instructing ? [{ type: 'text', text: instructions }] : []), { type: 'text', text: prompt }];
    const result = promptResultSchema.parse(await live.rpc.request('session/prompt', { sessionId: live.sessionId, prompt: blocks }));
    // the agent has had the instructions once a request with them comes back, however it ended
    if (instructing) live.instructed = true;
    return doneFor(result.stopReason, current);
  };

  const finish = (current: Turn, event: AgentEvent): void => {
    if (turn !== current) return;
    flush(current);
    turn = null;
    current.onEvent(current.stopped && event.type === 'done' && !event.ok ? { type: 'done', ok: false, error: 'Stopped.' } : event);
  };

  const stop = (): void => {
    const current = turn;
    if (!current) return;
    current.stopped = true;
    const live = agent;
    if (!live) return;
    // still starting, or no session to cancel yet: let go of and ended, to start afresh next time
    if (!live.ready || live.sessionId === null) {
      agent = null;
      end(live.child);
      return;
    }
    live.rpc.notify('session/cancel', { sessionId: live.sessionId });
    // an agent that does not finish when asked is ended, and starts afresh next time
    setTimeout(() => {
      if (turn === current) end(live.child);
    }, killAfterMs).unref();
  };

  return {
    status: (): AgentStatus => ({ available: true, name, detail: `Runs on this computer over the Agent Client Protocol, with your own ${name} login.` }),
    get running() {
      return turn !== null;
    },
    start(prompt, fresh, onEvent, extra) {
      if (turn) {
        onEvent({ type: 'done', ok: false, error: BUSY });
        return;
      }
      const current: Turn = { onEvent, text: '', messageId: null, stopped: false, costAtStart: 0, costUsd: undefined, shown: new Set() };
      turn = current;
      run(current, prompt, fresh, extra?.instructions).then(
        (event) => finish(current, event),
        (error: unknown) => finish(current, { type: 'done', ok: false, error: error instanceof Stopped ? 'Stopped.' : describe(error) }),
      );
    },
    stop,
    close() {
      stop();
      const live = agent;
      agent = null;
      if (live) end(live.child);
    },
  };
}
