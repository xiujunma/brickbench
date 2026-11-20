import { expect, test, type Page } from './fixtures';
import { chooseLibraryPart, counts, freshEditor, savedBricks, viewportCentre } from './helpers';

/** Moves the cursor over the scene near `from` until the build preview's position matches `wanted`; where it does, or null. */
async function findSpot(page: Page, from: { x: number; y: number }, wanted: RegExp): Promise<{ x: number; y: number } | null> {
  const coords = page.locator('.status-coords');
  for (let dy = -90; dy <= 60; dy += 6) {
    for (let dx = -60; dx <= 60; dx += 6) {
      await page.mouse.move(from.x + dx, from.y + dy);
      if (wanted.test((await coords.textContent()) ?? '')) return { x: from.x + dx, y: from.y + dy };
    }
  }
  return null;
}

test.describe('Technic and hinges', () => {
  test('plugs a pin into a beam, a beam onto the pin, and swings it on the pin', async ({ page }) => {
    // starts the editor and searches the library three times
    test.slow();
    await freshEditor(page);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.locator('#library-category')).toBeVisible();

    // a Technic beam 3, lying flat on the baseplate, its holes upright
    await chooseLibraryPart(page, '32523');
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');

    // over one of its holes, a pin plugs in: upright, off the stud grid by the pin's half-width
    await chooseLibraryPart(page, '3673');
    const hole = await findSpot(page, centre, /X\s*-?\d+\.[19](?!\d).*Y\s*0\b|Z\s*-?\d+\.[19](?!\d)/);
    expect(hole).not.toBeNull();
    await page.mouse.click(hole?.x ?? 0, hole?.y ?? 0);
    await expect(counts(page)).toHaveText('2 bricks');
    const [beam, pin] = await savedBricks(page, 2);
    expect(pin?.partId).toBe('ldraw:3673');
    expect(pin?.m).toBeDefined();
    // its lower end in the beam's stud-high hole, its upper end standing a stud above the beam
    expect(pin?.y).toBe(beam?.y);

    // another beam goes onto the standing end, lying flat from the pin's collar up: 2.5 plates up
    await chooseLibraryPart(page, '32523');
    const onPin = await findSpot(page, hole ?? centre, /Y\s*2\.5(?!\d)/);
    expect(onPin).not.toBeNull();
    await page.mouse.click(onPin?.x ?? 0, onPin?.y ?? 0);
    await expect(counts(page)).toHaveText('3 bricks');
    const top = (await savedBricks(page, 3))[2];
    expect(top?.y).toBe(2.5);
    expect(top?.m?.[4]).toBeCloseTo(1, 6);

    // selected, R swings it 15° about the pin, still on it
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.mouse.click(onPin?.x ?? 0, onPin?.y ?? 0);
    await expect(counts(page)).toContainText('1 selected');
    await page.keyboard.press('r');
    await expect
      .poll(async () => (await savedBricks(page, 3))[2]?.m?.[0])
      .toBeCloseTo(Math.cos(Math.PI / 12), 6);
    const swung = (await savedBricks(page, 3))[2];
    expect(swung?.y).toBe(2.5);
  });
});
