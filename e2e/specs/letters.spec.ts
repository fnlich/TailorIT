import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/*
 * Work package C: cover letters and templates against the dev server (`npm run dev` with the fake Claude CLI, whose
 * scenarios are tools/fake-claude/scenarios/{cover_letter,template_fill}.json).
 *   npx playwright test --project=e2e e2e/specs/letters.spec.ts
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const ORIGIN = { Origin: BASE };

/** The shared API restarts while other work saves files: retry what it refuses for a moment. */
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

/** A fresh account with one built resume (no phone, so `{{USER_PHONE}}` stays unfilled). */
async function signInWithResume(page: Page): Promise<{ email: string }> {
  const email = `letters-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.tailorit.dev`;
  const api = page.request;
  await call(() => api.post('/api/auth/email/verify', { headers: ORIGIN, data: { email, code: '000000' } }), 'sign in');
  await call(
    () =>
      api.post('/api/resumes', {
        headers: ORIGIN,
        data: {
          document: {
            name: 'Jordan Avery Chen',
            title: 'Product Designer',
            contact: { phone: '', email: 'jordan@example.com', location: 'Austin, TX', linkedin: 'linkedin.com/in/jordanchen' },
            summary: 'Product designer who turns research into calm, usable products.',
            experience: [
              {
                title: 'Product Designer',
                company: 'Northwind',
                startDate: '2021',
                endDate: 'Present',
                location: 'Remote',
                description: 'Owns onboarding and the design system.',
                achievements: ['Rebuilt onboarding, lifting week-one activation.'],
                skills: ['Figma', 'User research'],
              },
            ],
            skills: ['Figma', 'User research', 'Prototyping'],
            education: [],
          },
        },
      }),
    'create a resume',
  );
  return { email };
}

async function templateId(api: APIRequestContext, name: string): Promise<string> {
  const list = await call<{ items: Array<{ id: string; name: string }> }>(() => api.get('/api/cover-letter-templates'), 'list templates');
  const found = list.items.find((item) => item.name === name);
  if (!found) throw new Error(`No template named ${name}`);
  return found.id;
}

/**
 * Opens a page and waits for `ready`. When the API is restarting (other work saving files), the page says it could
 * not load the account: wait and open it again.
 */
async function visit(page: Page, path: string, ready: string): Promise<void> {
  const failed = page.getByText('TailorIT could not load your account');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.goto(path);
    const outcome = await Promise.race([
      page.locator(ready).first().waitFor({ timeout: 25_000 }).then(() => 'ready' as const),
      failed.waitFor({ timeout: 25_000 }).then(() => 'failed' as const),
    ]).catch(() => 'failed' as const);
    if (outcome === 'ready') return;
    await page.waitForTimeout(2000);
  }
  throw new Error(`${path} did not open`);
}

const editor = (page: Page) => page.locator('[data-letter-editor]');
const saved = (page: Page) => expect(page.locator('[data-editor-bar] [role=status]')).toHaveText('Saved just now', { timeout: 15_000 });

