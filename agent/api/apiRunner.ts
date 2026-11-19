/**
 * Answers the app's chat with a model behind an API: OpenAI, xAI, OpenRouter,
 * a model on this computer through Ollama or LM Studio, or any other
 * OpenAI-compatible server. The model gets BrickBench's tools by function
 * calling, and its calls run in the open tab just as Claude Code's do.
 */
import type { AgentEvent, ToolOutcome } from '../../src/agent/protocol';
import type { AgentStatus, ChatRunner } from '../chat';
import { API_INSTRUCTIONS } from '../guide';
import { summarizeTool } from '../toolSummary';
import { ApiError, postJson } from './http';
import { argumentsOf, runCall, TOOL_SPECS, type ToolRunner } from './tools';
import { ReplyError, type CallResult, type Reply, type ToolCall, type WireFormat } from './types';

/** Rounds of tool calls one request may take: plenty for a big build, and an end for a model that goes round in circles. */
export const MAX_ROUNDS = 60;
/** Reasoning models can think for minutes; one that takes longer than this has hung. */
const REQUEST_TIMEOUT_MS = 15 * 60_000;
const RETRY_DELAYS_MS: readonly number[] = [2000, 8000];
/** Pictures kept from earlier requests: the last, so the model still knows how the build looked. */
const PICTURES_KEPT = 1;
const MAX_ERROR = 600;
const MAX_REFUSAL = 300;

const BUSY = 'The agent is still working on the last request.';
const NOT_RUN = 'Not run: the user stopped the request.';
const STOPPED_WHILE_RUNNING = 'Stopped by the user while it ran: it may have been done, in part or in full.';
const NO_PICTURE = '(No picture: this model cannot see them. get_model lists the bricks instead.)';
const STOPPED: AgentEvent = { type: 'done', ok: false, error: 'Stopped.' };
/** Errors that mean the conversation no longer fits in what the model can read. */
const TOO_LONG = /context[ _-]?(length|window)|too many tokens|maximum.{0,40}tokens|prompt is too long|token limit/i;
/** A refusal of the pictures themselves, by a model that cannot see: OpenRouter's comes as a 404. */
const NO_PICTURES = /image|vision|multi-?modal/i;

export interface ApiRunnerOptions {
  /** Who runs the model, for the chat and its messages: "OpenAI", "Ollama". */
  readonly label: string;
  /** The API's address, such as https://api.openai.com/v1. */
  readonly baseUrl: string;
  readonly model: string;
  readonly format: WireFormat;
  readonly tools: ToolRunner;
  readonly apiKey?: string | undefined;
  /** The environment variable the key came from, for messages about it. */
  readonly keyVariable?: string | undefined;
  /** The model runs on this computer. */
  readonly local?: boolean;
  readonly maxRounds?: number;
  readonly timeoutMs?: number;
  readonly retryDelaysMs?: readonly number[];
}

interface Run {
  readonly controller: AbortController;
  stopped: boolean;
}

type Emit = (event: AgentEvent) => void;

/** What the user sees of a reply: some local models think aloud between <think> tags. */
export function visibleText(text: string): string {
  return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim();
}

const cut = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);
const firstLine = (text: string): string => cut(text.split('\n')[0] ?? '', MAX_REFUSAL);
const httpError = (error: unknown): ApiError | null => (error instanceof ApiError && error.kind === 'http' && error.status !== null ? error : null);

function refusesPictures(error: unknown): boolean {
  const refusal = httpError(error);
  return refusal !== null && ![401, 403, 429].includes(refusal.status ?? 0) && NO_PICTURES.test(refusal.message);
}

/** A model that is not a reasoning model refuses to be asked for its reasoning. */
function refusesReasoning(error: unknown): boolean {
  const refusal = httpError(error);
  return refusal !== null && refusal.status === 400 && /encrypted/i.test(refusal.message);
}

const failedWith = (error: unknown): ToolOutcome => ({ ok: false, error: `BrickBench could not run it: ${error instanceof Error ? error.message : String(error)}` });

