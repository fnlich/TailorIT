import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, type APIRequestContext, type Page } from '@playwright/test';

/*
 * Work package C visual captures at the size of the user's Simplify screenshots (1567×889, project "shots"), for a
 * side-by-side look with e2e/reference/simplify-4.png (Documents › Cover Letters) and simplify-5.png (the template
 * editor). Runs against the dev server with the fake Claude CLI.
 *   npx playwright test --project=shots e2e/visual/letters.spec.ts
 */

const OUT = join(process.cwd(), 'e2e', 'artifacts', 'letters');
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const ORIGIN = { Origin: BASE };

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

async function call<T>(attempt: () => Promise<{ ok(): boolean; status(): number; json(): Promise<unknown> }>, what: string): Promise<T> {
  let last = 0;
  for (let tries = 0; tries < 20; tries += 1) {
    const response = await attempt().catch(() => null);
    if (response?.ok()) return (await response.json().catch(() => ({}))) as T;
    last = response?.status() ?? 0;
    if (last && last < 500) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`${what} failed (${last})`);
}

async function setUp(page: Page): Promise<APIRequestContext> {
  const api = page.request;
  const email = `letters-shots-${Date.now()}@e2e.tailorit.dev`;
  await call(() => api.post('/api/auth/email/verify', { headers: ORIGIN, data: { email, code: '000000' } }), 'sign in');
  await call(
    () =>
      api.post('/api/resumes', {
        headers: ORIGIN,
        data: {
          document: {
            name: 'David Jack',
            title: 'Site Reliability Engineer',
            contact: { phone: '', email: 'david.jack@example.com', location: 'San Francisco, CA', linkedin: 'linkedin.com/in/davidjack' },
            summary: 'Keeps large production systems calm.',
            experience: [
              {
                title: 'Senior SRE',
                company: 'Northwind',
                startDate: '2019',
                endDate: 'Present',
                location: 'Remote',
                description: 'Runs the on-call rotation and the deployment platform.',
                achievements: ['Rebuilt the release checklist; releases ship on the planned date.'],
                skills: ['Kubernetes', 'Go'],
              },
            ],
            skills: ['Kubernetes', 'Go', 'Terraform'],
            education: [],
          },
        },
      }),
    'create a resume',
  );
  return api;
}

