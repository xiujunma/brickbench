import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
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

    // to buy them: in each catalogue's numbers, where blue is BrickLink's 7 and Rebrickable's 1
    const buy = async (item: string): Promise<string> => {
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Buy these parts' }).click();
      await page.getByRole('menuitem', { name: item }).click();
      return readFile(await (await downloadPromise).path(), 'utf8');
    };
    expect(await buy('BrickLink wanted list (.xml)')).toContain('<ITEMID>3022</ITEMID>\n    <COLOR>7</COLOR>\n    <MINQTY>1</MINQTY>');
    expect(await buy('Rebrickable parts list (.csv)')).toBe('Part,Color,Quantity\r\n3022,1,1\r\n');
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

  test('shares a model by link, which opens a copy in another browser', async ({ page, browser }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await freshEditor(page);
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Copy share link' }).click();
    await expect(page.getByText('Link copied.')).toBeVisible();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\/#model=1\.[A-Za-z0-9_-]+$/);

    // another browser, with nothing of its own to replace: the model opens straight away, and the link leaves the address
    const elsewhere = await browser.newContext();
    try {
      const other = await elsewhere.newPage();
      await freshEditor(other, link);
      await expect(counts(other)).toHaveText('1 brick');
      await expect(other.getByText(/^Opened the shared model/)).toBeVisible();
      expect(new URL(other.url()).hash).toBe('');
    } finally {
      await elsewhere.close();
    }
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

  test('says what it keeps and whose trademarks are whose, from the parts panel and the help', async ({ page }) => {
    await freshEditor(page);
    const about = page.getByRole('dialog', { name: 'About BrickBench' });
    await expect(page.locator('.panel-footer')).toContainText('Not made or endorsed by the LEGO Group');
    await page.getByRole('button', { name: 'About & privacy' }).click();
    await expect(about).toContainText('There are no accounts');
    await expect(about).toContainText('LEGO® is a trademark of the LEGO Group, which does not sponsor, authorise or endorse BrickBench.');
    await expect(about.getByRole('link', { name: 'Everyone who made them' })).toHaveAttribute('href', /ldraw\/CREDITS\.txt$/);
    await page.keyboard.press('Escape');
    await expect(about).toBeHidden();

    // the button, not ?: the store hears that a dialog closed a moment after Escape hides it, and ? waits for no dialog
    await page.getByRole('button', { name: 'Help and shortcuts' }).click();
    await page.getByRole('button', { name: 'About BrickBench, privacy and credits' }).click();
    await expect(page.getByRole('heading', { name: 'Mouse & keyboard' })).toBeHidden();
    await expect(about).toBeVisible();
  });

  test('is served under the hosted site’s security policy', async ({ page }) => {
    test.skip(!process.env['CI'], 'the policy comes with the production build, which only CI serves to the tests');
    const response = await page.goto('/');
    expect(response?.headers()['content-security-policy']).toContain("default-src 'self'");
    expect(response?.headers()['x-frame-options']).toBe('DENY');
  });

  test('turns ambient occlusion on from the Scene menu, draws PNGs with it, and remembers it', async ({ page }) => {
    test.slow();
    await freshEditor(page);
    const occlusion = page.getByRole('menuitemcheckbox', { name: /Ambient occlusion/ });
    await page.getByRole('button', { name: 'Scene' }).click();
    // the browser tests draw WebGL on the CPU, where it starts off
    await expect(occlusion).toHaveAttribute('aria-checked', 'false');
    await occlusion.click();
    await expect(occlusion).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Image (.png)' }).click();
    const png = await readFile(await (await downloadPromise).path());
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    await reloadEditor(page);
    await page.getByRole('button', { name: 'Scene' }).click();
    await expect(occlusion).toHaveAttribute('aria-checked', 'true');
  });

  test('starts a photo of the view, and stops when asked', async ({ page }) => {
    test.slow();
    await freshEditor(page);
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Photo (.png)…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Photo' });
    // path tracing a whole photo on the CPU, as the tests draw, takes far too long: start, then stop
    await dialog.getByRole('button', { name: 'Make photo' }).click();
    await expect(dialog.getByRole('progressbar')).toBeVisible();
    await dialog.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByText('Stopped making the photo.')).toBeVisible({ timeout: 180_000 });
    await expect(dialog.getByRole('button', { name: 'Make photo' })).toBeVisible();
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
