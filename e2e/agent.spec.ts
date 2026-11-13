import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test, type Page } from '@playwright/test';
import { counts, freshEditor } from './helpers';
import { AGENT_PORT } from './ports';

/** The app, talking to the test bridge. */
const WITH_BRIDGE = `/?agentPort=${AGENT_PORT}`;
const agentPanel = (page: Page) => page.getByRole('complementary', { name: 'Agent' });

async function openAgent(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(agentPanel(page).getByRole('status').first()).toHaveText(/Claude Code 0\.0\.0/);
}

test.describe('building with an agent', () => {
  // one bridge serves every tab, and calls go to the tab used last: these tests take turns
  test.describe.configure({ mode: 'serial' });

  test('builds what the user asks for in the chat, as one step to undo', async ({ page }) => {
    await freshEditor(page, WITH_BRIDGE);
    await openAgent(page);
    const prompt = agentPanel(page).getByRole('textbox', { name: 'Ask the agent to build something' });
    await prompt.fill('Build a yellow tower');
    await prompt.press('Enter');
    const log = agentPanel(page).getByRole('log', { name: 'Conversation with the agent' });
    await expect(log).toContainText('Build a yellow tower');
    await expect(log).toContainText('Placing 2 bricks');
    await expect(log).toContainText('Placing 1 brick');
    await expect(log).toContainText('Built a yellow tower of 3 bricks.');
    await expect(counts(page)).toHaveText('3 bricks');
    // the agent built in two steps; one undo takes back the whole request
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(counts(page)).toHaveText('0 bricks');

    // Esc puts the panel away and the keyboard back on the button that opened it
    await prompt.focus();
    await page.keyboard.press('Escape');
    await expect(agentPanel(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Agent', exact: true })).toBeFocused();
  });

  test('lets an agent in a terminal build, and see the model, through MCP', async ({ page }) => {
    await freshEditor(page, WITH_BRIDGE);
    // opening the panel once connects this tab to the bridge
    await openAgent(page);
    const client = new Client({ name: 'e2e-agent', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${AGENT_PORT}/mcp`)));
    try {
      const placed = await client.callTool({
        name: 'place_bricks',
        arguments: { bricks: [{ part: 'brick-2x4', color: 'Blue', x: 0, y: 0, z: 0 }, { part: 'plate-2x2', color: 'White', x: 0, y: 3, z: 0 }] },
      });
      expect(placed.isError).toBeFalsy();
      await expect(counts(page)).toHaveText('2 bricks');

      const look = await client.callTool({ name: 'look', arguments: { view: 'front' } });
      const image = (look.content as { type: string; data?: string; mimeType?: string }[]).find((part) => part.type === 'image');
      expect(image?.mimeType, JSON.stringify(look).slice(0, 600)).toBe('image/jpeg');
      expect(Buffer.from(image?.data ?? '', 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

      const model = await client.callTool({ name: 'get_model', arguments: {} });
      expect(JSON.parse((model.content as { text: string }[])[0]?.text ?? '{}')).toMatchObject({ brick_count: 2 });
    } finally {
      await client.close();
    }
  });

  test('explains how to start the bridge when it is not running', async ({ page }) => {
    // nothing listens on this port
    await freshEditor(page, '/?agentPort=7498');
    await page.getByRole('button', { name: 'Agent', exact: true }).click();
    await expect(agentPanel(page)).toContainText('Start the agent bridge');
    await expect(agentPanel(page)).toContainText('bun run agent');
    await expect(agentPanel(page).getByRole('textbox', { name: 'Ask the agent to build something' })).toBeDisabled();
  });
});
