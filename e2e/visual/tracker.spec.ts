import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/*
 * Work package T visual captures at the size of the user's Simplify screenshots (1567×889, project "shots"):
 * compare e2e/artifacts/tracker/*.png with e2e/reference/simplify-2.png (board), simplify-6.png (Options menu) and
 * simplify-7.png (list view). Needs the dev server (`npm run dev`) with AUTH_DEV_FIXED_CODE; seeds its own account.
 *   npx playwright test --project=shots e2e/visual/tracker.spec.ts
 */

const OUT = join(process.cwd(), 'e2e', 'artifacts', 'tracker');
const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const EMAIL = 'tracker-shots@tailorit.dev';
const CODE = process.env.AUTH_DEV_FIXED_CODE ?? '000000';

interface Seed {
  title: string;
  companyName: string;
  location: string;
  employmentType?: string;
  status: number;
  occurredOn: string;
  favorite?: boolean;
  later?: Array<{ status: number; occurredOn: string }>;
}

// Postings like the ones in the user's screenshots (Simplify's own data is not reused).
const SEEDS: Seed[] = [
  { title: 'AI Foundry Platform Engineer', companyName: 'Applied Information Sciences', location: 'Remote in USA', status: 1, occurredOn: '2026-10-22', favorite: true },
  { title: 'Cloud Architect', companyName: 'Rubrik', location: 'Remote in USA', status: 2, occurredOn: '2026-10-22' },
  { title: 'Software Engineer 3', companyName: 'Global Healthcare Exchange', location: 'Remote in USA', status: 2, occurredOn: '2026-10-22' },
  { title: 'Lead Platform Operations Expert', companyName: 'OutSystems', location: 'Remote in USA', status: 2, occurredOn: '2026-10-22' },
  { title: 'Distinguished Platform Solutions Architect', companyName: 'Experian', location: 'Remote in USA', status: 2, occurredOn: '2026-10-22' },
  { title: 'Senior Database Administrator', companyName: 'Foley', location: 'Remote in USA', status: 2, occurredOn: '2026-10-22' },
  { title: 'OpenShift Platform Engineer', companyName: 'M&T Bank', location: 'Remote in USA', status: 2, occurredOn: '2026-10-22' },
  // History for the chart (archived after seeding, so the board matches the reference's columns).
  { title: 'Site Reliability Engineer', companyName: 'Northwind', location: 'Austin, TX', status: 2, occurredOn: '2026-09-14', later: [{ status: 11, occurredOn: '2026-09-21' }, { status: 12, occurredOn: '2026-09-30' }, { status: 13, occurredOn: '2026-10-09' }] },
  { title: 'Platform Engineer', companyName: 'Contoso', location: 'Seattle, WA', status: 2, occurredOn: '2026-09-07', later: [{ status: 11, occurredOn: '2026-09-15' }, { status: 23, occurredOn: '2026-09-25' }] },
  { title: 'DevOps Engineer', companyName: 'Fabrikam', location: 'Remote', status: 2, occurredOn: '2026-09-02', later: [{ status: 22, occurredOn: '2026-10-02' }] },
  { title: 'Infrastructure Engineer', companyName: 'Tailspin', location: 'Denver, CO', status: 2, occurredOn: '2026-09-28', later: [{ status: 11, occurredOn: '2026-10-05' }, { status: 12, occurredOn: '2026-10-12' }, { status: 23, occurredOn: '2026-10-19' }] },
];

async function signIn(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/auth/email/verify', { data: { email: EMAIL, code: CODE }, headers: { Origin: ORIGIN } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function json<T>(promise: Promise<{ ok(): boolean; json(): Promise<unknown>; text(): Promise<string> }>): Promise<T> {
  const res = await promise;
  if (!res.ok()) throw new Error(await res.text());
  return (await res.json()) as T;
}

