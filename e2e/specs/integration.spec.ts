import { expect, test, type Locator, type Page } from '@playwright/test';

/*
 * Work package I: one person's path through every feature, against the dev server (`npm run dev` with the fake Claude
 * CLI and AUTH_DEV_FIXED_CODE). Navigation between the areas uses the header and the editor bar (client-side, as a
 * person clicks), so what one feature changes must show in the others without a reload.
 *   Jobs (search, filter, open, Save: the best resume is linked) → Job Tracker (under Saved) → Jobs (Apply, "Did you
 *   apply?" → Applied chip) → Job Tracker (under Applied, list stepper dates) → the application's Documents → Generate
 *   cover letter (editor prefilled, the fake AI writes it) → the letter is linked on the application → Documents ›
 *   Cover Letters lists it → Documents › Resumes: a resume from a template, made the default → the Jobs keyword card
 *   of an untracked job scores that resume, while the saved job's card keeps scoring the resume linked to it.
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

/** The parts of GET /api/jobs/:id/insights this spec reads: the analysis and the keyword card's match. */
interface Match {
  state: 'ok' | 'no_resume';
  resumeId?: string;
  resumeLabel?: string;
  resumeBasis?: 'linked' | 'default';
  matchedCount: number;
  total: number;
}
interface Insights {
  analysis: {
    source: 'deterministic' | 'ft_lake' | 'ai';
    refining: boolean;
    keywords: { high: Array<{ term: string }>; low: Array<{ term: string }> };
  };
  match: Match | null;
}

/**
 * A job's insights once no AI analysis of it is running. With AI_JOB_ANALYSIS=ingest (the default) Claude reads each
 * added job when the add-time backlog reaches it, not when someone opens or saves it: until its analysis is `ai`, it
 * can still change while the test runs, so callers read it again right before relying on it.
 */
async function settledInsights(page: Page, jobId: number): Promise<Insights> {
  let latest = null as Insights | null;
  await expect
    .poll(
      async () => {
        latest = await json<Insights>(page, `/api/jobs/${jobId}/insights`);
        return latest.analysis.refining;
      },
      { message: `job ${jobId}'s analysis finishes`, timeout: 90_000, intervals: [500, 1000, 2000] },
    )
    .toBe(false);
  return latest!;
}

const termsOf = (insights: Insights): string[] =>
  [...insights.analysis.keywords.high, ...insights.analysis.keywords.low].map((keyword) => keyword.term);

/** A posting the flow can use: its analysis names keywords (so a score has something to count). */
interface Candidate {
  id: number;
  /** Active, with a link to apply. */
  applyable: boolean;
  /** Claude's analysis: it will not change any more. */
  final: boolean;
}

async function candidateOf(page: Page, id: number): Promise<Candidate | null> {
  const job = await json<{ applyUrl?: string; active?: boolean }>(page, `/api/jobs/${id}`);
  const insights = await settledInsights(page, id);
  if (termsOf(insights).length === 0) return null;
  return { id, applyable: job.active !== false && Boolean(job.applyUrl), final: insights.analysis.source === 'ai' };
}

/** The first candidate other than `not`, one whose analysis is final when there is one. */
function preferFinal(candidates: readonly Candidate[], not?: number): Candidate | undefined {
  const usable = candidates.filter((candidate) => candidate.id !== not);
  return usable.find((candidate) => candidate.final) ?? usable[0];
}

/**
 * The last GET /api/jobs/:id/insights answer the page itself received, per job. The job page shows exactly that answer
 * (React Query keeps the latest read), so the keyword card is checked against it, however the analysis changes.
 */
function watchInsights(page: Page) {
  const latest = new Map<number, { seq: number; insights: Insights }>();
  let received = 0;
  page.on('response', (res) => {
    const path = /^\/api\/jobs\/(\d+)\/insights$/.exec(new URL(res.url()).pathname);
    if (!path || res.request().method() !== 'GET' || !res.ok()) return;
    const seq = (received += 1);
    const jobId = Number(path[1]);
    void res.json().then(
      (insights: Insights) => {
        if ((latest.get(jobId)?.seq ?? 0) < seq) latest.set(jobId, { seq, insights });
      },
      () => undefined, // the page moved on before the body was read
    );
  });
  return {
    /** Answers that arrive after this mark are newer. */
    mark: (): number => received,
    /** Waits until the page has read the job's insights after `since`. */
    async read(jobId: number, since = 0): Promise<void> {
      await expect
        .poll(() => (latest.get(jobId)?.seq ?? 0) > since, { message: `the page reads job ${jobId}'s insights`, timeout: 30_000 })
        .toBe(true);
    },
    latest: (jobId: number): Insights | undefined => latest.get(jobId)?.insights,
  };
}
type InsightsWatch = ReturnType<typeof watchInsights>;

