import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/*
 * Work package T (Job Tracker) user flows against the dev server (`npm run dev`, AUTH_DEV_FIXED_CODE set). Each test
 * signs in its own account and empties it first, so runs do not depend on one another.
 *   npx playwright test --project=e2e e2e/specs/tracker.spec.ts
 */

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const CODE = process.env.AUTH_DEV_FIXED_CODE ?? '000000';

/** M/D/YY of the browser's (this machine's) day, as the stepper prints it. */
function todayLabel(): string {
  const now = new Date();
  return `${now.getMonth() + 1}/${now.getDate()}/${String(now.getFullYear() % 100).padStart(2, '0')}`;
}

async function signInFresh(page: Page, email: string): Promise<APIRequestContext> {
  const request = page.request;
  // The shared dev API restarts when any package saves a file: wait out a short restart.
  let res = await request.post('/api/auth/email/verify', { data: { email, code: CODE }, headers: { Origin: ORIGIN } });
  for (let attempt = 0; attempt < 20 && res.status() >= 500; attempt += 1) {
    await page.waitForTimeout(500);
    res = await request.post('/api/auth/email/verify', { data: { email, code: CODE }, headers: { Origin: ORIGIN } });
  }
  expect(res.ok(), await res.text()).toBeTruthy();
  for (const tab of ['active', 'archived']) {
    const list = (await (await request.get(`/api/applications?tab=${tab}&limit=100`)).json()) as { items: Array<{ id: string }> };
    if (list.items.length) {
      await request.post('/api/applications/bulk', {
        headers: { Origin: ORIGIN },
        data: { ids: list.items.map((item) => item.id), action: 'delete' },
      });
    }
  }
  return request;
}

const column = (page: Page, status: number) => page.locator(`[data-column="${status}"]`);
const card = (scope: Page | Locator, title: string) => scope.locator('[data-application-card]').filter({ hasText: title });

async function dragTo(page: Page, source: Locator, target: Locator) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('drag source or target is not visible');
  await page.mouse.move(from.x + from.width / 2, from.y + 24);
  await page.mouse.down();
  // dnd-kit's mouse sensor starts after 8 px; move in steps so it sees the motion.
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + 30, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 12 });
  await page.mouse.move(to.x + to.width / 2, to.y + 64, { steps: 2 });
  await page.mouse.up();
}

