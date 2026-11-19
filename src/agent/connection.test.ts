import { describe, expect, it } from 'bun:test';
import { createStore } from 'zustand/vanilla';
import type { AgentLinkState } from './link';
import { bridgeUrl, forgetAgent, REMEMBER_KEY, startAgent } from './connection';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

function fakeLink() {
  const store = createStore<AgentLinkState>(() => ({ status: 'off', agent: null, mcpUrl: null }));
  const calls: string[] = [];
  return { store, calls, connect: () => void calls.push('connect'), markActive: () => void calls.push('active'), disconnect: () => void calls.push('disconnect') };
}

function fakeWindow() {
  const listeners = new Map<string, () => void>();
  return {
    listeners,
    addEventListener: (type: string, listener: () => void) => void listeners.set(type, listener),
    removeEventListener: (type: string) => void listeners.delete(type),
  };
}

describe('the agent in the app', () => {
  it('finds the bridge on this computer', () => {
    expect(bridgeUrl('')).toBe('ws://127.0.0.1:7425/app');
    expect(bridgeUrl('?agentPort=7499')).toBe('ws://127.0.0.1:7499/app');
    expect(bridgeUrl('?agentPort=80')).toBe('ws://127.0.0.1:7425/app');
    expect(bridgeUrl('?agentPort=lots')).toBe('ws://127.0.0.1:7425/app');
  });

  it('reconnects on later visits once the bridge has answered', () => {
    const link = fakeLink();
    const storage = memory();
    const target = fakeWindow();
    const stop = startAgent({ link, storage, target });
    expect(link.calls).toEqual([]);
    link.store.setState({ status: 'connected' });
    expect(storage.data.get(REMEMBER_KEY)).toBe('on');

    const again = fakeLink();
    startAgent({ link: again, storage, target: fakeWindow() });
    expect(again.calls).toEqual(['connect']);
    stop();
    expect(target.listeners.size).toBe(0);
  });

  it('tells the bridge when this tab comes to the front', () => {
    const link = fakeLink();
    const target = fakeWindow();
    startAgent({ link, storage: null, target });
    target.listeners.get('focus')?.();
    expect(link.calls).toEqual(['active']);
  });

  it('forgets the agent when asked, and copes with blocked storage', () => {
    const storage = memory({ [REMEMBER_KEY]: 'on' });
    const link = fakeLink();
    forgetAgent(link, storage);
    expect(link.calls).toEqual(['disconnect']);
    expect(storage.data.has(REMEMBER_KEY)).toBe(false);
    const blocked = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
      removeItem: (): void => {
        throw new Error('blocked');
      },
    };
    const quiet = fakeLink();
    startAgent({ link: quiet, storage: blocked, target: fakeWindow() });
    quiet.store.setState({ status: 'connected' });
    forgetAgent(quiet, blocked);
    expect(quiet.calls).toEqual(['disconnect']);
  });
});
