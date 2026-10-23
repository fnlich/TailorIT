import { expect, test, type Locator, type Page } from '@playwright/test';

/*
 * Work package F5 (web foundation): computed-style checks of the shell and kit against the values sampled from the
 * user's Simplify screenshots (docs/research/screenshots-spec.md), plus the sign-in gate. Runs against the dev
 * server (`npm run dev`); /dev/kit needs no API.
 */

const WHITE = 'rgb(255, 255, 255)';
const BORDER = 'rgb(232, 232, 232)';
const FOREGROUND = 'rgb(25, 25, 25)';
const MUTED = 'rgb(125, 125, 125)';
const PRIMARY = 'rgb(20, 161, 192)';

async function style(locator: Locator, property: string, pseudo?: string): Promise<string> {
  return locator.evaluate((element, [prop, pseudoElement]) => getComputedStyle(element, pseudoElement || null).getPropertyValue(prop!), [
    property,
    pseudo ?? '',
  ] as const);
}

async function openKit(page: Page) {
  await page.goto('/dev/kit');
  await expect(page.getByRole('heading', { name: 'My Documents' })).toBeVisible();
}

test.describe('shell', () => {
  test('header: 62 px white bar with a #e8e8e8 bottom border', async ({ page }) => {
    await openKit(page);
    const header = page.locator('[data-app-header]');
    const box = await header.boundingBox();
    expect(box?.height).toBe(63);
    expect(await style(header, 'background-color')).toBe(WHITE);
    expect(await style(header, 'border-bottom-color')).toBe(BORDER);
    expect(await style(header, 'border-bottom-width')).toBe('1px');
  });

  test('nav: muted 16 px items; the active one is a full-height #e8e8e8 block with a 2 px #191919 bar', async ({ page }) => {
    await openKit(page);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link')).toHaveText(['Jobs', 'Job Tracker', 'Documents']);
    const active = nav.getByRole('link', { name: 'Documents' });
    await expect(active).toHaveAttribute('aria-current', 'page');
    expect(await style(active, 'background-color')).toBe(BORDER);
    expect(await style(active, 'color')).toBe(FOREGROUND);
    expect(await style(active, 'font-size')).toBe('16px');
    expect((await active.boundingBox())?.height).toBe(63);
    expect(await style(active, 'height', '::after')).toBe('2px');
    expect(await style(active, 'background-color', '::after')).toBe(FOREGROUND);
    const inactive = nav.getByRole('link', { name: 'Jobs' });
    expect(await style(inactive, 'color')).toBe(MUTED);
    expect(await style(inactive, 'background-color')).toBe('rgba(0, 0, 0, 0)');
  });

  test('account: 40 px #3ec0de square, radius 10, white bold initials, menu with Settings / Admin / Log out', async ({ page }) => {
    await openKit(page);
    const trigger = page.getByRole('button', { name: 'Account menu for David Jack' });
    const avatar = trigger.locator('span').first();
    const box = await avatar.boundingBox();
    expect([box?.width, box?.height]).toEqual([40, 40]);
    expect(await style(avatar, 'background-color')).toBe('rgb(62, 192, 222)');
    expect(await style(avatar, 'border-top-left-radius')).toBe('10px');
    expect(await style(avatar, 'color')).toBe(WHITE);
    expect(await style(avatar, 'font-weight')).toBe('700');
    await expect(avatar).toHaveText('DJ');
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'Account' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Settings', 'Admin', 'Log out']);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });
});

test.describe('documents layer', () => {
  test('action cards, tabs and the table card follow Simplify', async ({ page }) => {
    await openKit(page);
    const card = page.locator('[data-new-fallback="resume"]');
    expect(await style(card, 'border-top-left-radius')).toBe('16px');
    expect(await style(card, 'background-color')).toBe(WHITE);
    expect((await card.boundingBox())?.height).toBe(90);
    const tile = card.locator('span').first();
    expect(await style(tile, 'background-color')).toBe('rgb(204, 246, 255)');
    expect((await tile.boundingBox())?.width).toBe(40);

    const tab = page.getByRole('tab', { name: 'Resumes' });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(await style(tab, 'color')).toBe(FOREGROUND);
    expect(await style(tab, 'height', '::after')).toBe('2px');
    expect(await style(page.getByRole('tab', { name: 'Cover Letters' }).first(), 'color')).toBe(MUTED);

    const table = page.getByRole('table', { name: 'Resumes' });
    const headerRow = table.getByRole('row').first();
    expect(await style(headerRow, 'background-color')).toBe('rgb(248, 248, 248)');
    expect((await headerRow.boundingBox())?.height).toBe(44);
    await expect(table.getByRole('columnheader')).toHaveText(['', 'Name', 'Created', 'Last Edited', 'Actions']);
    const firstRow = table.getByRole('row').nth(1);
    expect((await firstRow.boundingBox())?.height).toBe(77); // 76 px + the 1 px divider
    const defaultBadge = firstRow.getByText('Default', { exact: true });
    expect(await style(defaultBadge.locator('..'), 'background-color')).toBe(PRIMARY);
  });

  test('search status line, no-match state and shift-click range selection', async ({ page }) => {
    await openKit(page);
    const section = page.locator('#documents');
    const search = section.getByRole('searchbox', { name: 'Search resumes' });
    await search.fill('paas');
    await expect(section.getByRole('status').filter({ hasText: 'match.' })).toHaveText('1 of 4 resumes match.');
    await search.fill('zzz');
    await expect(section.getByText('Oops! No matching resumes found.')).toBeVisible();
    await section.getByRole('button', { name: 'Clear search' }).first().click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();

    const boxes = section.getByRole('checkbox', { name: /^Select / });
    await boxes.nth(1).click();
    await boxes.nth(3).click({ modifiers: ['Shift'] });
    await expect(section.getByText('3 selected')).toBeVisible();
    await section.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('heading', { name: 'Delete Resumes' })).toBeVisible();
    await expect(dialog).toContainText("Are you sure you want to delete these 3 resumes? You won't be able to undo this action.");
    await expect(dialog.getByRole('button', { name: 'Delete Bulk' })).toBeVisible();
  });

  test('row menu: an ARIA menu that runs the action after returning focus', async ({ page }) => {
    await openKit(page);
    const section = page.locator('#documents');
    const more = section.getByRole('button', { name: /^More actions for PaaS/ });
    await more.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['View', 'Rename', 'Download', 'Set as default', 'Delete']);
    await expect(menu.getByRole('menuitem', { name: 'View' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Change resume name' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep it' }).click();
    await expect(more).toBeFocused();
  });

  test('cover letters: the view toggle switches to page thumbnails and is remembered', async ({ page }) => {
    await openKit(page);
    const section = page.locator('#letters-grid');
    await section.getByRole('button', { name: 'Grid' }).click();
    await expect(section.locator('[data-cover-letter-card]')).toHaveCount(3);
    await expect(section.locator('[data-new-tile="cover-letter"]')).toBeVisible();
    await section.scrollIntoViewIfNeeded();
    await expect(section.locator('iframe[sandbox=""]').first()).toBeAttached({ timeout: 10_000 });
    await page.reload();
    await expect(page.locator('#letters-grid [data-cover-letter-card]')).toHaveCount(3);
    await page.locator('#letters-grid').getByRole('button', { name: 'List' }).click();
  });
});

test.describe('kit', () => {
  test('controls: 36 px buttons and inputs with Simplify radii and borders', async ({ page }) => {
    await openKit(page);
    const primary = page.getByRole('button', { name: 'Add application' }).first();
    expect((await primary.boundingBox())?.height).toBe(36);
    expect(await style(primary, 'background-color')).toBe(PRIMARY);
    expect(await style(primary, 'border-top-left-radius')).toBe('10px');
    const input = page.getByPlaceholder('Title').first();
    expect((await input.boundingBox())?.height).toBe(36);
    expect(await style(input, 'border-top-color')).toBe('rgb(230, 230, 230)');
    expect(await style(input, 'border-top-left-radius')).toBe('10px');
    await input.focus();
    // The border colour transitions over 150 ms.
    await expect.poll(() => style(input, 'border-top-color')).toBe('rgb(150, 150, 150)');
    expect(await style(input, 'outline-style')).toBe('none');
    const track = page.getByRole('tablist', { name: 'Applications' });
    expect(await style(track, 'background-color')).toBe('rgba(0, 0, 0, 0.04)');
    const activeSegment = track.getByRole('tab', { selected: true });
    expect(await style(activeSegment, 'background-color')).toBe(WHITE);
  });
});

test.describe('sign-in gate', () => {
  test('an app page without a session goes to /login with next', async ({ page }) => {
    await page.goto('/documents?tab=templates');
    await expect(page).toHaveURL(/\/login\?next=%2Fdocuments%3Ftab%3Dtemplates$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText('TailorIT keeps your resumes to your own account.')).toBeVisible();
  });

  test('the sign-in page offers a method or says why it cannot', async ({ page }) => {
    await page.goto('/login');
    await expect(
      page
        .getByLabel('Email address')
        .or(page.getByText("We can't reach the server right now", { exact: false }))
        .or(page.getByText("Sign-in isn't available right now", { exact: false }))
        .or(page.getByText('Loading Google sign-in...')),
    ).toBeVisible();
  });
});
