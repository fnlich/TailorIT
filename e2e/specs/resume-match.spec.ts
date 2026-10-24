import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/*
 * Work package WP10: the resume TailorIT matches to a saved job, on the application's Documents tab, against a running
 * server (`npm run dev`, or a test server with the fake Claude CLI) with AUTH_DEV_FIXED_CODE. Saving a job links the
 * resume that fits it best ("Best match"); the picker ranks the account's resumes with the Jobs card's numbers
 * ("{matched} of {total} keywords · {percentage}%"); picking another makes the choice the person's ("Chosen by you");
 * "Let TailorIT choose" hands it back. Each run signs in a new account, so nothing is left to clean up.
 *   npx playwright test --project=e2e e2e/specs/resume-match.spec.ts
 */

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const CODE = process.env.AUTH_DEV_FIXED_CODE ?? '000000';

const BACKEND_LABEL = 'Backend Resume';
const PASTRY_LABEL = 'Pastry Chef Resume';

/** What a backend posting tends to ask for, on top of the posting's own keywords. */
const BACKEND_SKILLS = [
  'Java',
  'Go',
  'Python',
  'Node.js',
  'TypeScript',
  'SQL',
  'PostgreSQL',
  'MySQL',
  'Redis',
  'Kafka',
  'RabbitMQ',
  'gRPC',
  'REST',
  'GraphQL',
  'Microservices',
  'Distributed systems',
  'Docker',
  'Kubernetes',
  'AWS',
  'GCP',
  'Terraform',
  'Linux',
  'CI/CD',
  'Spring Boot',
  'Elasticsearch',
  'Prometheus',
];

/** A new account (a few tries: a dev API restarts whenever someone saves an API file). */
async function signInFresh(page: Page): Promise<APIRequestContext> {
  const email = `resume-match-${Date.now()}-${Math.floor(Math.random() * 1e4)}@tailorit.dev`;
  let last = '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const res = await page.request
      .post('/api/auth/email/verify', { headers: { Origin: ORIGIN }, data: { email, code: CODE } })
      .catch(() => null);
    if (res?.ok()) return page.request;
    last = res ? `${res.status()} ${await res.text()}` : 'no answer';
    await page.waitForTimeout(1500);
  }
  throw new Error(`sign-in failed: ${last}`);
}

async function json<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(path);
  expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** The browser machine's calendar day, as the Jobs page sends it when it saves a job. */
function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** The parts of GET /api/jobs/:id/insights this spec reads. */
interface Insights {
  analysis: {
    source: string;
    refining: boolean;
    keywords: { high: Array<{ term: string }>; low: Array<{ term: string }> };
  };
}

const termsOf = (insights: Insights): string[] =>
  [...insights.analysis.keywords.high, ...insights.analysis.keywords.low].map((keyword) => keyword.term);

/**
 * A backend posting of the job board whose analysis names keywords, with those keywords. One Claude has finished
 * reading is preferred (its keywords no longer change); else one no analysis runs on now; else the first, once its
 * analysis is done.
 */
async function backendJob(request: APIRequestContext): Promise<{ id: number; keywords: string[] }> {
  const { items } = await json<{ items: Array<{ id: number }> }>(request, '/api/jobs?q=backend');
  expect(items.length, 'the job board lists backend postings (the demo jobs)').toBeGreaterThan(0);
  const read = (id: number) => json<Insights>(request, `/api/jobs/${id}/insights`);
  let idle: { id: number; keywords: string[] } | null = null;
  let busy: number | null = null;
  for (const job of items.slice(0, 15)) {
    const insights = await read(job.id);
    const keywords = termsOf(insights);
    if (keywords.length === 0) continue;
    if (insights.analysis.refining) {
      busy ??= job.id;
      continue;
    }
    if (insights.analysis.source === 'ai') return { id: job.id, keywords };
    idle ??= { id: job.id, keywords };
  }
  if (idle) return idle;
  expect(busy, 'a backend posting whose analysis names keywords').not.toBeNull();
  let settled = null as Insights | null;
  await expect
    .poll(async () => (settled = await read(busy!)).analysis.refining, {
      message: `job ${busy}'s analysis finishes`,
      timeout: 90_000,
      intervals: [500, 1000, 2000],
    })
    .toBe(false);
  const keywords = termsOf(settled!);
  expect(keywords.length, `job ${busy} names keywords`).toBeGreaterThan(0);
  return { id: busy!, keywords };
}

