/**
 * Coding agents the chat can run over the Agent Client Protocol: each one's
 * program and arguments for ACP mode, as the ACP registry has them
 * (agentclientprotocol/registry, November 2026), how to install it and how
 * to sign in to it; which of them are on this computer; and one more the
 * user names in BRICKBENCH_ACP_COMMAND.
 */
import { findProgram, type ClaudeLookup } from '../claudeCli';
import { readSetting, type Environment } from '../settings';

export interface AcpAgentSpec {
  /** For the choice to be remembered by, such as "codex". */
  readonly id: string;
  readonly name: string;
  /** The program, by name (looked for as Claude Code is) or as a path. */
  readonly program: string;
  /** Its arguments for ACP mode. */
  readonly args: readonly string[];
  /** How to install it, shown when it is not here; empty for one the user named. */
  readonly install: string;
  /** How to sign in to it, shown when it says it needs that. */
  readonly signIn: string;
}

export const ACP_AGENTS: readonly AcpAgentSpec[] = [
  {
    id: 'codex',
    name: 'Codex',
    program: 'codex-acp',
    args: [],
    install: 'npm install -g @agentclientprotocol/codex-acp',
    signIn: 'Sign in to Codex (codex login), or open BrickBench with OPENAI_API_KEY set',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    program: 'gemini',
    args: ['--acp'],
    install: 'npm install -g @google/gemini-cli',
    signIn: 'Run gemini once in a terminal to sign in, or open BrickBench with GEMINI_API_KEY set',
  },
  { id: 'opencode', name: 'OpenCode', program: 'opencode', args: ['acp'], install: 'npm install -g @opencode/cli', signIn: 'Run opencode --login in a terminal' },
  {
    id: 'grok',
    name: 'Grok Build',
    program: 'grok',
    args: ['agent', 'stdio'],
    install: 'npm install -g @xai-official/grok',
    signIn: 'Run grok login in a terminal, or open BrickBench with XAI_API_KEY set',
  },
  { id: 'vibe', name: 'Mistral Vibe', program: 'vibe-acp', args: [], install: 'uv tool install --python 3.14 mistral-vibe', signIn: 'Run vibe --setup in a terminal' },
];

/** An agent, and the command that starts it here; null when it is not on this computer. */
export interface FoundAgent {
  readonly spec: AcpAgentSpec;
  readonly command: readonly string[] | null;
}

const COMMAND_SETTING = 'BRICKBENCH_ACP_COMMAND';

/**
 * The agent the user names in BRICKBENCH_ACP_COMMAND, as a JSON array of the
 * program and its arguments (["/opt/agent/bin/agent","--acp"]), with
 * BRICKBENCH_ACP_NAME as its name; null when there is none. Throws on one
 * that is not such an array, so whoever opens the app hears which.
 */
export function customAgent(env: Environment): AcpAgentSpec | null {
  const value = readSetting(env, COMMAND_SETTING);
  if (value === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((part): part is string => typeof part === 'string' && part !== '')) {
    throw new Error(`${COMMAND_SETTING} must be a JSON array of the agent's program and its arguments, such as ["/opt/agent/bin/agent","--acp"].`);
  }
  const [program = '', ...args] = parsed;
  const name = readSetting(env, 'BRICKBENCH_ACP_NAME')?.slice(0, 40) ?? 'Custom agent';
  return { id: 'custom', name, program, args, install: '', signIn: `Sign in to ${name} as it says` };
}

/** The agents to offer, in order: the listed ones, then the user's own if they named one. */
export function agentSpecs(env: Environment): readonly AcpAgentSpec[] {
  const custom = customAgent(env);
  return custom ? [...ACP_AGENTS, custom] : ACP_AGENTS;
}

/** Each agent, and whether it is here. */
export async function findAgents(lookup: ClaudeLookup, specs: readonly AcpAgentSpec[] = agentSpecs(lookup.env)): Promise<FoundAgent[]> {
  return Promise.all(
    specs.map(async (spec): Promise<FoundAgent> => {
      const program = await findProgram(spec.program, lookup);
      return { spec, command: program === null ? null : [program, ...spec.args] };
    }),
  );
}
