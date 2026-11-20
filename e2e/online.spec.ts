import { expect, test, type Page } from './fixtures';
import { counts, freshEditor, viewportCentre } from './helpers';

/**
 * Accounts, models kept online and the gallery, against the test API
 * (server/local.ts, started by playwright.config.ts): it lets anyone sign in
 * under a made-up name, and "moderator" moderates. Every test signs in as
 * people of its own, since tests share the API.
 */

let run = 0;

/** An account id no other test uses. */
function someone(name: string): string {
  run += 1;
  return `${name}-${test.info().workerIndex}-${Date.now()}-${run}`;
}

/** Opens the editor signed in, as the test API lets anyone. */
async function signedIn(page: Page, id: string, name: string): Promise<void> {
  await freshEditor(page, `/api/auth/test?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`);
  await expect(page.getByRole('button', { name: `Account: ${name}` })).toBeVisible();
}

async function build(page: Page, bricks: number): Promise<void> {
  const centre = await viewportCentre(page);
  for (let i = 0; i < bricks; i++) await page.mouse.click(centre.x + i * 120, centre.y);
  await expect(counts(page)).toHaveText(bricks === 1 ? '1 brick' : `${bricks} bricks`);
}

async function fileMenu(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

async function nameModel(page: Page, name: string): Promise<void> {
  const field = page.getByRole('textbox', { name: 'Model name' });
  await field.fill(name);
  await field.press('Enter');
}

function yourModels(page: Page) {
  return page.getByRole('dialog', { name: 'Your models online' });
}

function gallery(page: Page) {
  return page.getByRole('dialog', { name: 'Gallery' });
}

async function openGallery(page: Page): Promise<void> {
  await page.getByRole('banner').getByRole('button', { name: 'Gallery', exact: true }).click();
  await expect(gallery(page)).toBeVisible();
}

test.describe('models online', () => {
  test('saves a model online and opens it in another browser, never saving over a newer save unseen', async ({ page, browser }) => {
    // starts the editor three times
    test.slow();
    const ada = someone('ada');
    await signedIn(page, ada, 'Ada');
    await expect(page.getByText('Signed in as Ada.')).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
    await build(page, 1);
    await nameModel(page, 'Boathouse');
    await fileMenu(page, 'Save online');
    await expect(page.getByText('Saved “Boathouse” online.')).toBeVisible();

    await fileMenu(page, 'Your models online…');
    const card = yourModels(page).getByRole('listitem', { name: 'Boathouse' });
    await expect(card).toContainText('1 brick');
    await expect(card).toContainText('Only you can see it');
    await expect(card).toContainText('Open now');
    // its picture was drawn and came back
    await expect.poll(() => card.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480);
    await page.keyboard.press('Escape');

    // on another computer: the same account opens it, builds on it and saves it over
    const laptop = await browser.newContext();
    try {
      const other = await laptop.newPage();
      await signedIn(other, ada, 'Ada');
      await other.getByRole('button', { name: 'Account: Ada' }).click();
      await other.getByRole('menuitem', { name: 'Your models online…' }).click();
      await yourModels(other).getByRole('listitem', { name: 'Boathouse' }).getByRole('button', { name: 'Open' }).click();
      await expect(counts(other)).toHaveText('1 brick');
      await expect(other.getByText('Opened “Boathouse”.')).toBeVisible();
      const centre = await viewportCentre(other);
      await other.mouse.click(centre.x + 150, centre.y + 40);
      await expect(counts(other)).toHaveText('2 bricks');
      await fileMenu(other, 'Save online');
      await expect(other.getByText('Saved “Boathouse” online.')).toBeVisible();
    } finally {
      await laptop.close();
    }

    // back on the first: its save would go over the newer one, so it asks, and keeps both
    const centre = await viewportCentre(page);
    await page.mouse.click(centre.x + 150, centre.y + 40);
    await expect(counts(page)).toHaveText('2 bricks');
    const asked = page.waitForEvent('dialog');
    await fileMenu(page, 'Save online');
    const confirm = await asked;
    expect(confirm.message()).toContain('was saved online from somewhere else since you opened it here');
    await confirm.accept();
    await expect(page.getByText('Saved “Boathouse” online.').last()).toBeVisible();
    await fileMenu(page, 'Your models online…');
    await expect(yourModels(page).getByRole('listitem', { name: 'Boathouse' })).toHaveCount(2);
    await expect(yourModels(page).getByRole('listitem').filter({ hasText: '2 bricks' })).toHaveCount(2);
  });

  test('publishes to the gallery, where others open and report it, and a moderator takes it out', async ({ page, browser }) => {
    // starts the editor three times
    test.slow();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    page.on('dialog', (dialog) => void dialog.accept());
    const ada = someone('ada');
    const title = `Lighthouse ${ada}`;
    await signedIn(page, ada, 'Ada');
    await build(page, 2);
    await nameModel(page, title);
    await fileMenu(page, 'Save online');
    await expect(page.getByText(`Saved “${title}” online.`)).toBeVisible();
    await fileMenu(page, 'Your models online…');
    const mine = yourModels(page).getByRole('listitem', { name: title });
    await mine.getByRole('button', { name: 'Publish' }).click();
    await expect(mine).toContainText('In the gallery');
    await mine.getByRole('button', { name: `Copy a link to ${title}` }).click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\/#gallery=[0-9a-z]{16}$/);
    await page.keyboard.press('Escape');

    // someone else, signed in, finds it in the gallery, opens a copy and reports it
    const elsewhere = await browser.newContext();
    try {
      const other = await elsewhere.newPage();
      other.on('dialog', (dialog) => void dialog.accept());
      await signedIn(other, someone('grace'), 'Grace');
      await openGallery(other);
      await gallery(other).getByRole('searchbox', { name: 'Search the gallery' }).fill(ada);
      const found = gallery(other).getByRole('listitem', { name: title });
      await expect(found).toContainText('by Ada');
      await expect(gallery(other).getByRole('listitem')).toHaveCount(1);
      await found.getByRole('button', { name: `Report ${title}` }).click();
      const report = found.getByRole('form', { name: `Report ${title}` });
      await report.getByRole('radio', { name: 'Spam or advertising' }).check();
      await report.getByRole('textbox', { name: 'More about it (optional)' }).fill('An advert');
      await report.getByRole('button', { name: 'Send report' }).click();
      await expect(other.getByText('Thank you: the moderators will look at it.')).toBeVisible();
      await found.getByRole('button', { name: 'Open' }).click();
      await expect(counts(other)).toHaveText('2 bricks');
      await expect(other.getByText(`Opened “${title}” by Ada. Saving it online keeps a copy of your own.`)).toBeVisible();

      // the gallery link opens it too, pasted into the address bar, and leaves the address
      await fileMenu(other, 'New model');
      await expect(counts(other)).toHaveText('0 bricks');
      await other.goto(link);
      await expect(counts(other)).toHaveText('2 bricks');
      await expect.poll(() => new URL(other.url()).hash).toBe('');
    } finally {
      await elsewhere.close();
    }

    // a moderator sees the report and takes the model out of the gallery
    const moderating = await browser.newContext();
    try {
      const mod = await moderating.newPage();
      await signedIn(mod, 'moderator', 'Moderator');
      await openGallery(mod);
      await gallery(mod).getByRole('button', { name: 'Reported' }).click();
      const reported = gallery(mod).getByRole('listitem', { name: title });
      await expect(reported).toContainText('1 report');
      await expect(reported).toContainText('spam ×1');
      await expect(reported).toContainText('“An advert”');
      await reported.getByRole('button', { name: 'Take out' }).click();
      await expect(mod.getByText(`“${title}” is out of the gallery.`)).toBeVisible();
      await expect(gallery(mod).getByRole('listitem', { name: title })).toHaveCount(0);
      await gallery(mod).getByRole('button', { name: 'Gallery', exact: true }).click();
      await gallery(mod).getByRole('searchbox', { name: 'Search the gallery' }).fill(ada);
      await expect(gallery(mod).getByText(/Nothing in the gallery is called anything like/)).toBeVisible();
    } finally {
      await moderating.close();
    }

    // its owner still has it, marked, and cannot put it back
    await fileMenu(page, 'Your models online…');
    const taken = yourModels(page).getByRole('listitem', { name: title });
    await expect(taken).toContainText('Taken out of the gallery by a moderator');
  });

  test('deletes an account with its models', async ({ page }) => {
    const ada = someone('ada');
    await signedIn(page, ada, 'Ada');
    await build(page, 1);
    await fileMenu(page, 'Save online');
    await expect(page.getByText('Saved “Untitled model” online.')).toBeVisible();
    await page.getByRole('button', { name: 'Account: Ada' }).click();
    await page.getByRole('menuitem', { name: 'Account…' }).click();
    const account = page.getByRole('dialog', { name: 'Your account' });
    await account.getByRole('textbox', { name: 'Your name in the gallery' }).fill('Ada L');
    await account.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByText('The gallery now shows you as “Ada L”.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account: Ada L' })).toBeVisible();

    page.once('dialog', (dialog) => void dialog.accept());
    await account.getByRole('button', { name: 'Delete account…' }).click();
    await expect(page.getByText('Your account and its models are deleted.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();

    // signing in again starts afresh
    await signedIn(page, ada, 'Ada');
    await fileMenu(page, 'Your models online…');
    await expect(yourModels(page).getByText(/^Nothing online yet/)).toBeVisible();
  });

  test('asks to sign in before saving online, and says when signing in was cancelled', async ({ page }) => {
    await freshEditor(page, '/#sign-in=cancelled');
    await expect(page.getByText('Signing in was cancelled.')).toBeVisible();
    await build(page, 1);
    await fileMenu(page, 'Save online');
    const signIn = page.getByRole('dialog', { name: 'Sign in' });
    await expect(signIn.getByRole('button', { name: 'Sign in for testing' })).toBeVisible();
    await expect(signIn).toContainText('It never sees your password or email address.');
  });

  test('are left out where the site has no accounts', async ({ page }) => {
    await page.route('**/api/session', (route) => route.fulfill({ status: 404, body: 'Not found' }));
    await freshEditor(page);
    await page.getByRole('button', { name: 'File' }).click();
    await expect(page.getByRole('menuitem', { name: 'Save to file' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Save online' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('banner').getByRole('button', { name: 'Gallery', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'About & privacy' }).click();
    await expect(page.getByRole('dialog', { name: 'About BrickBench' })).toContainText('There are no accounts.');
  });
});
