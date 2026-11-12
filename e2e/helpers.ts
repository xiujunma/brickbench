import { expect, type Locator, type Page } from '@playwright/test';

/** Startup draws the scene once; on machines without a GPU that can take a while. */
const STARTUP_MS = 45_000;

/**
 * Opens the editor. Every test runs in a new browser context, so storage
 * starts empty. If the 3D view cannot start (no WebGL), fail at once with the
 * reason the page shows instead of waiting out the test.
 */
export async function freshEditor(page: Page): Promise<void> {
  await page.goto('/');
  const failure = page.locator('.viewport-error');
  await expect(page.locator('canvas.viewport-canvas').or(failure)).toBeVisible({ timeout: STARTUP_MS });
  if (await failure.isVisible()) throw new Error(`The 3D view did not start: ${(await failure.textContent()) ?? ''}`);
}

export async function viewportCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('viewport').boundingBox();
  if (!box) throw new Error('viewport has no size');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export const counts = (page: Page): Locator => page.getByTestId('status-counts');
