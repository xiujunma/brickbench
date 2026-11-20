import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from './fixtures';
import { autosaved, counts, freshEditor, viewportCentre } from './helpers';

/** The model as the autosave holds it, once it holds `bricks` of them under `name`. */
async function saved(page: Page, bricks: number, name = 'Untitled model'): Promise<{ partId: string; x: number; y: number; z: number; r: number }[]> {
  await autosaved(page, bricks);
  const handle = await page.waitForFunction((wanted) => {
    const model = JSON.parse(window.localStorage.getItem('brickbench:autosave:v1') ?? '{}') as { name?: string; bricks?: { part: string; x: number; y: number; z: number; r: number }[] };
    return model.name === wanted ? model.bricks?.map((b) => ({ partId: b.part, x: b.x, y: b.y, z: b.z, r: b.r })) : undefined;
  }, name);
  return (await handle.jsonValue()) as { partId: string; x: number; y: number; z: number; r: number }[];
}

/** Picks a library part by number from the Library tab. */
async function choose(page: Page, number: string): Promise<void> {
  const search = page.getByRole('searchbox').first();
  await search.fill(number);
  const tile = page.locator('.part-tile').first();
  await expect(tile).toHaveAttribute('title', new RegExp(`LDraw ${number}\\b`));
  await tile.click();
}

/** The six ways a part can face, as orientations count them (src/core/orientation.ts). */
const FACINGS = ['+y', '-y', '+x', '-x', '+z', '-z'] as const;
/** A quarter turn about the vertical, as R makes: +X towards -Z. */
const QUARTER: Readonly<Record<string, string>> = { '+x': '-z', '-z': '-x', '-x': '+z', '+z': '+x' };

test.describe('building sideways (SNOT)', () => {
  test('builds a plate on a brick’s side stud, on its back, and keeps it there through LDraw', async ({ page }, testInfo) => {
    // starts the editor and opens a model
    test.slow();
    await freshEditor(page);
    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.locator('#library-category')).toBeVisible();

    // the brick's side stud, from the library: turned with R to face +X or +Z, the sides the camera looks at
    const sideStuds = await page.evaluate(async () => {
      const index = (await (await fetch('/ldraw/index.json')).json()) as { parts: { id: string; sideStuds?: number[][] }[] };
      return index.parts.find((p) => p.id === '87087')?.sideStuds ?? [];
    });
    expect(sideStuds).toHaveLength(1);
    let facing: string = FACINGS[sideStuds[0]?.[3] ?? 0] ?? '+y';
    await choose(page, '87087');
    let turns = 0;
    while (facing !== '+x' && facing !== '+z') {
      await page.keyboard.press('r');
      facing = QUARTER[facing] ?? facing;
      turns += 1;
    }
    expect(turns).toBeLessThan(4);
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');

    // over the stud, a 1 × 1 plate's preview turns onto its back, half a plate up the brick's side
    await choose(page, '3024');
    const coords = page.locator('.status-coords');
    let spot: { x: number; y: number } | null = null;
    for (let dy = -60; dy <= 30 && !spot; dy += 5) {
      for (let dx = -45; dx <= 45 && !spot; dx += 5) {
        await page.mouse.move(centre.x + dx, centre.y + dy);
        if (/Y\s*0\.5(?!\d)/.test((await coords.textContent()) ?? '')) spot = { x: centre.x + dx, y: centre.y + dy };
      }
    }
    expect(spot).not.toBeNull();
    await page.mouse.click(spot?.x ?? 0, spot?.y ?? 0);
    await expect(counts(page)).toHaveText('2 bricks');

    const [brick, plate] = await saved(page, 2);
    // on its back, its top facing out of the brick's side, from half a plate up to the brick's top
    expect(FACINGS[Math.floor((plate?.r ?? 0) / 4)]).toBe(facing);
    expect((plate?.y ?? 0) - (brick?.y ?? 0)).toBe(0.5);
    if (facing === '+z') expect((plate?.z ?? 0) - (brick?.z ?? 0)).toBe(1);
    else expect((plate?.x ?? 0) - (brick?.x ?? 0)).toBe(1);

    // out to LDraw and back in, the plate stays turned where it was
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'LDraw model (.ldr)' }).click();
    const ldr = await readFile(await (await downloadPromise).path(), 'utf8');
    const path = testInfo.outputPath('snot.ldr');
    await writeFile(path, ldr);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Open…' }).click();
    await (await chooser).setFiles(path);
    await expect(page.getByRole('textbox', { name: 'Model name' })).toHaveValue('snot');
    await expect(counts(page)).toHaveText('2 bricks');
    const [again, onSide] = await saved(page, 2, 'snot');
    expect(onSide?.r).toBe(plate?.r);
    expect([(onSide?.x ?? 0) - (again?.x ?? 0), (onSide?.y ?? 0) - (again?.y ?? 0), (onSide?.z ?? 0) - (again?.z ?? 0)]).toEqual([
      (plate?.x ?? 0) - (brick?.x ?? 0),
      (plate?.y ?? 0) - (brick?.y ?? 0),
      (plate?.z ?? 0) - (brick?.z ?? 0),
    ]);
  });

  test('tips a part over with T and lays it on the baseplate on its side', async ({ page }) => {
    // the editor starts building with a 2 × 4 brick
    await freshEditor(page);
    await page.keyboard.press('t');
    await expect(page.locator('.building')).toContainText('on its side, turned 0°');
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');
    const [brick] = await saved(page, 1);
    expect(brick?.y).toBe(0);
    expect(FACINGS[Math.floor((brick?.r ?? 0) / 4)]).not.toBe('+y');
    // once more over, and it is upside down; tipped back twice, it stands up again
    await page.keyboard.press('t');
    await expect(page.locator('.building')).toContainText('upside down, turned 0°');
    await page.keyboard.press('Shift+t');
    await page.keyboard.press('Shift+t');
    await expect(page.locator('.building')).toContainText('turned 0°');
    await expect(page.locator('.building')).not.toContainText(/on its side|upside down/);
  });
});
