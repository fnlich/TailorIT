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

/** The board's horizontal scroll box (the parent of its columns; Saved is always shown). */
const boardScroller = (page: Page) => column(page, 1).locator('xpath=..');

/**
 * Drags a card onto a board column with the mouse. The card is grabbed on its side nearer the target (below its
 * heart and ⋯ buttons) and dropped just inside the target's near edge, so the two points are as close as they get.
 * A point off screen, or in the strips along the board's edges where dnd-kit scrolls by itself, lands the drop
 * somewhere else (the Archived column sits past the right edge of a 1440 px window): the board is scrolled first so
 * both points are well inside it.
 */
async function dragTo(page: Page, source: Locator, target: Locator) {
  const points = async () => {
    const from = await source.boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) throw new Error('drag source or target is not on the page');
    const rightward = to.x > from.x;
    return {
      grab: { x: rightward ? from.x + from.width - 40 : from.x + 40, y: from.y + 64 },
      drop: { x: rightward ? to.x + 60 : to.x + to.width - 60, y: to.y + 100 },
    };
  };
  let { grab, drop } = await points();
  const width = page.viewportSize()?.width ?? 1440;
  // BoardView auto-scrolls within 8% of the board's width from either edge.
  const margin = Math.ceil(width * 0.08) + 40;
  if (Math.min(grab.x, drop.x) < margin || Math.max(grab.x, drop.x) > width - margin) {
    const shift = Math.round((grab.x + drop.x) / 2 - width / 2);
    await boardScroller(page).evaluate((element, by) => {
      element.scrollLeft += by;
    }, shift);
    ({ grab, drop } = await points());
  }
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  // dnd-kit's mouse sensor starts after 8 px; move in steps so it sees the motion.
  await page.mouse.move(grab.x + (drop.x > grab.x ? 12 : -12), grab.y + 6, { steps: 4 });
  await page.mouse.move(drop.x, drop.y - 4, { steps: 12 });
  await page.mouse.move(drop.x, drop.y, { steps: 2 });
  await page.mouse.up();
}

