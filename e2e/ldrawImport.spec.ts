import { expect, test, type Page } from '@playwright/test';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/lib/zip-native.js';
import { counts, freshEditor } from './helpers';

/**
 * A small LDraw model: a red and a yellow 2 × 4 stacked, a blue 2 × 2 beside
 * them turned a quarter, a brick upside down, and a part BrickBench lacks.
 */
const WALL = [
  '0 Little Wall',
  '0 Name: wall.ldr',
  '1 4 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat',
  '1 14 0 -48 0 1 0 0 0 1 0 0 0 1 3001.dat',
  '1 1 60 -24 0 0 0 -1 0 1 0 1 0 0 3003.dat',
  '1 4 0 -72 0 1 0 0 0 -1 0 0 0 -1 3001.dat',
  '1 4 0 -96 0 1 0 0 0 1 0 0 0 1 u9241.dat',
].join('\r\n');

/** The model inside a Studio file, as Studio writes it. */
const WHALE = ['﻿0 FILE whale.io', '0 Untitled Model', '0 Name: whale', '1 272 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat', '1 15 0 -48 0 1 0 0 0 1 0 0 0 1 3001.dat', '0 NOFILE'].join('\r\n');

/** A Studio file locked with Studio's password, as older versions saved them. */
async function studioFile(model: string): Promise<Buffer> {
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
  await writer.add('.info', new TextReader('{"version":"2.22.1_1"}'));
  await writer.add('model.ldr', new TextReader(model), { password: 'soho0909', zipCrypto: true });
  return Buffer.from(await (await writer.close()).arrayBuffer());
}

async function openFile(page: Page, name: string, buffer: Buffer): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Open…' }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer });
}

test.describe('opening LDraw and Studio files', () => {
  test('opens an LDraw model and reports the parts it left out', async ({ page }) => {
    await freshEditor(page);
    await openFile(page, 'wall.ldr', Buffer.from(WALL));

    await expect(page.getByText('Opened “Little Wall”: 3 of 5 parts came in.')).toBeVisible();
    await expect(counts(page)).toHaveText('3 bricks');
    const report = page.getByRole('dialog', { name: 'What came in' });
    await expect(report.getByTestId('import-summary')).toHaveText('3 of 5 parts came in.');
    await report.getByText('Not in BrickBench').click();
    await expect(report.getByRole('cell', { name: 'u9241' })).toBeVisible();
    await report.getByText('On their side or at an angle').click();
    await expect(report.getByRole('cell', { name: 'Brick 2 × 4 (3001)' })).toBeVisible();
    await report.getByRole('button', { name: 'Done' }).click();
    await expect(report).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Model name' })).toHaveValue('Little Wall');
  });

  test('opens a model file dropped on the window', async ({ page }) => {
    await freshEditor(page);
    const dataTransfer = await page.evaluateHandle((text) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], 'wall.ldr', { type: 'text/plain' }));
      return transfer;
    }, WALL);
    await page.dispatchEvent('body', 'dragover', { dataTransfer });
    await page.dispatchEvent('body', 'drop', { dataTransfer });

    await expect(page.getByText('Opened “Little Wall”: 3 of 5 parts came in.')).toBeVisible();
    await expect(counts(page)).toHaveText('3 bricks');
  });

  test('opens a Studio file locked with Studio’s password', async ({ page }) => {
    await freshEditor(page);
    await openFile(page, 'whale.io', await studioFile(WHALE));

    await expect(page.getByText('Opened “whale”: all 2 parts came in.')).toBeVisible();
    await expect(counts(page)).toHaveText('2 bricks');
    // everything came in as it was, so there is nothing to report
    await expect(page.getByRole('dialog', { name: 'What came in' })).toBeHidden();
  });
});
