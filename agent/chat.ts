import type { AgentEvent } from '../src/agent/protocol';

export interface AgentStatus {
  readonly available: boolean;
  /** What answers the chat, e.g. "Claude Code 2.1.323". */
  readonly name: string;
  /** Why it is unavailable, or how it runs. */
  readonly detail?: string;
}

/** What a request carries besides its words. */
export interface RequestExtra {
  /** The user's own instructions for the chat, added to the agent's own: from the next conversation on, for an agent that keeps a session. */
  readonly instructions?: string;
}

/** Runs the agent behind the app's chat: one request at a time, events until "done". */
export interface ChatRunner {
  status(): AgentStatus;
  readonly running: boolean;
  /** Starts work on a request; `fresh` starts a new conversation instead of continuing the last. */
  start(prompt: string, fresh: boolean, onEvent: (event: AgentEvent) => void, extra?: RequestExtra): void;
  /** Stops the work in progress, if any; its "done" event still follows. */
  stop(): void;
  /** Lets go of everything it keeps running between requests, such as an agent's program: the bridge is stopping. */
  close?(): void;
}

/** For when no agent can run here: the chat explains why instead of failing quietly. */
export function unavailableRunner(detail: string): ChatRunner {
  return {
    status: () => ({ available: false, name: 'No agent', detail }),
    running: false,
    start: (_prompt, _fresh, onEvent) => onEvent({ type: 'done', ok: false, error: detail }),
    stop: () => undefined,
  };
}
