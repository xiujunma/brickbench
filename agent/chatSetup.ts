/**
 * The agents behind the app's chat, set up when the desktop app's Agent
 * panel connects: Claude Code, a model behind an API when the environment
 * names one, and the coding agents on this computer that speak the Agent
 * Client Protocol. The Agent panel chooses among them (agent/chooser.ts);
 * the choice is remembered in the app's folder for the bridge.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { createAcpRunner } from './acp/acpRunner';
import { agentSpecs, findAgents, type AcpAgentSpec, type FoundAgent } from './acp/agents';
import type { StdioMcpServer } from './acp/schema';
import { createApiRunner } from './api/apiRunner';
import { chatCompletions } from './api/chatCompletions';
import { responsesApi } from './api/responses';
import type { AppLink } from './appLink';
import { unavailableRunner, type ChatRunner } from './chat';
import { createChooser, type AgentEntry, type Chooser } from './chooser';
import { claudeEnv, claudeVersion, findClaude, findClaudeShim, type ClaudeLookup } from './claudeCli';
import { createClaudeRunner, writeMcpConfig, type McpServerAccess } from './claudeRunner';
import { API_INSTRUCTIONS } from './guide';
import { chooseAgent, type ApiSettings } from './providers';
import { budgetOf, readSetting } from './settings';

/** How agents over ACP reach BrickBench's tools, or why they cannot run here. */
export type AcpSetup = { readonly mcpServer: StdioMcpServer } | { readonly unavailable: string };

export interface ChatSetup {
  /** The environment, and where to look for Claude Code and the other agents. */
  readonly lookup: ClaudeLookup;
  /** Runs the tools in BrickBench, for a model behind an API. */
  readonly link: Pick<AppLink, 'call'>;
  /** The bridge's MCP server, which Claude Code builds through, and the token the chat's agent shows it. */
  readonly mcp: McpServerAccess;
  /** An empty folder for the agents to run in. */
  readonly workDir: string;
  /** What the chat says when Claude Code is not installed: how to try again differs in a terminal and in the app. */
  readonly noClaude: string;
  /** How to try again once a setting is put right, as in "restart the bridge". */
  readonly restart: string;
  /** BrickBench's MCP server as agents over ACP start it; without it they cannot run here. */
  readonly acp?: AcpSetup;
  /** The agents over ACP to look for: the listed ones and the user's own unless a test says otherwise. */
  readonly acpAgents?: readonly AcpAgentSpec[];
  /** The app's folder for the bridge, where the chosen agent is remembered; without it, it is not. */
  readonly folder?: string;
}

export interface Chat {
  /** The chosen agent's runner. */
  readonly runner: ChatRunner;
  /** For the user, when the bridge starts. */
  readonly notes: readonly string[];
  readonly chooser: Chooser;
}

const CHOICE_FILE = 'chat.json';
const choiceSchema = z.object({ agent: z.string().max(40) });

/** The agent chosen last time, or null. */
async function rememberedChoice(folder: string | undefined): Promise<string | null> {
  if (folder === undefined) return null;
  try {
    const parsed = choiceSchema.safeParse(JSON.parse(await readFile(join(folder, CHOICE_FILE), 'utf8')));
    return parsed.success ? parsed.data.agent : null;
  } catch {
    // never chosen, or not readable: as if never chosen
    return null;
  }
}

function apiRunner(settings: ApiSettings, link: Pick<AppLink, 'call'>): ChatRunner {
  return createApiRunner({
    label: settings.label,
    baseUrl: settings.baseUrl,
    model: settings.model,
    format: settings.api === 'responses' ? responsesApi : chatCompletions,
    // the same tools Claude Code reaches through MCP, run in the same tab
    tools: (tool, input) => link.call(tool, input),
    apiKey: settings.apiKey,
    keyVariable: settings.keyVariable,
    local: settings.local,
  });
}