test.describe('cover letters', () => {
  test('new letter: generate from a template, fill the tag, autosave, reload, export PDF', async ({ page }) => {
    await signInWithResume(page);
    await visit(page, '/cover-letter/new', '[data-letter-editor]');

    // An empty letter opens the generate dialog by itself.
    const dialog = page.getByRole('dialog', { name: 'Generate a Tailored Cover Letter' });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/cover-letter\/[0-9a-f-]{36}$/);
    await expect(page.locator('[data-editor-bar]')).toContainText(/Cover Letter \d{1,2}\/\d{1,2}\/\d{4}/);

    // Required fields first.
    await dialog.getByRole('button', { name: 'Generate' }).click();
    await expect(dialog.getByText('Required')).toHaveCount(2);
    await dialog.getByLabel('Company Name').fill('Contoso');
    await dialog.getByLabel('Job Title').fill('Design Intern');
    await dialog.getByLabel('Job Description').fill('Help the design team ship onboarding improvements.');
    await dialog.getByRole('tab', { name: 'Template' }).click();
    await dialog.getByText('Internship / New Grad (Default)').click();
    await dialog.getByRole('tab', { name: 'Custom Prompt' }).click();
    await dialog.getByRole('button', { name: 'Load an example' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Custom prompt' })).toHaveValue(/Emphasize my skills and experience/);
    await dialog.getByRole('button', { name: 'Generate' }).click();

    // The fake CLI answers at once; the letter is written and the banner lists what is left.
    await expect(dialog).toBeHidden({ timeout: 45_000 });
    await expect(editor(page)).toContainText('I am writing to apply for the Design Intern position at Contoso.');
    const banner = page.locator('[data-placeholder-banner]');
    await expect(banner).toContainText('Almost there - fill in these details to finish your letter');
    await expect(banner).toContainText('Click a tag to replace it.');
    await expect(banner.getByRole('button')).toHaveText(['{{USER_PHONE}}']);
    await expect(editor(page).locator('[data-variable="USER_PHONE"]')).toHaveCount(1);

    await banner.getByRole('button', { name: '{{USER_PHONE}}' }).click();
    const replace = page.getByRole('dialog', { name: 'Replace placeholder' });
    await expect(replace).toContainText('All tags named {{USER_PHONE}} will become the text you enter below.');
    await replace.getByRole('textbox').fill('(555) 010-0199');
    await replace.getByRole('button', { name: 'Apply' }).click();
    await expect(banner).toBeHidden();
    await expect(editor(page)).toContainText('jordan@example.com | (555) 010-0199');
    await saved(page);

    // A typed edit autosaves too.
    await editor(page).locator('p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Thanks!');
    await saved(page);

    await visit(page, page.url(), '[data-letter-editor]');
    await expect(editor(page)).toContainText('(555) 010-0199');
    await expect(editor(page)).toContainText('Thanks!');
    await expect(page.locator('[data-placeholder-banner]')).toBeHidden();
    await expect(page.getByRole('dialog')).toBeHidden();

    // Export Cover Letter downloads a PDF named after the letter.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Cover Letter' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^Cover Letter \d{1,2}-\d{1,2}-\d{4}\.pdf$/);
    const bytes = readFileSync(await file.path());
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  test('generate without a template: the name, contact line, greeting and sign-off wrap the AI paragraphs', async ({ page }) => {
    await signInWithResume(page);
    await visit(page, '/cover-letter/new', '[data-letter-editor]');
    const dialog = page.getByRole('dialog', { name: 'Generate a Tailored Cover Letter' });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog.getByLabel('Company Name').fill('Fabrikam');
    await dialog.getByLabel('Job Title').fill('Product Designer');
    await dialog.getByRole('button', { name: 'Generate' }).click();
    await expect(dialog).toBeHidden({ timeout: 45_000 });
    await expect(editor(page).locator('h1')).toHaveText('Jordan Avery Chen');
    await expect(editor(page)).toContainText('jordan@example.com | linkedin.com/in/jordanchen');
    await expect(editor(page)).toContainText('Dear Hiring Manager,');
    await expect(editor(page)).toContainText('Sincerely,');
    await expect(page.locator('[data-placeholder-banner]')).toBeHidden();

    // The Documents tab lists it with its badge, in both views.
    await visit(page, '/documents?tab=cover-letters', '[data-cover-letter-row], [data-cover-letter-card]');
    const table = page.getByRole('table', { name: 'Cover letters' });
    await expect(table.getByRole('row').nth(1)).toContainText('Generated');
    await expect(table.getByRole('row').nth(1)).toContainText('-');
  });

  test('Cover Letters tab: table and thumbnail grid, remembered', async ({ page }) => {
    await signInWithResume(page);
    const api = page.request;
    for (let index = 0; index < 2; index += 1) {
      const letter = await call<{ id: string }>(() => api.post('/api/cover-letters', { headers: ORIGIN, data: {} }), 'create a letter');
      await call(
        () => api.patch(`/api/cover-letters/${letter.id}`, { headers: ORIGIN, data: { contentHtml: `<p>Letter ${index + 1}</p>` } }),
        'save a letter',
      );
    }
    await visit(page, '/documents?tab=cover-letters', '[data-cover-letter-row], [data-cover-letter-card]');
    const table = page.getByRole('table', { name: 'Cover letters' });
    await expect(table.getByRole('columnheader')).toHaveText(['', 'Name', 'Created', 'Last Edited', 'Actions']);
    await expect(table.getByRole('row')).toHaveCount(3);

    await page.getByRole('button', { name: 'Grid', exact: true }).click();
    await expect(page.locator('[data-cover-letter-card]')).toHaveCount(2);
    await expect(page.locator('[data-new-tile="cover-letter"]')).toBeVisible();
    // The first page draws in a sandboxed frame from GET /preview.
    await expect(page.locator('[data-cover-letter-card] iframe').first()).toBeAttached({ timeout: 15_000 });

    await visit(page, page.url(), '[data-cover-letter-card]');
    await expect(page.locator('[data-cover-letter-card]')).toHaveCount(2);
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Cover letters' })).toBeVisible();

    // More ⌄ → View opens the preview.
    await page.locator('[data-cover-letter-row]').first().getByRole('button', { name: /^More/ }).click();
    await page.getByRole('menuitem', { name: 'View' }).click();
    const preview = page.getByRole('dialog', { name: 'Cover Letter Preview' });
    await expect(preview).toBeVisible();
    await expect(preview.locator('iframe')).toBeAttached({ timeout: 15_000 });
  });
});

test.describe('templates', () => {
  test('insert a variable, type one, drag a chip; chips survive a reload and are stored as {{X}}', async ({ page }) => {
    await signInWithResume(page);
    await visit(page, '/cover-letter-template/new', '[data-letter-editor]');
    await expect(page).toHaveURL(/\/cover-letter-template\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page.locator('[data-editor-bar]')).toContainText(/Template \d{1,2}\/\d{1,2}\/\d{4}, /);
    await expect(editor(page)).toBeVisible();

    await editor(page).click();
    await page.keyboard.type('Dear ');
    await page.getByLabel('Insert variable').click();
    await page.getByLabel('Insert variable').fill('company');
    await page.getByRole('option', { name: /Company name/ }).click();
    await page.keyboard.type(', the {{JOB_TITLE}} role is mine. Signed:');
    await expect(editor(page).locator('[data-variable]')).toHaveCount(2);
    await expect(editor(page).locator('[data-variable="JOB_TITLE"]')).toHaveText('{{JOB_TITLE}}');

    // A chip is atomic and draggable: move {{COMPANY_NAME}} to the end.
    const chip = editor(page).locator('[data-variable="COMPANY_NAME"]');
    const box = await editor(page).locator('p').first().boundingBox();
    if (!box) throw new Error('no paragraph');
    await chip.dragTo(editor(page).locator('p').first(), { targetPosition: { x: box.width - 2, y: box.height / 2 } });
    await saved(page);

    const id = page.url().split('/').pop()!;
    const stored = await call<{ contentHtml: string }>(() => page.request.get(`/api/cover-letter-templates/${id}`), 'read template');
    expect(stored.contentHtml).toMatch(/^<p>Dear .*\{\{JOB_TITLE\}\} role is mine\. Signed:.*<\/p>$/);
    expect(stored.contentHtml).toContain('{{COMPANY_NAME}}');
    expect(stored.contentHtml).not.toContain('<span');
    // The drag moved the chip after "Signed:".
    expect(stored.contentHtml.indexOf('{{COMPANY_NAME}}')).toBeGreaterThan(stored.contentHtml.indexOf('Signed:'));

    await visit(page, page.url(), '[data-letter-editor]');
    await expect(editor(page).locator('[data-variable]')).toHaveCount(2);
    await expect(editor(page).locator('[data-variable="COMPANY_NAME"]')).toBeVisible();

    // Hovering a chip explains it.
    await editor(page).locator('[data-variable="JOB_TITLE"]').hover();
    await expect(page.locator('[data-variable-hint]')).toContainText('The title of the role you are applying for.');
  });

  test('rename rules, AI prompt counter, and a starter template is read-only until duplicated', async ({ page }) => {
    await signInWithResume(page);
    const id = await templateId(page.request, 'Creative Industry');
    await visit(page, `/cover-letter-template/${id}`, '[data-letter-editor]');
    await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
    await expect(page.locator('[data-editor-bar]').getByRole('status')).toHaveText('Read-only');
    await expect(editor(page).locator('[data-variable="COMPANY_APPEAL"]')).toBeVisible();

    await page.locator('[data-editor-bar]').getByRole('button', { name: 'Duplicate to edit' }).click();
    await expect(page).not.toHaveURL(new RegExp(id));
    await expect(page.locator('[data-editor-bar]')).toContainText('Creative Industry (Copy)');
    await expect(editor(page)).toHaveAttribute('contenteditable', 'true');

    // Rename: at least 3 characters.
    await page.getByRole('button', { name: 'Rename' }).click();
    const name = page.getByLabel('Document name');
    await name.fill('ab');
    await name.press('Enter');
    await expect(page.locator('[data-editor-bar]').getByRole('alert')).toHaveText('Template name must be at least 3 characters long');
    await name.fill('Creative Industry Cover Letter');
    await name.press('Enter');
    await expect(page.locator('[data-editor-bar]')).toContainText('Creative Industry Cover Letter');

    // The AI prompt: counter and save.
    await page.getByRole('button', { name: 'AI Prompt' }).click();
    const prompt = page.getByRole('dialog', { name: 'AI Prompt' });
    await expect(prompt).toContainText('This prompt will be used as additional context');
    await prompt.getByLabel('AI prompt').fill('Mention my portfolio.');
    await expect(prompt).toContainText('21/1000');
    await prompt.getByRole('button', { name: 'Save' }).click();
    await expect(prompt).toBeHidden();

    // It appears in the Templates tab, after the starters.
    await visit(page, '/documents?tab=templates', '[data-template-row]');
    const rows = page.locator('[data-template-row]');
    await expect(rows.first()).toContainText('System Default');
    await expect(rows.last()).toContainText('Creative Industry Cover Letter');
    await expect(rows.first().getByRole('checkbox')).toBeDisabled();
  });
});
