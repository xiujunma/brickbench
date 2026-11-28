import { describe, expect, it } from 'bun:test';
import type { AgentEvent } from '../src/agent/protocol';
import type { ChatRunner } from './chat';
import { createChooser, type AgentEntry } from './chooser';

/** A runner that says who it is, works until finished, and keeps whether it was closed. */
function scripted(name: string) {
  let emit: ((event: AgentEvent) => void) | null = null;
  const state = { closed: 0 };
  const runner: ChatRunner = {
    status: () => ({ available: true, name }),
    get running() {
      return emit !== null;
    },
    start: (_prompt, _fresh, onEvent) => {
      emit = onEvent;
      onEvent({ type: 'started' });
    },
    stop: () => {
      const done = emit;
      emit = null;
      done?.({ type: 'done', ok: false, error: 'Stopped.' });
    },
    close: () => void (state.closed += 1),
  };
  return { runner, state, finish: () => runner.stop() };
}

const entry = (id: string, made: ChatRunner, ready = true): AgentEntry => ({ option: { id, name: id, ready, ...(ready ? {} : { detail: `install ${id}` }) }, make: () => made });

describe('choosing the chat’s agent', () => {
  it('starts with the agent asked for, and offers every one, with how to install those that are not here', async () => {
    const claude = scripted('Claude Code');
    const codex = scripted('Codex');
    const chooser = await createChooser({ entries: [entry('claude', claude.runner), entry('codex', codex.runner), entry('vibe', scripted('Vibe').runner, false)], first: 'codex' });
    expect(chooser.choices()).toEqual({
      chosen: 'codex',
      options: [
        { id: 'claude', name: 'claude', ready: true },
        { id: 'codex', name: 'codex', ready: true },
        { id: 'vibe', name: 'vibe', ready: false, detail: 'install vibe' },
      ],
    });
    expect(chooser.runner.status().name).toBe('Codex');
  });

  it('starts with the agent asked for even when it cannot run here, so the chat says why, or the first when it is not offered', async () => {
    const entries = [entry('claude', scripted('Claude Code').runner), entry('vibe', scripted('Vibe').runner, false)];
    expect((await createChooser({ entries, first: 'vibe' })).choices().chosen).toBe('vibe');
    expect((await createChooser({ entries, first: 'gone' })).choices().chosen).toBe('claude');
    await expect(createChooser({ entries: [], first: 'claude' })).rejects.toThrow('No agent');
  });

  it('switches agents between requests, never during one, and remembers the choice', async () => {
    const claude = scripted('Claude Code');
    const codex = scripted('Codex');
    const remembered: string[] = [];
    const chooser = await createChooser({
      entries: [entry('claude', claude.runner), entry('codex', codex.runner), entry('vibe', scripted('Vibe').runner, false)],
      first: 'claude',
      remember: async (id) => void remembered.push(id),
    });
    const events: AgentEvent[] = [];
    chooser.runner.start('Build', true, (event) => void events.push(event));
    expect(chooser.runner.running).toBe(true);
    expect(await chooser.choose('codex')).toBe(false);
    claude.finish();
    expect(await chooser.choose('codex')).toBe(true);
    expect(chooser.runner.status().name).toBe('Codex');
    expect(claude.state.closed).toBe(1);
    expect(remembered).toEqual(['codex']);
    // not here, or not offered: nothing changes
    expect(await chooser.choose('vibe')).toBe(false);
    expect(await chooser.choose('gone')).toBe(false);
    // the same one again is no change at all
    expect(await chooser.choose('codex')).toBe(true);
    expect(remembered).toEqual(['codex']);
    chooser.runner.close?.();
    expect(codex.state.closed).toBe(1);
  });

  it('gives up an agent made while a request started', async () => {
    const claude = scripted('Claude Code');
    const codex = scripted('Codex');
    let chooser: Awaited<ReturnType<typeof createChooser>> | null = null;
    const late: AgentEntry = {
      option: { id: 'codex', name: 'Codex', ready: true },
      make: () => {
        // the user asks for something while the agent is being started
        chooser?.runner.start('Build', true, () => undefined);
        return codex.runner;
      },
    };
    chooser = await createChooser({ entries: [entry('claude', claude.runner), late], first: 'claude' });
    expect(await chooser.choose('codex')).toBe(false);
    expect(codex.state.closed).toBe(1);
    expect(chooser.choices().chosen).toBe('claude');
    expect(chooser.runner.status().name).toBe('Claude Code');
  });

  it('switches all the same when the choice cannot be remembered', async () => {
    const chooser = await createChooser({
      entries: [entry('claude', scripted('Claude Code').runner), entry('codex', scripted('Codex').runner)],
      first: 'claude',
      remember: () => Promise.reject(new Error('disk full')),
    });
    expect(await chooser.choose('codex')).toBe(true);
    expect(chooser.choices().chosen).toBe('codex');
  });
});
