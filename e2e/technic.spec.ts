import { expect, test } from './fixtures';
import { chooseLibraryPart, counts, findSpot, freshEditor, plugNear, savedBricks, spotsAround, viewportCentre } from './helpers';

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

  test('plugs a beam onto a pin by the hole C chooses, and says when a part plugs in only one way', async ({ page }) => {
    // starts the editor and searches the library three times
    test.slow();
    await freshEditor(page);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.locator('#library-category')).toBeVisible();

    // a Technic beam 3 lying flat on the baseplate
    await chooseLibraryPart(page, '32523');
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');

    // over one of its holes, a pin: its two ends are alike, so whichever goes in, it stands the same, and C says so
    await chooseLibraryPart(page, '3673');
    const hole = await findSpot(page, centre, /X\s*-?\d+\.[19](?!\d).*Y\s*0\b|Z\s*-?\d+\.[19](?!\d)/);
    expect(hole).not.toBeNull();
    await page.keyboard.press('c');
    await expect(page.getByText('It plugs in there only one way.')).toBeVisible();
    await page.mouse.click(hole?.x ?? 0, hole?.y ?? 0);
    await expect(counts(page)).toHaveText('2 bricks');

    // another beam over the pin's standing end goes onto it by an end hole, and could by its middle one
    await chooseLibraryPart(page, '32523');
    const onPin = await findSpot(page, hole ?? centre, /Y\s*2\.5(?!\d)/);
    expect(onPin).not.toBeNull();
    const hint = page.locator('.status-hint');
    const coords = page.locator('.status-coords');
    await expect(hint).toContainText('by another connection (1 of 2)');
    /** Where the build preview is, as the status bar shows it. */
    const shown = async (): Promise<number[]> => ((await coords.textContent()) ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const byEnd = await shown();

    // C puts it on by its middle hole: the beam moves a stud along itself, still 2.5 plates up; ⇧C goes back, and C again
    await page.keyboard.press('c');
    await expect(hint).toContainText('(2 of 2)');
    await expect.poll(shown).not.toEqual(byEnd);
    const byMiddle = await shown();
    const [dx = 0, dy = 0, dz = 0] = byMiddle.map((v, k) => v - (byEnd[k] ?? 0));
    expect(Math.abs(dx) + Math.abs(dz)).toBeCloseTo(1, 6);
    expect(dy).toBe(0);
    await page.keyboard.press('Shift+C');
    await expect(hint).toContainText('(1 of 2)');
    await expect.poll(shown).toEqual(byEnd);
    await page.keyboard.press('c');
    await expect.poll(shown).toEqual(byMiddle);

    // built there, by its middle hole
    await page.mouse.click(onPin?.x ?? 0, onPin?.y ?? 0);
    await expect(counts(page)).toHaveText('3 bricks');
    const top = (await savedBricks(page, 3))[2];
    expect(top?.partId).toBe('ldraw:32523');
    // the status bar shows where it is to a thousandth
    [top?.x, top?.y, top?.z].forEach((v, k) => expect(v ?? NaN).toBeCloseTo(byMiddle[k] ?? NaN, 3));
  });

  test('pushes an axle a stud into an axle joiner and D further, and meets it with another in a joiner on its end', async ({ page }) => {
    // starts the editor, searches the library four times and looks for four places along an axle
    test.setTimeout(300_000);
    await freshEditor(page);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.locator('#library-category')).toBeVisible();
    const hint = page.locator('.status-hint');
    const coords = page.locator('.status-coords');
    /** Where the build preview is, as the status bar shows it: where its box starts. */
    const shown = async (): Promise<number[]> => ((await coords.textContent()) ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    /** With the cursor at `spot`, the status bar's hint and where the preview's box starts, read at once. */
    const readAt = async (spot: { x: number; y: number }): Promise<{ hinted: string; at: number[] }> => {
      await page.mouse.move(spot.x, spot.y);
      const [hinted, text] = await page.evaluate(() => [document.querySelector('.status-hint')?.textContent ?? '', document.querySelector('.status-coords')?.textContent ?? '']);
      return { hinted: hinted ?? '', at: (text ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [] };
    };
    /** The first of `spots` where the build preview has room and is where `wanted` says. */
    const firstWhere = async (spots: readonly { x: number; y: number }[], wanted: (at: number[], hinted: string) => boolean): Promise<{ x: number; y: number } | null> => {
      for (const spot of spots) {
        const { hinted, at } = await readAt(spot);
        if (!hinted.includes('No room') && wanted(at, hinted)) return spot;
      }
      return null;
    };

    // an axle joiner on the baseplate, its hole running front to back
    await chooseLibraryPart(page, '6538a');
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');

    // at its front, an axle goes a stud in, to the joiner's middle
    await chooseLibraryPart(page, '3705');
    const mouth = await firstWhere(spotsAround(centre, 120), (_, hinted) => hinted.includes('further in (1 of 3)'));
    expect(mouth).not.toBeNull();
    if (!mouth) return;
    const stud = await shown();
    // D pushes it half a stud further, towards the back
    await page.keyboard.press('d');
    await expect(hint).toContainText('further in (2 of 3)');
    await expect.poll(shown).not.toEqual(stud);
    const moved = (await shown()).map((v, k) => v - (stud[k] ?? 0));
    expect(moved[0]).toBeCloseTo(0, 2);
    expect(moved[1]).toBeCloseTo(0, 2);
    expect(moved[2]).toBeCloseTo(-0.5, 2);
    /** How far the preview is from where it is a stud in, along the joiner, towards the front. */
    const out = async (): Promise<number> => ((await shown())[2] ?? NaN) - (stud[2] ?? NaN);
    // and again, to the joiner's back; then round to a stud in again, and ⇧D back the other way
    await page.keyboard.press('d');
    await expect(hint).toContainText('further in (3 of 3)');
    await expect.poll(out).toBeCloseTo(-1, 2);
    await page.keyboard.press('d');
    await expect(hint).toContainText('further in (1 of 3)');
    await expect.poll(out).toBeCloseTo(0, 2);
    await page.keyboard.press('Shift+D');
    await expect(hint).toContainText('further in (3 of 3)');
    await expect.poll(out).toBeCloseTo(-1, 2);
    await page.keyboard.press('Shift+D');
    await page.keyboard.press('Shift+D');
    await expect(hint).toContainText('further in (1 of 3)');
    await expect.poll(out).toBeCloseTo(0, 2);

    // built there, a stud in, loose
    await page.mouse.click(mouth.x, mouth.y);
    await expect(counts(page)).toHaveText('2 bricks');
    const first = (await savedBricks(page, 2))[1];
    expect(first?.m).toBeDefined();
    [first?.x, first?.y, first?.z].forEach((v, k) => expect(v ?? NaN).toBeCloseTo(stud[k] ?? NaN, 3));

    // another joiner goes half onto the axle's front end, three studs out of the first joiner, and hangs off it: LDraw draws the axle a twentieth
    // of a stud short of its four, so its end is 3.975 on from where its box starts, and the joiner's box starts a stud before that. The axle
    // runs on, on the screen, the way from the first joiner's middle to its mouth: out along that first, then all round
    await chooseLibraryPart(page, '6538a');
    /** How far on from the first axle's box, along it, the preview's box starts. */
    const along = (at: number[]): number => (at[2] ?? NaN) - (stud[2] ?? NaN);
    const hangsOff = (at: number[]): boolean => Math.abs(along(at) - 2.975) < 0.002;
    // where the axle runs on the screen: spots where the joiner goes onto it, at one of the half studs along it, till two lie a stud apart
    const onAxle = (at: number[]): boolean => along(at) > 0.9 && along(at) < 3 && Math.abs(((along(at) - 0.975) * 2) % 1) < 0.004;
    const seen: { readonly spot: { x: number; y: number }; readonly at: number }[] = [];
    for (const spot of spotsAround(mouth, 120, 8)) {
      const { hinted, at } = await readAt(spot);
      if (hinted.includes('No room') || !onAxle(at)) continue;
      seen.push({ spot, at: along(at) });
      if (Math.max(...seen.map((s) => s.at)) - Math.min(...seen.map((s) => s.at)) >= 1) break;
    }
    const [near, far] = [seen.reduce((a, b) => (b.at < a.at ? b : a)), seen.reduce((a, b) => (b.at > a.at ? b : a))];
    expect(far.at - near.at).toBeGreaterThanOrEqual(1);
    /** Where on the screen the axle is `studs` on from the first axle's box along it, as those two spots tell. */
    const onScreen = (studs: number): { x: number; y: number } => ({
      x: far.spot.x + ((far.spot.x - near.spot.x) / (far.at - near.at)) * (studs - far.at),
      y: far.spot.y + ((far.spot.y - near.spot.y) / (far.at - near.at)) * (studs - far.at),
    });
    const end = (await firstWhere(spotsAround(onScreen(2.975), 40, 3), hangsOff)) ?? (await firstWhere(spotsAround(mouth, 120), hangsOff));
    expect(end).not.toBeNull();
    if (!end) return;
    await page.mouse.click(end.x, end.y);
    await expect(counts(page)).toHaveText('3 bricks');
    expect((await savedBricks(page, 3))[2]?.m).toBeDefined();

    // and a second axle goes a stud into the rest of that joiner, against the first: its box starts 3.95 on from the first's
    await chooseLibraryPart(page, '3705');
    const meets = (at: number[]): boolean => Math.abs((at[2] ?? NaN) - (stud[2] ?? NaN) - 3.95) < 0.002;
    // at the second joiner's mouth, a stud past the first axle's end
    const second = (await firstWhere(spotsAround(onScreen(3.975), 40, 3), meets)) ?? (await firstWhere(spotsAround(end, 120), meets));
    expect(second).not.toBeNull();
    if (!second) return;
    await page.mouse.click(second.x, second.y);
    await expect(counts(page)).toHaveText('4 bricks');
    const last = (await savedBricks(page, 4))[3];
    expect(last?.partId).toBe('ldraw:3705');
    expect(last?.m).toBeDefined();
    expect((last?.z ?? NaN) - (first?.z ?? NaN)).toBeCloseTo(3.95, 3);
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

    // the neck takes one head: at the torso a second shows where it would go, with no room there, and is not built
    const coords = page.locator('.status-coords');
    const taken = await findSpot(page, onNeck ?? centre, /Y\s*9(?![\d.])/);
    expect(taken).not.toBeNull();
    await expect(page.locator('.status-hint.is-blocked')).toBeVisible();
    await page.mouse.click(taken?.x ?? 0, taken?.y ?? 0);
    await expect(page.getByText('There is no room for that there.')).toBeVisible();
    await expect(counts(page)).toHaveText('3 bricks');

    // selected, R turns the head 15° on its neck: in Select, the status bar shows where the part under the cursor stands, the head's 9 plates up
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
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

  test('clips a bar into the clip on a 1 × 1 tile, which LDraw draws without its clip primitive', async ({ page }) => {
    // starts the editor and searches the library twice
    test.slow();
    await freshEditor(page);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.locator('#library-category')).toBeVisible();

    // a 1 × 1 tile with a clip standing on it, on the baseplate
    await chooseLibraryPart(page, '15712');
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');

    // a bar 3 long goes into the clip, level, its middle in the clip: the clip's line is 14 LDraw units up the tile, and the bar's box a stud thick
    await chooseLibraryPart(page, '87994');
    const inClip = await plugNear(page, centre, /Y\s*0\.5(?!\d)/, 1);
    expect(inClip).not.toBeNull();
    const [tile, bar] = await savedBricks(page, 2);
    expect(bar?.partId).toBe('ldraw:87994');
    // lying level: its own up, along the bar, runs across
    expect(Math.abs(bar?.m?.[4] ?? 1)).toBeLessThan(1e-6);
    // along the clip, from front to back over the tile: its middle, a stud and a half along the 3.2 studs of its cells, in the clip
    expect(bar?.x).toBeCloseTo(tile?.x ?? NaN, 6);
    expect(Math.abs((bar?.z ?? 0) + 1.1 - (tile?.z ?? 0))).toBeCloseTo(0.1, 6);
  });

  test('clips a flame into a tile’s clip by its bar, which LDraw draws as a closed cylinder', async ({ page }) => {
    // starts the editor and searches the library twice
    test.slow();
    await freshEditor(page);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.locator('#library-category')).toBeVisible();

    // a 1 × 1 tile with a clip standing on it, which is all it plugs anything into, on the baseplate
    await chooseLibraryPart(page, '15712');
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');

    // a flame 7 long with a bar at its foot goes into the clip by that bar: the clip's line is 14 LDraw units up the tile, and the
    // flame's box, lying level, a stud thick
    await chooseLibraryPart(page, '85959');
    const inClip = await plugNear(page, centre, /Y\s*0\.5(?!\d)/, 1);
    expect(inClip).not.toBeNull();
    const flame = (await savedBricks(page, 2))[1];
    expect(flame?.partId).toBe('ldraw:85959');
    // lying level along the clip, from front to back over the tile: its own up, along its bar, runs that way
    expect(Math.abs(flame?.m?.[7] ?? 0)).toBeCloseTo(1, 6);
  });

  test('puts a bar in a Friends figure’s hand', async ({ page }) => {
    // starts the editor and searches the library twice
    test.slow();
    await freshEditor(page);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.locator('#library-category')).toBeVisible();

    // a Friends girl's torso with her arms on, whose hands are all a bar plugs into, on the baseplate
    await chooseLibraryPart(page, '92456');
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');

    // a bar 3 long goes into a hand: the hands are 0.2285 studs up the torso, and the bar's box, a stud thick, reaches under the
    // ground, its bottom 0.679 plates under it
    await chooseLibraryPart(page, '87994');
    const inHand = await plugNear(page, centre, /Y\s*-0\.679(?!\d)/, 1);
    expect(inHand).not.toBeNull();
    const bar = (await savedBricks(page, 2))[1];
    expect(bar?.partId).toBe('ldraw:87994');
    // held front to back, as the hand holds it: its own up, along the bar, runs that way
    expect(Math.abs(bar?.m?.[7] ?? 0)).toBeCloseTo(1, 6);
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

  test('puts a hinge brick together and swings its top', async ({ page }) => {
    // starts the editor and searches the library twice
    test.slow();
    await freshEditor(page);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.locator('#library-category')).toBeVisible();

    // the base of a 1 × 2 hinge brick, on the baseplate
    await chooseLibraryPart(page, '3937');
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');

    // its top goes on closed, as LDraw's assembled hinge has it: in the top two plates of the base's own three, not stacked on it
    await chooseLibraryPart(page, '3938');
    const onBase = await plugNear(page, centre, /Y\s*1(?![\d.])/, 1);
    expect(onBase).not.toBeNull();
    const [base, top] = await savedBricks(page, 2);
    expect(top?.partId).toBe('ldraw:3938');
    expect([top?.x, top?.y, top?.z]).toEqual([base?.x, 1, base?.z]);
    expect(top?.m?.[4]).toBeCloseTo(1, 6);

    // put together, the hinge is a brick like any other: nowhere on it does a second top go into the base, where the first is
    const coords = page.locator('.status-coords');
    const inBase = `X${top?.x} Y${top?.y} Z${top?.z}`;
    for (const spot of spotsAround(onBase ?? centre, 36)) {
      await page.mouse.move(spot.x, spot.y);
      expect(((await coords.textContent()) ?? '').trim()).not.toBe(inBase);
    }

    // selected, R swings the top 15° about the hinge, along the brick's length
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    let overTop: { x: number; y: number } | null = null;
    for (let dy = 0; dy <= 60 && !overTop; dy += 4) {
      await page.mouse.move(onBase?.x ?? 0, (onBase?.y ?? 0) - dy);
      if (/Y\s*1(?![\d.])/.test((await coords.textContent()) ?? '')) overTop = { x: onBase?.x ?? 0, y: (onBase?.y ?? 0) - dy };
    }
    expect(overTop).not.toBeNull();
    await page.mouse.click(overTop?.x ?? 0, overTop?.y ?? 0);
    await expect(counts(page)).toContainText('1 selected');
    await page.keyboard.press('r');
    await expect.poll(async () => (await savedBricks(page, 2))[1]?.m?.[4]).toBeCloseTo(Math.cos(Math.PI / 12), 6);
    // about the brick's length: that way it has not turned
    expect((await savedBricks(page, 2))[1]?.m?.[0]).toBeCloseTo(1, 6);
  });

  test('hinges a car roof on the plate that holds it, and lifts it off the ground', async ({ page }) => {
    // starts the editor and searches the library twice
    test.slow();
    await freshEditor(page);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.locator('#library-category')).toBeVisible();

    // a 1 × 4 plate with a car roof holder beside it, on the baseplate
    await chooseLibraryPart(page, '4315');
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');

    // the roof goes on by the fingers along its edge, between the holder's: lying on from the plate, on the ground like it, right way up
    await chooseLibraryPart(page, '4213');
    const onHolder = await plugNear(page, centre, /Y\s*0(?![\d.])/, 1);
    expect(onHolder).not.toBeNull();
    const [holder, roof] = await savedBricks(page, 2);
    expect(roof?.partId).toBe('ldraw:4213');
    // as wide as the plate, from the plate's own stud on: the holder's fingers fill the stud beside it
    expect([roof?.x, roof?.y, roof?.z]).toEqual([holder?.x, 0, (holder?.z ?? 0) + 1]);
    expect(roof?.m?.[0]).toBeCloseTo(1, 6);
    expect(roof?.m?.[4]).toBeCloseTo(1, 6);

    // selected, R lifts it about its fingers, 15° at a time: its far edge rises off the ground, and across the car it has not turned
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    const overRoof = await findSpot(page, onHolder ?? centre, new RegExp(`X${roof?.x} Y0 Z${roof?.z}(?![\\d.])`));
    expect(overRoof).not.toBeNull();
    await page.mouse.click(overRoof?.x ?? 0, overRoof?.y ?? 0);
    await expect(counts(page)).toContainText('1 selected');
    await page.keyboard.press('r');
    await expect.poll(async () => (await savedBricks(page, 2))[1]?.m?.[4]).toBeCloseTo(Math.cos(Math.PI / 12), 6);
    const lifted = (await savedBricks(page, 2))[1];
    expect(lifted?.m?.[0]).toBeCloseTo(1, 6);
    // up: the roof's length, which lay level, now climbs
    expect(lifted?.m?.[5]).toBeCloseTo(Math.sin(Math.PI / 12), 6);

    // ⇧R lays it back on the ground, and no further: down through the baseplate it will not go
    await page.keyboard.press('Shift+R');
    await expect.poll(async () => (await savedBricks(page, 2))[1]?.m?.[4]).toBeCloseTo(1, 6);
    await page.keyboard.press('Shift+R');
    await expect(page.getByText('There is no room to turn the selection there.')).toBeVisible();
    expect((await savedBricks(page, 2))[1]?.m?.[4]).toBeCloseTo(1, 6);
  });

  test('puts a 4 × 4 turntable together and turns its top', async ({ page }) => {
    // starts the editor and searches the library twice
    test.slow();
    await freshEditor(page);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.locator('#library-category')).toBeVisible();

    // the base of a 4 × 4 turntable, on the baseplate
    await chooseLibraryPart(page, '3403');
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');

    // its top goes on as LDraw's assembled turntable has it: inside the base's three plates of cells, three quarters of a plate up
    await chooseLibraryPart(page, '3404');
    const onBase = await plugNear(page, centre, /Y\s*0\.75(?!\d)/, 1);
    expect(onBase).not.toBeNull();
    const [base, top] = await savedBricks(page, 2);
    expect(top?.partId).toBe('ldraw:3404');
    expect([top?.x, top?.y, top?.z]).toEqual([base?.x, 0.75, base?.z]);

    // in Select, the top is found from above, though it stops a little under the top of the base's cells: the status bar shows where the part under the cursor stands
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.mouse.move(onBase?.x ?? 0, onBase?.y ?? 0);
    await expect(page.locator('.status-coords')).toContainText(/Y\s*0\.75(?!\d)/);
    await page.mouse.click(onBase?.x ?? 0, onBase?.y ?? 0);
    await expect(counts(page)).toContainText('1 selected');

    // R turns it 15° about the upright through its middle, where it stays
    await page.keyboard.press('r');
    await expect.poll(async () => (await savedBricks(page, 2))[1]?.m?.[0]).toBeCloseTo(Math.cos(Math.PI / 12), 6);
    const turned = (await savedBricks(page, 2))[1];
    expect(turned?.m?.[4]).toBeCloseTo(1, 6);
    expect(turned?.y).toBeCloseTo(0.75, 6);
  });
});
