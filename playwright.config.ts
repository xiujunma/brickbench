import { defineConfig, devices } from '@playwright/test';
import { API_PORT, APP_PORT as PORT } from './e2e/ports';

const CI = Boolean(process.env['CI']);

/** The agent works only in the desktop app: its tests are in e2e-desktop (playwright.desktop.config.ts). */
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
      // its /api requests go to the test API below
      env: { BRICKBENCH_API: `http://127.0.0.1:${API_PORT}` },
    },
    {
      // accounts and the gallery, kept in memory for as long as the tests run; test sign-in is on, and "moderator" moderates
      command: 'bun server/local.ts',
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: false,
      env: { BRICKBENCH_API_PORT: String(API_PORT), BRICKBENCH_API_DB: ':memory:', BRICKBENCH_ADMINS: 'test:moderator' },
    },
  ],
});
