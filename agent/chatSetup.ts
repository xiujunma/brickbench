/**
 * The agent behind the app's chat, set up from the environment: a model
 * behind an API if one is chosen, else Claude Code if it is installed, else
 * a runner that says why the chat cannot run. The desktop app runs the
 * bridge and sets this up when its Agent panel connects.
 */
import { createApiRunner } from './api/apiRunner';
import { chatCompletions } from './api/chatCompletions';
import { responsesApi } from './api/responses';
import type { AppLink } from './appLink';
import { unavailableRunner, type ChatRunner } from './chat';
import { claudeEnv, claudeVersion, findClaude, findClaudeShim, type ClaudeLookup } from './claudeCli';
import { createClaudeRunner, writeMcpConfig, type McpServerAccess } from './claudeRunner';
import { chooseAgent, type ApiSettings } from './providers';
import { budgetOf, readSetting } from './settings';

export interface ChatSetup {
  /** The environment, and where to look for Claude Code. */
  readonly lookup: ClaudeLookup;
  /** Runs the tools in BrickBench, for a model behind an API. */
  readonly link: Pick<AppLink, 'call'>;
  /** The bridge's MCP server, which Claude Code builds through, and the token the chat's agent shows it. */
  readonly mcp: McpServerAccess;
  /** An empty folder for Claude Code to run in. */
  readonly workDir: string;
  /** What the chat says when Claude Code is not installed: how to try again differs in a terminal and in the app. */
  readonly noClaude: string;
  /** How to try again once a setting is put right, as in "restart the bridge". */
  readonly restart: string;
}

export interface Chat {
  readonly runner: ChatRunner;
  /** For the user, when the bridge starts. */
  readonly notes: readonly string[];
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

/** Throws on a setting that is malformed, so whoever starts the bridge can say which. */
export async function createChat(setup: ChatSetup): Promise<Chat> {
  const choice = chooseAgent(setup.lookup.env, setup.restart);
  if (choice.kind === 'unavailable') return { runner: unavailableRunner(choice.reason), notes: [] };
  if (choice.kind === 'api') return { runner: apiRunner(choice.settings, setup.link), notes: choice.notes };
  return { runner: await claudeRunner(setup), notes: [] };
}