async function claudeRunner(setup: ChatSetup): Promise<ChatRunner> {
  const { lookup } = setup;
  const command = await findClaude(lookup);
  if (!command) {
    const shim = await findClaudeShim(lookup);
    if (!shim) return unavailableRunner(setup.noClaude);
    return unavailableRunner(
      `Claude Code is installed through npm here (${shim}), which BrickBench cannot start. Install it with Claude Code's own installer (https://code.claude.com), then ${setup.restart}.`,
    );
  }
  const answer = await claudeVersion(command, lookup);
  if ('failure' in answer) return unavailableRunner(`Claude Code is at ${command}, but it did not start: ${answer.failure}`);
  return createClaudeRunner({
    command: [command],
    mcpConfig: await writeMcpConfig(setup.workDir, setup.mcp),
    workDir: setup.workDir,
    name: `Claude Code ${answer.version}`,
    model: readSetting(lookup.env, 'BRICKBENCH_AGENT_MODEL'),
    maxBudgetUsd: budgetOf(lookup.env),
    env: claudeEnv(command, lookup),
  });
}

/** An agent over ACP as the panel offers it: ready when it is here and BrickBench's server for it is in place. */
function acpEntry(found: FoundAgent, setup: ChatSetup): AgentEntry {
  const { spec, command } = found;
  const notReady = (detail: string): AgentEntry => ({ option: { id: spec.id, name: spec.name, ready: false, detail }, make: () => unavailableRunner(detail) });
  if (!command) return notReady(spec.install ? `Not installed. Install it with: ${spec.install}` : `${spec.program} was not found.`);
  const acp = setup.acp;
  if (!acp || 'unavailable' in acp) return notReady(acp?.unavailable ?? 'Agents over ACP cannot run here.');
  const [program = ''] = command;
  return {
    option: { id: spec.id, name: spec.name, ready: true },
    make: () =>
      createAcpRunner({
        name: spec.name,
        command,
        env: claudeEnv(program, setup.lookup),
        workDir: setup.workDir,
        mcpServer: acp.mcpServer,
        instructions: API_INSTRUCTIONS,
        signIn: spec.signIn,
      }),
  };
}

/** Throws on a setting that is malformed, so whoever starts the bridge can say which. */
export async function createChat(setup: ChatSetup): Promise<Chat> {
  const { env } = setup.lookup;
  const choice = chooseAgent(env, setup.restart);
  const specs = setup.acpAgents ?? agentSpecs(env);
  const claude = await claudeRunner(setup);
  const claudeStatus = claude.status();
  const entries: AgentEntry[] = [
    {
      option: { id: 'claude', name: 'Claude Code', ready: claudeStatus.available, ...(claudeStatus.available ? {} : { detail: claudeStatus.detail ?? setup.noClaude }) },
      make: () => claude,
    },
  ];
  if (choice.kind === 'api') {
    entries.push({ option: { id: 'api', name: `${choice.settings.label} · ${choice.settings.model}`, ready: true }, make: () => apiRunner(choice.settings, setup.link) });
  } else if (choice.kind === 'unavailable') {
    // asked for, but set up wrong: chosen all the same, so the chat says what is missing
    entries.push({ option: { id: 'api', name: 'Model behind an API', ready: true }, make: () => unavailableRunner(choice.reason) });
  }
  for (const found of await findAgents(setup.lookup, specs)) entries.push(acpEntry(found, setup));
  // the environment's choice wins; else the last one made in the panel
  const asked = readSetting(env, 'BRICKBENCH_AGENT_PROVIDER') !== undefined;
  const first = asked ? (choice.kind === 'claude' ? 'claude' : 'api') : ((await rememberedChoice(setup.folder)) ?? 'claude');
  const { folder } = setup;
  const chooser = await createChooser({
    entries,
    first,
    ...(folder === undefined ? {} : { remember: (id: string) => writeFile(join(folder, CHOICE_FILE), JSON.stringify({ agent: id })) }),
  });
  return { runner: chooser.runner, notes: choice.kind === 'api' ? choice.notes : [], chooser };
}
