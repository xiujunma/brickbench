import { defineConfig } from '@playwright/test';
import { FAKE_MODEL_PORT } from './e2e-desktop/ports';

/**
 * Tests of the desktop app (Electron), apart from the browser tests because
 * they need it built first: `bun run e2e:desktop` builds it, then runs them.
 * The agent works only in the desktop app, so its tests are here.
 */
export default defineConfig({
  testDir: 'e2e-desktop',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  webServer: [
    {
      // a stand-in for a model behind an API, as GPT and Grok are, that builds a small wall
      command: 'bun agent/fixtures/fakeModelApi.ts',
      url: `http://127.0.0.1:${FAKE_MODEL_PORT}/health`,
      reuseExistingServer: false,
      env: { FAKE_MODEL_PORT: String(FAKE_MODEL_PORT) },
    },
  ],
});
