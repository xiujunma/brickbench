import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { counts, freshEditor, reloadEditor, viewportCentre } from './helpers';

/** The app's autosave key (src/state/persistence.ts). */
const AUTOSAVE_KEY = 'brickbench:autosave:v1';

/** Waits until the autosave holds a sub-assembly of this name. */
async function savedAssembly(page: Page, name: string): Promise<void> {
  await page.waitForFunction(
    ({ key, wanted }) => {
      try {
        const saved = JSON.parse(window.localStorage.getItem(key) ?? 'null') as { instructions?: { assemblies?: { name?: string }[] } } | null;
        return saved?.instructions?.assemblies?.some((a) => a.name === wanted) === true;
      } catch {
        return false;
      }
    },
    { key: AUTOSAVE_KEY, wanted: name },
  );
}

const stepsPanel = (page: Page) => page.getByRole('complementary', { name: 'Instruction steps' });
const position = (page: Page) => stepsPanel(page).getByRole('group', { name: 'Go to a step' }).locator('strong');
const summary = (page: Page) => page.getByTestId('instructions-summary');

async function editSteps(page: Page): Promise<number> {
  await page.getByRole('button', { name: 'Instructions' }).click();
  await page.getByRole('button', { name: 'Edit steps…' }).click();
  await expect(page.getByRole('heading', { name: 'Building instructions' })).toBeHidden();
  await expect(position(page)).toHaveText(/^Step 1 of \d+$/);
  return Number(/of (\d+)/.exec((await position(page).textContent()) ?? '')?.[1]);
}

test.describe('instruction steps', () => {
  test('arranges the steps by hand, and the booklet and the saved model follow them', async ({ page }) => {
    test.slow();
    await freshEditor(page);
    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Open sample cottage' }).click();
    await expect(counts(page)).toHaveText('78 bricks');

    // steps planned automatically until arranged: there are none of the user's yet
    await page.getByRole('button', { name: 'Instructions' }).click();
    await expect(page.getByRole('button', { name: 'Bottom up', pressed: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Your steps' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    const planned = await editSteps(page);

    await page.keyboard.press(']');
    await expect(position(page)).toHaveText(`Step 2 of ${planned}`);
    await stepsPanel(page).getByRole('button', { name: 'Join with the next step' }).click();
    await expect(position(page)).toHaveText(`Step 2 of ${planned - 1}`);
    await page.keyboard.press('[');
    await expect(position(page)).toHaveText(`Step 1 of ${planned - 1}`);

    // every brick into one step, undone
    await page.keyboard.press('Control+a');
    await stepsPanel(page).getByRole('button', { name: 'Move to this step' }).click();
    await expect(position(page)).toHaveText('Step 1 of 1');
    await page.keyboard.press('Control+z');
    await expect(position(page)).toHaveText(`Step 1 of ${planned - 1}`);

    // the whole cottage as a sub-assembly, named, added in the model's one step
    await page.keyboard.press('Control+a');
    await stepsPanel(page).getByRole('button', { name: 'Make a sub-assembly' }).click();
    await expect(position(page)).toHaveText('Step 1 of 1');
    await stepsPanel(page).getByRole('button', { name: 'Open it' }).click();
    const name = stepsPanel(page).getByRole('textbox', { name: 'Sub-assembly' });
    await expect(name).toHaveValue('Sub-assembly 1');
    await expect(position(page)).toHaveText(/^Step 1 of \d+$/);
    const own = Number(/of (\d+)/.exec((await position(page).textContent()) ?? '')?.[1]);
    await name.fill('Cottage');
    await name.press('Enter');
    await stepsPanel(page).getByRole('button', { name: 'Back to the model' }).click();
    await expect(stepsPanel(page).getByText('Adds the sub-assembly Cottage')).toBeVisible();
    // Escape lets go of the selection first, then closes the steps
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Escape');
    await expect(stepsPanel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(stepsPanel(page)).toBeHidden();

    // the booklet: the sub-assembly's pages, then the step adding it
    await page.getByRole('button', { name: 'Instructions' }).click();
    await expect(page.getByRole('button', { name: 'Your steps', pressed: true })).toBeVisible();
    await expect(summary(page)).toHaveText(new RegExp(`^${own + 1} steps · `));
    await page.keyboard.press('Escape');

    await savedAssembly(page, 'Cottage');
    await reloadEditor(page);
    await expect(counts(page)).toHaveText('78 bricks');
    await page.getByRole('button', { name: 'Instructions' }).click();
    await expect(page.getByRole('button', { name: 'Your steps', pressed: true })).toBeVisible();
    await expect(summary(page)).toHaveText(new RegExp(`^${own + 1} steps · `));
  });

  test('draws a sub-assembly on pages of its own', async ({ page }) => {
    test.setTimeout(180_000);
    await freshEditor(page);
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await page.mouse.click(centre.x + 160, centre.y + 60);
    await expect(counts(page)).toHaveText('2 bricks');
    expect(await editSteps(page)).toBe(1);
    await page.keyboard.press('Control+a');
    await stepsPanel(page).getByRole('button', { name: 'Make a sub-assembly' }).click();
    await stepsPanel(page).getByRole('button', { name: 'Make the booklet…' }).click();
    // cover, parts, the sub-assembly's step, the step adding it
    await expect(summary(page)).toHaveText('2 steps · 4 pages');

    const downloadPromise = page.waitForEvent('download', { timeout: 150_000 });
    await page.getByRole('button', { name: 'Make PDF' }).click();
    const pdf = await readFile(await (await downloadPromise).path(), 'latin1');
    expect(pdf.match(/\/Type \/Page(?!s)/g)).toHaveLength(4);
  });
});