const nav = (page: Page, name: 'Jobs' | 'Job Tracker' | 'Documents') =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true });
const jobCards = (page: Page) => page.getByRole('list', { name: 'Jobs' }).locator('[data-job-card]');
const jobDetail = (page: Page) => page.getByRole('region', { name: 'Job details' });
const improveCard = (page: Page) => page.locator('[data-improve-card]');
const column = (page: Page, status: number) => page.locator(`[data-column="${status}"]`);
const trackerCard = (scope: Page | Locator, title: string) => scope.locator('[data-application-card]').filter({ hasText: title });

/** The resume linked to the job's tracker application; null while it has none (or the job is not tracked). */
async function linkedResumeOf(page: Page, jobId: number): Promise<string | null> {
  const { userState } = await json<{ userState: { applicationId: string | null } }>(page, `/api/jobs/${jobId}`);
  if (!userState.applicationId) return null;
  return (await json<{ resumeId: string | null }>(page, `/api/applications/${userState.applicationId}`)).resumeId;
}

/** Finds a job again with the search box (every word must match, so title and company narrow it down) and opens it. */
async function openFromSearch(page: Page, job: { id: number; title: string; company: string }): Promise<void> {
  await page.getByRole('searchbox', { name: 'Find your dream role' }).fill(`${job.title} ${job.company}`);
  const card = page.locator(`[data-job-card="${job.id}"]`);
  await expect(card).toBeVisible();
  await card.locator('a').click();
  await expect(page).toHaveURL(new RegExp(`[?&]jobId=${job.id}(&|$)`));
  await expect(jobDetail(page).getByRole('heading', { level: 1 })).toHaveText(job.title);
}

/** What the keyword card says for a match: the score and the resume it scored, or that the posting names no keywords. */
function cardLines(match: Match): string[] {
  if (match.total === 0) return ["We didn't find any skill keywords in this posting."];
  const linked = match.resumeBasis === 'linked' ? ' (linked to this saved job)' : '';
  return [`${match.matchedCount} out of ${match.total} required keywords found`, `Scored with ${match.resumeLabel}${linked}`];
}

async function cardShows(page: Page): Promise<string[]> {
  const card = improveCard(page);
  const lines = [
    ...(await card.getByTestId('keyword-score').allInnerTexts()),
    ...(await card.getByTestId('scored-with').allInnerTexts()),
    ...(await card.getByText("We didn't find any skill keywords in this posting.").allInnerTexts()),
  ];
  return lines.map((line) => line.replace(/\s+/g, ' ').trim());
}

/**
 * The keyword card shows the last insights the page read for the open job (after `since`). Polled: a newer read (the
 * page polls while Claude analyses the job) can replace them at any moment. Answers the match it showed.
 */
async function expectCardShowsRead(page: Page, watch: InsightsWatch, jobId: number, since = 0): Promise<Match> {
  await watch.read(jobId, since);
  let shown = null as Match | null;
  await expect
    .poll(
      async () => {
        const match = watch.latest(jobId)?.match;
        if (!match || match.state !== 'ok') return `the page read no score for job ${jobId}`;
        const want = cardLines(match);
        const got = await cardShows(page);
        shown = match;
        return JSON.stringify(got) === JSON.stringify(want) ? 'same' : `the card shows ${JSON.stringify(got)}, the page read ${JSON.stringify(want)}`;
      },
      { timeout: 20_000 },
    )
    .toBe('same');
  return shown!;
}

/** Achievement lines that name every keyword, a few to a line. */
function achievementLines(keywords: readonly string[]): string {
  const lines: string[] = [];
  for (let start = 0; start < keywords.length; start += 6) lines.push(`Worked daily with ${keywords.slice(start, start + 6).join(', ')}`);
  return lines.join('\n');
}

