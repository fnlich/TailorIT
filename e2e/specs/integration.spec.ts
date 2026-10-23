import { expect, test, type Locator, type Page } from '@playwright/test';

/*
 * Work package I: one person's path through every feature, against the dev server (`npm run dev` with the fake Claude
 * CLI and AUTH_DEV_FIXED_CODE). Navigation between the areas uses the header and the editor bar (client-side, as a
 * person clicks), so what one feature changes must show in the others without a reload.
 *   Jobs (search, filter, open, Save) → Job Tracker (under Saved) → Jobs (Apply, "Did you apply?" → Applied chip)
 *   → Job Tracker (under Applied, list stepper dates) → the application's Documents → Generate cover letter (editor
 *   prefilled, the fake AI writes it) → the letter is linked on the application → Documents › Cover Letters lists it
 *   → Documents › Resumes: a resume from a template, made the default → the Jobs keyword card scores that resume.
 * And: an experience level saved in Settings reaches the Jobs page's level check.
 *   npx playwright test --project=e2e e2e/specs/integration.spec.ts
 */

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const CODE = process.env.AUTH_DEV_FIXED_CODE ?? '000000';

/** "M/D/YY" of the browser's today, as the Applied chip and the stepper print it. */
function todayMDYY(): string {
  const now = new Date();
  return `${now.getMonth() + 1}/${now.getDate()}/${String(now.getFullYear() % 100).padStart(2, '0')}`;
}

/** A fresh account (a few tries: the shared dev API restarts whenever someone saves an API file). */
async function signInFresh(page: Page): Promise<string> {
  const email = `integration-${Date.now()}-${Math.floor(Math.random() * 1e4)}@tailorit.dev`;
  let last = '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const res = await page.request
      .post('/api/auth/email/verify', { headers: { Origin: ORIGIN }, data: { email, code: CODE } })
      .catch(() => null);
    if (res?.ok()) return email;
    last = res ? `${res.status()} ${await res.text()}` : 'no answer';
    await page.waitForTimeout(1500);
  }
  throw new Error(`sign-in failed: ${last}`);
}

async function json<T>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(path);
  expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** Waits until the job's analysis is final (the fake CLI's AI analysis replaces the deterministic one on first view). */
async function settledKeywords(page: Page, jobId: number): Promise<string[]> {
  let terms: string[] = [];
  await expect
    .poll(
      async () => {
        const analysis = await json<{ refining: boolean; keywords: { high: Array<{ term: string }>; low: Array<{ term: string }> } }>(
          page,
          `/api/jobs/${jobId}/analysis`,
        );
        terms = [...analysis.keywords.high, ...analysis.keywords.low].map((keyword) => keyword.term);
        return analysis.refining;
      },
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toBe(false);
  return terms;
}

const nav = (page: Page, name: 'Jobs' | 'Job Tracker' | 'Documents') =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true });
const jobCards = (page: Page) => page.getByRole('list', { name: 'Jobs' }).locator('[data-job-card]');
const jobDetail = (page: Page) => page.getByRole('region', { name: 'Job details' });
const column = (page: Page, status: number) => page.locator(`[data-column="${status}"]`);
const trackerCard = (scope: Page | Locator, title: string) => scope.locator('[data-application-card]').filter({ hasText: title });