async function createResume(request: APIRequestContext, data: unknown): Promise<string> {
  const res = await request.post('/api/resumes', { headers: { Origin: ORIGIN }, data });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** The parts of an application detail this spec reads. */
interface Detail {
  id: string;
  title: string;
  resumeId: string | null;
  resumeOrigin?: 'auto' | 'user' | null;
  resumeMatchPending?: boolean;
}

/** The parts of GET /api/applications/:id/resume-matches the picker shows. */
interface Ranking {
  scored: boolean;
  items: Array<{ resumeId: string; label: string; isDefault: boolean; fit: number; matchedCount: number; total: number; percentage: number }>;
}

/** The Jobs card's numbers, as the picker prints them under each resume. */
const numbersOf = (item: Ranking['items'][number]) =>
  `${item.matchedCount} of ${item.total} ${item.total === 1 ? 'keyword' : 'keywords'} · ${item.percentage}%`;

/** The next ranking the page itself reads for the application (the picker shows exactly that answer). */
function nextRanking(page: Page, applicationId: string): Promise<Ranking> {
  return page
    .waitForResponse(
      (res) =>
        res.request().method() === 'GET' &&
        new URL(res.url()).pathname === `/api/applications/${applicationId}/resume-matches` &&
        res.ok(),
    )
    .then((res) => res.json() as Promise<Ranking>);
}

/** The linked resume's card in the Resume section. */
const linkedCard = (section: Locator, resumeId: string) => section.locator(`[data-document-id="${resumeId}"]`);

test.describe('matched resume', () => {
  // A dev API restarts whenever a package saves a file; a run caught by one is retried (on a new account).
  test.describe.configure({ retries: 2 });

  test('saving a job links its best match; the person can pick another, then let TailorIT choose again', async ({ page }) => {
    test.setTimeout(180_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const request = await signInFresh(page);

    // A backend posting and two resumes: first one with nothing it asks for (so it is the account's default), then one
    // that names its keywords. TailorIT must pick the second, not merely the default.
    const job = await backendJob(request);
    const pastryId = await createResume(request, {
      title: PASTRY_LABEL,
      document: {
        name: 'Robin Castellanos',
        title: 'Pastry Chef',
        contact: { email: 'robin@example.com', phone: '', location: 'Portland, OR' },
        summary: 'Pastry chef who bakes laminated doughs and plated desserts for a busy bistro.',
        skills: ['Lamination', 'Sugar work', 'Menu costing'],
      },
    });
    const skills = [...new Map([...job.keywords, ...BACKEND_SKILLS].map((skill) => [skill.toLowerCase(), skill])).values()];
    const backendId = await createResume(request, {
      title: BACKEND_LABEL,
      document: {
        name: 'Robin Castellanos',
        title: 'Senior Backend Engineer',
        contact: { email: 'robin@example.com', phone: '', location: 'Portland, OR' },
        summary: `Backend engineer with eight years of building services in ${job.keywords.slice(0, 6).join(', ')}.`,
        skills: skills.slice(0, 100),
        experience: [
          {
            title: 'Senior Backend Engineer',
            company: 'Harborview Logistics',
            startDate: '2018-01',
            endDate: 'Present',
            location: 'Portland, OR',
            description: 'Owned the order and billing services.',
            achievements: [`Built and ran services with ${job.keywords.join(', ')}.`],
            skills: job.keywords.slice(0, 20),
          },
        ],
      },
    });

    // ------------------------------------------------- Save the job: TailorIT links its best match (origin auto)
    const saved = await request.post('/api/applications', {
      headers: { Origin: ORIGIN },
      data: { jobId: job.id, status: 1, occurredOn: localToday() },
    });
    expect(saved.status(), await saved.text()).toBe(201);
    const application = (await saved.json()) as Detail;
    // Linked at once, or by the match worker within seconds when the save could not wait for the choice.
    await expect
      .poll(async () => {
        const detail = await json<Detail>(request, `/api/applications/${application.id}`);
        return [detail.resumeId, detail.resumeOrigin ?? null, detail.resumeMatchPending ?? false];
      }, { message: 'saving links the best-matching resume', timeout: 30_000 })
      .toEqual([backendId, 'auto', false]);

    // ------------------------------------------------------------- The Documents tab: "Best match" on its card
    await page.goto(`/tracker?app=${application.id}`);
    const detail = page.getByRole('dialog', { name: application.title });
    await expect(detail).toBeVisible({ timeout: 20_000 });
    const firstRanking = nextRanking(page, application.id);
    await detail.getByRole('tab', { name: 'Documents' }).click();
    const ranking = await firstRanking;
    expect(ranking.scored).toBe(true);
    expect(ranking.items.map((item) => item.resumeId)).toEqual([backendId, pastryId]);
    expect(ranking.items[0]!.fit).toBeGreaterThan(0);

    const section = detail.getByRole('region', { name: 'Resume', exact: true });
    const backendCard = linkedCard(section, backendId);
    await expect(backendCard).toContainText(BACKEND_LABEL);
    await expect(backendCard.getByText('Best match', { exact: true })).toBeVisible();
    await expect(section.getByText('Chosen by you', { exact: true })).toHaveCount(0);
    // TailorIT chose it already: nothing to hand back.
    await expect(section.getByRole('button', { name: 'Let TailorIT choose' })).toHaveCount(0);

    // ---------------------------------------------- Change: the resumes ranked by fit, with the card's numbers
    await backendCard.getByRole('button', { name: 'Change' }).click();
    await section.getByRole('combobox', { name: 'Link existing resume' }).click();
    const options = page.getByRole('option');
    await expect(options).toHaveCount(2);
    const [best, other] = ranking.items;
    await expect(options.nth(0)).toContainText(BACKEND_LABEL);
    await expect(options.nth(0)).toContainText('Best match');
    await expect(options.nth(0)).toContainText(numbersOf(best!));
    await expect(options.nth(1)).toContainText(`${PASTRY_LABEL} (Default)`);
    await expect(options.nth(1)).toContainText(numbersOf(other!));
    await expect(options.nth(1)).not.toContainText('Best match');
    for (const text of await options.allInnerTexts()) expect(text).toMatch(/\d+ of \d+ keywords? · \d+%/);

    // ---------------------------------------------------------- Pick the other one: it is the person's choice
    await options.nth(1).click();
    await expect(page.getByText('Resume linked to this application.')).toBeVisible();
    const pastryCard = linkedCard(section, pastryId);
    await expect(pastryCard).toContainText(PASTRY_LABEL);
    await expect(pastryCard.getByText('Chosen by you', { exact: true })).toBeVisible();
    await expect(pastryCard.getByText('Default', { exact: true })).toBeVisible();
    await expect(section.getByText('Best match', { exact: true })).toHaveCount(0);
    expect(await json<Detail>(request, `/api/applications/${application.id}`)).toMatchObject({
      resumeId: pastryId,
      resumeOrigin: 'user',
    });

    // ------------------------------------------------- "Let TailorIT choose": the best match is linked again
    const choose = section.getByRole('button', { name: 'Let TailorIT choose' });
    await expect(choose).toBeVisible();
    await choose.click();
    await expect(page.getByText(`Best match linked: ${BACKEND_LABEL}.`)).toBeVisible();
    await expect(linkedCard(section, backendId).getByText('Best match', { exact: true })).toBeVisible();
    await expect(section.getByText('Chosen by you', { exact: true })).toHaveCount(0);
    await expect(choose).toHaveCount(0);
    expect(await json<Detail>(request, `/api/applications/${application.id}`)).toMatchObject({
      resumeId: backendId,
      resumeOrigin: 'auto',
      resumeMatchPending: false,
    });

    expect(pageErrors).toEqual([]);
  });
});
