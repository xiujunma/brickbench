import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { autosaved, counts, freshEditor, reloadEditor, viewportCentre } from './helpers';

test.describe('building', () => {
  test('places a brick, then undoes and redoes it', async ({ page }) => {
    await freshEditor(page);
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');
    await page.keyboard.press('Control+z');
    await expect(counts(page)).toHaveText('0 bricks');
    await page.keyboard.press('Control+Shift+z');
    await expect(counts(page)).toHaveText('1 brick');
  });

  test('stacks a second brick on top of the first', async ({ page }) => {
    await freshEditor(page);
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    // aiming at the brick's front face puts the preview beside it, on the ground
    await expect(page.locator('.status-coords')).toContainText('Y0');
    // move up the screen until the cursor is over the top face: the preview rests three plates up
    let onTop = false;
    for (let dy = 4; dy <= 120 && !onTop; dy += 4) {
      await page.mouse.move(centre.x, centre.y - dy);
      onTop = ((await page.locator('.status-coords').textContent()) ?? '').includes('Y3');
    }
    expect(onTop).toBe(true);
    await page.mouse.down();
    await page.mouse.up();
    await expect(counts(page)).toHaveText('2 bricks');
  });

  test('builds with the chosen part and colour', async ({ page }) => {
    await freshEditor(page);
    await page.getByRole('tab', { name: 'Plates' }).click();
    await page.getByRole('button', { name: /^Plate 2 × 2\b/ }).click();
    await page.getByRole('button', { name: 'Blue', exact: true }).click();
    await expect(page.getByText('Building with')).toBeVisible();
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');
    await page.getByRole('button', { name: 'Parts list' }).click();
    const table = page.locator('.parts-table');
    await expect(table).toContainText('Plate 2 × 2');
    await expect(table).toContainText('Blue');
    await expect(table).toContainText('3022');
  });

  test('finds parts by search', async ({ page }) => {
    await freshEditor(page);
    await page.keyboard.press('/');
    await page.keyboard.type('cheese');
    // the built-in cheese slopes come first; library variants may follow
    await expect(page.locator('.part-tile').nth(0)).toHaveAttribute('title', /^Slope 30° 1 × 1 × 2\/3/);
    await expect(page.locator('.part-tile').nth(1)).toHaveAttribute('title', /^Slope 30° 1 × 2 × 2\/3/);
  });
});

test.describe('editing', () => {
  test('selects, nudges and deletes a brick', async ({ page }) => {
    await freshEditor(page);
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.press('v');
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick · 1 selected');
    await page.keyboard.press('ArrowRight');
    await expect(counts(page)).toHaveText('1 brick · 1 selected');
    await page.keyboard.press('Delete');
    await expect(counts(page)).toHaveText('0 bricks');
  });

  test('drags a brick to a new spot and undoes the move', async ({ page }) => {
    await freshEditor(page);
    const centre = await viewportCentre(page);
    const coords = page.locator('.status-coords');
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.press('v');
    await page.mouse.move(centre.x, centre.y + 2);
    const before = await coords.textContent();
    expect(before).toMatch(/X/);

    await page.mouse.down();
    await page.mouse.move(centre.x + 160, centre.y + 50, { steps: 10 });
    await page.mouse.up();
    await expect(counts(page)).toHaveText('1 brick · 1 selected');
    await page.mouse.move(centre.x + 160, centre.y + 52);
    await expect(coords).not.toHaveText(before ?? '');

    await page.keyboard.press('Control+z');
    await page.mouse.move(centre.x, centre.y + 2);
    await expect(coords).toHaveText(before ?? '');
  });

  test('copies and pastes a brick', async ({ page }) => {
    await freshEditor(page);
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+d');
    await expect(page.locator('.paste-banner')).toBeVisible();
    await page.mouse.click(centre.x + 160, centre.y + 60);
    await expect(counts(page)).toHaveText('2 bricks · 1 selected');
  });
});

