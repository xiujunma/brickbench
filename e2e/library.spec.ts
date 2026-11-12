import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { autosaved, counts, freshEditor, reloadEditor, viewportCentre } from './helpers';

/** Built by `bun run ldraw`; without it only the "not installed" path can be checked. */
const LIBRARY_BUILT = existsSync('public/ldraw/index.json');

test.describe('LDraw parts library', () => {
  test('explains how to install a library that is missing', async ({ page }) => {
    await page.route('**/ldraw/index.json', (route) => route.fulfill({ status: 404, body: 'missing' }));
    await freshEditor(page);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.getByText('The LDraw library is not installed.')).toBeVisible();
    await expect(page.getByText('bun run ldraw')).toBeVisible();
  });

  test('offers to try again when the library cannot be loaded', async ({ page }) => {
    let failures = 1;
    await page.route('**/ldraw/index.json', (route) => (failures-- > 0 ? route.fulfill({ status: 503, body: 'busy' }) : route.continue()));
    await freshEditor(page);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.getByText('The LDraw library could not be loaded.')).toBeVisible();
    test.skip(!LIBRARY_BUILT, 'run `bun run ldraw` to build the library');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('#library-category')).toBeVisible();
  });

  test.describe('installed', () => {
    test.skip(!LIBRARY_BUILT, 'run `bun run ldraw` to build the library');

    test('finds a part, builds with it and keeps it after a reload', async ({ page }) => {
      // starts the editor twice
      test.slow();
      await freshEditor(page);
      await page.getByRole('button', { name: 'Library', exact: true }).click();
      await expect(page.locator('#library-category')).toBeVisible();
      await page.keyboard.press('/');
      await page.keyboard.type('32000');
      const tile = page.locator('.part-tile').first();
      await expect(tile).toHaveAttribute('title', /^Technic Brick 1 × 2 with Holes · LDraw 32000/);
      await tile.click();
      await expect(page.getByText('Building with')).toBeVisible();
      const centre = await viewportCentre(page);
      await page.mouse.click(centre.x, centre.y);
      await expect(counts(page)).toHaveText('1 brick');

      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'File' }).click();
      await page.getByRole('menuitem', { name: 'LDraw model (.ldr)' }).click();
      const ldr = await readFile(await (await downloadPromise).path(), 'utf8');
      expect(ldr).toMatch(/^1 4 .* 32000\.dat$/m);

      await autosaved(page, 1);
      await reloadEditor(page);
      await expect(counts(page)).toHaveText('1 brick');
    });

    test('browses by category and pages through long lists', async ({ page }) => {
      await freshEditor(page);
      await page.getByRole('button', { name: 'Library', exact: true }).click();
      await page.locator('#library-category').selectOption('Technic');
      await expect(page.locator('.part-tile')).toHaveCount(60);
      await expect(page.locator('.part-tile').first()).toHaveAttribute('title', /^Technic /);
      await page.getByRole('button', { name: /^Show 60 more$/ }).click();
      await expect(page.locator('.part-tile')).toHaveCount(120);
    });

    test('opens a saved model that uses library parts', async ({ page }, testInfo) => {
      const path = testInfo.outputPath('library-model.brickbench.json');
      const bricks = [
        { part: 'ldraw:3001', color: 1, x: 0, y: 0, z: 0, r: 0 },
        { part: 'brick-2x2', color: 4, x: 0, y: 3, z: 0, r: 0 },
      ];
      await writeFile(path, JSON.stringify({ format: 'brickbench.model', version: 1, name: 'Mixed', bricks }));
      await freshEditor(page);
      const chooserPromise = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'File' }).click();
      await page.getByRole('menuitem', { name: 'Open…' }).click();
      await (await chooserPromise).setFiles(path);
      await expect(counts(page)).toHaveText('2 bricks');
      await expect(page.getByRole('textbox', { name: 'Model name' })).toHaveValue('Mixed');
    });

    test('keeps a session it could not fully restore, and recovers it later', async ({ page }) => {
      const bricks = [
        { part: 'brick-2x4', color: 4, x: 0, y: 0, z: 0, r: 0 },
        { part: 'ldraw:3001', color: 1, x: 0, y: 3, z: 0, r: 0 },
      ];
      const saved = JSON.stringify({ format: 'brickbench.model', version: 1, name: 'Kept', bricks });
      let libraryDown = true;
      await page.route('**/ldraw/index.json', (route) => (libraryDown ? route.fulfill({ status: 503, body: 'busy' }) : route.continue()));
      await page.goto('/');
      await page.evaluate((text) => {
        window.localStorage.clear();
        window.localStorage.setItem('brickbench:autosave:v1', text);
      }, saved);
      await page.reload();
      await expect(counts(page)).toHaveText('1 brick');
      await expect(page.getByText(/1 brick from your last session could not be restored/)).toBeVisible();

      libraryDown = false;
      await page.getByRole('button', { name: 'File' }).click();
      page.once('dialog', (dialog) => void dialog.accept());
      await page.getByRole('menuitem', { name: 'Recover earlier session' }).click();
      await expect(counts(page)).toHaveText('2 bricks');
      await page.getByRole('button', { name: 'File' }).click();
      await expect(page.getByRole('menuitem', { name: 'Recover earlier session' })).toHaveCount(0);
    });
  });
});
