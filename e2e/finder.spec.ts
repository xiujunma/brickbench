import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { autosaved, counts, freshEditor, reloadEditor, viewportCentre } from './helpers';

const LIBRARY_BUILT = existsSync('public/ldraw/index.json');

const tiles = (page: Page) => page.locator('.part-tile');
const buildingWith = (page: Page) => page.locator('.inspector-section').filter({ hasText: 'Building with' });

test.describe('finding parts', () => {
  test('builds with a part found in everyday words, straight from the keyboard', async ({ page }) => {
    await freshEditor(page);
    await page.keyboard.press('/');
    await page.keyboard.type('two by four plate');
    await expect(page.locator('.find-hint')).toContainText('Plate 2 × 4');
    await page.keyboard.press('Enter');
    await expect(buildingWith(page)).toContainText('Plate 2 × 4');
    // the search box handed the keyboard to the build area, so editor shortcuts work at once
    await expect(page.locator('#build-area')).toBeFocused();
    await page.keyboard.press('r');
    await expect(buildingWith(page)).toContainText('turned 90°');
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');

    // the next search starts afresh rather than adding to the last one
    await page.keyboard.press('/');
    await page.keyboard.type('cheese');
    await expect(page.locator('#part-search')).toHaveValue('cheese');
    // Enter with nothing typed builds with nothing
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await expect(buildingWith(page)).toContainText('Plate 2 × 4');
  });

  test('builds in the colour a search names', async ({ page }) => {
    await freshEditor(page);
    await page.keyboard.press('/');
    await page.keyboard.type('yellow four by two brick');
    await expect(page.locator('.find-hint')).toContainText('Brick 2 × 4 in Yellow');
    await page.keyboard.press('Enter');
    await expect(buildingWith(page)).toContainText('Brick 2 × 4');
    await expect(page.getByRole('region', { name: 'Colour' }).locator('strong')).toHaveText('Yellow');
  });

  test('finds parts by part pattern, and says why a pattern does not read', async ({ page }) => {
    await freshEditor(page);
    await page.keyboard.press('/');
    await page.keyboard.type('S45[oo/..] :red');
    await expect(page.locator('.find-note')).toContainText('by part pattern');
    await expect(page.locator('.find-hint')).toContainText('Slope 45° 2 × 2 in Red');
    await page.keyboard.press('Enter');
    await expect(buildingWith(page)).toContainText('Slope 45° 2 × 2');
    await expect(page.getByRole('region', { name: 'Colour' }).locator('strong')).toHaveText('Red');

    await page.keyboard.press('/');
    await page.keyboard.type('S45[oo/..');
    await expect(page.locator('.find-note')).toContainText('As a part pattern: A “[” needs its “]” (at character 4).');
  });

  test('moves through results with the arrow keys', async ({ page }) => {
    await freshEditor(page);
    await page.keyboard.press('/');
    await page.keyboard.type('brick 1x');
    await expect(page.locator('.find-hint')).toContainText('Brick 1 × 1');
    const second = await tiles(page).nth(1).getAttribute('title');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.part-tile-wrap.is-highlighted .part-tile')).toHaveAttribute('title', second ?? '');
    await page.keyboard.press('Enter');
    await expect(buildingWith(page)).toContainText((second ?? '').split(' · ')[0] ?? '');
  });

  test('keeps favourites, recent picks and the model’s parts under Mine', async ({ page }) => {
    // starts the editor twice
    test.slow();
    await freshEditor(page);
    await page.getByRole('tab', { name: 'Plates' }).click();
    await page.getByRole('button', { name: 'Favourite Plate 2 × 2', exact: true }).click();
    await page.getByRole('tab', { name: 'Bricks' }).click();
    await page.getByRole('button', { name: 'Brick 1 × 2 3004', exact: true }).click();
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');

    await autosaved(page, 1);
    await reloadEditor(page);
    await expect(page.getByRole('button', { name: 'Mine', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('region', { name: 'Favourites' })).toContainText('Plate 2 × 2');
    await expect(page.getByRole('region', { name: 'Recent' })).toContainText('Brick 1 × 2');
    await expect(page.getByRole('region', { name: 'In this model' })).toContainText('×1');
  });

  test.describe('in the LDraw library', () => {
    test.skip(!LIBRARY_BUILT, 'run `bun run ldraw` to build the library');

    test('narrows thousands of parts with size, height and shape', async ({ page }) => {
      await freshEditor(page);
      await page.getByRole('combobox', { name: 'Part size' }).selectOption('1x2');
      await page.getByRole('combobox', { name: 'Part height' }).selectOption('plate');
      await page.getByRole('combobox', { name: 'Part shape' }).selectOption('clip');
      await expect(tiles(page).first()).toHaveAttribute('title', /^Plate 1 × 2 with .*Clip/);
      expect(await tiles(page).count()).toBeLessThan(20);
      await page.getByRole('button', { name: 'Clear search and filters' }).click();
      await expect(page.getByRole('combobox', { name: 'Part size' })).toHaveValue('');
    });

    test('knows nicknames and forgives typos', async ({ page }) => {
      await freshEditor(page);
      await page.keyboard.press('/');
      await page.keyboard.type('jumper');
      await expect(tiles(page).first()).toHaveAttribute('title', /with 1 Centre Stud/);
      await page.locator('#part-search').fill('hnige');
      await expect(page.locator('.find-note')).toContainText('close spellings');
      await expect(tiles(page).first()).toHaveAttribute('title', /^Hinge/);
    });
  });
});