test.describe('files', () => {
  test('saves a model and opens it again', async ({ page }) => {
    await freshEditor(page);
    page.on('dialog', (dialog) => void dialog.accept());
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);

    const downloadPromise = page.waitForEvent('download');
    await page.keyboard.press('Control+s');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('untitled-model.brickbench.json');
    const path = await download.path();
    const saved = JSON.parse(await readFile(path, 'utf8')) as { format: string; bricks: unknown[] };
    expect(saved.format).toBe('brickbench.model');
    expect(saved.bricks).toHaveLength(1);

    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'New model' }).click();
    await expect(counts(page)).toHaveText('0 bricks');

    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Open…' }).click();
    await (await chooserPromise).setFiles(path);
    await expect(counts(page)).toHaveText('1 brick');
  });

  test('asks before opening a file over the current model', async ({ page }) => {
    await freshEditor(page);
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    const downloadPromise = page.waitForEvent('download');
    await page.keyboard.press('Control+s');
    const path = await (await downloadPromise).path();
    await page.mouse.click(centre.x + 160, centre.y + 60);
    await expect(counts(page)).toHaveText('2 bricks');

    const openFile = async (answer: 'accept' | 'dismiss') => {
      const chooserPromise = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'File' }).click();
      await page.getByRole('menuitem', { name: 'Open…' }).click();
      const confirmPromise = page.waitForEvent('dialog');
      await (await chooserPromise).setFiles(path);
      const confirm = await confirmPromise;
      expect(confirm.message()).toContain('will be replaced');
      await (answer === 'accept' ? confirm.accept() : confirm.dismiss());
    };
    await openFile('dismiss');
    await expect(counts(page)).toHaveText('2 bricks');
    await openFile('accept');
    await expect(counts(page)).toHaveText('1 brick');
  });

  test('exports an LDraw file', async ({ page }) => {
    await freshEditor(page);
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'LDraw model (.ldr)' }).click();
    const text = await readFile(await (await downloadPromise).path(), 'utf8');
    expect(text).toMatch(/^1 4 .* 3001\.dat$/m);
  });

  test('keeps the model after a reload', async ({ page }) => {
    // starts the editor twice
    test.slow();
    await freshEditor(page);
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Open sample cottage' }).click();
    await expect(counts(page)).toHaveText('78 bricks');
    await autosaved(page, 78);
    await reloadEditor(page);
    await expect(counts(page)).toHaveText('78 bricks');
    await expect(page.getByRole('textbox', { name: 'Model name' })).toHaveValue('Garden cottage');
  });
});

test.describe('building instructions', () => {
  const pageObjects = (pdf: string) => pdf.match(/\/Type \/Page(?!s)/g) ?? [];

  test('makes a PDF booklet from the model panel', async ({ page }) => {
    test.setTimeout(180_000);
    await freshEditor(page);
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await page.mouse.click(centre.x + 160, centre.y + 60);
    await expect(counts(page)).toHaveText('2 bricks');
    await page.getByRole('button', { name: 'Instructions' }).click();
    await expect(page.getByTestId('instructions-summary')).toHaveText('1 step · 3 pages');

    const downloadPromise = page.waitForEvent('download', { timeout: 150_000 });
    await page.getByRole('button', { name: 'Make PDF' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('untitled-model-instructions.pdf');
    const pdf = await readFile(await download.path(), 'latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pageObjects(pdf)).toHaveLength(3);
    await expect(page.getByRole('heading', { name: 'Building instructions' })).toBeHidden();
  });

  test('keeps going through a double-click and a stray shortcut', async ({ page }) => {
    test.setTimeout(180_000);
    await freshEditor(page);
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await page.getByRole('button', { name: 'Instructions' }).click();
    const downloadPromise = page.waitForEvent('download', { timeout: 150_000 });
    await page.getByRole('button', { name: 'Make PDF' }).dblclick();
    await page.keyboard.press('?');
    await downloadPromise;
    await expect(page.getByText('Building instructions saved to your downloads.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mouse & keyboard' })).toBeHidden();
  });

  test('stops making a booklet when asked', async ({ page }) => {
    test.setTimeout(180_000);
    await freshEditor(page);
    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Open sample cottage' }).click();
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: /Building instructions/ }).click();
    await page.getByRole('button', { name: '3', exact: true }).click();
    await page.getByRole('button', { name: 'Make PDF' }).click();
    await expect(page.getByRole('progressbar')).toBeVisible();
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByText('Stopped making the instructions.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Make PDF' })).toBeEnabled();
  });
});

test.describe('interface', () => {
  test('lets open menus own the keyboard', async ({ page }) => {
    await freshEditor(page);
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.press('Control+a');
    await expect(counts(page)).toHaveText('1 brick · 1 selected');
    await page.getByRole('button', { name: 'File' }).click();
    const menu = page.getByRole('menu', { name: 'File' });
    await expect(menu).toBeVisible();
    await page.keyboard.press('Delete');
    await page.keyboard.press('e');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(counts(page)).toHaveText('1 brick · 1 selected');
    await expect(page.getByRole('button', { name: 'Select & move' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('opens and closes the help', async ({ page }) => {
    await freshEditor(page);
    await page.keyboard.press('?');
    await expect(page.getByRole('heading', { name: 'Mouse & keyboard' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Mouse & keyboard' })).toBeHidden();
  });

  test('fits a phone screen without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshEditor(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: 'Show parts' }).click();
    await expect(page.getByRole('button', { name: /^Brick 2 × 4\b/ })).toBeInViewport();
  });
});
