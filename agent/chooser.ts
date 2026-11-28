/**
 * Which agent answers the app's chat, chosen in the Agent panel: Claude
 * Code, a model behind an API when one is set up, or a coding agent over the
 * Agent Client Protocol. The chosen agent's runner answers for all of them,
 * so the bridge holds one runner; a choice is remembered for next time.
 */
import type { ChatRunner } from './chat';

/** One agent, as the panel offers it. */
export interface AgentOption {
  readonly id: string;
  readonly name: string;
  /** Whether it can run here: installed, and set up. */
  readonly ready: boolean;
  /** For one that cannot: how to install it, or why not. */
  readonly detail?: string;
}

export interface AgentChoices {
  readonly chosen: string;
  readonly options: readonly AgentOption[];
}

/** An agent to offer, and how to make its runner once it is chosen. */
export interface AgentEntry {
  readonly option: AgentOption;
  readonly make: () => ChatRunner | Promise<ChatRunner>;
}

export interface Chooser {
  /** The chosen agent's runner, as one: it answers for whichever is chosen. */
  readonly runner: ChatRunner;
  choices(): AgentChoices;
  /** Chooses another agent, unless one is at work or that one cannot run here, and remembers it; says whether it did. */
  choose(id: string): Promise<boolean>;
}

export interface ChooserOptions {
  readonly entries: readonly AgentEntry[];
  /** The agent to start with if it is offered, ready or not (one that cannot run here says why); else the first. */
  readonly first: string;
  /** Keeps a choice for next time; a failure to keep it changes nothing now. */
  readonly remember?: (id: string) => Promise<void>;
}

export async function createChooser(options: ChooserOptions): Promise<Chooser> {
  const { entries } = options;
  const firstEntry = entries.find((e) => e.option.id === options.first) ?? entries[0];
  if (!firstEntry) throw new Error('No agent to offer the chat.');
  let chosen: AgentEntry = firstEntry;
  let current: ChatRunner = await chosen.make();

  const runner: ChatRunner = {
    status: () => current.status(),
    get running() {
      return current.running;
    },
    start: (prompt, fresh, onEvent, extra) => current.start(prompt, fresh, onEvent, extra),
    stop: () => current.stop(),
    close: () => current.close?.(),
  };

  return {
    runner,
    choices: () => ({ chosen: chosen.option.id, options: entries.map((e) => e.option) }),
    async choose(id) {
      const next = entries.find((e) => e.option.id === id);
      if (!next?.option.ready || current.running) return false;
      if (next === chosen) return true;
      const made = await next.make();
      // a request may have started while it was being made
      if (current.running) {
        made.close?.();
        return false;
      }
      current.close?.();
      current = made;
      chosen = next;
      await options.remember?.(id).catch(() => undefined);
      return true;
    },
  };
}
