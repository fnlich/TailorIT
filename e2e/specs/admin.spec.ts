import { expect, test, type Page } from '@playwright/test';

/*
 * Work package J1: the admin console (/settings/admin). Runs against the dev server (`npm run dev`, with
 * AUTH_DEV_FIXED_CODE=000000 and admin@tailorit.dev in ADMIN_EMAILS). Everything it adds it deletes again.
 */

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3100';

async function signIn(page: Page, email: string) {
  const res = await page.request.post('/api/auth/email/verify', { headers: { Origin: ORIGIN }, data: { email, code: '000000' } });
  expect(res.ok(), `sign-in as ${email}`).toBeTruthy();
}

async function deleteSource(page: Page, name: string) {
  await page.goto('/settings/admin?tab=sources');
  const table = page.getByRole('table', { name: 'Job sources' });
  const row = table.getByRole('row').filter({ hasText: name });
  await row.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Delete source' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText(`Delete ${name}?`);
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(table.getByRole('row').filter({ hasText: name })).toHaveCount(0);
}

test.describe('admin console', () => {
  test('an administrator sees every section', async ({ page }) => {
    await signIn(page, 'admin@tailorit.dev');
    await page.goto('/settings/admin');
    await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible();
    const tabs = page.getByRole('tablist', { name: 'Admin sections' }).getByRole('tab');
    await expect(tabs).toHaveText(['Sources', 'Runs', 'Import jobs', 'Reports', 'AI', 'Users']);
    await expect(page.getByRole('heading', { name: 'Job sources' })).toBeVisible();

    await tabs.filter({ hasText: 'Runs' }).click();
    await expect(page).toHaveURL(/tab=runs/);
    await expect(page.getByRole('heading', { name: 'Runs', exact: true })).toBeVisible();

    await tabs.filter({ hasText: 'Reports' }).click();
    await expect(page.getByRole('tablist', { name: 'Report status' })).toBeVisible();

    await tabs.filter({ hasText: 'AI' }).click();
    await expect(page.locator('[data-ai-health]')).toBeVisible();

    await tabs.filter({ hasText: 'Users' }).click();
    await expect(page.getByRole('table', { name: 'Accounts' })).toContainText('admin@tailorit.dev');
  });

  test('imports a CSV of jobs, shows its run, and deletes the source', async ({ page }) => {
    await signIn(page, 'admin@tailorit.dev');
    const stamp = Date.now();
    const fileName = `e2e-admin-${stamp}.csv`;
    const csv = [
      'Date,NO(DATE),Company,Job Title,Job Link,Job Description',
      `10/20/2026,1,E2E Admin Co ${stamp},Data Engineer ${stamp},https://e2e-admin.example/jobs/${stamp}-1,"Requirements:\n- 3+ years of SQL"`,
      `10/21/2026,2,E2E Admin Co ${stamp},Product Designer ${stamp},https://e2e-admin.example/jobs/${stamp}-2,Design in Figma.`,
    ].join('\n');

    await page.goto('/settings/admin?tab=import');
    await page.getByTestId('import-file').setInputFiles({ name: fileName, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await expect(page.getByRole('heading', { name: 'Columns' })).toBeVisible();
    await expect(page.getByText('2 rows, 2 jobs to import (CSV)')).toBeVisible();
    await expect(page.getByLabel('Job title', { exact: true })).toContainText('Job Title');
    await expect(page.getByLabel('Job link', { exact: true })).toContainText('Job Link');
    await expect(page.getByRole('table', { name: 'First rows of the file' })).toContainText(`Data Engineer ${stamp}`);

    await page.getByRole('button', { name: 'Import 2 jobs' }).click();
    await expect(page.getByText(`Imported into ${fileName}`)).toBeVisible();
    await expect(page.getByText('2 new.')).toBeVisible();

    await page.getByRole('button', { name: 'See the run' }).click();
    await expect(page).toHaveURL(/tab=runs&source=\d+/);
    const run = page.getByRole('table', { name: 'Ingest runs' }).getByRole('row').filter({ hasText: fileName });
    await expect(run).toContainText('Upload');
    await expect(run).toContainText('Succeeded');
    await run.getByRole('button', { name: /Show the log of run/ }).click();
    await expect(page.getByLabel(/Log of run \d+/)).toContainText('Saved: 2 new');

    await page.getByRole('tab', { name: 'Sources' }).click();
    await expect(page.getByRole('heading', { name: 'Job sources' })).toBeVisible();
    const row = page.getByRole('table', { name: 'Job sources' }).getByRole('row').filter({ hasText: fileName });
    await expect(row).toContainText('CSV import');
    await expect(row).toContainText('2 live of 2');
    await deleteSource(page, fileName);
  });

  test('adds a demo seed source from the dialog and deletes it', async ({ page }) => {
    await signIn(page, 'admin@tailorit.dev');
    const name = `Demo jobs e2e ${Date.now()}`;
    await page.goto('/settings/admin?tab=sources');
    await page.getByRole('button', { name: 'Add source' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add source' });
    await dialog.getByRole('tab', { name: 'Greenhouse' }).click();
    await expect(dialog.getByLabel('Board token')).toBeVisible();
    await dialog.getByRole('tab', { name: 'Demo jobs' }).click();
    await expect(dialog.getByText('About 120 fictional postings')).toBeVisible();
    await dialog.getByLabel('Display name').fill(name);
    await dialog.getByRole('button', { name: 'Add source' }).click();
    await expect(dialog).toBeHidden();
    const row = page.getByRole('table', { name: 'Job sources' }).getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('Demo seed');
    await expect(row).toContainText('Never');
    await deleteSource(page, name);
  });

  test('a non-administrator is told the page is not for them', async ({ page }) => {
    await signIn(page, `e2e-member-${Date.now()}@tailorit.dev`);
    await page.goto('/settings/admin');
    await expect(page.getByText('That is an administrator-only part of this installation.')).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Admin sections' })).toHaveCount(0);
  });
});
