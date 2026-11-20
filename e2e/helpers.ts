import { expect, type Locator, type Page } from '@playwright/test';

/** Startup draws the scene once; on machines without a GPU that can take a while. */
const STARTUP_MS = 45_000;

/**
 * Waits for the 3D view to start. If it cannot (no WebGL), fail at once with
 * the reason the page shows instead of waiting out the test.
 */
async function editorStarted(page: Page): Promise<void> {
  const failure = page.locator('.viewport-error');
  await expect(page.locator('canvas.viewport-canvas').or(failure)).toBeVisible({ timeout: STARTUP_MS });
  if (await failure.isVisible()) throw new Error(`The 3D view did not start: ${(await failure.textContent()) ?? ''}`);
}

/** Opens the editor. Every test runs in a new browser context, so storage starts empty. */
export async function freshEditor(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await editorStarted(page);
}

/**
 * Reloads the editor and waits for it to start again. Under software WebGL
 * starting twice takes a while, so tests that reload also call test.slow().
 */
export async function reloadEditor(page: Page): Promise<void> {
  await page.reload();
  await editorStarted(page);
}

export async function viewportCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('viewport').boundingBox();
  if (!box) throw new Error('viewport has no size');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export const counts = (page: Page): Locator => page.getByTestId('status-counts');

/** The app's autosave key (src/state/persistence.ts); e2e code stays out of the app's modules. */
const AUTOSAVE_KEY = 'brickbench:autosave:v1';

/** Waits until the autosave holds this many bricks, rather than guessing how long saving takes. */
export async function autosaved(page: Page, bricks: number): Promise<void> {
  await page.waitForFunction(
    ({ key, count }) => {
      try {
        const saved = JSON.parse(window.localStorage.getItem(key) ?? 'null') as { bricks?: unknown[] } | null;
        return saved?.bricks?.length === count;
      } catch {
        return false;
      }
    },
    { key: AUTOSAVE_KEY, count: bricks },
  );
}

/** A brick as the autosave holds it: its part, where its box starts, its orientation and, when loose, its exact turn. */
export interface SavedBrick {
  readonly partId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly r: number;
  readonly m?: readonly number[];
}

/** The model's bricks as the autosave holds them, once it holds `bricks` of them under `name`. */
export async function savedBricks(page: Page, bricks: number, name = 'Untitled model'): Promise<SavedBrick[]> {
  await autosaved(page, bricks);
  const handle = await page.waitForFunction(
    ({ key, wanted }) => {
      const model = JSON.parse(window.localStorage.getItem(key) ?? '{}') as {
        name?: string;
        bricks?: { part: string; x: number; y: number; z: number; r: number; m?: number[] }[];
      };
      return model.name === wanted ? model.bricks?.map((b) => ({ partId: b.part, x: b.x, y: b.y, z: b.z, r: b.r, ...(b.m ? { m: b.m } : {}) })) : undefined;
    },
    { key: AUTOSAVE_KEY, wanted: name },
  );
  return (await handle.jsonValue()) as SavedBrick[];
}

/** Picks a library part by number from the Library tab. */
export async function chooseLibraryPart(page: Page, number: string): Promise<void> {
  const search = page.getByRole('searchbox').first();
  await search.fill(number);
  const tile = page.locator('.part-tile').first();
  await expect(tile).toHaveAttribute('title', new RegExp(`LDraw ${number}\\b`));
  await tile.click();
}
