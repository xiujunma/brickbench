#!/usr/bin/env bun
/**
 * `bun run agent`: starts the agent bridge, so BrickBench's chat can run
 * Claude Code and any MCP agent can build in BrickBench.
 *
 * Settings: BRICKBENCH_AGENT_PORT (default 7425), BRICKBENCH_AGENT_ORIGINS
 * (the only pages let in, comma-separated; any page from this computer
 * otherwise), BRICKBENCH_CLAUDE (path to the claude command),
 * BRICKBENCH_AGENT_MODEL and BRICKBENCH_AGENT_BUDGET_USD (per request,
 * default 5, or none).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_PORT, startBridge } from './bridge';
import { unavailableRunner, type ChatRunner } from './chat';
import { createClaudeRunner } from './claudeRunner';
import { parseOrigins } from './origins';

const VERSION_TIMEOUT_MS = 10_000;
/** The most one chat request may spend unless the user says otherwise: enough for a big build, not a runaway. */
const DEFAULT_BUDGET_USD = 5;
const NO_CLAUDE =
  'Claude Code is not installed on this computer, so the chat cannot run. Install it from https://code.claude.com, then restart the bridge. Other MCP agents can still connect.';

function setting(name: string): string | undefined {
  const value = Bun.env[name]?.trim();
  return value ? value : undefined;
}

function portSetting(): number {
  const value = setting('BRICKBENCH_AGENT_PORT');
  if (value === undefined) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`BRICKBENCH_AGENT_PORT must be a port number, not "${value}".`);
  return port;
}

function budgetSetting(): number | undefined {
  const value = setting('BRICKBENCH_AGENT_BUDGET_USD');
  if (value === undefined) return DEFAULT_BUDGET_USD;
  if (value.toLowerCase() === 'none') return undefined;
  const budget = Number(value);
  if (!(budget > 0)) throw new Error(`BRICKBENCH_AGENT_BUDGET_USD must be a positive amount or "none", not "${value}".`);
  return budget;
}

/** "2.1.323" from `claude --version`, or null if it does not answer. */
async function versionOf(command: string): Promise<string | null> {
  try {
    const process = Bun.spawn([command, '--version'], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
    const timer = setTimeout(() => process.kill(), VERSION_TIMEOUT_MS);
    const output = await new Response(process.stdout).text();
    clearTimeout(timer);
    return (await process.exited) === 0 ? (output.trim().split(/\s+/)[0] ?? null) : null;
  } catch {
    // not runnable: the caller says Claude Code is missing
    return null;
  }
}

/** The claude command: BRICKBENCH_CLAUDE (a path, or a name on PATH) or claude itself, as an absolute path. */
function claudeCommand(): string | null {
  const chosen = setting('BRICKBENCH_CLAUDE');
  // the runner starts it from another folder, so a relative path must be made absolute first
  if (chosen && /[\\/]/.test(chosen)) return resolve(chosen);
  return Bun.which(chosen ?? 'claude');
}

async function chatRunner(mcpUrl: string, workDir: string): Promise<ChatRunner> {
  const command = claudeCommand();
  const version = command ? await versionOf(command) : null;
  if (!command || version === null) return unavailableRunner(NO_CLAUDE);
  return createClaudeRunner({
    command: [command],
    mcpUrl,
    workDir,
    name: `Claude Code ${version}`,
    model: setting('BRICKBENCH_AGENT_MODEL'),
    maxBudgetUsd: budgetSetting(),
  });
}

async function main(): Promise<void> {
  const port = portSetting();
  const mcpUrl = `http://127.0.0.1:${port}/mcp`;
  const workDir = mkdtempSync(join(tmpdir(), 'brickbench-agent-'));
  const runner = await chatRunner(mcpUrl, workDir);
  const bridge = startBridge({ runner, port, onlyOrigins: parseOrigins(setting('BRICKBENCH_AGENT_ORIGINS')) });
  const agent = runner.status();
  process.stdout.write(
    [
      `BrickBench agent bridge: ${bridge.url}`,
      agent.available ? `  Chat: open BrickBench and click Agent. ${agent.name} answers, with your login.` : `  Chat unavailable: ${agent.detail ?? ''}`,
      '  Build from Claude Code in any terminal after adding the server once:',
      `    claude mcp add --transport http brickbench ${mcpUrl}`,
      '  Press Ctrl+C to stop.',
      '',
    ].join('\n'),
  );
  const shutdown = (): void => {
    void bridge.stop().finally(() => {
      rmSync(workDir, { recursive: true, force: true });
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
