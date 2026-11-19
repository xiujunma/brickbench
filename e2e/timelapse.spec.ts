import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { counts, freshEditor, viewportCentre } from './helpers';

/** MP4 files name their brand at byte 4; WebM files start with the EBML magic number. */
function videoKind(bytes: Buffer): 'mp4' | 'webm' | null {
  if (bytes.subarray(4, 8).toString('latin1') === 'ftyp') return 'mp4';
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  return null;
}

test.describe('time-lapse video', () => {
  test('films the model being built and saves the video', async ({ page }) => {
    // software WebGL films slowly
    test.setTimeout(240_000);
    await freshEditor(page);
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await page.mouse.click(centre.x + 60, centre.y + 20);
    await expect(counts(page)).toHaveText('2 bricks');

    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Time-lapse video…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Time-lapse video' });
    await dialog.getByRole('button', { name: '5 s', exact: true }).click();
    await dialog.getByRole('button', { name: 'Square', exact: true }).click();
    await dialog.getByRole('button', { name: '720p', exact: true }).click();
    await expect(dialog.getByTestId('timelapse-summary')).toHaveText('5 s · 720 × 720 · a brick every 3 s');

    const downloadPromise = page.waitForEvent('download', { timeout: 200_000 });
    await dialog.getByRole('button', { name: 'Make video' }).click();
    await expect(dialog.getByRole('progressbar')).toBeVisible();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^untitled-model-timelapse\.(mp4|webm)$/);
    const bytes = await readFile(await download.path());
    expect(videoKind(bytes)).toBe(download.suggestedFilename().endsWith('.mp4') ? 'mp4' : 'webm');
    expect(bytes.length).toBeGreaterThan(10_000);
    await expect(page.getByText('Time-lapse video saved to your downloads.')).toBeVisible();
    await expect(dialog).toBeHidden();
  });

  test('stops filming when asked, saving nothing', async ({ page }) => {
    await freshEditor(page);
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(counts(page)).toHaveText('1 brick');
    let downloads = 0;
    page.on('download', () => {
      downloads += 1;
    });
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Time-lapse video…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Time-lapse video' });
    await dialog.getByRole('button', { name: '60 s', exact: true }).click();
    await dialog.getByRole('button', { name: 'Make video' }).click();
    await expect(dialog.getByRole('progressbar')).toBeVisible();
    await dialog.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByText('Stopped making the video.')).toBeVisible();
    // the dialog is ready for another go
    await expect(dialog.getByRole('button', { name: 'Make video' })).toBeEnabled();
    expect(downloads).toBe(0);
  });
});
