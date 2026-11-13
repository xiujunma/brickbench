/** Connecting this tab to the agent bridge: where it is, when to connect, and remembering that. */
import type { AgentLink } from './link';

export const AGENT_PORT = 7425;
/** Set once the bridge has answered, so later visits reconnect by themselves. */
export const REMEMBER_KEY = 'brickbench:agent:v1';

/** The bridge on this computer: the default port, or ?agentPort= in the page's address. */
export function bridgeUrl(search: string): string {
  const asked = Number(new URLSearchParams(search).get('agentPort'));
  const port = Number.isInteger(asked) && asked >= 1024 && asked <= 65_535 ? asked : AGENT_PORT;
  return `ws://127.0.0.1:${port}/app`;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** This browser's storage, or null where it is blocked. */
export function agentStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // blocked by the browser: the agent works, it just is not remembered
    return null;
  }
}

/** Where focus events come from: the window. */
interface FocusTarget {
  addEventListener(type: 'focus', listener: () => void): void;
  removeEventListener(type: 'focus', listener: () => void): void;
}

interface StartDeps {
  readonly link: Pick<AgentLink, 'store' | 'connect' | 'markActive'>;
  readonly storage: Storage | null;
  readonly target: FocusTarget;
}

function remembered(storage: Storage | null): boolean {
  try {
    return storage?.getItem(REMEMBER_KEY) === 'on';
  } catch {
    // storage blocked: the panel still connects when opened
    return false;
  }
}

/**
 * Reconnects at start-up if the agent was used here before; remembers the
 * first connection; and tells the bridge whenever this tab comes to the front.
 */
export function startAgent(deps: StartDeps): () => void {
  const { link, storage, target } = deps;
  if (remembered(storage)) link.connect();
  const unsubscribe = link.store.subscribe((state, previous) => {
    if (state.status !== 'connected' || previous.status === 'connected') return;
    try {
      storage?.setItem(REMEMBER_KEY, 'on');
    } catch {
      // storage full or blocked: next visit connects when the panel opens
    }
  });
  const onFocus = (): void => link.markActive();
  target.addEventListener('focus', onFocus);
  return () => {
    unsubscribe();
    target.removeEventListener('focus', onFocus);
  };
}

/** Stops connecting, now and on later visits, until the panel connects again. */
export function forgetAgent(link: Pick<AgentLink, 'disconnect'>, storage: Storage | null): void {
  link.disconnect();
  try {
    storage?.removeItem(REMEMBER_KEY);
  } catch {
    // storage blocked: nothing was remembered
  }
}
