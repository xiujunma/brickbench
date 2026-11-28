import { afterAll, describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaudeLookup } from '../claudeCli';
import { ACP_AGENTS, agentSpecs, customAgent, findAgents } from './agents';

const root = mkdtempSync(join(tmpdir(), 'brickbench-acp-agents-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A program that does nothing, in a folder of its own. */
function program(folder: string, name: string): string {
  mkdirSync(folder, { recursive: true });
  const file = join(folder, name);
  writeFileSync(file, '#!/bin/sh\nexit 0\n');
  chmodSync(file, 0o755);
  return file;
}

const lookup = (env: Record<string, string>): ClaudeLookup => ({ env, platform: process.platform, home: join(root, 'home'), cwd: root });

describe('coding agents over ACP', () => {
  it('finds the agents that are here, with the arguments for ACP mode, and offers the rest to install', async () => {
    if (process.platform === 'win32') return;
    // names no real agent has, so what this computer has installed plays no part
    const spec = (id: string, args: readonly string[] = []) => ({ id, name: id, program: `brickbench-test-${id}`, args, install: `install ${id}`, signIn: `sign in to ${id}` });
    const bin = join(root, 'bin');
    const one = program(bin, 'brickbench-test-one');
    // where npm puts programs when nvm runs Node: found even off the PATH
    const two = program(join(root, 'home', '.nvm', 'versions', 'node', 'v24.1.0', 'bin'), 'brickbench-test-two');
    const found = await findAgents(lookup({ PATH: bin }), [spec('one', ['--acp']), spec('two', ['acp']), spec('three')]);
    expect(found.map((agent) => [agent.spec.id, agent.command])).toEqual([
      ['one', [one, '--acp']],
      ['two', [two, 'acp']],
      ['three', null],
    ]);
  });

  it('lists the agents the ACP registry names, each with how to install it and sign in', () => {
    expect(ACP_AGENTS.map((agent) => [agent.id, agent.program, agent.args])).toEqual([
      ['codex', 'codex-acp', []],
      ['gemini', 'gemini', ['--acp']],
      ['opencode', 'opencode', ['acp']],
      ['grok', 'grok', ['agent', 'stdio']],
      ['vibe', 'vibe-acp', []],
    ]);
    expect(ACP_AGENTS.every((agent) => agent.install !== '' && agent.signIn !== '')).toBe(true);
  });

  it('takes one more agent the user names, as a JSON array, and refuses anything else', async () => {
    if (process.platform === 'win32') return;
    const mine = program(join(root, 'mine'), 'my-agent');
    expect(customAgent({})).toBeNull();
    const env = { PATH: '', BRICKBENCH_ACP_COMMAND: JSON.stringify([mine, '--acp', '--quiet']), BRICKBENCH_ACP_NAME: 'Mine' };
    expect(customAgent(env)).toMatchObject({ id: 'custom', name: 'Mine', program: mine, args: ['--acp', '--quiet'] });
    expect(agentSpecs(env).at(-1)).toMatchObject({ id: 'custom', name: 'Mine' });
    expect((await findAgents(lookup(env), agentSpecs(env).slice(-1))).at(-1)).toMatchObject({ spec: { id: 'custom' }, command: [mine, '--acp', '--quiet'] });
    expect(customAgent({ BRICKBENCH_ACP_COMMAND: '["my-agent"]' })).toMatchObject({ name: 'Custom agent', program: 'my-agent', args: [] });
    for (const bad of ['my-agent --acp', '[]', '[""]', '[1,2]', '{"program":"x"}']) {
      expect(() => customAgent({ BRICKBENCH_ACP_COMMAND: bad })).toThrow('BRICKBENCH_ACP_COMMAND must be a JSON array');
    }
  });
});
