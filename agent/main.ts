#!/usr/bin/env bun
/**
 * `bun run agent`: starts the agent bridge, so BrickBench's chat can run an
 * agent (Claude Code, or a model behind an API) and any MCP agent can build
 * in BrickBench. The desktop app runs the same bridge itself.
 *
 * Settings: BRICKBENCH_AGENT_PORT (default 7425), BRICKBENCH_AGENT_ORIGINS
 * (the only pages let in, comma-separated; any page from this computer
 * otherwise), BRICKBENCH_AGENT_PROVIDER (claude, the default, or openai, xai,
 * openrouter, ollama, lmstudio or custom), BRICKBENCH_AGENT_MODEL, and for
 * Claude Code BRICKBENCH_CLAUDE (path to the claude command) and
 * BRICKBENCH_AGENT_BUDGET_USD (per request, default 5, or none); for an API,
 * BRICKBENCH_AGENT_API_KEY_VAR, BRICKBENCH_AGENT_BASE_URL and
 * BRICKBENCH_AGENT_API (chat or responses). See agent/providers.ts.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppLink } from './appLink';
import { startBridge } from './bridge';
import { createChat } from './chatSetup';
import { parseOrigins } from './origins';
import { portOf, readSetting } from './settings';

const NO_CLAUDE =
  'Claude Code is not installed on this computer, so the chat cannot run. Install it from https://code.claude.com, then restart the bridge. Other MCP agents can still connect.';

async function main(): Promise<void> {
  const env = process.env;
  const port = portOf(env);
  const mcpUrl = `http://127.0.0.1:${port}/mcp`;
  const workDir = mkdtempSync(join(tmpdir(), 'brickbench-agent-'));
  const link = createAppLink();
  const { runner, notes } = await createChat({
    lookup: { env, platform: process.platform, home: homedir(), cwd: process.cwd() },
    link,
    mcpUrl,
    workDir,
    noClaude: NO_CLAUDE,
    restart: 'restart the bridge',
  });
  const bridge = startBridge({ runner, link, port, onlyOrigins: parseOrigins(readSetting(env, 'BRICKBENCH_AGENT_ORIGINS')) });
  const agent = runner.status();
  process.stdout.write(
    [
      `BrickBench agent bridge: ${bridge.url}`,
      agent.available ? `  Chat: open BrickBench and click Agent. ${agent.name} answers. ${agent.detail ?? ''}`.trimEnd() : `  Chat unavailable: ${agent.detail ?? ''}`,
      ...notes.map((note) => `  Note: ${note}`),
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