test.describe('integration', () => {
  test('a job from search to tracker, cover letter, default resume and keyword match', async ({ page, context }) => {
    test.setTimeout(360_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const insights = watchInsights(page);

    await signInFresh(page);
    // A first resume (the account's default) with nothing a tech posting asks for. Lists call it by its headline.
    const firstLabel = 'Pastry Chef';
    const first = await page.request.post('/api/resumes', {
      headers: { Origin: ORIGIN },
      data: {
        document: {
          name: 'Robin Castellanos',
          title: firstLabel,
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

    // Two postings whose analyses name keywords: one to save and apply to (it needs a link to apply), and one that
    // stays untracked. Analyses Claude has finished are preferred: they no longer change.
    const count = await jobCards(page).count();
    expect(count).toBeGreaterThan(0);
    const candidates: Candidate[] = [];
    for (let index = 0; index < count; index += 1) {
      const candidate = await candidateOf(page, Number(await jobCards(page).nth(index).getAttribute('data-job-card')));
      if (candidate) candidates.push(candidate);
      const best = preferFinal(candidates.filter((item) => item.applyable));
      if (best?.final && preferFinal(candidates, best.id)?.final) break;
    }
    const target = preferFinal(candidates.filter((item) => item.applyable));
    expect(target, 'a job with keywords and a link to apply').toBeDefined();
    const jobId = target!.id;
    let other = preferFinal(candidates, jobId);
    if (!other) {
      // Only one posting of this search names keywords: the untracked one comes from the first page of all jobs.
      const everything = await json<{ items: Array<{ id: number }> }>(page, '/api/jobs');
      for (const item of everything.items) {
        if (item.id === jobId) continue;
        other = (await candidateOf(page, item.id)) ?? undefined;
        if (other) break;
      }
    }
    expect(other, 'a second job with keywords, left untracked').toBeDefined();
    const otherId = other!.id;

    const card = page.locator(`[data-job-card="${jobId}"]`);
    const title = (await card.locator('h3').innerText()).trim();
    await card.locator('a').click();
    await expect(page).toHaveURL(new RegExp(`[?&]jobId=${jobId}(&|$)`));
    await expect(jobDetail(page).getByRole('heading', { level: 1 })).toHaveText(title);
    const company = (await json<{ company: { name: string } }>(page, `/api/jobs/${jobId}`)).company.name;

    await jobDetail(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(jobDetail(page).getByRole('button', { name: 'Saved', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Saving links the best-matching resume to the application, here the account's only one: from now on the job's
    // keyword card scores that resume, whatever the default becomes (once applied, the choice no longer changes).
    await expect
      .poll(() => linkedResumeOf(page, jobId), { message: 'saving links the best-matching resume', timeout: 30_000 })
      .toBe(firstResumeId);
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

    // ----------------------- The keyword card with the first resume (linked to the job, and the default): no match
    await nav(page, 'Jobs').click();
    await openFromSearch(page, { id: jobId, title, company });
    const before = await expectCardShowsRead(page, insights, jobId);
    expect(before.resumeId).toBe(firstResumeId);
    expect(before.matchedCount).toBe(0);

    // ----------------------------------------- Documents › Resumes: a resume from a template, then the default
    // It names the keywords both postings ask for now (read again: an analysis Claude had not finished may have changed).
    const keywords = [...new Set([...termsOf(await settledInsights(page, jobId)), ...termsOf(await settledInsights(page, otherId))])];
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
    await page.getByLabel('Achievements, one per line').fill(achievementLines(keywords));
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

    // ------------------- Jobs: "Improve Your Resume" of an untracked job scores the new default resume, by name
    // The resume change marked every cached insights answer stale, so opening a job reads it again.
    const afterDefault = insights.mark();
    const otherJob = await json<{ title: string; company: { name: string } }>(page, `/api/jobs/${otherId}`);
    await nav(page, 'Jobs').click();
    await openFromSearch(page, { id: otherId, title: otherJob.title, company: otherJob.company.name });
    const untracked = await expectCardShowsRead(page, insights, otherId, afterDefault);
    expect(untracked).toMatchObject({ resumeId: newResumeId, resumeLabel: newTitle, resumeBasis: 'default' });
    expect(untracked.matchedCount).toBeGreaterThan(0);
    await expect(improveCard(page).getByTestId('scored-with')).toHaveText(`Scored with ${newTitle}`);

    // ---------------------- ...while the saved job's card keeps scoring the resume linked to it (it says so), not the
    // new default, though that one names every keyword the job asks for
    await openFromSearch(page, { id: jobId, title, company });
    const tracked = await expectCardShowsRead(page, insights, jobId, afterDefault);
    expect(tracked).toMatchObject({ resumeId: firstResumeId, resumeLabel: firstLabel, resumeBasis: 'linked', matchedCount: 0 });
    // The line sits under the score, so a posting that (after Claude read it) names no keywords has neither.
    if (tracked.total > 0) {
      await expect(improveCard(page).getByTestId('scored-with')).toHaveText(`Scored with ${firstLabel} (linked to this saved job)`);
    }

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