/** A clean account with the seed applications; the history ones end up in Archived for the board shot. */
async function seed(request: APIRequestContext): Promise<{ chartIds: string[] }> {
  const headers = { Origin: ORIGIN };
  for (const tab of ['active', 'archived']) {
    const list = await json<{ items: Array<{ id: string }> }>(request.get(`/api/applications?tab=${tab}&limit=100`));
    if (list.items.length) await request.post('/api/applications/bulk', { headers, data: { ids: list.items.map((item) => item.id), action: 'delete' } });
  }
  const chartIds: string[] = [];
  for (const entry of SEEDS) {
    const created = await json<{ id: string }>(
      request.post('/api/applications', {
        headers,
        data: {
          title: entry.title,
          companyName: entry.companyName,
          location: entry.location,
          employmentType: entry.employmentType ?? 'full_time',
          status: entry.status,
          occurredOn: entry.occurredOn,
        },
      }),
    );
    if (entry.favorite) await request.patch(`/api/applications/${created.id}`, { headers, data: { favorite: true } });
    if (entry.title === 'OpenShift Platform Engineer') {
      await request.patch(`/api/applications/${created.id}`, {
        headers,
        data: {
          postingUrl: 'https://careers.example.com/jobs/openshift-platform-engineer',
          salaryMin: 135000,
          salaryMax: 165000,
          salaryPeriod: 'year',
          salaryCurrency: 'USD',
          descriptionHtml:
            '<p>Join the platform team that runs our OpenShift and Kubernetes clusters.</p><ul><li>Operate OpenShift 4 clusters on AWS</li><li>Automate with Terraform and Ansible</li><li>Write tooling in Python and Go</li></ul>',
          notesHtml: '<p>Recruiter: Sam Lee. Follow up on Monday.</p>',
        },
      });
      await request.post(`/api/applications/${created.id}/questions`, {
        headers,
        data: { question: 'Why do you want to work here?', answer: 'The platform team owns the whole Kubernetes stack.' },
      });
    }
    for (const step of entry.later ?? []) {
      await request.put(`/api/applications/${created.id}/status`, { headers, data: step });
    }
    if (entry.later) chartIds.push(created.id);
  }
  return { chartIds };
}

async function settle(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test('tracker captures (compare with simplify-2/6/7.png)', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page.request);
  const { chartIds } = await seed(page.request);

  // Chart first, while the history is active.
  await page.goto('/tracker?view=chart');
  await page.getByRole('heading', { name: 'Application flow' }).waitFor();
  await page.locator('[data-chart="application-flow"] svg rect').first().waitFor();
  await settle(page);
  await page.screenshot({ path: join(OUT, 'chart.png') });
  await page.screenshot({ path: join(OUT, 'chart-full.png'), fullPage: true });

  await page.request.post('/api/applications/bulk', { headers: { Origin: ORIGIN }, data: { ids: chartIds, action: 'archive' } });

  // The reference board shows Saved, Applied, Screen, Offer, Rejected (Interviewing hidden, Screen kept).
  await page.evaluate(() => localStorage.setItem('tailorit.tracker.columnStatus', JSON.stringify({ 11: 'forced', 12: 'hidden' })));
  await page.goto('/tracker');
  await page.getByRole('heading', { name: 'Applied' }).waitFor();
  await page.locator('[data-application-card]').first().waitFor();
  await settle(page);
  await page.screenshot({ path: join(OUT, 'board.png') });

  await page.getByRole('button', { name: /^Options/ }).click();
  await page.getByRole('menuitem', { name: 'Status', exact: true }).hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'options-menu.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.locator('[data-application-card]').first().click({ button: 'right' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, 'card-menu.png') });
  await page.keyboard.press('Escape');

  await page.goto('/tracker?view=list');
  await page.locator('[data-application-row]').first().waitFor();
  await settle(page);
  await page.screenshot({ path: join(OUT, 'list.png') });

  await page.goto('/tracker');
  await page.locator('[data-application-card]').first().waitFor();
  await settle(page);
  await page.getByRole('button', { name: 'Add application' }).click();
  await page.getByRole('dialog', { name: 'Add Application' }).waitFor();
  await settle(page);
  await page.screenshot({ path: join(OUT, 'add-sheet.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Add Application' }).waitFor({ state: 'detached' });

  await page.locator('[data-application-card]').filter({ hasText: 'OpenShift Platform Engineer' }).click();
  await page.getByRole('dialog', { name: 'OpenShift Platform Engineer' }).waitFor();
  await settle(page);
  await page.screenshot({ path: join(OUT, 'detail-sheet.png') });
});
