import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import { API_AGENT_PORT, CHAT_AGENT_PORT, FAKE_MODEL_PORT } from './ports';

test.describe('building with a model behind an API', () => {
  for (const [api, port] of [
    ['responses', API_AGENT_PORT],
    ['chat', CHAT_AGENT_PORT],
  ] as const) {
    test(`runs the tool calls in the chat, shows the model its picture, and is one step to undo (${api})`, async () => {
      // an app of its own, since the chat's settings are read when the app opens
      test.slow();
      const running = await launchApp({
        BRICKBENCH_AGENT_PORT: String(port),
        BRICKBENCH_AGENT_PROVIDER: 'custom',
        BRICKBENCH_AGENT_BASE_URL: `http://127.0.0.1:${FAKE_MODEL_PORT}/v1`,
        BRICKBENCH_AGENT_API: api,
        BRICKBENCH_AGENT_MODEL: `fake-${api}`,
      });
      const { page } = running;
      try {
        await page.getByRole('button', { name: 'Agent', exact: true }).click();
        const panel = page.getByRole('complementary', { name: 'Agent' });
        // a custom API is named by its address
        await expect(panel.getByRole('status').first()).toHaveText(`127.0.0.1:${FAKE_MODEL_PORT} · fake-${api}`);
        const prompt = panel.getByRole('textbox', { name: 'Ask the agent to build something' });
        await prompt.fill('Build a red wall');
        await prompt.press('Enter');
        const log = panel.getByRole('log', { name: 'Conversation with the agent' });
        await expect(log).toContainText('Placing 2 bricks');
        await expect(log).toContainText('Looking at the model from the front');
        // the picture BrickBench drew reached the model, and the model's reasoning went back to it each round; drawing it
        // under software graphics takes a while
        await expect(log).toContainText('Built a red wall of 2 bricks. I was shown 1 picture.', { timeout: 30_000 });
        await expect(log).toContainText('3 turns');
        await expect(page.getByTestId('status-counts')).toHaveText('2 bricks');
        await page.getByRole('button', { name: 'Undo' }).click();
        await expect(page.getByTestId('status-counts')).toHaveText('0 bricks');
      } finally {
        await running.close();
      }
    });
  }
});
