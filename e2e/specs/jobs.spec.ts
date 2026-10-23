import { expect, test, type Page } from '@playwright/test';

/*
 * Work package J2: the Jobs page against the dev server (`npm run dev`) and the jobs in its database (J1's seed or
 * J2's demo rows). Each run signs in as a fresh account, so saved/applied state starts empty.
 *   npx playwright test --project=e2e e2e/specs/jobs.spec.ts
 */

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const CODE = process.env.AUTH_DEV_FIXED_CODE ?? '000000';

/** Signs a new account in through the API (a few tries: the dev API restarts whenever a package edits its source). */
async function signInFresh(page: Page, label: string): Promise<string> {
  const email = `j2-e2e-${label}-${Date.now()}@tailorit.dev`;
  let last = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await page.request.post('/api/auth/email/verify', { headers: { Origin: ORIGIN }, data: { email, code: CODE } });
    if (res.ok()) return email;
    last = `${res.status()} ${await res.text()}`;
    await page.waitForTimeout(2_000);
  }
  expect(last, 'sign-in failed').toBe('');
  return email;
}

/** "M/D/YY" of the browser's today, as the Applied chip prints it. */
function todayMDYY(): string {
  const now = new Date();
  return `${now.getMonth() + 1}/${now.getDate()}/${String(now.getFullYear() % 100).padStart(2, '0')}`;
}

const cards = (page: Page) => page.getByRole('list', { name: 'Jobs' }).locator('[data-job-card]');
const detail = (page: Page) => page.getByRole('region', { name: 'Job details' });

async function openJobs(page: Page, path = '/jobs') {
  await page.goto(path);
  await expect(cards(page).first()).toBeVisible();
  await expect(page).toHaveURL(/jobId=\d+/);
}

/** Creates a resume through R1's API when it is live; false when it is not there yet. */
async function tryCreateResume(page: Page): Promise<boolean> {
  const res = await page.request.post('/api/resumes', {
    headers: { Origin: ORIGIN },
    data: {
      title: 'E2E resume',
      document: {
        name: 'Jordan Rivera',
        title: 'Senior Platform Engineer',
        summary: 'Platform engineer running Kubernetes and Docker on Linux, writing Python and Go, with Terraform on AWS.',
        skills: ['Kubernetes', 'Docker', 'Linux', 'Python', 'Go', 'Terraform', 'AWS', 'PostgreSQL', 'React', 'TypeScript'],
      },
    },
  });
  return res.status() === 201 || res.status() === 200;
}