/** The account's application counts, as the server has them (a drop is only checked once it is saved). */
async function serverCounts(request: APIRequestContext) {
  return (await (await request.get('/api/applications/counts')).json()) as {
    active: number;
    archived: number;
    byStatus: Record<string, number>;
  };
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
    // Each "Required" goes as soon as its field is filled.
    await sheet.getByLabel('Position Title').fill('Platform Engineer');
    await expect(sheet.getByText('Required')).toHaveCount(1);
    // A company typed and left (no pick from the suggestions) is kept.
    await sheet.getByRole('combobox', { name: 'Company' }).fill('Globex');
    await expect(sheet.getByText('Required')).toHaveCount(0);
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
    // The message goes as soon as the pay is edited.
    await expect(detail.getByText('Max salary must be greater than min salary')).toBeHidden();
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
    await timeline.getByRole('button', { name: 'Add date for Applied' }).click();
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

  test('Import CSV wizard: map columns, review companies, map statuses and job types', async ({ page }) => {
    const request = await signInFresh(page, 'tracker-import@tailorit.dev');
    await page.goto('/tracker?view=list');
    await expect(page.getByText('Add your first job application!')).toBeVisible();
    await expect(page.getByText('No more endless spreadsheets, keep track of everything in one place.')).toBeVisible();
    // A company the account already tracks is one TailorIT knows (so are the job board's).
    await request.post('/api/applications', {
      headers: { Origin: ORIGIN },
      data: { title: 'Earlier Role', companyName: 'Acme', employmentType: 'full_time' },
    });

    await page.getByRole('button', { name: /^Options/ }).click();
    await page.getByRole('menuitem', { name: 'Import CSV' }).click();
    const wizard = page.getByRole('dialog', { name: 'Import Applications from CSV' });
    await expect(wizard.getByText('Expected headers: Company name, Position Title. Location is optional.')).toBeVisible();
    const csv = [
      'Company,Job Title,Where,Stage,Date Applied,Type',
      'Acme,Backend Engineer,Remote,Phone call,10/01/2026,Permanent',
      'Qwertyuiop Dynamics,Software Engineering Intern,"Austin, TX",Rejected,2026-09-15,',
      'Initech,Data Analyst,,Applied,,Seasonal',
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

    // Review companies: the ones TailorIT does not know yet, each of which can be changed.
    await expect(wizard.getByRole('heading', { name: 'Review companies' })).toBeVisible();
    await expect(wizard.getByRole('combobox', { name: 'Acme' })).toHaveCount(0);
    const unknown = wizard.getByRole('combobox', { name: 'Qwertyuiop Dynamics' });
    await expect(unknown).toHaveValue('Qwertyuiop Dynamics');
    await unknown.fill('Globex');
    await page.keyboard.press('Tab');
    await wizard.getByRole('button', { name: 'Next' }).click();

    await expect(wizard.getByRole('heading', { name: 'Map status values' })).toBeVisible();
    await wizard.getByRole('combobox', { name: 'Status for Phone call' }).click();
    await page.getByRole('option', { name: 'Screen' }).click();
    await wizard.getByRole('button', { name: 'Next' }).click();

    // Map job types: "Permanent" reads as Full-Time; "Seasonal" is asked about.
    await expect(wizard.getByRole('heading', { name: 'Map job types' })).toBeVisible();
    await expect(wizard.getByRole('combobox', { name: 'Job type for Permanent' })).toHaveCount(0);
    await wizard.getByRole('combobox', { name: 'Job type for Seasonal' }).click();
    await page.getByRole('option', { name: 'Contract' }).click();
    await wizard.getByRole('button', { name: 'Import 3 applications' }).click();
    await expect(wizard.getByText('All 3 applications imported successfully!')).toBeVisible();
    await wizard.getByRole('button', { name: 'Done' }).click();

    const rows = page.locator('[data-application-row]');
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: 'Backend Engineer' }).getByRole('list')).toContainText('Screen10/1/26');
    await expect(rows.filter({ hasText: 'Software Engineering Intern' })).toContainText('Austin, TX');
    // What the review chose is what was imported.
    await expect(rows.filter({ hasText: 'Software Engineering Intern' })).toContainText('Globex');
    const types = (await (await request.get('/api/applications?sort=title&order=asc')).json()) as {
      items: Array<{ title: string; employmentType: string }>;
    };
    expect(types.items.map((item) => [item.title, item.employmentType])).toEqual([
      ['Backend Engineer', 'full_time'],
      ['Data Analyst', 'contract'],
      ['Earlier Role', 'full_time'],
      ['Software Engineering Intern', 'internship'],
    ]);
  });

  test('Import CSV: a batch that fails waits for Retry or Skip, and the summary names its rows', async ({ page }) => {
    const request = await signInFresh(page, 'tracker-import-retry@tailorit.dev');
    await request.post('/api/applications', {
      headers: { Origin: ORIGIN },
      data: { title: 'Earlier Role', companyName: 'Acme', employmentType: 'full_time' },
    });
    // The import endpoint fails the next `failures` requests (a server that is briefly down).
    let failures = 0;
    await page.route('**/api/applications/import', async (route) => {
      if (failures === 0) return route.continue();
      failures -= 1;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'The server is busy. Please try again.' } }),
      });
    });
    const runImport = async (titles: string[]) => {
      await page.getByRole('button', { name: /^Options/ }).click();
      await page.getByRole('menuitem', { name: 'Import CSV' }).click();
      const wizard = page.getByRole('dialog', { name: 'Import Applications from CSV' });
      const csv = ['Company,Position Title', ...titles.map((title) => `Acme,${title}`)].join('\n');
      await wizard.getByLabel('CSV file').setInputFiles({ name: 'applications.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
      await wizard.getByRole('button', { name: 'Next' }).click();
      await wizard.getByRole('button', { name: `Import ${titles.length} applications` }).click();
      return wizard;
    };
    await page.goto('/tracker?view=list');

    // Retry sends the same rows again (a failed batch wrote nothing).
    failures = 1;
    let wizard = await runImport(['First Role', 'Second Role']);
    await expect(wizard.getByText('Import paused')).toBeVisible();
    await expect(wizard.getByText(/Rows 2–3 couldn.t be imported: The server is busy\. Please try again\./)).toBeVisible();
    await wizard.getByRole('button', { name: 'Retry' }).click();
    await expect(wizard.getByText('All 2 applications imported successfully!')).toBeVisible();
    await wizard.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('[data-application-row]')).toHaveCount(3);

    // Skip moves on without them; the summary says which rows were not imported, and why.
    failures = 1;
    wizard = await runImport(['Third Role']);
    await wizard.getByRole('button', { name: 'Skip these rows' }).click();
    await expect(wizard.getByRole('heading', { name: 'Import Complete' })).toBeVisible();
    await expect(wizard.getByText('0 of 1 applications imported. These rows were not imported:')).toBeVisible();
    await expect(wizard.getByRole('list', { name: 'Rows not imported' })).toContainText('Row 2: The server is busy. Please try again.');
    await wizard.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('[data-application-row]')).toHaveCount(3);
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
    // Columns without a match say so, not "Move applications into …".
    await expect(column(page, 12).getByText('None match your search or filters.')).toBeVisible();
    // Nothing matches: the board says it once, as the list does, instead of a row of empty columns.
    await page.getByRole('searchbox', { name: 'Search for roles or companies' }).fill('zzz-no-such-role');
    await expect(page.getByText('Oops! No matching applications found.')).toBeVisible();
    await expect(page.getByText('Please update your search criteria and try again.')).toBeVisible();
    await expect(page.locator('[data-column]')).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search for roles or companies' }).fill('');
    await expect(page.locator('[data-application-card]')).toHaveCount(3);

    // Options opens on hover (and closes when the pointer leaves), as well as on click.
    await page.getByRole('button', { name: /^Options/ }).hover();
    await expect(page.getByRole('menu', { name: 'Options' })).toBeVisible();
    await page.mouse.move(5, 600);
    await expect(page.getByRole('menu', { name: 'Options' })).toBeHidden();

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

    // The Archived column is the last one, past the window's right edge: dragTo scrolls the board to it first.
    await dragTo(page, card(column(page, 2), 'Old Role'), archived);
    await expect.poll(async () => (await serverCounts(request)).archived).toBe(1);
    await expect(card(archived, 'Old Role')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Archived (1)' })).toBeVisible();

    // Dragged out onto Interviewing: restored, and moved there.
    await dragTo(page, card(archived, 'Old Role'), column(page, 12));
    await expect.poll(() => serverCounts(request)).toMatchObject({ active: 2, archived: 0, byStatus: { '12': 1 } });
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

    // The first letter the cover letter editor makes for an application becomes its cover letter; a later one is
    // offered under "Written for this job" and can take its place.
    const makeLetter = async () => {
      const letter = await request.post('/api/cover-letters', { headers: { Origin: ORIGIN }, data: { applicationId: created.id } });
      return letter.ok() ? ((await letter.json()) as { id: string }) : null;
    };
    const first = await makeLetter();
    test.skip(!first, 'the cover letter API is not available on this server');
    const second = (await makeLetter())!;
    await page.goto(`/tracker?app=${created.id}`);
    const detail = page.getByRole('dialog', { name: 'Keys Role' });
    await detail.getByRole('tab', { name: 'Documents' }).click();
    const letters = detail.getByRole('region', { name: 'Cover Letter' });
    const written = detail.getByRole('region', { name: 'Written for this job' });
    await expect(letters.locator(`a[href="/cover-letter/${first!.id}"]`)).toHaveCount(1);
    await expect(written.locator(`a[href="/cover-letter/${second.id}"]`)).toBeVisible();
    await written.getByRole('button', { name: 'Use for this application' }).click();
    // The second is the application's letter now, and the first is offered in its place.
    await expect(written.locator(`a[href="/cover-letter/${first!.id}"]`)).toBeVisible();
    await expect(written.locator(`a[href="/cover-letter/${second.id}"]`)).toHaveCount(0);
    await expect(letters.locator(`a[href="/cover-letter/${second.id}"]`)).toHaveCount(1);
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

test.describe('job tracker on a phone', () => {
  test.describe.configure({ retries: 2 });
  test.use({ viewport: { width: 390, height: 844 } });

  test('no sideways scroll, whole list titles, and a detail sheet with ✕ beside the title and a Status tab', async ({ page }) => {
    test.setTimeout(90_000);
    const request = await signInFresh(page, 'tracker-phone@tailorit.dev');
    const long = 'Distinguished Platform Solutions Architect';
    await request.post('/api/applications', {
      headers: { Origin: ORIGIN },
      data: { title: long, companyName: 'Experian', location: 'Costa Mesa, CA', employmentType: 'full_time' },
    });
    // Two-digit counts make the tabs row as wide as it gets.
    for (let index = 1; index <= 11; index += 1) {
      await request.post('/api/applications', {
        headers: { Origin: ORIGIN },
        data: { title: `Role ${index}`, companyName: 'Phone Co', employmentType: 'full_time', status: 1 },
      });
    }
    const pageWidth = () => page.evaluate(() => document.documentElement.scrollWidth);

    await page.goto('/tracker');
    await expect(page.getByRole('tab', { name: 'Active (12)' })).toBeVisible();
    expect(await pageWidth()).toBeLessThanOrEqual(390);
    // "Add application" is a "+" that fits beside the tabs, inside the page gutter.
    const add = (await page.getByRole('button', { name: 'Add application' }).boundingBox())!;
    expect(add.x + add.width).toBeLessThanOrEqual(390 - 16 + 0.5);

    // The list: the whole title reads (two lines at most), with the status and "Status ⌄" under it.
    await page.getByRole('tab', { name: 'List' }).click();
    const row = page.locator('[data-application-row]').filter({ hasText: long });
    const title = row.getByRole('button', { name: long });
    await expect(title).toBeVisible();
    const fits = await title.evaluate((element) => {
      const text = element.firstElementChild as HTMLElement;
      return text.scrollWidth <= text.clientWidth + 1 && text.scrollHeight <= text.clientHeight + 1;
    });
    expect(fits).toBe(true);
    const titleBox = (await title.boundingBox())!;
    const statusBox = (await row.getByRole('button', { name: /^Status: / }).boundingBox())!;
    expect(statusBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
    expect(await pageWidth()).toBeLessThanOrEqual(390);

    // The detail: ✕ stays on the title's line; the Status tab holds the status timeline and the notes.
    await title.click();
    const detail = page.getByRole('dialog', { name: long });
    const heading = (await detail.getByRole('heading', { name: long }).boundingBox())!;
    const close = (await detail.getByRole('button', { name: 'Close' }).boundingBox())!;
    expect(close.y).toBeLessThan(heading.y + heading.height);
    expect(close.y + close.height).toBeGreaterThan(heading.y);
    expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await detail.getByRole('tab', { name: 'Status' }).click();
    await expect(detail.getByRole('combobox', { name: 'Application status' })).toBeVisible();
    await expect(detail.getByRole('list', { name: 'Status timeline' })).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Add date for Screen' })).toBeVisible();
    await expect(detail.getByRole('textbox', { name: 'Notes' })).toBeVisible();
  });
});
