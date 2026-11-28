import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, type RunningApp } from './launch';
import { AGENT_PORT } from './ports';

/** Two red bricks, stacked, as an LDraw file. */
const WALL = ['0 Little Wall', '1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat', '1 4 0 -48 0 1 0 0 0 1 0 0 0 1 3001.dat'].join('\r\n');

/** The bridge the app runs for its Agent panel, on a port of its own, with a stand-in for Claude Code that builds a tower. */
const AGENT_ENV = {
  BRICKBENCH_AGENT_PORT: String(AGENT_PORT),
  BRICKBENCH_CLAUDE: join(process.cwd(), 'agent', 'fixtures', 'fakeClaude.ts'),
  FAKE_CLAUDE_MODE: 'build',
};

let running: RunningApp;
let app: ElectronApplication;
let page: Page;
let folder: string;

test.beforeAll(async () => {
  running = await launchApp(AGENT_ENV);
  ({ app, page, folder } = running);
});

test.afterAll(async () => {
  await running.close();
});

test('serves BrickBench and its parts library from the app, with no Node in the page', async () => {
  expect(page.url()).toBe('brickbench://app/index.html');
  expect(await page.evaluate(async () => (await fetch('/ldraw/index.json')).ok)).toBe(true);
  expect(await page.evaluate(async () => (await fetch('/ldraw/parts/3001.bin')).ok)).toBe(true);
  expect(await page.evaluate(async () => (await fetch('/ldraw/../../package.json')).status)).toBe(404);
  expect(await page.evaluate(() => [typeof (window as { require?: unknown }).require, typeof (window as { process?: unknown }).process])).toEqual(['undefined', 'undefined']);
  expect(await page.evaluate(() => Object.keys((window as { brickbench?: object }).brickbench ?? {}).sort())).toEqual(['agent', 'onMenuCommand', 'onOpenFile', 'onSaved', 'ready']);
});

// while the model is still empty, so the agent builds on a clear baseplate and leaves it so
test('chats with Claude Code in the Agent panel, with no bridge to start by hand', async () => {
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Agent' });
  await expect(panel.getByRole('status').first()).toHaveText(/Claude Code 0\.0\.0/);
  // agents in a terminal are told where the app's MCP server is
  await expect(panel).toContainText(`claude mcp add --transport http brickbench http://127.0.0.1:${AGENT_PORT}/mcp`);
  const prompt = panel.getByRole('textbox', { name: 'Ask the agent to build something' });
  await prompt.fill('Build a yellow tower');
  await prompt.press('Enter');
  const log = panel.getByRole('log', { name: 'Conversation with the agent' });
  await expect(log).toContainText('Build a yellow tower');
  await expect(log).toContainText('Placing 2 bricks');
  await expect(log).toContainText('Placing 1 brick');
  await expect(log).toContainText('Built a yellow tower of 3 bricks');
  // the reply's markdown shows as formatting, not as asterisks and backticks
  await expect(log.locator('strong')).toHaveText('yellow');
  await expect(log.getByRole('listitem')).toHaveText('3 × brick-2x4, stacked');
  await expect(log.locator('code')).toHaveText('brick-2x4');
  await expect(log).not.toContainText('**');
  await expect(page.getByTestId('status-counts')).toHaveText('3 bricks');
  // the agent built in two steps; one undo takes back the whole request
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('status-counts')).toHaveText('0 bricks');

  // the page's address changing in place (as a share link's does) leaves the agent be: its bridge stays up,
  // where a stopped one would be down until the page reconnected, seconds later
  await page.evaluate(() => {
    history.replaceState(null, '', `${location.pathname}?moved=1`);
    location.hash = 'moved';
  });
  await page.waitForTimeout(300);
  expect((await fetch(`http://127.0.0.1:${AGENT_PORT}/health`)).ok).toBe(true);
  await prompt.fill('Build it again');
  await prompt.press('Enter');
  await expect(log.getByText('Built a yellow tower of 3 bricks')).toHaveCount(2);
  await expect(page.getByTestId('status-counts')).toHaveText('3 bricks');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('status-counts')).toHaveText('0 bricks');
  await page.evaluate(() => history.replaceState(null, '', location.pathname));

  // Esc puts the panel away and the keyboard back on the button that opened it
  await prompt.focus();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Agent', exact: true })).toBeFocused();
});

// the model is empty again, and the agent stays connected with the panel put away
test('lets an agent in a terminal build in the app, and see the model, through MCP', async () => {
  const client = new Client({ name: 'e2e-agent', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${AGENT_PORT}/mcp`)));
  try {
    const placed = await client.callTool({
      name: 'place_bricks',
      arguments: { bricks: [{ part: 'brick-2x4', color: 'Blue', x: 0, y: 0, z: 0 }, { part: 'plate-2x2', color: 'White', x: 0, y: 3, z: 0 }] },
    });
    expect(placed.isError).toBeFalsy();
    await expect(page.getByTestId('status-counts')).toHaveText('2 bricks');

    const look = await client.callTool({ name: 'look', arguments: { view: 'front' } });
    const image = (look.content as { type: string; data?: string; mimeType?: string }[]).find((part) => part.type === 'image');
    expect(image?.mimeType, JSON.stringify(look).slice(0, 600)).toBe('image/jpeg');
    expect(Buffer.from(image?.data ?? '', 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

    const model = await client.callTool({ name: 'get_model', arguments: {} });
    expect(JSON.parse((model.content as { text: string }[])[0]?.text ?? '{}')).toMatchObject({ brick_count: 2 });
  } finally {
    await client.close();
  }
  // one call, one step to undo
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('status-counts')).toHaveText('0 bricks');
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
