import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';

/** A packaged app to test instead of the built one, e.g. release/mac-arm64/BrickBench.app/Contents/MacOS/BrickBench. */
const PACKAGED = process.env['BRICKBENCH_DESKTOP_APP'];

/** The chat's settings, every one given, so none comes from the shell running the tests: one set there could reach a real model, and spend money. */
const NO_CHAT_SETTINGS: Readonly<Record<string, string>> = {
  BRICKBENCH_AGENT_PROVIDER: 'claude',
  BRICKBENCH_AGENT_MODEL: '',
  BRICKBENCH_AGENT_BASE_URL: '',
  BRICKBENCH_AGENT_API: '',
  BRICKBENCH_AGENT_API_KEY_VAR: '',
  BRICKBENCH_AGENT_BUDGET_USD: '',
};

export interface RunningApp {
  readonly app: ElectronApplication;
  readonly page: Page;
  /** A folder of its own, for its profile and the test's files. */
  readonly folder: string;
  close(): Promise<void>;
}

/**
 * Opens the desktop app with `settings` in its environment and a profile of
 * its own, so it starts empty and leaves the real app's storage alone, then
 * waits for its 3D view.
 */
export async function launchApp(settings: Readonly<Record<string, string>>): Promise<RunningApp> {
  const folder = await mkdtemp(join(tmpdir(), 'brickbench-desktop-'));
  const profile = `--user-data-dir=${join(folder, 'profile')}`;
  // this process's environment without its unset variables, as Electron takes it
  const inherited = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const env = { ...inherited, ...NO_CHAT_SETTINGS, ...settings };
  const app = await electron.launch(PACKAGED ? { executablePath: PACKAGED, args: [profile], env } : { args: ['.desktop', profile], env: { ...env, BRICKBENCH_WEB_ROOT: 'dist' } });
  const page = await app.firstWindow();
  await expect(page.locator('canvas.viewport-canvas')).toBeVisible({ timeout: 60_000 });
  return {
    app,
    page,
    folder,
    close: async () => {
      await app.close();
      await rm(folder, { recursive: true, force: true });
    },
  };
}
