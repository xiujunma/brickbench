import { defineConfig } from '@playwright/test';

/**
 * Tests of the desktop app (Electron), apart from the browser tests because
 * they need it built first: `bun run e2e:desktop` builds it, then runs them.
 */
export default defineConfig({
  testDir: 'e2e-desktop',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
