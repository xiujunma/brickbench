import { defineConfig, devices } from '@playwright/test';
import { AGENT_PORT, API_AGENT_PORT, APP_PORT as PORT, CHAT_AGENT_PORT, FAKE_MODEL_PORT } from './e2e/ports';

const CI = Boolean(process.env['CI']);

/**
 * The chat's settings for a test bridge, every one given, so none comes from
 * the shell running the tests: a provider set there would have the tests talk
 * to a real model, and spend money.
 */
const agentSettings = (settings: Readonly<Record<string, string>>): Record<string, string> => ({
  BRICKBENCH_AGENT_PROVIDER: 'claude',
  BRICKBENCH_AGENT_MODEL: '',
  BRICKBENCH_AGENT_BASE_URL: '',
  BRICKBENCH_AGENT_API: '',
  BRICKBENCH_AGENT_API_KEY_VAR: '',
  BRICKBENCH_AGENT_BUDGET_USD: '',
  BRICKBENCH_AGENT_ORIGINS: '',
  ...settings,
});

/** A test bridge whose chat runs the stand-in model, over one wire format. */
const modelBridge = (port: number, api: 'responses' | 'chat') => ({
  command: 'bun agent/main.ts',
  url: `http://127.0.0.1:${port}/health`,
  reuseExistingServer: false,
  env: agentSettings({
    BRICKBENCH_AGENT_PORT: String(port),
    BRICKBENCH_AGENT_PROVIDER: 'custom',
    BRICKBENCH_AGENT_BASE_URL: `http://127.0.0.1:${FAKE_MODEL_PORT}/v1`,
    BRICKBENCH_AGENT_API: api,
    BRICKBENCH_AGENT_MODEL: `fake-${api}`,
  }),
});

export default defineConfig({
  testDir: 'e2e',
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: CI,
  // CI machines have two cores and no GPU: one test at a time, more time each, one retry
  // (reported as "flaky"), and stop early when everything fails the same way
  timeout: CI ? 120_000 : 60_000,
  retries: CI ? 1 : 0,
  workers: CI ? 1 : undefined,
  maxFailures: CI ? 3 : 0,
  reporter: CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        // software WebGL so the 3D view also runs on CI machines without a GPU
        launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
      },
    },
  ],
  webServer: [
    {
      // CI tests the production build (`vite build` runs first): far less work per page than the dev server
      command: `bunx --bun vite ${CI ? 'preview' : ''} --port ${PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !CI,
    },
    {
      // the agent bridge, with a stand-in for Claude Code that builds a small tower through MCP
      command: 'bun agent/main.ts',
      url: `http://127.0.0.1:${AGENT_PORT}/health`,
      reuseExistingServer: false,
      env: agentSettings({
        BRICKBENCH_AGENT_PORT: String(AGENT_PORT),
        BRICKBENCH_CLAUDE: 'agent/fixtures/fakeClaude.ts',
        FAKE_CLAUDE_MODE: 'build',
      }),
    },
    {
      // a stand-in for a model behind an API, as GPT and Grok are, that builds a small wall
      command: 'bun agent/fixtures/fakeModelApi.ts',
      url: `http://127.0.0.1:${FAKE_MODEL_PORT}/health`,
      reuseExistingServer: false,
      env: { FAKE_MODEL_PORT: String(FAKE_MODEL_PORT) },
    },
    // bridges whose chat runs that model, over each wire format
    modelBridge(API_AGENT_PORT, 'responses'),
    modelBridge(CHAT_AGENT_PORT, 'chat'),
  ],
});
