import { expect, test, type Page } from './fixtures';
import { autosaved, counts, freshEditor, reloadEditor, viewportCentre } from './helpers';

/** A set's parts as Rebrickable exports them: 3023 is a number LDraw moved to 3023b, 5903 a part it lacks. */
const SET_CSV = ['Part,Color,Quantity', '3001,4,2', '3023,15,3', '5903,85,1'].join('\r\n');

/** The app's key for the parts lists (src/state/inventory.ts); e2e code stays out of the app's modules. */
const INVENTORY_KEY = 'brickbench:owned-parts:v1';

const ownedTile = (page: Page, name: RegExp) => page.getByRole('list', { name: 'Parts you own' }).getByRole('button', { name });

test.describe('building with the parts you own', () => {
  test('adds a set, counts what is left while building, and remembers it', async ({ page }) => {
    test.slow();
    await freshEditor(page);
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Your parts…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Your parts' });
    const chooser = page.waitForEvent('filechooser');
    await dialog.getByRole('button', { name: 'Add a parts list…' }).click();
    await (await chooser).setFiles({ name: '42693-1.csv', mimeType: 'text/csv', buffer: Buffer.from(SET_CSV) });

    await expect(page.getByText('Added 5 parts from “42693-1”. 1 more is not in BrickBench yet.')).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('42693-1');
    await expect(dialog).toContainText('5 parts to build with');
    await dialog.getByText('1 part is not in BrickBench yet').click();
    await expect(dialog.locator('.owned-unmatched')).toContainText('5903');
    await dialog.getByRole('button', { name: 'One copy more' }).click();
    await expect(dialog).toContainText('10 parts to build with');
    await dialog.getByRole('button', { name: 'Close' }).click();

    // Mine shows each part of the set in its colour, with how many are left
    await page.getByRole('button', { name: 'Mine', exact: true }).click();
    await expect(ownedTile(page, /^Brick 2 × 4/)).toContainText('4 left');
    await expect(ownedTile(page, /^Plate 1 × 2/)).toContainText('6 left');
    await ownedTile(page, /^Brick 2 × 4/).click();
    await expect(page.getByText('4 of your 4 left in Red.')).toBeVisible();

    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');
    await expect(page.getByText('3 of your 4 left in Red.')).toBeVisible();
    await expect(ownedTile(page, /^Brick 2 × 4/)).toContainText('3 left');

    await page.getByRole('button', { name: 'Parts list' }).click();
    await expect(page.locator('.parts-table').getByRole('columnheader', { name: 'Missing' })).toBeVisible();
    await expect(page.getByText(/all in your parts/)).toBeVisible();
    await page.keyboard.press('Escape');

    await autosaved(page, 1);
    await reloadEditor(page);
    await expect(ownedTile(page, /^Brick 2 × 4/)).toContainText('3 left');
  });

  test('keeps a search to the parts you own', async ({ page }) => {
    await page.addInitScript(
      ({ key, value }) => window.localStorage.setItem(key, value),
      {
        key: INVENTORY_KEY,
        value: JSON.stringify({
          lists: [{ id: 'set', name: 'My set', catalogue: 'rebrickable', copies: 1, lots: [{ part: '3001', colour: 4, quantity: 5 }], unmatched: [] }],
        }),
      },
    );
    await freshEditor(page);
    await page.keyboard.press('/');
    await page.keyboard.type('2x4');
    await expect(page.locator('.part-tile').nth(1)).toBeVisible();
    await page.getByRole('button', { name: 'Owned' }).click();
    await expect(page.locator('.part-tile')).toHaveCount(1);
    // tiles show the default colour, red, which the set has five of
    await expect(page.locator('.part-tile').first()).toContainText('5 left');
  });
});
