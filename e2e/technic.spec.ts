import { expect, test } from './fixtures';
import { chooseLibraryPart, counts, findSpot, freshEditor, plugNear, savedBricks, viewportCentre } from './helpers';

test.describe('Technic, hinges and minifigures', () => {
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

  test('puts a minifigure together: hips and legs, a torso on them, a head on top that turns', async ({ page }) => {
    // starts the editor and searches the library three times
    test.slow();
    await freshEditor(page);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.locator('#library-category')).toBeVisible();

    // hips and legs, standing on the baseplate
    await chooseLibraryPart(page, '73200b-f1');
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');

    // a torso goes on the hips by their studs: its bottom on the hips' top, 5 plates up, not on top of the legs' box
    await chooseLibraryPart(page, '973');
    const onHips = await plugNear(page, centre, /Y\s*5(?![\d.])/, 1);
    expect(onHips).not.toBeNull();
    await expect(counts(page)).toHaveText('2 bricks');
    const torso = (await savedBricks(page, 2))[1];
    expect(torso?.partId).toBe('ldraw:973');
    expect(torso?.y).toBeCloseTo(5, 6);

    // a head on its neck, its underside on the torso's shoulders, 4 plates further up
    await chooseLibraryPart(page, '3626c');
    const onNeck = await plugNear(page, onHips ?? centre, /Y\s*9(?![\d.])/, 2);
    expect(onNeck).not.toBeNull();
    await expect(counts(page)).toHaveText('3 bricks');
    const head = (await savedBricks(page, 3))[2];
    expect(head?.y).toBeCloseTo(9, 6);
    // centred on the torso, which is two studs wide to the head's one
    expect((head?.x ?? 0) - (torso?.x ?? 0)).toBeCloseTo(0.5, 6);

    // selected, R turns the head 15° on its neck: in Select, the status bar shows where the part under the cursor stands, the head's 9 plates up
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    const coords = page.locator('.status-coords');
    let overHead: { x: number; y: number } | null = null;
    for (let dy = 0; dy <= 60 && !overHead; dy += 4) {
      await page.mouse.move(onNeck?.x ?? 0, (onNeck?.y ?? 0) - dy);
      if (/Y\s*9(?![\d.])/.test((await coords.textContent()) ?? '')) overHead = { x: onNeck?.x ?? 0, y: (onNeck?.y ?? 0) - dy };
    }
    expect(overHead).not.toBeNull();
    await page.mouse.click(overHead?.x ?? 0, overHead?.y ?? 0);
    await expect(counts(page)).toContainText('1 selected');
    await page.keyboard.press('r');
    await expect.poll(async () => (await savedBricks(page, 3))[2]?.m?.[0]).toBeCloseTo(Math.cos(Math.PI / 12), 6);
  });

  test('clips a bar to a plate with a clip', async ({ page }) => {
    // starts the editor and searches the library twice
    test.slow();
    await freshEditor(page);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.locator('#library-category')).toBeVisible();

    // a 1 × 1 plate with a clip on its side, on the baseplate
    await chooseLibraryPart(page, '61252');
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');

    // a bar 3 long goes into the clip, across it, its middle in the clip: low enough that its box, a stud thick to its fifth, reaches under the ground
    await chooseLibraryPart(page, '87994');
    const inClip = await plugNear(page, centre, /Y\s*-0\.\d/, 1);
    expect(inClip).not.toBeNull();
    const bar = (await savedBricks(page, 2))[1];
    expect(bar?.partId).toBe('ldraw:87994');
    // lying level: its own up, along the bar, runs across
    expect(Math.abs(bar?.m?.[4] ?? 1)).toBeLessThan(1e-6);
  });

  test('stands a bar in a round plate’s open stud', async ({ page }) => {
    // starts the editor and searches the library twice
    test.slow();
    await freshEditor(page);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.locator('#library-category')).toBeVisible();

    // a 1 × 1 round plate with an open stud, on the baseplate (a library part: the built-in round parts have no connections)
    await chooseLibraryPart(page, '85861');
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');
    expect((await savedBricks(page, 1))[0]?.partId).toBe('ldraw:85861');

    // a bar goes down its stud, standing up from the stud's base on the plate's top, a plate up
    await chooseLibraryPart(page, '87994');
    const inStud = await plugNear(page, centre, /Y\s*1(?![\d.])/, 1);
    expect(inStud).not.toBeNull();
    const bar = (await savedBricks(page, 2))[1];
    expect(bar?.y).toBeCloseTo(1, 6);
    expect(Math.abs(bar?.m?.[4] ?? 0)).toBeCloseTo(1, 6);
  });
});
