import { describe, expect, it } from 'bun:test';
import type { AgentEvent } from '../src/agent/protocol';
import { unavailableRunner } from './chat';

describe('a chat that cannot run here', () => {
  it('says why, at once and every time it is asked, and has nothing to stop', () => {
    const runner = unavailableRunner('Claude Code is not installed.');
    expect(runner.status()).toEqual({ available: false, name: 'No agent', detail: 'Claude Code is not installed.' });
    const events: AgentEvent[] = [];
    runner.start('Build a tower', true, (event) => void events.push(event));
    expect(events).toEqual([{ type: 'done', ok: false, error: 'Claude Code is not installed.' }]);
    expect(runner.running).toBe(false);
    expect(() => runner.stop()).not.toThrow();
  });
});
