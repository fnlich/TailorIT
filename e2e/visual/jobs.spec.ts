import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/*
 * Work package J2 visual captures of the Jobs page at the size of the user's Simplify screenshot (1567×889, project
 * "shots"), for side-by-side comparison with e2e/reference/simplify-1.png. Runs against the dev server with the jobs
 * in its database (J1's seed, or J2's demo rows).
 *   npx playwright test --project=shots e2e/visual/jobs.spec.ts
 */

const OUT = join(process.cwd(), 'e2e', 'artifacts', 'jobs');
const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const EMAIL = process.env.J2_SHOTS_EMAIL ?? 'j2-shots@tailorit.dev';

/** Signs in through the API (a few tries: the dev API restarts whenever a package edits its source). */
async function signIn(page: Page) {
  let last = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await page.request.post('/api/auth/email/verify', {
      headers: { Origin: ORIGIN },
      data: { email: EMAIL, code: process.env.AUTH_DEV_FIXED_CODE ?? '000000' },
    });
    if (res.ok()) return;
    last = `${res.status()} ${await res.text()}`;
    await page.waitForTimeout(2_000);
  }
  expect(last, 'sign-in failed').toBe('');
}

/** The shots account looks for Senior roles (the facts grid's level check shows its green tick). */
async function preferSenior(page: Page) {
  const current = await page.request.get('/api/me/preferences');
  const body = (await current.json()) as Record<string, unknown>;
  const preferences = (body.preferences as Record<string, unknown> | undefined) ?? body;
  await page.request.put('/api/me/preferences', {
    headers: { Origin: ORIGIN },
    data: { ...preferences, experienceLevels: ['senior'] },
  });
}

/** The shots account has a resume (through the resume API), so the keyword card shows matched chips. */
async function ensureResume(page: Page) {
  const list = await page.request.get('/api/resumes');
  if (list.ok() && ((await list.json()) as { items?: unknown[] }).items?.length) return;
  await page.request.post('/api/resumes', {
    headers: { Origin: ORIGIN },
    data: {
      title: 'Shots resume',
      document: {
        name: 'Jordan Rivera',
        title: 'Senior Platform Engineer',
        summary: 'Platform engineer running Kubernetes and Docker on Linux, writing Python and Go, with Terraform on AWS.',
        skills: ['Kubernetes', 'Docker', 'Linux', 'Python', 'Go', 'Terraform', 'AWS', 'PostgreSQL', 'React', 'TypeScript', 'SQL'],
      },
    },
  });
}

/** The id of the first job a search finds (the demo data's Lead SRE posting mirrors the screenshot's). */
async function findJob(page: Page, q: string): Promise<number | null> {
  const res = await page.request.get(`/api/jobs?q=${encodeURIComponent(q)}`);
  const body = (await res.json()) as { items?: Array<{ id: number }> };
  return body.items?.[0]?.id ?? null;
}

async function settle(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

async function openFirstJob(page: Page, path = '/jobs') {
  await page.goto(path);
  await page.locator('[data-job-card]').first().waitFor();
  await expect(page).toHaveURL(/jobId=\d+/);
  await page.locator('[data-improve-card]').waitFor();
  await page.getByRole('heading', { level: 1 }).filter({ hasNotText: 'Jobs' }).first().waitFor();
}

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await preferSenior(page);
  await ensureResume(page);
});

test('jobs page (compare with simplify-1.png)', async ({ page }) => {
  await openFirstJob(page);
  await settle(page);
  await page.screenshot({ path: join(OUT, 'jobs.png') });
});

test('jobs page: the Lead SRE posting (detail like simplify-1.png)', async ({ page }) => {
  const id = await findJob(page, 'lead site reliability');
  await openFirstJob(page, id ? `/jobs?jobId=${id}` : '/jobs');
  await page.locator('[data-keyword]').first().waitFor({ timeout: 10_000 }).catch(() => undefined);
  await settle(page);
  await page.screenshot({ path: join(OUT, 'jobs-lead-sre.png') });
});

test('jobs page: an applied job (the header shows "Applied M/D/YY", like simplify-1.png)', async ({ page }) => {
  const id = await findJob(page, 'lead site reliability');
  test.skip(!id, 'the demo Lead SRE posting is not in this database');
  // Tracking it as Applied through the tracker's API (idempotent: the existing application is answered).
  await page.request.post('/api/applications', { headers: { Origin: ORIGIN }, data: { jobId: id, status: 2 } });
  await openFirstJob(page, `/jobs?jobId=${id}`);
  await page.locator('[data-applied-chip]').waitFor();
  await settle(page);
  await page.screenshot({ path: join(OUT, 'jobs-applied.png') });
});

test('jobs page: a job with salary, filters set', async ({ page }) => {
  await openFirstJob(page, '/jobs?type=full_time&category=devops-infrastructure&category=software-engineering');
  await settle(page);
  await page.screenshot({ path: join(OUT, 'jobs-filtered.png') });
});

test('jobs page: full posting and company section', async ({ page }) => {
  await openFirstJob(page);
  await page.getByRole('tab', { name: 'Full posting' }).click();
  await settle(page);
  await page.screenshot({ path: join(OUT, 'jobs-full-posting.png') });
  await page.getByRole('tab', { name: 'Company' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, 'jobs-company.png') });
});

test('jobs page: filter popovers and menus', async ({ page }) => {
  await openFirstJob(page);
  await settle(page);
  await page.getByRole('button', { name: /^Location/ }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'jobs-location.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Job Type/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'jobs-job-type.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Category/ }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'jobs-category.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'All filters', exact: true }).click();
  await page.getByRole('dialog', { name: 'All filters' }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'jobs-all-filters.png') });
});
