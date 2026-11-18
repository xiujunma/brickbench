import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/** Two red bricks, stacked, as an LDraw file. */
const WALL = ['0 Little Wall', '1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat', '1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3001.dat'].join('\r\n');

/** A packaged app to test instead of the built one, e.g. release/mac-arm64/BrickBench.app/Contents/MacOS/BrickBench. */
const PACKAGED = process.env['BRICKBENCH_DESKTOP_APP'];

let app: ElectronApplication;
let page: Page;
let folder: string;

test.beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'brickbench-desktop-'));
  // a profile of its own, so the test starts empty and leaves the real app's storage alone
  const profile = `--user-data-dir=${join(folder, 'profile')}`;
  app = await electron.launch(
    PACKAGED ? { executablePath: PACKAGED, args: [profile] } : { args: ['.desktop', profile], env: { ...process.env, BRICKBENCH_WEB_ROOT: 'dist' } },
  );
  page = await app.firstWindow();
  await expect(page.locator('canvas.viewport-canvas')).toBeVisible({ timeout: 60_000 });
});

test.afterAll(async () => {
  await app.close();
  await rm(folder, { recursive: true, force: true });
});

test('serves BrickBench and its parts library from the app, with no Node in the page', async () => {
  expect(page.url()).toBe('brickbench://app/index.html');
  expect(await page.evaluate(async () => (await fetch('/ldraw/index.json')).ok)).toBe(true);
  expect(await page.evaluate(async () => (await fetch('/ldraw/parts/3001.bin')).ok)).toBe(true);
  expect(await page.evaluate(async () => (await fetch('/ldraw/../../package.json')).status)).toBe(404);
  expect(await page.evaluate(() => [typeof (window as { require?: unknown }).require, typeof (window as { process?: unknown }).process])).toEqual(['undefined', 'undefined']);
  expect(await page.evaluate(() => Object.keys((window as { brickbench?: object }).brickbench ?? {}).sort())).toEqual(['onMenuCommand', 'onOpenFile', 'onSaved', 'ready']);
});

test('opens a model file handed over by the desktop, as Finder does', async () => {
  const path = join(folder, 'wall.ldr');
  await writeFile(path, WALL);
  await app.evaluate(({ app: electronApp }, file) => electronApp.emit('open-file', { preventDefault: () => undefined }, file), path);
  await expect(page.getByText('Opened “Little Wall”: all 2 parts came in.')).toBeVisible();
  await expect(page.getByTestId('status-counts')).toHaveText('2 bricks');
});

test('carries out commands from the app menu', async () => {
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('help')?.click());
  await expect(page.getByRole('dialog', { name: 'Mouse & keyboard' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('says where a saved model went, as the Save dialog chose', async () => {
  const saves = join(folder, 'saves');
  await mkdir(saves);
  // stands in for the person choosing a folder in the Save dialog
  await app.evaluate(({ session }, dir) => {
    session.defaultSession.once('will-download', (_event, item) => item.setSavePath(`${dir}/${item.getFilename()}`));
  }, saves);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('save')?.click());

  await expect(page.getByText('Saved “little-wall.brickbench.json” in saves.')).toBeVisible();
  await expect(page.getByText('Model saved to your downloads.')).toHaveCount(0);
  expect(JSON.parse(await readFile(join(saves, 'little-wall.brickbench.json'), 'utf8'))).toMatchObject({ format: 'brickbench.model', name: 'Little Wall' });
});

test('says nothing when the save is cancelled', async () => {
  await app.evaluate(({ session }) => {
    session.defaultSession.once('will-download', (_event, item) => item.cancel());
  });
  const toasts = page.locator('.toast');
  const before = await toasts.count();
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('export-ldraw')?.click());
  await page.waitForTimeout(800);
  await expect(page.getByText(/^Saved “little-wall\.ldr”|Exported LDraw file\./)).toHaveCount(0);
  expect(await toasts.count()).toBeLessThanOrEqual(before);
});

// last: Playwright keeps waiting for the navigation the app blocks, which would hold up later tests
test('stays on BrickBench when the page tries to go elsewhere', async () => {
  await page.evaluate(() => {
    window.location.href = 'https://example.com/';
  });
  await page.waitForTimeout(500);
  expect(page.url()).toBe('brickbench://app/index.html');
});