/** The call's outcome, or as soon as the user stops, one that says so: nothing waits on a tab that has hung. */
function unlessStopped(work: Promise<ToolOutcome>, signal: AbortSignal): Promise<ToolOutcome> {
  return new Promise((resolve) => {
    const stopped = (): void => resolve({ ok: false, error: STOPPED_WHILE_RUNNING });
    if (signal.aborted) stopped();
    signal.addEventListener('abort', stopped, { once: true });
    work.then(resolve, (error: unknown) => resolve(failedWith(error))).finally(() => signal.removeEventListener('abort', stopped));
  });
}

export function createApiRunner(options: ApiRunnerOptions): ChatRunner {
  const { format, label, model } = options;
  const maxRounds = options.maxRounds ?? MAX_ROUNDS;
  let conversation: readonly unknown[] = [];
  let current: Run | null = null;
  let seesPictures = true;
  let asksReasoning = true;
  /** The last request failed, perhaps over a picture: the next one starts without them. */
  let dropPictures = false;

  const request = (run: Run): Promise<unknown> =>
    postJson({
      url: `${options.baseUrl}${format.path}`,
      apiKey: options.apiKey,
      body: format.body(model, API_INSTRUCTIONS, conversation, TOOL_SPECS, { encryptedReasoning: asksReasoning }),
      signal: run.controller.signal,
      timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
      retryDelaysMs: options.retryDelaysMs ?? RETRY_DELAYS_MS,
    });

  /** Does without what the API refused, if the chat can; says whether to ask again. Each gives way once, so asking ends. */
  const giveWay = (error: unknown, emit: Emit): boolean => {
    if (seesPictures && format.pictures(conversation) > 0 && refusesPictures(error)) {
      seesPictures = false;
      conversation = format.withoutPictures(conversation, 0);
      emit({ type: 'tool', tool: 'note', summary: `${model} cannot see pictures, so it carries on without them` });
      return true;
    }
    if (asksReasoning && refusesReasoning(error)) {
      asksReasoning = false;
      return true;
    }
    return false;
  };

  /** The model's next step. */
  const ask = async (run: Run, emit: Emit): Promise<Reply> => {
    for (;;) {
      try {
        return format.read(await request(run));
      } catch (error: unknown) {
        if (!giveWay(error, emit)) throw error;
      }
    }
  };

  const resultOf = (call: ToolCall, outcome: ToolOutcome): CallResult => {
    if (!outcome.ok) return { id: call.id, text: `Error: ${outcome.error}` };
    const text = JSON.stringify(outcome.data ?? null);
    if (!outcome.image) return { id: call.id, text };
    return seesPictures ? { id: call.id, text, picture: outcome.image } : { id: call.id, text: `${text}\n${NO_PICTURE}` };
  };

  /** Runs one call, telling the chat; nothing a model sends can break off the round with calls already made. */
  const runOne = (call: ToolCall, run: Run, emit: Emit): Promise<ToolOutcome> => {
    try {
      const args = argumentsOf(call.arguments);
      emit({ type: 'tool', tool: call.name, summary: summarizeTool(call.name, args.ok ? args.value : {}) });
      return unlessStopped(runCall(call, options.tools), run.controller.signal);
    } catch (error: unknown) {
      return Promise.resolve(failedWith(error));
    }
  };

  /** Runs the calls in order, as the model asked; once the user stops, the rest are answered without running. */
  const answer = async (calls: readonly ToolCall[], run: Run, emit: Emit): Promise<CallResult[]> => {
    const results: CallResult[] = [];
    for (const call of calls) {
      if (run.stopped) {
        results.push({ id: call.id, text: NOT_RUN });
        continue;
      }
      const outcome = await runOne(call, run, emit);
      if (!outcome.ok && !run.stopped) emit({ type: 'tool', tool: 'error', summary: `Refused: ${firstLine(outcome.error)}` });
      results.push(resultOf(call, outcome));
    }
    return results;
  };

  const cutShort = (reason: string): string => {
    if (reason === 'length') return 'The reply was cut short: the model ran out of room. Ask it to carry on.';
    return reason === 'filter' ? `${label}'s content filter stopped the reply.` : `The reply stopped early (${reason}).`;
  };

  const work = async (run: Run, emit: Emit): Promise<AgentEvent> => {
    for (let round = 1; round <= maxRounds; round += 1) {
      const reply = await ask(run, emit);
      const text = visibleText(reply.text);
      if (text) emit({ type: 'text', text });
      if (reply.calls.length === 0) {
        conversation = [...conversation, ...reply.items];
        return reply.cutShort ? { type: 'done', ok: false, error: cutShort(reply.cutShort), turns: round } : { type: 'done', ok: true, turns: round };
      }
      const results = await answer(reply.calls, run, emit);
      // a round joins the conversation whole, so every call has its answer whatever happens next
      conversation = [...conversation, ...reply.items, ...format.results(results)];
      if (run.stopped) return STOPPED;
    }
    return { type: 'done', ok: false, error: `Stopped after ${maxRounds} rounds of tool calls, the most one request may take. Ask again to carry on.`, turns: maxRounds };
  };

  const httpFailure = (status: number, message: string): string => {
    const key = options.keyVariable ? ` in ${options.keyVariable}` : '';
    if (status === 401) return `${label} did not accept the API key${key} (HTTP 401: ${message}).`;
    if (status === 403) return `${label} refused access (HTTP 403: ${message}). Check that the API key${key} may use ${model}.`;
    if (status === 404) return `${label} answered “${message}” (HTTP 404). Check that ${model} is one of its models, and that ${options.baseUrl} is its API's address.`;
    if (status === 429) return `${label} is limiting requests, or the account is out of credit (HTTP 429: ${message}).`;
    if (TOO_LONG.test(message)) return `This chat is now too long for ${model}. Start a new chat.`;
    return `${label} refused the request (HTTP ${status}: ${message}).`;
  };

  const describe = (error: unknown): string => {
    if (error instanceof ReplyError) return `${label} ${error.message}`;
    if (!(error instanceof ApiError)) return `The chat broke off: ${error instanceof Error ? error.message : String(error)}`;
    switch (error.kind) {
      case 'stopped':
        return 'Stopped.';
      case 'timeout':
      case 'reply':
        return `${label} ${error.message}.`;
      case 'network':
        return `Could not reach ${label} at ${options.baseUrl}${options.local ? `: is ${label} running?` : '.'} (${error.message})`;
      case 'http':
        return httpFailure(error.status ?? 0, error.message);
    }
  };

  const detail = (): string => {
    if (options.local) return `Runs on this computer with ${label}.`;
    if (!options.apiKey) return `Runs on ${label}, at ${options.baseUrl}.`;
    return `Runs on ${label} with your API key${options.keyVariable ? ` (${options.keyVariable})` : ''}.`;
  };

  return {
    status: (): AgentStatus => ({ available: true, name: `${label} · ${model}`, detail: detail() }),
    get running() {
      return current !== null;
    },
    start(prompt, fresh, onEvent) {
      if (current) {
        onEvent({ type: 'done', ok: false, error: BUSY });
        return;
      }
      const run: Run = { controller: new AbortController(), stopped: false };
      current = run;
      // earlier pictures go but the last (they are heavy, and out of date), all of them if the last request failed
      const earlier = fresh ? [] : format.settled(format.withoutPictures(conversation, dropPictures ? 0 : PICTURES_KEPT));
      conversation = [...earlier, format.user(prompt)];
      onEvent({ type: 'started', model });
      void work(run, onEvent)
        .catch((error: unknown): AgentEvent => ({ type: 'done', ok: false, error: cut(describe(error), MAX_ERROR) }))
        .then((done) => {
          current = null;
          dropPictures = done.type === 'done' && !done.ok && !run.stopped;
          onEvent(done);
        });
    },
    stop() {
      const run = current;
      if (!run) return;
      run.stopped = true;
      run.controller.abort();
    },
  };
}