test.describe('Jobs page', () => {
  test('search, filter, open a job, save it, apply, see the Applied chip and the keyword card', async ({ page }) => {
    await signInFresh(page, 'flow');
    const hasResume = await tryCreateResume(page);
    await openJobs(page);
    const found = page.getByRole('status').filter({ hasText: /^Found [\d,]+ jobs?$/ });
    await expect(found).toBeVisible();

    // Search: the list narrows and the address keeps the words.
    await page.getByRole('searchbox', { name: 'Find your dream role' }).fill('engineer');
    await expect(page).toHaveURL(/[?&]q=engineer/);
    await expect(cards(page).first()).toContainText(/engineer/i);

    // Job Type → Full-Time; the pill shows its count.
    await page.getByRole('button', { name: /^Job Type/ }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Full-Time' }).click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/[?&]type=full_time/);
    await expect(page.getByRole('button', { name: /^Job Type/ })).toContainText('1');

    // Experience Level → Senior.
    await page.getByRole('button', { name: /^Experience Level/ }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Senior' }).click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/[?&]level=senior/);
    await expect(found).toHaveText(/^Found [\d,]+ jobs?$/);
    const count = await cards(page).count();
    expect(count).toBeGreaterThan(0);

    // Open a job from the list whose analysis has keywords (the second card when none does): it is highlighted and
    // its detail shows.
    let pick = count > 1 ? 1 : 0;
    for (let index = 0; index < count; index += 1) {
      const id = await cards(page).nth(index).getAttribute('data-job-card');
      const match = (await (await page.request.get(`/api/jobs/${id}/match`)).json()) as { total: number };
      if (match.total > 0) {
        pick = index;
        break;
      }
    }
    const card = cards(page).nth(pick);
    const title = (await card.locator('h3').innerText()).trim();
    await card.locator('a').click();
    await expect(card.locator('a')).toHaveAttribute('aria-current', 'true');
    await expect(detail(page).getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(page).toHaveURL(/[?&]jobId=\d+/);

    // Save: the button and the card's bookmark both read Saved.
    const saveButton = detail(page).getByRole('button', { name: 'Save', exact: true });
    await saveButton.click();
    await expect(detail(page).getByRole('button', { name: 'Saved', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(card.getByRole('button', { name: `Remove ${title} from saved jobs` })).toBeVisible();

    // Un-save archives the tracker application (never deletes it) and offers Undo, which saves it again.
    await detail(page).getByRole('button', { name: 'Saved', exact: true }).click();
    await expect(page.getByText('Removed from saved jobs', { exact: true })).toBeVisible();
    await expect(saveButton).toHaveAttribute('aria-pressed', 'false');
    await expect(card.getByRole('button', { name: `Save ${title}` })).toBeVisible();
    const archived = (await (await page.request.get('/api/applications?tab=archived')).json()) as { items: Array<{ title: string }> };
    expect(archived.items.map((item) => item.title)).toContain(title);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(detail(page).getByRole('button', { name: 'Saved', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(card.getByRole('button', { name: `Remove ${title} from saved jobs` })).toBeVisible();

    // Apply opens the posting in a new tab, then asks "Did you apply?"; Yes records Applied today.
    const popup = page.waitForEvent('popup');
    await detail(page).getByRole('button', { name: 'Apply', exact: true }).click();
    await (await popup).close();
    const dialog = page.getByRole('dialog', { name: 'Did you apply?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Yes, I applied' }).click();
    await expect(dialog).toBeHidden();
    await expect(detail(page).locator('[data-applied-chip]')).toHaveText(`Applied ${todayMDYY()}`);
    await expect(detail(page).getByRole('button', { name: 'Already Applied?' })).toHaveCount(0);

    // The tracker has it as Applied.
    const tracked = await page.request.get('/api/applications');
    expect(tracked.ok()).toBeTruthy();
    const body = (await tracked.json()) as { items: Array<{ title: string; currentStatus: number }> };
    expect(body.items.find((item) => item.title === title)?.currentStatus).toBe(2);

    // The keyword card: "X out of Y" with a resume, else the request for one. Never a Tailor button.
    const improve = page.locator('[data-improve-card]');
    await expect(improve.getByRole('heading', { name: 'Improve Your Resume' })).toBeVisible();
    if (hasResume) {
      const score = improve.getByTestId('keyword-score');
      const noKeywords = improve.getByText("We didn't find any skill keywords in this posting.");
      await expect(score.or(noKeywords)).toBeVisible();
      if (await score.isVisible()) {
        await expect(score).toHaveText(/^\d+ out of \d+ required keywords found$/);
        const [found, total] = ((await score.innerText()).match(/\d+/g) ?? []).map(Number);
        expect(found).toBeLessThanOrEqual(total!);
        // Matched chips first (tinted, with a check), then the missing ones.
        const chips = improve.locator('[data-keyword]');
        const kinds = await chips.evaluateAll((items) => items.map((item) => item.getAttribute('data-keyword')));
        expect(kinds.filter((kind) => kind === 'matched')).toHaveLength(found!);
        expect(kinds).toEqual([...kinds].sort((a, b) => (a === b ? 0 : a === 'matched' ? -1 : 1)));
        // Collapsed to two rows: "Show N more" counts the chips left out; it toggles to "Show less".
        const more = improve.getByRole('button', { name: /^Show \d+ more$/ });
        if (await more.isVisible()) {
          const hidden = Number(((await more.innerText()).match(/\d+/) ?? ['0'])[0]);
          await expect(improve.locator('[data-keyword][aria-hidden="true"]')).toHaveCount(hidden);
          await more.click();
          await expect(improve.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
          await expect(improve.locator('[data-keyword][aria-hidden="true"]')).toHaveCount(0);
        }
      }
    } else {
      await expect(improve.getByText('Add a resume', { exact: true })).toBeVisible();
      await expect(improve.getByText("Upload or create a resume and we'll score it against this job's keywords.")).toBeVisible();
      await expect(improve.getByRole('link', { name: 'Create a resume' })).toHaveAttribute('href', '/resumes/new');
      await expect(improve.getByRole('link', { name: 'Upload a resume' })).toHaveAttribute('href', '/documents?tab=resumes');
    }
    await expect(page.getByRole('button', { name: /tailor my resume/i })).toHaveCount(0);

    // "Hide applied jobs" (All filters → Preferences) drops it from the list.
    await page.getByRole('button', { name: 'All filters', exact: true }).click();
    const filters = page.getByRole('dialog', { name: 'All filters' });
    await filters.getByRole('switch', { name: "Hide jobs I've applied to" }).click();
    await filters.getByRole('button', { name: /^Show [\d,]+ jobs?$|^Show jobs$/ }).click();
    await expect(page).toHaveURL(/[?&]hideApplied=1/);
    await expect(page.getByRole('list', { name: 'Jobs' }).getByRole('heading', { name: title, exact: true })).toHaveCount(0);
  });

  test('keeps the filters and the job in the address; sort, clear all and reload', async ({ page }) => {
    await signInFresh(page, 'url');
    await openJobs(page, '/jobs?type=full_time&sort=salary');
    await expect(page.getByRole('button', { name: /^Sort jobs: Highest salary/ })).toBeVisible();
    const second = cards(page).nth(1);
    const id = await second.getAttribute('data-job-card');
    await second.locator('a').click();
    await expect(page).toHaveURL(new RegExp(`jobId=${id}`));

    await page.reload();
    await expect(cards(page).nth(1).locator('a')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('button', { name: /^Job Type/ })).toContainText('1');

    await page.getByRole('button', { name: /^Sort jobs/ }).click();
    await page.getByRole('menuitemradio', { name: 'Recently posted' }).click();
    await expect(page).toHaveURL(/[?&]sort=posted/);

    await page.getByRole('button', { name: 'Clear all filters' }).click();
    await expect(page).not.toHaveURL(/type=full_time/);
    await expect(page.getByRole('button', { name: /^Job Type/ })).not.toContainText('1');
  });

  test('detail: live chip, facts with the level check, Summary / Full posting, Company anchor', async ({ page }) => {
    await signInFresh(page, 'detail');
    const prefs = await page.request.get('/api/me/preferences');
    const current = (await prefs.json()) as Record<string, unknown>;
    await page.request.put('/api/me/preferences', {
      headers: { Origin: ORIGIN },
      data: { ...((current.preferences as object | undefined) ?? current), experienceLevels: ['senior'] },
    });
    await openJobs(page, '/jobs?level=senior');
    const panel = detail(page);
    await expect(panel.locator('[data-live-chip]')).toHaveText(/^(Posted on|Updated on) .+|^Confirmed live in the last 24 hours$/);
    await expect(panel.getByRole('listitem', { name: 'Salary' })).toBeVisible();
    // A Senior job for someone looking for Senior roles: the green check.
    await expect(panel.locator('[data-level-match="match"]')).toBeVisible();
    await panel.locator('[data-level-match="match"]').hover();
    await expect(page.getByText(/^Your experience level matches one of the following:/)).toBeVisible();

    await expect(panel.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true');
    await panel.getByRole('tab', { name: 'Full posting' }).click();
    await expect(panel.getByRole('tab', { name: 'Full posting' })).toHaveAttribute('aria-selected', 'true');
    await expect(panel.locator('section[aria-labelledby="about-the-job"]')).not.toContainText('Loading');

    await panel.getByRole('tab', { name: 'Company' }).click();
    await expect(panel.getByRole('heading', { name: 'About the company' })).toBeInViewport();
    await expect(panel.getByRole('tab', { name: 'Company' })).toHaveAttribute('aria-selected', 'true');
  });

  test('on a phone: choosing a job brings its detail into view, nothing is cut off, and the arrow goes back', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInFresh(page, 'phone');
    await openJobs(page);

    // The toolbar wraps without a divider left at either end of a row.
    const dividers = await page.locator('[data-toolbar-divider]').evaluateAll((items) =>
      items
        .filter((item) => item.getBoundingClientRect().width > 0)
        .map((item) => {
          const middle = (element: Element | null) => {
            const box = element?.getBoundingClientRect();
            return box && box.width > 0 ? box.top + box.height / 2 : null;
          };
          return { self: middle(item), before: middle(item.previousElementSibling), after: middle(item.nextElementSibling) };
        }),
    );
    for (const divider of dividers) {
      expect(divider.before).not.toBeNull();
      expect(divider.after).not.toBeNull();
      expect(Math.abs(divider.before! - divider.self!)).toBeLessThan(4);
      expect(Math.abs(divider.after! - divider.self!)).toBeLessThan(4);
    }

    const card = cards(page).nth(2);
    const title = (await card.locator('h3').innerText()).trim();
    await card.locator('a').click();
    const heading = detail(page).getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(title);
    await expect(heading).toBeInViewport();

    // Every header action is inside the panel: the row wraps instead of running off its left edge.
    const panel = (await detail(page).boundingBox())!;
    for (const control of await page.locator('[data-detail-header]').locator('button, a').all()) {
      if (!(await control.isVisible())) continue;
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(panel.x);
      expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
    }

    await detail(page).getByRole('button', { name: 'Back to the job list' }).click();
    await expect(card).toBeInViewport();
  });

  test('a job that no longer exists offers "Back to jobs" (not "Try again")', async ({ page }) => {
    await signInFresh(page, 'gone');
    await page.goto('/jobs?jobId=999999999');
    await expect(detail(page).getByText('This job is no longer available')).toBeVisible();
    await expect(detail(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await detail(page).getByRole('button', { name: 'Back to jobs' }).click();
    // The list's first job opens instead.
    await expect(cards(page).first().locator('a')).toHaveAttribute('aria-current', 'true');
    await expect(page).not.toHaveURL(/jobId=999999999/);
  });

  test('hide a job (with undo), share a link and report a job', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
    await signInFresh(page, 'hide');
    await openJobs(page);
    const first = cards(page).first();
    const title = (await first.locator('h3').innerText()).trim();

    await detail(page).getByRole('button', { name: 'Hide options' }).click();
    await page.getByRole('menuitem', { name: 'Hide this job' }).click();
    await expect(page.getByText('Job hidden', { exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Jobs' }).getByRole('heading', { name: title, exact: true })).toHaveCount(0);
    // The next job opens.
    await expect(detail(page).getByRole('heading', { level: 1 })).not.toHaveText(title);
    // Undo brings it back into the list straight away.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('list', { name: 'Jobs' }).getByRole('heading', { name: title, exact: true })).toHaveCount(1);

    await detail(page).getByRole('button', { name: 'Share: copy a link to this job' }).click();
    await expect(page.getByText('Link copied', { exact: true })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/\/jobs\?jobId=\d+$/);

    await detail(page).getByRole('button', { name: 'Report this job' }).click();
    const report = page.getByRole('dialog', { name: 'Report this job' });
    await report.getByRole('radio', { name: 'The details are wrong' }).click();
    await report.getByRole('textbox').fill('The salary is out of date.');
    await report.getByRole('button', { name: 'Report job' }).click();
    await expect(report).toBeHidden();
    await expect(page.getByText('Thanks for the report', { exact: true })).toBeVisible();
  });

  test('the Location and Category pills, and every filter of All filters, reach the address and the list', async ({ page }) => {
    await signInFresh(page, 'filters');
    await openJobs(page);
    const found = page.getByRole('status').filter({ hasText: /^Found [\d,]+ jobs?$/ });

    // Location: a suggested place, a "Remote in" country and a work arrangement; the pill counts all three.
    await page.getByRole('button', { name: /^Location/ }).click();
    const places = page.getByRole('list', { name: 'Suggested places' }).getByRole('button');
    await expect(places.first()).toBeVisible();
    await places.first().click();
    await expect(page).toHaveURL(/[?&]location=/);
    await page.getByRole('button', { name: /^Remote in / }).first().click();
    await expect(page).toHaveURL(/[?&]remote=[A-Z]{2}/);
    await page.getByRole('button', { name: 'Hybrid', exact: true }).click();
    await expect(page).toHaveURL(/[?&]arrangement=hybrid/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^Location/ })).toContainText('3');
    await expect(found.or(page.getByText('No matching jobs found'))).toBeVisible();
    await page.getByRole('button', { name: 'Clear all filters' }).click();
    await expect(page).not.toHaveURL(/location=|remote=|arrangement=/);

    // Category: tick the category with the most jobs.
    await page.getByRole('button', { name: /^Category/ }).click();
    const categories = page.getByRole('list', { name: 'Categories' });
    await categories.getByRole('checkbox').first().click();
    await expect(page).toHaveURL(/[?&]category=[a-z-]+/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^Category/ })).toContainText('1');
    await expect(found).toBeVisible();
    await page.getByRole('button', { name: 'Clear all filters' }).click();

    // All filters: a draft until "Show N jobs".
    await page.getByRole('button', { name: 'All filters', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'All filters' });
    await dialog.getByRole('button', { name: 'Past month', exact: true }).click();
    // A filter only appears when the data has values for it: each is used when present, and asserted then.
    const expected: RegExp[] = [/[?&]updated=30(&|$)/];
    const salary = dialog.getByRole('slider', { name: 'Minimum salary' });
    if (await salary.isVisible()) {
      await salary.focus();
      for (let step = 0; step < 5; step += 1) await page.keyboard.press('ArrowRight');
      expected.push(/[?&]minSalary=50000(&|$)/);
    }
    const h1b = dialog.getByRole('switch', { name: 'Only companies that sponsor H1B visas' });
    if (await h1b.isVisible()) {
      await h1b.click();
      expected.push(/[?&]h1b=1(&|$)/);
    }
    const ic = dialog.getByRole('button', { name: 'Individual Contributor', exact: true });
    if (await ic.isVisible()) {
      await ic.click();
      expected.push(/[?&]leadership=ic(&|$)/);
    }
    const clearance = dialog.getByRole('button', { name: 'No security clearance required', exact: true });
    if (await clearance.isVisible()) {
      await clearance.click();
      expected.push(/[?&]clearance=not_required(&|$)/);
    }
    await dialog.getByRole('switch', { name: "Hide jobs I've applied to" }).click();
    expected.push(/[?&]hideApplied=1(&|$)/);
    await dialog.getByRole('button', { name: /^Show [\d,]+ jobs?$/ }).click();
    await expect(dialog).toBeHidden();
    for (const pattern of expected) await expect(page).toHaveURL(pattern);
    await expect(found.or(page.getByText('No matching jobs found'))).toBeVisible();
    // The All filters button counts what it holds (everything but the four pills' filters).
    await expect(page.getByRole('button', { name: 'All filters', exact: true }).locator('..')).toContainText(String(expected.length));
  });

  test('saves the current search with the bookmark, applies it again and deletes it', async ({ page }) => {
    await signInFresh(page, 'saved');
    await openJobs(page, '/jobs?q=engineer&type=full_time');
    await page.getByRole('button', { name: 'Saved searches' }).click();
    const popover = page.getByRole('dialog', { name: 'Saved searches' });
    await popover.getByRole('button', { name: 'Save this search' }).click();
    const name = popover.getByRole('textbox', { name: 'Name this search' });
    await expect(name).toHaveValue('engineer, Full-Time');
    await name.fill('Engineering roles');
    await popover.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Search saved', { exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Saved searches' }).getByText('Engineering roles')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Clear all filters' }).click();
    await expect(page).not.toHaveURL(/q=engineer/);
    await page.getByRole('button', { name: 'Saved searches' }).click();
    await page.getByRole('list', { name: 'Saved searches' }).getByText('Engineering roles').click();
    await expect(page).toHaveURL(/[?&]q=engineer/);
    await expect(page).toHaveURL(/[?&]type=full_time/);
    await expect(page.getByRole('searchbox', { name: 'Find your dream role' })).toHaveValue('engineer');

    await page.getByRole('button', { name: 'Saved searches' }).click();
    await page.getByRole('button', { name: 'Delete Engineering roles' }).click();
    await expect(page.getByText('No saved searches yet.', { exact: false })).toBeVisible();
  });

  test("keeps Simplify's measured sizes and colours (screenshots-spec, simplify-1.png)", async ({ page }) => {
    await signInFresh(page, 'styles');
    await openJobs(page);
    const css = (locator: ReturnType<Page['locator']>, property: string) =>
      locator.evaluate((element, prop) => getComputedStyle(element).getPropertyValue(prop), property);

    // Toolbar: a 36 px search pill as wide as the list panel (a third of the frame).
    const search = page.getByRole('searchbox', { name: 'Find your dream role' });
    expect((await search.boundingBox())?.height).toBe(36);
    const frame = await page.locator('[data-jobs-frame]').boundingBox();
    const listPanel = await page.getByRole('region', { name: 'Job list' }).boundingBox();
    expect(Math.abs((listPanel?.width ?? 0) - (frame?.width ?? 0) / 3)).toBeLessThan(2);
    expect(await css(page.locator('[data-jobs-frame]'), 'border-top-left-radius')).toBe('16px');

    // List: "Found N jobs" 12 px muted; the selected card #ccf6ff; titles 16 px.
    const found = page.getByRole('status').filter({ hasText: /^Found / });
    expect(await css(found, 'font-size')).toBe('12px');
    expect(await css(found, 'color')).toBe('rgb(125, 125, 125)');
    const selected = cards(page).first();
    expect(await css(selected, 'background-color')).toBe('rgb(204, 246, 255)');
    expect(await css(selected.locator('h3'), 'font-size')).toBe('16px');
    expect(await css(cards(page).nth(1), 'background-color')).toBe('rgb(255, 255, 255)');

    // Detail: a 61 px sticky header, a 24 px bold title, the job-type and live chips, the teal Apply.
    const panel = detail(page);
    expect((await panel.locator('[data-detail-header]').boundingBox())?.height).toBe(61);
    const title = panel.getByRole('heading', { level: 1 });
    expect(await css(title, 'font-size')).toBe('24px');
    expect(await css(title, 'font-weight')).toBe('700');
    const typeChip = panel.getByText(/^(Full-Time|Part-Time|Internship|Contract)$/).first();
    if (await typeChip.count()) {
      const pill = typeChip.locator('xpath=ancestor-or-self::span[contains(@class,"rounded-full")][1]');
      expect(await css(pill, 'background-color')).toBe('rgb(204, 246, 255)');
      expect(await css(pill, 'color')).toBe('rgb(8, 117, 140)');
    }
    const live = panel.locator('[data-live-chip]').locator('..');
    expect(await css(live, 'background-color')).toBe('rgb(235, 235, 235)');
    const apply = panel.getByRole('button', { name: 'Apply', exact: true });
    if (await apply.count()) {
      expect(await css(apply, 'background-color')).toBe('rgb(20, 161, 192)');
      expect((await apply.boundingBox())?.height).toBe(36);
    }
    expect(await css(panel.getByRole('heading', { name: 'About the job' }), 'font-size')).toBe('22px');

    // The "Improve Your Resume" card: radius 16, the sampled border, a #ccf6ff → white wash.
    const improve = page.locator('[data-improve-card]');
    expect(await css(improve, 'border-top-left-radius')).toBe('16px');
    expect(await css(improve, 'border-top-color')).toBe('rgb(167, 212, 222)');
    expect(await css(improve, 'background-image')).toContain('linear-gradient');
  });

  test('loads the next 21 jobs as the list scrolls (when there are more than 21)', async ({ page }) => {
    await signInFresh(page, 'scroll');
    await openJobs(page);
    const total = Number(
      ((await page.getByRole('status').filter({ hasText: /^Found / }).innerText()).match(/[\d,]+/)?.[0] ?? '0').replace(/,/g, ''),
    );
    test.skip(total <= 21, `only ${total} jobs in the database: no second page to load`);
    await expect(cards(page)).toHaveCount(21);
    await page.getByRole('region', { name: 'Job list' }).evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect(cards(page)).toHaveCount(Math.min(42, total));
  });
});
