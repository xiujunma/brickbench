import { expect, test, type Page } from './fixtures';
import { freshEditor } from './helpers';
import { APP_PORT } from './ports';

const agentPanel = (page: Page) => page.getByRole('complementary', { name: 'Agent' });

test.describe('the agent on a web page', () => {
  test('points to the desktop app, and never reaches for an agent on this computer', async ({ page }) => {
    const sockets: string[] = [];
    page.on('websocket', (socket) => void sockets.push(socket.url()));
    // as for a visitor who used the agent here before it moved to the desktop app: that page reconnected by itself on later visits
    await page.addInitScript(() => localStorage.setItem('brickbench:agent:v1', 'on'));
    await freshEditor(page);
    await page.getByRole('button', { name: 'Agent', exact: true }).click();
    const panel = agentPanel(page);
    await expect(panel).toContainText('The agent works in the desktop app');
    const about = panel.getByRole('link', { name: 'About the desktop app' });
    await expect(about).toHaveAttribute('href', 'https://github.com/xiujunma/brickbench#desktop-app');
    await expect(panel.getByRole('textbox')).toHaveCount(0);
    // nothing connects anywhere, the dev server's own socket aside (tests outside CI run against the dev server)
    expect(sockets.filter((url) => !url.startsWith(`ws://127.0.0.1:${APP_PORT}/`))).toEqual([]);

    // Esc puts the panel away and the keyboard back on the button that opened it
    await about.focus();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Agent', exact: true })).toBeFocused();
  });
});
