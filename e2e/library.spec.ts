import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from './fixtures';
import { autosaved, chooseLibraryPart, counts, freshEditor, reloadEditor, savedBricks, spotsAround, viewportCentre } from './helpers';

/** Opens a model file through File › Open…. */
async function openModelFile(page: Page, path: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Open…' }).click();
  await (await chooserPromise).setFiles(path);
}

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

    test('builds half a stud over on a jumper plate, keeps it there and gives it back to LDraw there', async ({ page }, testInfo) => {
      // starts the editor and opens a model
      test.slow();
      await freshEditor(page);
      page.on('dialog', (dialog) => void dialog.accept());
      await page.getByRole('button', { name: 'Library', exact: true }).click();
      await expect(page.locator('#library-category')).toBeVisible();
      const choose = async (number: string): Promise<void> => {
        const search = page.getByRole('searchbox').first();
        await search.fill(number);
        const tile = page.locator('.part-tile').first();
        await expect(tile).toHaveAttribute('title', new RegExp(`LDraw ${number}\\b`));
        await tile.click();
      };
      await choose('3794b');
      const centre = await viewportCentre(page);
      await page.mouse.click(centre.x, centre.y);
      await expect(counts(page)).toHaveText('1 brick');

      // up the screen onto the jumper's top, where a 1 × 1 plate's preview sits a plate up, half a stud over
      await choose('3024');
      const coords = page.locator('.status-coords');
      let dy = 0;
      for (let step = 2; step <= 80; step += 2) {
        await page.mouse.move(centre.x, centre.y - step);
        if (/Y1(?!\d)/.test((await coords.textContent()) ?? '')) {
          dy = step;
          break;
        }
      }
      expect(dy).toBeGreaterThan(0);
      await expect(coords).toContainText('.5');
      await page.mouse.click(centre.x, centre.y - dy);
      await expect(counts(page)).toHaveText('2 bricks');

      /** The jumper and the plate on it, once the autosave holds both under the model's name. */
      const saved = async (name: string) => {
        await autosaved(page, 2);
        const handle = await page.waitForFunction((wanted) => {
          const model = JSON.parse(window.localStorage.getItem('brickbench:autosave:v1') ?? '{}') as { name?: string; bricks?: { x: number; z: number }[] };
          return model.name === wanted ? model.bricks : undefined;
        }, name);
        return (await handle.jsonValue()) as { x: number; z: number }[];
      };
      const [jumper, plate] = await saved('Untitled model');
      // the plate's one cell is centred on the jumper's stud, between the jumper's two cells
      expect((plate?.x ?? 0) - (jumper?.x ?? 0)).toBe(0.5);
      expect(plate?.z).toBe(jumper?.z);

      // in LDraw, the plate stands right on the jumper's centre
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'File' }).click();
      await page.getByRole('menuitem', { name: 'LDraw model (.ldr)' }).click();
      const ldr = await readFile(await (await downloadPromise).path(), 'utf8');
      const where = (number: string) => /^1 \d+ (\S+) \S+ (\S+) .* (\S+)\.dat$/m.exec(ldr.split('\n').find((line) => line.endsWith(` ${number}.dat`)) ?? '');
      expect(where('3024')?.slice(1, 3)).toEqual(where('3794b')?.slice(1, 3));

      // and opened again, it comes back the same
      const path = testInfo.outputPath('jumper.ldr');
      await writeFile(path, ldr);
      await openModelFile(page, path);
      await expect(page.getByRole('textbox', { name: 'Model name' })).toHaveValue('jumper');
      await expect(counts(page)).toHaveText('2 bricks');
      const [again, onIt] = await saved('jumper');
      expect((onIt?.x ?? 0) - (again?.x ?? 0)).toBe(0.5);
      expect(onIt?.z).toBe(again?.z);
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

    test('puts printed parts after the plain ones, and shows only them when asked', async ({ page }) => {
      await freshEditor(page);
      const search = page.getByRole('searchbox').first();
      await search.fill('tile 2x2');
      const tiles = page.locator('.part-tile');
      await expect(tiles.first()).toHaveAttribute('title', /^Tile 2 × 2/);
      await expect(tiles.first()).not.toHaveAttribute('title', /Pattern|Sticker/);
      await page.getByRole('button', { name: 'Printed', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Printed', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(tiles.first()).toHaveAttribute('title', /^Tile 2 × 2 .*(Pattern|Sticker)/);
      // a print by what it shows
      await search.fill('police');
      await expect(tiles.first()).toHaveAttribute('title', /POLICE/i);
    });

    test('opens a saved model that uses library parts', async ({ page }, testInfo) => {
      const path = testInfo.outputPath('library-model.brickbench.json');
      const bricks = [
        { part: 'ldraw:3001', color: 1, x: 0, y: 0, z: 0, r: 0 },
        { part: 'brick-2x2', color: 4, x: 0, y: 3, z: 0, r: 0 },
      ];
      await writeFile(path, JSON.stringify({ format: 'brickbench.model', version: 1, name: 'Mixed', bricks }));
      await freshEditor(page);
      await openModelFile(page, path);
      await expect(counts(page)).toHaveText('2 bricks');
      await expect(page.getByRole('textbox', { name: 'Model name' })).toHaveValue('Mixed');
    });

    test('lets other parts into the cells a library part leaves empty, however it is turned', async ({ page }, testInfo) => {
      const path = testInfo.outputPath('corner-plates.brickbench.json');
      // a Plate 2 × 2 Corner in each of its four turns, with a 1 × 1 plate tried in every cell of its box:
      // only the one in its missing corner fits, as bricks that overlap others are left out
      const bricks = [0, 1, 2, 3].flatMap((r) => [
        { part: 'ldraw:2420', color: 15, x: r * 4, y: 0, z: 0, r },
        ...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx = 0, dz = 0]) => ({ part: 'plate-1x1', color: 4, x: r * 4 + dx, y: 0, z: dz, r: 0 })),
      ]);
      await writeFile(path, JSON.stringify({ format: 'brickbench.model', version: 1, name: 'Corners', bricks }));
      await freshEditor(page);
      await openModelFile(page, path);
      await expect(counts(page)).toHaveText('8 bricks');
    });

    test('opens an LDraw model built on a baseplate of its own standing on it, every part on the grid', async ({ page }, testInfo) => {
      const path = testInfo.outputPath('town.ldr');
      // as LDraw models have it: a 16 × 16 baseplate's top at y 0, a brick on it, its underside there too, and another on that
      const model = ['0 Town', '0 Name: town.ldr', '1 71 0 0 0 1 0 0 0 1 0 0 0 1 3867.dat', '1 4 10 -24 20 1 0 0 0 1 0 0 0 1 3001.dat', '1 1 10 -48 20 1 0 0 0 1 0 0 0 1 3001.dat'];
      await writeFile(path, model.join('\r\n'));
      await freshEditor(page);
      await openModelFile(page, path);
      await expect(page.getByText('Opened “Town”: all 3 parts came in.')).toBeVisible();
      // none loose: the baseplate's plate of cells on the ground, the bricks on whole plates over it
      const bricks = await savedBricks(page, 3, 'Town');
      expect(bricks.map((b) => `${b.partId} ${b.y}${b.m ? ' loose' : ''}`).sort()).toEqual(['brick-2x4 1', 'brick-2x4 4', 'ldraw:3867 0']);
      // and the scene's own baseplate is left out from under it
      const size = await page.evaluate((key) => (JSON.parse(window.localStorage.getItem(key) ?? '{}') as { settings?: { baseplateSize?: number } }).settings?.baseplateSize, 'brickbench:autosave:v1');
      expect(size).toBe(0);
    });

    test('builds on top of a 1 × 4 × 6 door frame six bricks up, not a plate higher', async ({ page }) => {
      // searches the view for the frame's top
      test.slow();
      await freshEditor(page);
      await page.getByRole('button', { name: 'Library', exact: true }).click();
      await expect(page.locator('#library-category')).toBeVisible();
      await chooseLibraryPart(page, '60596');
      const centre = await viewportCentre(page);
      await page.mouse.click(centre.x, centre.y);
      await expect(counts(page)).toHaveText('1 brick');
      // a brick on its top: the frame stands 18 plates tall, the stubs its door turns in counted as studs
      await chooseLibraryPart(page, '3005');
      const coords = page.locator('.status-coords');
      let onTop: { x: number; y: number } | null = null;
      // the frame's top shows about 165 pixels over the middle of the view
      for (const spot of spotsAround({ x: centre.x, y: centre.y - 165 }, 160, 8)) {
        await page.mouse.move(spot.x, spot.y);
        if (/Y\s*18(?![\d.])/.test((await coords.textContent()) ?? '')) {
          onTop = spot;
          break;
        }
      }
      expect(onTop).not.toBeNull();
      await page.mouse.click(onTop?.x ?? 0, onTop?.y ?? 0);
      const [frame, brick] = await savedBricks(page, 2);
      expect(frame?.partId).toBe('ldraw:60596');
      expect(brick?.y).toBe(18);
      expect(brick?.m).toBeUndefined();
    });

    test('builds with parts drawn in several colours, such as a wheel with its tyre', async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const path = testInfo.outputPath('wheel.brickbench.json');
      // the rim takes the brick's red; the tyre keeps its rubber black
      const bricks = [{ part: 'ldraw:11208c01', color: 4, x: 0, y: 0, z: 0, r: 0 }];
      await writeFile(path, JSON.stringify({ format: 'brickbench.model', version: 1, name: 'Wheel', bricks }));
      await freshEditor(page);
      await openModelFile(page, path);
      await expect(counts(page)).toHaveText('1 brick');
      expect(errors).toEqual([]);
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
