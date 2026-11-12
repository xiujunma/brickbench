import { expect, type Locator, type Page } from '@playwright/test';

export async function freshEditor(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.locator('canvas.viewport-canvas')).toBeVisible();
}

export async function viewportCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('viewport').boundingBox();
  if (!box) throw new Error('viewport has no size');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export const counts = (page: Page): Locator => page.getByTestId('status-counts');