/** A letter generated through the fake CLI (no template), as Simplify's list shows them: "Generated", never edited. */
async function generatedLetter(api: APIRequestContext, company: string, title: string, templateId: string | null = null) {
  const letter = await call<{ id: string }>(() => api.post('/api/cover-letters', { headers: ORIGIN, data: {} }), 'create a letter');
  const { taskId } = await call<{ taskId: string }>(
    () =>
      api.post(`/api/cover-letters/${letter.id}/generate`, {
        headers: ORIGIN,
        data: { companyName: company, jobTitle: title, jobDescription: '', templateId, customPrompt: '' },
      }),
    'generate',
  );
  for (let tries = 0; tries < 60; tries += 1) {
    const task = await call<{ status: string }>(() => api.get(`/api/ai/tasks/${taskId}`), 'poll the task');
    if (task.status === 'succeeded') return letter.id;
    if (task.status === 'failed' || task.status === 'cancelled') throw new Error(`generation ${task.status}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('generation timed out');
}

async function settle(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(900);
}

async function visit(page: Page, path: string, ready: string) {
  const failed = page.getByText('TailorIT could not load your account');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.goto(path);
    const outcome = await Promise.race([
      page.locator(ready).first().waitFor({ timeout: 25_000 }).then(() => 'ready'),
      failed.waitFor({ timeout: 25_000 }).then(() => 'failed'),
    ]).catch(() => 'failed');
    if (outcome === 'ready') return settle(page);
    await page.waitForTimeout(2000);
  }
  throw new Error(`${path} did not open`);
}

/** The tabs-and-table crop Simplify's screenshot 4 shows (from just above the tabs). */
async function shotFromTabs(page: Page, file: string) {
  const tabs = await page.getByRole('tablist', { name: 'Document types' }).boundingBox();
  const top = Math.max(0, Math.floor((tabs?.y ?? 330) - 22));
  await page.screenshot({ path: join(OUT, file), clip: { x: 0, y: top, width: 1567, height: Math.min(565, 889 - top) } });
}

test('documents: cover letters (table, grid) and templates', async ({ page }) => {
  const api = await setUp(page);
  for (const [company, title] of [
    ['Northwind', 'Site Reliability Engineer'],
    ['Contoso', 'Platform Engineer'],
    ['Fabrikam', 'DevOps Engineer'],
  ] as const) {
    await generatedLetter(api, company, title);
  }

  await visit(page, '/documents?tab=cover-letters', '[data-cover-letter-row]');
  await page.screenshot({ path: join(OUT, 'cover-letters-table-full.png') });
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(300);
  await shotFromTabs(page, 'cover-letters-table.png');

  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await page.locator('[data-cover-letter-card] iframe').first().waitFor({ timeout: 20_000 });
  await settle(page);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, 'cover-letters-grid.png') });
  await page.getByRole('button', { name: 'List', exact: true }).click();

  await visit(page, '/documents?tab=templates', '[data-template-row]');
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(300);
  await shotFromTabs(page, 'templates-table.png');
});

test('template editor (screenshot 5)', async ({ page }) => {
  const api = await setUp(page);
  const list = await call<{ items: Array<{ id: string; name: string }> }>(() => api.get('/api/cover-letter-templates'), 'templates');
  const creative = list.items.find((item) => item.name === 'Creative Industry')!;
  const copy = await call<{ id: string }>(
    () => api.post(`/api/cover-letter-templates/${creative.id}/duplicate`, { headers: ORIGIN, data: { name: 'Creative Industry Cover Letter' } }),
    'duplicate',
  );
  // Simplify's capture is in Times New Roman.
  await call(() => api.patch(`/api/cover-letter-templates/${copy.id}`, { headers: ORIGIN, data: { fontFamily: 'Times New Roman' } }), 'font');

  await visit(page, `/cover-letter-template/${copy.id}`, '[data-letter-editor] [data-variable]');
  await page.mouse.move(5, 880);
  await page.screenshot({ path: join(OUT, 'template-editor.png') });

  await page.getByLabel('Insert variable').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'template-insert-variable.png') });
  await page.keyboard.press('Escape');

  await page.locator('[data-letter-editor] [data-variable="COMPANY_APPEAL"]').hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, 'template-chip-hint.png') });

  await visit(page, `/cover-letter-template/${creative.id}`, '[data-letter-editor] [data-variable]');
  await page.mouse.move(5, 880);
  await page.screenshot({ path: join(OUT, 'template-starter-read-only.png') });
});

test('cover letter editor: generate dialog, generated letter, placeholder banner', async ({ page }) => {
  const api = await setUp(page);
  await visit(page, '/cover-letter/new', '[data-generate-submit]');
  await page.screenshot({ path: join(OUT, 'generate-dialog.png') });
  await page.getByRole('tab', { name: 'Template' }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, 'generate-dialog-template.png') });

  const list = await call<{ items: Array<{ id: string; name: string }> }>(() => api.get('/api/cover-letter-templates'), 'templates');
  const internship = list.items.find((item) => item.name === 'Internship / New Grad')!;
  const withTemplate = await generatedLetter(api, 'Contoso', 'Site Reliability Intern', internship.id);
  await visit(page, `/cover-letter/${withTemplate}`, '[data-placeholder-banner]');
  await page.mouse.move(5, 880);
  await page.screenshot({ path: join(OUT, 'letter-editor-banner.png') });

  const plain = await generatedLetter(api, 'Northwind', 'Site Reliability Engineer');
  await visit(page, `/cover-letter/${plain}`, '[data-letter-editor] h1');
  await page.mouse.move(5, 880);
  await page.screenshot({ path: join(OUT, 'letter-editor.png') });
});
