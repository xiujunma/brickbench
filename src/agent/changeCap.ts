/**
 * A cap on the changes one request to the chat's agent may make, when the
 * user sets one: each tool call that changes the model counts; reading it
 * does not. At the cap, a change is refused with a word for the agent to
 * stop and say what is left, so the user can let it carry on. While a request
 * runs, every change counts, as every change then is undone with it.
 */
import type { ToolOutcome } from './protocol';

/** The tools that change the model. */
export const CHANGING_TOOLS: ReadonlySet<string> = new Set(['place_bricks', 'paint_bricks', 'move_bricks', 'remove_bricks', 'clear_model', 'set_model_name', 'undo']);

export const capReached = (cap: number): string =>
  `The user allows ${cap} ${cap === 1 ? 'change' : 'changes'} to the model for each chat request, and this one has made ${cap === 1 ? 'it' : 'them'}. Make no more: stop here and tell the user what is left to do, and they can ask you to carry on.`;

export interface ChangeCap {
  /** A request has begun: its changes count from nothing. */
  begin(): void;
  /** It is over: changes count again only once the next begins. */
  end(): void;
  /** Runs a tool call, unless it would change the model past the cap. */
  run(tool: string, call: () => Promise<ToolOutcome>): Promise<ToolOutcome>;
}

/** Whether two snapshots of what the tools change are the same, part by part. */
const same = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((part, i) => Object.is(part, b[i]));

/**
 * `cap` says the cap at the moment a change is asked for: null for none,
 * though changes still count, for a cap set partway. `snapshot` says what the
 * tools change as it stands, such as the model and its name: a call that
 * leaves every part of it the same changed nothing.
 */
export function createChangeCap(cap: () => number | null, snapshot: () => readonly unknown[]): ChangeCap {
  let counting = false;
  let changes = 0;
  /** Which request is counting, so a change still going as its request ends is not taken off the next one's count. */
  let request = 0;
  return {
    begin() {
      counting = true;
      changes = 0;
      request += 1;
    },
    end() {
      counting = false;
    },
    async run(tool, call) {
      if (!counting || !CHANGING_TOOLS.has(tool)) return call();
      const limit = cap();
      if (limit !== null && changes >= limit) return { ok: false, error: capReached(limit) };
      // counted before it runs, so changes asked for at once cannot all slip under the cap
      changes += 1;
      const counted = request;
      const before = snapshot();
      let outcome: ToolOutcome | null = null;
      try {
        outcome = await call();
        return outcome;
      } finally {
        // refused, failed, or left the model as it was (every brick refused, ids not found, nothing to undo): no change.
        // With calls at once, another call's change can make one that changed nothing count, never the other way
        if ((!outcome?.ok || same(snapshot(), before)) && counted === request) changes -= 1;
      }
    },
  };
}