test.describe('integration', () => {
  test('a job from search to tracker, cover letter, default resume and keyword match', async ({ page, context }) => {
    test.setTimeout(300_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await signInFresh(page);
    // A first resume (the account's default) with nothing a tech posting asks for.
    const first = await page.request.post('/api/resumes', {
      headers: { Origin: ORIGIN },
      data: {
        document: {
          name: 'Robin Castellanos',
          title: 'Pastry Chef',
          contact: { email: 'robin@example.com', phone: '', location: 'Portland, OR' },
          summary: 'Pastry chef who bakes laminated doughs and plated desserts for a busy bistro.',
          skills: ['Lamination', 'Sugar work', 'Menu costing'],
          education: [],
        },
      },
    });
    expect(first.status()).toBe(201);
    const firstResumeId = ((await first.json()) as { id: string }).id;

    // ---------------------------------------------------------------- Jobs: search, filter, open a job, Save
    await page.goto('/jobs');
    await expect(jobCards(page).first()).toBeVisible();
    await page.getByRole('searchbox', { name: 'Find your dream role' }).fill('reliability');
    await expect(page).toHaveURL(/[?&]q=reliability/);
    await page.getByRole('button', { name: /^Job Type/ }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Full-Time' }).click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/[?&]type=full_time/);
    await expect(page.getByRole('status').filter({ hasText: /^Found [\d,]+ jobs?$/ })).toBeVisible();

    // A posting whose analysis names keywords (so the score has something to count) and that has a link to apply.
    let card: Locator | null = null;
    let jobId = 0;
    const count = await jobCards(page).count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count && !card; index += 1) {
      const id = Number(await jobCards(page).nth(index).getAttribute('data-job-card'));
      const job = await json<{ applyUrl?: string; active?: boolean }>(page, `/api/jobs/${id}`);
      if (job.active === false || !job.applyUrl) continue;
      if ((await settledKeywords(page, id)).length > 0) {
        card = jobCards(page).nth(index);
        jobId = id;
      }
    }
    expect(card, 'a job with keywords').not.toBeNull();
    const title = (await card!.locator('h3').innerText()).trim();
    await card!.locator('a').click();
    await expect(page).toHaveURL(new RegExp(`[?&]jobId=${jobId}(&|$)`));
    await expect(jobDetail(page).getByRole('heading', { level: 1 })).toHaveText(title);
    const company = (await json<{ company: { name: string } }>(page, `/api/jobs/${jobId}`)).company.name;

    await jobDetail(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(jobDetail(page).getByRole('button', { name: 'Saved', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const jobsUrl = page.url();

    // ------------------------------------------------------------------ Job Tracker: the board has it under Saved
    await nav(page, 'Job Tracker').click();
    await expect(page).toHaveURL(/\/tracker/);
    await expect(trackerCard(column(page, 1), title)).toBeVisible();
    await expect(trackerCard(column(page, 1), title)).toContainText(company);
    await expect(column(page, 2).locator('[data-application-card]')).toHaveCount(0);

    // ------------------------------------------------- Jobs again: Apply → "Did you apply?" Yes → the Applied chip
    await page.goBack();
    await expect(page).toHaveURL(jobsUrl);
    await expect(jobDetail(page).getByRole('heading', { level: 1 })).toHaveText(title);
    const popup = context.waitForEvent('page');
    await jobDetail(page).getByRole('button', { name: 'Apply', exact: true }).click();
    await (await popup).close();
    const applyDialog = page.getByRole('dialog', { name: 'Did you apply?' });
    await expect(applyDialog).toBeVisible();
    await applyDialog.getByRole('button', { name: 'Yes, I applied' }).click();
    await expect(applyDialog).toBeHidden();
    await expect(jobDetail(page).locator('[data-applied-chip]')).toHaveText(`Applied ${todayMDYY()}`);

    // --------------------------------------------- Job Tracker: under Applied; the list's stepper dates both steps
    await nav(page, 'Job Tracker').click();
    await expect(trackerCard(column(page, 2), title)).toBeVisible();
    await expect(trackerCard(column(page, 1), title)).toHaveCount(0);
    await page.getByRole('tab', { name: 'List' }).click();
    await expect(page).toHaveURL(/view=list/);
    const row = page.locator('[data-application-row]').filter({ hasText: title });
    const steps = row.getByRole('list', { name: `Progress of ${title}` }).getByRole('listitem');
    await expect(steps).toHaveCount(5);
    await expect(steps.nth(0)).toContainText(`Saved${todayMDYY()}`);
    await expect(steps.nth(1)).toContainText(`Applied${todayMDYY()}`);
    await expect(steps.nth(2)).toContainText('Screen, not reached');

    // ------------------------------- The application's Documents → Generate cover letter → the editor, prefilled
    await row.getByRole('button', { name: title, exact: true }).click();
    const detail = page.getByRole('dialog', { name: title });
    await expect(detail).toBeVisible();
    await expect(page).toHaveURL(/[?&]app=/);
    const applicationId = new URL(page.url()).searchParams.get('app')!;
    await detail.getByRole('tab', { name: 'Documents' }).click();
    const letterSection = detail.getByRole('region', { name: 'Cover Letter' });
    await expect(letterSection.getByRole('combobox', { name: 'Link existing cover letter' })).toBeVisible();
    await letterSection.getByRole('link', { name: 'Generate cover letter' }).click();

    await expect(page).toHaveURL(/\/cover-letter\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const letterId = page.url().split('/').pop()!;
    const generate = page.getByRole('dialog', { name: 'Generate a Tailored Cover Letter' });
    await expect(generate).toBeVisible({ timeout: 20_000 });
    await expect(generate.getByLabel('Company Name')).toHaveValue(company);
    await expect(generate.getByLabel('Job Title')).toHaveValue(title);
    await expect(generate.getByLabel('Job Description')).not.toHaveValue('');
    await generate.getByRole('button', { name: 'Generate' }).click();
    await expect(generate).toBeHidden({ timeout: 60_000 });
    const editor = page.locator('[data-letter-editor]');
    await expect(editor.locator('h1')).toHaveText('Robin Castellanos');
    await expect(editor).toContainText('Dear Hiring Manager,');
    await expect(editor).toContainText('I have spent the last several years building products');
    const letterTitle = (await json<{ title: string; applicationId: string | null; origin: string }>(page, `/api/cover-letters/${letterId}`));
    expect(letterTitle).toMatchObject({ applicationId, origin: 'generated' });

    // ------------------------------------------------- Back on the application: the letter is its cover letter
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`[?&]app=${applicationId}`));
    const reopened = page.getByRole('dialog', { name: title });
    await reopened.getByRole('tab', { name: 'Documents' }).click();
    const linked = reopened.getByRole('region', { name: 'Cover Letter' });
    // Linked (its card with Edit and Remove), not merely offered under "Written for this job".
    await expect(linked.getByRole('combobox', { name: 'Link existing cover letter' })).toHaveCount(0);
    await expect(linked.getByRole('region', { name: 'Written for this job' })).toHaveCount(0);
    await expect(linked.locator(`a[href="/cover-letter/${letterId}"]`)).toBeVisible();
    await expect(linked).toContainText(letterTitle.title);
    await expect(linked.getByRole('button', { name: 'Remove' })).toBeVisible();
    await reopened.getByRole('button', { name: 'Close' }).click();
    await expect(reopened).toBeHidden();

    // ------------------------------------------------------------------ Documents › Cover Letters lists it
    await nav(page, 'Documents').click();
    await page.getByRole('tab', { name: 'Cover Letters' }).click();
    await expect(page).toHaveURL(/tab=cover-letters/);
    const listView = page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'List' });
    await listView.click();
    await expect(listView).toHaveAttribute('aria-pressed', 'true');
    const letterRow = page.locator('[data-cover-letter-row]').filter({ hasText: letterTitle.title });
    await expect(letterRow).toBeVisible();
    await expect(letterRow).toContainText('Generated');

    // ------------------------------- The keyword card with the first resume (the default): this job's score, cached
    await nav(page, 'Jobs').click();
    await page.getByRole('searchbox', { name: 'Find your dream role' }).fill(title);
    const ours = page.locator(`[data-job-card="${jobId}"]`);
    await expect(ours).toBeVisible();
    await ours.locator('a').click();
    const score = page.locator('[data-improve-card]').getByTestId('keyword-score');
    await expect(score).toHaveText(/^0 out of \d+ required keywords found$/);
    const keywords = await settledKeywords(page, jobId);

    // ----------------------------------------- Documents › Resumes: a resume from a template, then the default
    await nav(page, 'Documents').click();
    await page.getByRole('tab', { name: 'Resumes' }).click();
    await page.locator('[data-new-fallback="resume"]').click();
    await expect(page).toHaveURL(/\/resumes\/new$/);
    await page.locator('[data-template-card]').first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Use this template' }).click();
    const start = page.getByRole('dialog', { name: 'Import your existing resume' });
    await start.getByRole('button', { name: 'Start from blank' }).click();
    await page.getByRole('button', { name: 'Edit name and contact details' }).click();
    await page.getByLabel('Full name').fill('Robin Castellanos');
    const newTitle = `Site Reliability Engineer ${Date.now().toString(36)}`;
    await page.getByLabel('Professional title').fill(newTitle);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: /^Experience/ }).click();
    await page.getByRole('button', { name: 'Add experience' }).click();
    await page.getByLabel('Job title').fill('Site Reliability Engineer');
    await page.getByLabel('Company').fill('Harborview Logistics');
    await page.getByLabel('Achievements, one per line').fill(`Worked daily with ${keywords.slice(0, 8).join(', ')}`);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Create Resume' }).click();
    await expect(page).toHaveURL(/\/documents\?tab=resumes/);

    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'List' }).click();
    const resumeRow = page.locator('[data-resume-row]').filter({ hasText: newTitle });
    await expect(resumeRow).toBeVisible();
    const newResumeId = (await resumeRow.getAttribute('data-resume-row'))!;
    expect(newResumeId).not.toBe(firstResumeId);
    await expect(resumeRow.locator('[data-default-resume]')).toHaveCount(0);
    await resumeRow.getByRole('button', { name: `Actions for ${newTitle}` }).click();
    await page.getByRole('menuitem', { name: 'Set as default' }).click();
    await expect(resumeRow.locator('[data-default-resume]')).toBeVisible();

    // ------------------------------------------- Jobs: "Improve Your Resume" scores the new default resume
    const matched = page.waitForResponse(
      (res) => new URL(res.url()).pathname === `/api/jobs/${jobId}/match` && res.request().method() === 'GET',
      { timeout: 30_000 },
    );
    await nav(page, 'Jobs').click();
    await page.getByRole('searchbox', { name: 'Find your dream role' }).fill(title);
    await expect(ours).toBeVisible();
    await ours.locator('a').click();
    const match = (await (await matched).json()) as { resumeId: string; matchedCount: number; total: number };
    expect(match.resumeId).toBe(newResumeId);
    expect(match.matchedCount).toBeGreaterThan(0);
    await expect(score).toHaveText(`${match.matchedCount} out of ${match.total} required keywords found`);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });

  test('a preference saved in Settings shows in the Jobs level check without a reload', async ({ page }) => {
    await signInFresh(page);
    const current = await json<Record<string, unknown>>(page, '/api/me/preferences');
    const saved = await page.request.put('/api/me/preferences', {
      headers: { Origin: ORIGIN },
      data: { ...current, experienceLevels: ['senior'] },
    });
    expect(saved.ok()).toBeTruthy();

    // A Senior job for someone looking for Senior roles: the green check.
    await page.goto('/jobs?level=senior');
    await expect(page).toHaveURL(/[?&]jobId=\d+/);
    const check = jobDetail(page).locator('[data-level-match]');
    await expect(check).toHaveAttribute('data-level-match', 'match');
    const jobsUrl = page.url();

    // Settings (the account menu): Entry level instead of Senior.
    await page.getByRole('button', { name: /^Account menu for / }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    const levels = page.getByRole('group', { name: 'Experience level' });
    await levels.getByRole('button', { name: 'Senior' }).click();
    await levels.getByRole('button', { name: 'Entry Level/New Grad' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Settings saved')).toBeVisible();

    // Back on the same job, the check compares against the new preference.
    await page.goBack();
    await expect(page).toHaveURL(jobsUrl);
    await expect(check).toHaveAttribute('data-level-match', 'mismatch');
  });
});