test.describe('job tracker', () => {
  // The shared dev API restarts whenever any package saves a file; a run caught by one is retried.
  test.describe.configure({ retries: 2 });

  test('add, drag, list stepper, favorite, chart, archive and export', async ({ page }) => {
    test.setTimeout(90_000);
    await signInFresh(page, 'tracker-e2e@tailorit.dev');
    await page.goto('/tracker');
    await expect(page.getByRole('tab', { name: 'Active (0)' })).toBeVisible();
    await expect(column(page, 2).getByText('No applications')).toBeVisible();

    // Add application → the detail opens in edit mode; the card lands in Applied.
    await page.getByRole('button', { name: 'Add application' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add Application' });
    await sheet.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(sheet.getByText('Required')).toHaveCount(2);
    await sheet.getByLabel('Position Title').fill('Platform Engineer');
    // A company typed and left (no pick from the suggestions) is kept.
    await sheet.getByRole('combobox', { name: 'Company' }).fill('Globex');
    await page.keyboard.press('Tab');
    await sheet.getByLabel('Location').fill('Remote in USA');
    await sheet.getByRole('button', { name: 'Add', exact: true }).click();

    const detail = page.getByRole('dialog', { name: 'Platform Engineer' });
    await expect(detail.getByRole('heading', { name: 'Edit Job Posting' })).toBeVisible();
    await detail.getByRole('button', { name: 'Cancel' }).click();
    await detail.getByRole('button', { name: 'Close' }).click();
    await expect(detail).toBeHidden();
    await expect(page).toHaveURL(/\/tracker$/);
    await expect(card(column(page, 2), 'Platform Engineer')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Active (1)' })).toBeVisible();
    await expect(card(column(page, 2), 'Platform Engineer')).toContainText('Added ');

    // Screen is empty, so it is hidden until ticked in Options › Visible columns.
    await expect(column(page, 11)).toHaveCount(0);
    await page.getByRole('button', { name: /^Options/ }).click();
    await page.getByRole('menuitem', { name: /^Visible columns/ }).hover();
    await page.getByRole('menuitemcheckbox', { name: /^Screen/ }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(column(page, 11).getByText('No applications')).toBeVisible();

    // Drag the card from Applied to Screen.
    await dragTo(page, card(column(page, 2), 'Platform Engineer'), column(page, 11));
    await expect(card(column(page, 11), 'Platform Engineer')).toBeVisible();
    await expect(column(page, 2).getByText('No applications')).toBeVisible();
    // It sticks after a reload (the server has the move).
    await page.reload();
    await expect(card(column(page, 11), 'Platform Engineer')).toBeVisible();

    // The list's stepper shows the dates reached.
    await page.getByRole('tab', { name: 'List' }).click();
    await expect(page).toHaveURL(/view=list/);
    const row = page.locator('[data-application-row]').filter({ hasText: 'Platform Engineer' });
    const stepper = row.getByRole('list', { name: 'Progress of Platform Engineer' });
    await expect(stepper.getByRole('listitem')).toHaveCount(5);
    await expect(stepper.getByRole('listitem').nth(0)).toContainText(`Saved${todayLabel()}`);
    await expect(stepper.getByRole('listitem').nth(1)).toContainText(`Applied${todayLabel()}`);
    await expect(stepper.getByRole('listitem').nth(2)).toContainText(`Screen${todayLabel()}`);
    await expect(stepper.getByRole('listitem').nth(3)).toContainText('Interview, not reached');

    // Favorite (the heart fills).
    await row.getByRole('button', { name: 'Add to favorites' }).click();
    await expect(row.getByRole('button', { name: 'Remove from favorites' })).toHaveAttribute('aria-pressed', 'true');

    // The chart draws the flow Applied → Screening.
    await page.getByRole('tab', { name: 'Chart' }).click();
    await expect(page.getByRole('heading', { name: 'Application flow' })).toBeVisible();
    await expect(page.locator('[data-chart="application-flow"] rect[data-stage="Applied"]')).toBeVisible();
    await expect(page.locator('[data-chart="application-flow"] rect[data-stage="Screening"]')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Conversion funnel' })).toContainText('100%');

    // Stages can be dragged, and put back.
    const stage = page.locator('[data-chart="application-flow"] rect[data-stage="Screening"]');
    const before = Number(await stage.getAttribute('y'));
    const stageBox = (await stage.boundingBox())!;
    await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + 70, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => Number(await stage.getAttribute('y'))).toBeGreaterThan(before + 40);
    await page.getByRole('button', { name: 'Reset chart positions' }).click();
    await expect.poll(async () => Number(await stage.getAttribute('y'))).toBe(before);

    // Export chart as PNG.
    const png = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export chart as PNG' }).click();
    expect((await png).suggestedFilename()).toBe('application-flow.png');

    // Archive from the detail, then find it under Archived (a list).
    await page.getByRole('tab', { name: 'Board' }).click();
    await card(column(page, 11), 'Platform Engineer').click();
    await expect(page).toHaveURL(/app=/);
    const opened = page.getByRole('dialog', { name: 'Platform Engineer' });
    await opened.getByRole('button', { name: 'Archive' }).click();
    await expect(opened.getByRole('button', { name: 'Unarchive' })).toBeVisible();
    await opened.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('tab', { name: 'Archived (1)' })).toBeVisible();
    await page.getByRole('tab', { name: 'Archived (1)' }).click();
    await expect(page).toHaveURL(/tab=archived/);
    await expect(page.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-application-row]').filter({ hasText: 'Platform Engineer' })).toBeVisible();

    // Export CSV downloads the archived tab's applications.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /^Options/ }).click();
    await page.getByRole('menuitem', { name: 'Export CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^TailorIT_Tracked_Jobs_\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await readFile((await file.path())!, 'utf8');
    expect(text).toContain('Company,Position Title,Location,Job Type,Status');
    expect(text).toContain('Globex,Platform Engineer,Remote in USA,Full-Time,Screen');
  });

  test('detail sheet: edit the posting, date the timeline, reach Offer, notes, questions and delete', async ({ page }) => {
    test.setTimeout(90_000);
    const request = await signInFresh(page, 'tracker-detail@tailorit.dev');
    const created = (await (
      await request.post('/api/applications', {
        headers: { Origin: ORIGIN },
        data: { title: 'Data Engineer', companyName: 'Initech', employmentType: 'full_time', status: 1 },
      })
    ).json()) as { id: string };

    await page.goto(`/tracker?app=${created.id}`);
    const detail = page.getByRole('dialog', { name: 'Data Engineer' });
    await expect(detail.getByText('Initech')).toBeVisible();
    // Saved with no link: no Apply button yet.
    await expect(detail.getByRole('button', { name: 'Apply' })).toHaveCount(0);

    // Edit Job Posting: pay, link and description.
    await detail.getByRole('button', { name: 'Edit job posting' }).click();
    await detail.getByLabel('Min. Salary').fill('120000');
    await detail.getByLabel('Max. Salary').fill('100000');
    await detail.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(detail.getByText('Max salary must be greater than min salary')).toBeVisible();
    await detail.getByLabel('Max. Salary').fill('150000');
    await detail.getByLabel('URL').fill('jobs.initech.example/42');
    await detail.getByRole('textbox', { name: 'Job description' }).fill('We use Python and Kubernetes every day.');
    await detail.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(detail.getByRole('heading', { name: 'Edit Job Posting' })).toBeHidden();
    await expect(detail.getByText('$120k - $150k')).toBeVisible();
    await expect(detail.getByText('Yearly')).toBeVisible();
    await expect(detail.getByRole('link', { name: 'View Job Posting' })).toHaveAttribute('href', 'https://jobs.initech.example/42');
    await expect(detail.getByText('We use Python and Kubernetes every day.')).toBeVisible();
    // Saved with a link: Apply appears.
    await expect(detail.getByRole('button', { name: 'Apply' })).toBeVisible();

    // Resume Score with no resume: the "Add a resume" state, the description's keywords missing.
    await detail.getByRole('tab', { name: 'Resume Score' }).click();
    await expect(detail.getByText('Add a resume')).toBeVisible();
    await expect(detail.getByRole('list', { name: 'Keywords' })).toContainText('Kubernetes');
    await expect(detail.getByRole('list', { name: 'Keywords' })).toContainText('Python');

    // Timeline: Saved can't be cleared; Applied gets a date (and becomes current).
    const timeline = detail.getByRole('list', { name: 'Status timeline' });
    await timeline.getByRole('button', { name: /^Change the date of Saved/ }).click();
    await page.getByRole('dialog', { name: 'Date for Saved' }).getByRole('button', { name: 'Clear' }).click();
    await expect(
      page.getByRole('region', { name: 'Notifications' }).getByText("Saved can't be cleared; change its date instead."),
    ).toBeVisible();
    await timeline.getByRole('button', { name: 'Add a date for Applied' }).click();
    const picker = page.getByRole('dialog', { name: 'Date for Applied' });
    await picker.locator('button.rdp-day_button:not([disabled])', { hasText: /^1$/ }).first().click();
    await picker.getByRole('button', { name: 'Save' }).click();
    await expect(timeline.getByRole('button', { name: /^Change the date of Applied, \w{3} 1, \d{4}/ })).toBeVisible();
    await expect(detail.getByRole('combobox', { name: 'Application status' })).toHaveText(/Applied/);

    // The status select moves it to Offer (the confetti plays).
    await detail.getByRole('combobox', { name: 'Application status' }).click();
    await page.getByRole('option', { name: 'Offer' }).click();
    await expect(timeline.getByRole('button', { name: /^Change the date of Offer/ })).toBeVisible();
    await expect(page.locator('canvas').first()).toBeAttached();

    // Notes save themselves.
    await detail.getByRole('textbox', { name: 'Notes' }).fill('Call Sam on Monday');
    await expect(detail.getByText('Saved', { exact: true })).toBeVisible();

    // Questions.
    await detail.getByRole('tab', { name: 'Questions' }).click();
    await detail.getByRole('button', { name: 'Add Question' }).click();
    await detail.getByRole('textbox', { name: 'Question', exact: true }).fill('Why Initech?');
    await detail.getByRole('textbox', { name: 'Answer', exact: true }).fill('The TPS reports.');
    await detail.getByRole('button', { name: 'Save question' }).click();
    await expect(detail.getByRole('textbox', { name: 'Question 1', exact: true })).toHaveValue('Why Initech?');

    // Everything is on the server.
    await page.reload();
    const again = page.getByRole('dialog', { name: 'Data Engineer' });
    await expect(again.getByText('Call Sam on Monday')).toBeVisible();
    await again.getByRole('tab', { name: 'Questions' }).click();
    await expect(again.getByRole('textbox', { name: 'Answer to question 1' })).toHaveValue('The TPS reports.');

    // Delete, with Simplify's confirmation.
    await again.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByRole('heading', { name: 'Delete Application' })).toBeVisible();
    await expect(confirm).toContainText("Are you sure you want to delete this application? You won't be able to undo this action.");
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(again).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Active (0)' })).toBeVisible();
  });

  test('card menu, Manage jobs and Archive all', async ({ page }) => {
    const request = await signInFresh(page, 'tracker-bulk@tailorit.dev');
    for (const title of ['Alpha Role', 'Beta Role', 'Gamma Role']) {
      await request.post('/api/applications', {
        headers: { Origin: ORIGIN },
        data: { title, companyName: 'Umbrella', employmentType: 'full_time' },
      });
    }
    await page.goto('/tracker');
    await expect(column(page, 2).locator('[data-application-card]')).toHaveCount(3);

    // Right-click › Move to › Interviewing.
    await card(page, 'Alpha Role').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to' }).hover();
    await page.getByRole('menuitemradio', { name: 'Interviewing' }).click();
    await expect(card(column(page, 12), 'Alpha Role')).toBeVisible();

    // The keyboard: Space picks the card up, → moves it one column, Space drops it. (The closed context menu returns
    // focus once its exit animation ends, so wait for that before focusing another card.)
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.waitForTimeout(400);
    await card(column(page, 2), 'Gamma Role').focus();
    await expect(card(column(page, 2), 'Gamma Role')).toBeFocused();
    // dnd-kit listens for the arrows a tick after the drag starts; people never type that fast, a test does.
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    await page.keyboard.press('Space');
    await expect(card(column(page, 12), 'Gamma Role')).toBeVisible();

    // A 500 ms press opens the actions menu (and does not open the application).
    const box = (await card(page, 'Gamma Role').boundingBox())!;
    await page.mouse.move(box.x + 120, box.y + 70);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await expect(page.getByRole('menuitem', { name: 'Open application' })).toBeVisible();
    await expect(page).not.toHaveURL(/app=/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    // The ⋯ menu: Archive application.
    await card(page, 'Beta Role').getByRole('button', { name: 'Application actions' }).click();
    await page.getByRole('menuitem', { name: 'Archive application' }).click();
    await expect(card(page, 'Beta Role')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Archived (1)' })).toBeVisible();

    // Manage jobs: select everything, update the status with the "Warning" confirmation.
    await page.getByRole('button', { name: /^Options/ }).click();
    await page.getByRole('menuitem', { name: 'Manage jobs' }).click();
    const bar = page.getByRole('toolbar', { name: 'Manage jobs' });
    await expect(bar).toContainText('0 Job(s) Selected');
    await bar.getByRole('checkbox', { name: 'Select all applications' }).click();
    await expect(bar).toContainText('2 Job(s) Selected');
    await bar.getByRole('button', { name: 'Update Status' }).click();
    await page.getByRole('menuitem', { name: 'Offer' }).click();
    const warning = page.getByRole('alertdialog');
    await expect(warning.getByRole('heading', { name: 'Warning' })).toBeVisible();
    await expect(warning).toContainText('Are you sure you want to update the status of these 2 applications?');
    await warning.getByRole('button', { name: 'Update' }).click();
    await expect(column(page, 13).locator('[data-application-card]')).toHaveCount(2);
    await bar.getByRole('button', { name: 'Done' }).click();
    await expect(bar).toBeHidden();

    // Archive all applications.
    await page.getByRole('button', { name: /^Options/ }).click();
    await page.getByRole('menuitem', { name: 'Archive all applications' }).click();
    const archiveAll = page.getByRole('alertdialog');
    await expect(archiveAll.getByRole('heading', { name: 'Archive all applications' })).toBeVisible();
    await expect(archiveAll).toContainText('Are you sure you want to archive all applications?');
    await archiveAll.getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('tab', { name: 'Active (0)' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Archived (3)' })).toBeVisible();
  });

  test('Import CSV wizard', async ({ page }) => {
    await signInFresh(page, 'tracker-import@tailorit.dev');
    await page.goto('/tracker?view=list');
    await expect(page.getByText('Add your first job application!')).toBeVisible();
    await expect(page.getByText('No more endless spreadsheets, keep track of everything in one place.')).toBeVisible();

    await page.getByRole('button', { name: /^Options/ }).click();
    await page.getByRole('menuitem', { name: 'Import CSV' }).click();
    const wizard = page.getByRole('dialog', { name: 'Import Applications from CSV' });
    await expect(wizard.getByText('Expected headers: Company name, Position Title. Location is optional.')).toBeVisible();
    const csv = [
      'Company,Job Title,Where,Stage,Date Applied',
      'Acme,Backend Engineer,Remote,Phone call,10/01/2026',
      'Globex,Software Engineering Intern,"Austin, TX",Rejected,2026-09-15',
      'Initech,Data Analyst,,Applied,',
    ].join('\n');
    await wizard.getByLabel('CSV file').setInputFiles({ name: 'applications.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(wizard.getByText('Which row holds the column names?')).toBeVisible();
    await wizard.getByRole('button', { name: 'Next' }).click();

    await expect(wizard.getByRole('heading', { name: 'Map your columns' })).toBeVisible();
    await expect(wizard.getByRole('combobox', { name: 'Position Title column' })).toHaveText(/Job Title/);
    await expect(wizard.getByRole('combobox', { name: 'Company column' })).toHaveText(/Company/);
    await wizard.getByRole('combobox', { name: 'Location column' }).click();
    await page.getByRole('option', { name: 'Where' }).click();
    await wizard.getByRole('button', { name: 'Next' }).click();

    await expect(wizard.getByRole('heading', { name: 'Map status values' })).toBeVisible();
    await wizard.getByRole('combobox', { name: 'Status for Phone call' }).click();
    await page.getByRole('option', { name: 'Screen' }).click();
    await wizard.getByRole('button', { name: 'Import 3 applications' }).click();
    await expect(wizard.getByText('All 3 applications imported successfully!')).toBeVisible();
    await wizard.getByRole('button', { name: 'Done' }).click();

    const rows = page.locator('[data-application-row]');
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Backend Engineer' }).getByRole('list')).toContainText('Screen10/1/26');
    await expect(rows.filter({ hasText: 'Software Engineering Intern' })).toContainText('Austin, TX');
  });

  test('search, filters, chips and empty states', async ({ page }) => {
    const request = await signInFresh(page, 'tracker-filters@tailorit.dev');
    for (const [title, companyName, status] of [
      ['Frontend Engineer', 'Hooli', 2],
      ['Product Designer', 'Pied Piper', 12],
      ['Backend Engineer', 'Hooli', 1],
    ] as const) {
      await request.post('/api/applications', {
        headers: { Origin: ORIGIN },
        data: { title, companyName, employmentType: 'full_time', status },
      });
    }
    await page.goto('/tracker');
    await expect(page.locator('[data-application-card]')).toHaveCount(3);

    // Search (debounced, server-side) over roles and companies.
    await page.getByRole('searchbox', { name: 'Search for roles or companies' }).fill('hooli');
    await expect(page.locator('[data-application-card]')).toHaveCount(2);
    await page.getByRole('searchbox', { name: 'Search for roles or companies' }).fill('');
    await expect(page.locator('[data-application-card]')).toHaveCount(3);

    // A status filter switches to the list and shows a chip.
    await page.getByRole('button', { name: /^Options/ }).click();
    await page.getByRole('menuitem', { name: 'Status', exact: true }).hover();
    await page.getByRole('menuitemcheckbox', { name: 'Interviewing' }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/view=list/);
    const chips = page.getByLabel('Active filters');
    await expect(chips.getByText('Interviewing')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Options, 1 filters applied/ })).toBeVisible();
    await expect(page.locator('[data-application-row]')).toHaveCount(1);
    await expect(page.locator('[data-application-row]')).toContainText('Product Designer');

    // Nothing matches: Simplify's no-match copy.
    await page.getByRole('searchbox', { name: 'Search for roles or companies' }).fill('zzz-no-such-role');
    await expect(page.getByText('Oops! No matching applications found.')).toBeVisible();
    await expect(page.getByText('Please update your search criteria and try again.')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search for roles or companies' }).fill('');

    // Clear all filters.
    await page.getByRole('button', { name: 'Clear all filters' }).click();
    await expect(chips).toHaveCount(0);
    await expect(page.locator('[data-application-row]')).toHaveCount(3);

    // Sort by title, ascending (a chip says so).
    await page.getByRole('button', { name: /^Options/ }).click();
    await page.getByRole('menuitem', { name: 'Sort by' }).hover();
    await page.getByRole('menuitemradio', { name: 'Title' }).click();
    await page.getByRole('menuitemradio', { name: 'Ascending' }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Active filters').getByText('Sort: title (asc)')).toBeVisible();
    await expect(page.locator('[data-application-row]').first()).toContainText('Backend Engineer');

    // The row's Status ⌄: an ending adds a sixth, grey step.
    const designer = page.locator('[data-application-row]').filter({ hasText: 'Product Designer' });
    await designer.getByRole('button', { name: /^Status: Interviewing/ }).click();
    await page.getByRole('menuitemradio', { name: 'Rejected' }).click();
    const steps = designer.getByRole('list', { name: 'Progress of Product Designer' }).getByRole('listitem');
    await expect(steps).toHaveCount(6);
    await expect(steps.nth(5)).toContainText(`Rejected${todayLabel()}`);
  });

  test('the Archived column: drop to archive, drag out to restore', async ({ page }) => {
    const request = await signInFresh(page, 'tracker-archived-column@tailorit.dev');
    for (const title of ['Keep Role', 'Old Role']) {
      await request.post('/api/applications', {
        headers: { Origin: ORIGIN },
        data: { title, companyName: 'Vandelay', employmentType: 'full_time' },
      });
    }
    await page.goto('/tracker');
    await expect(column(page, 2).locator('[data-application-card]')).toHaveCount(2);

    await page.getByRole('button', { name: /^Options/ }).click();
    await page.getByRole('menuitem', { name: /^Visible columns \(5\)/ }).hover();
    await page.getByRole('menuitemcheckbox', { name: /^Archived/ }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const archived = page.locator('[data-column="archived"]');
    await expect(archived.getByText('No applications')).toBeVisible();

    await dragTo(page, card(column(page, 2), 'Old Role'), archived);
    await expect(card(archived, 'Old Role')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Archived (1)' })).toBeVisible();

    // Scrolled to the end, the Archived column and Interviewing are both on screen.
    await archived.scrollIntoViewIfNeeded();
    await dragTo(page, card(archived, 'Old Role'), column(page, 12));
    await expect(card(column(page, 12), 'Old Role')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Archived (0)' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Active (2)' })).toBeVisible();
  });

  test('Enter drops a keyboard drag without opening the card; letters written for the job can be linked', async ({ page }) => {
    const request = await signInFresh(page, 'tracker-keys@tailorit.dev');
    const created = (await (
      await request.post('/api/applications', {
        headers: { Origin: ORIGIN },
        data: { title: 'Keys Role', companyName: 'Initrode', employmentType: 'full_time' },
      })
    ).json()) as { id: string };
    await page.goto('/tracker');
    const keys = card(column(page, 2), 'Keys Role');
    await keys.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await expect(card(column(page, 12), 'Keys Role')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page).not.toHaveURL(/app=/);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // A letter the cover letter editor made for this application is offered in Documents.
    const letter = await request.post('/api/cover-letters', { headers: { Origin: ORIGIN }, data: { applicationId: created.id } });
    test.skip(!letter.ok(), 'the cover letter API is not available on this server');
    const { title } = (await letter.json()) as { title: string };
    await page.goto(`/tracker?app=${created.id}`);
    const detail = page.getByRole('dialog', { name: 'Keys Role' });
    await detail.getByRole('tab', { name: 'Documents' }).click();
    const written = detail.getByRole('region', { name: 'Written for this job' });
    await expect(written).toContainText(title);
    await written.getByRole('button', { name: 'Use for this application' }).click();
    await expect(detail.getByRole('link', { name: 'Edit' }).first()).toHaveAttribute('href', /\/cover-letter\//);
    await expect(written).toHaveCount(0);
  });

  test('a column loads 25 cards, then more', async ({ page }) => {
    test.setTimeout(90_000);
    const request = await signInFresh(page, 'tracker-paging@tailorit.dev');
    for (let index = 1; index <= 30; index += 1) {
      await request.post('/api/applications', {
        headers: { Origin: ORIGIN },
        data: { title: `Role ${String(index).padStart(2, '0')}`, companyName: 'Paging Co', employmentType: 'full_time' },
      });
    }
    await page.goto('/tracker');
    const applied = column(page, 2);
    await expect(applied.locator('[data-application-card]')).toHaveCount(25);
    // "Load more applications" sits at the end of the column; scrolling to it loads the next page (infinite scroll).
    await applied.getByRole('button', { name: 'Load more applications' }).scrollIntoViewIfNeeded();
    await expect(applied.locator('[data-application-card]')).toHaveCount(30);
    await expect(applied.getByRole('button', { name: 'Load more applications' })).toHaveCount(0);
    // The header counts every card in the column, loaded or not.
    await expect(applied.getByRole('heading', { name: 'Applied' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Applied, 30' })).toBeVisible();
  });
});
