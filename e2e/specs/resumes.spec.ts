import { expect, test, type Page } from '@playwright/test';

/*
 * Work package R2, end to end against the running app and API (no mocks): build a resume from a template, see it on
 * Documents › Resumes as a page thumbnail, then in the list rename it, make it the default and delete it.
 * Needs the dev server (npm run dev) with AUTH_DEV_FIXED_CODE=000000 and work package R1's resume API.
 */

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3100';

async function signIn(page: Page) {
  // The dev API restarts when its files change; a sign-in that meets a restart is tried again.
  for (let attempt = 1; ; attempt += 1) {
    const answer = await page.request.post('/api/auth/email/verify', {
      data: { email: 'r2@tailorit.dev', code: '000000' },
      headers: { Origin: ORIGIN },
    });
    if (answer.ok()) return;
    if (attempt >= 8 || answer.status() < 500) throw new Error(`Sign-in failed (${answer.status()}): ${await answer.text()}`);
    await page.waitForTimeout(1500);
  }
}

/** Deletes resumes earlier attempts of this test left behind (a run cut short by an API restart). */
async function removeLeftovers(page: Page) {
  const answer = await page.request.get('/api/resumes');
  if (!answer.ok()) return;
  const items = ((await answer.json()) as { items?: Array<{ id: string; label: string }> }).items ?? [];
  for (const item of items) {
    if (!/^(Platform Engineer|Renamed resume) [0-9a-z]+( \(Copy\))?$/.test(item.label)) continue;
    await page.request.delete(`/api/resumes/${encodeURIComponent(item.id)}`, { headers: { Origin: ORIGIN } });
  }
}

test.describe('resumes', () => {
  test.setTimeout(120_000);
  // The dev API restarts whenever its source changes; a run that meets a restart is tried again from the start.
  test.describe.configure({ retries: 2 });

  test('build a resume from a template, then rename it, set it as default and delete it', async ({ page }) => {
    await signIn(page);
    await removeLeftovers(page);
    const stamp = Date.now().toString(36);
    const name = `Avery Quinn ${stamp}`;
    const title = `Platform Engineer ${stamp}`;
    const renamed = `Renamed resume ${stamp}`;

    // Documents › New Resume → the template chooser.
    await page.goto('/documents?tab=resumes');
    await page.locator('[data-new-fallback="resume"]').click();
    await expect(page).toHaveURL(/\/resumes\/new$/);
    await expect(page.getByRole('heading', { name: 'Start building a resume' })).toBeVisible();
    await expect(page.getByText('Choose a design you like. You can customize or switch it later.')).toBeVisible();

    // A template's details → Use this template → "Import your existing resume" → Start from blank.
    await page.locator('[data-template-card]').first().click();
    const details = page.getByRole('dialog');
    await expect(details.getByRole('group', { name: 'Technical skills' })).toBeVisible();
    await details.getByRole('button', { name: 'Use this template' }).click();
    await expect(page).toHaveURL(/\/resumes\/new\?template=/);
    const start = page.getByRole('dialog', { name: 'Import your existing resume' });
    await expect(start.getByText('Start faster by prefilling your resume content.')).toBeVisible();
    await start.getByRole('button', { name: 'Start from blank' }).click();
    await expect(page.getByText('Nothing entered yet')).toBeVisible();

    // Name and title.
    await page.getByRole('button', { name: 'Edit name and contact details' }).click();
    await page.getByLabel('Full name').fill(name);
    await page.getByLabel('Professional title').fill(title);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Unsaved changes')).toBeVisible();

    // One role with two bullets.
    await page.getByRole('button', { name: /^Experience/ }).click();
    await page.getByRole('button', { name: 'Add experience' }).click();
    await page.getByLabel('Job title').fill('Staff Engineer');
    await page.getByLabel('Company').fill('Northwind Payments');
    await page.getByLabel('Achievements, one per line').fill('Cut cloud spend by 22% with right-sizing\nLed a team of five engineers');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Edit Staff Engineer at Northwind Payments' })).toBeVisible();

    // The live preview draws it.
    const status = page.locator('[data-preview-status]');
    await expect(status).toHaveAttribute('data-preview-status', 'current', { timeout: 30_000 });
    await expect(page.frameLocator('iframe[title="Resume preview"]').getByText(name)).toBeVisible();

    // Create → back to Documents › Resumes.
    await page.getByRole('button', { name: 'Create Resume' }).click();
    await expect(page).toHaveURL(/\/documents\?tab=resumes/);

    // The thumbnail grid: the card with its first page.
    await page.getByRole('button', { name: 'Grid' }).click();
    const card = page.locator('[data-resume-card]').filter({ hasText: title });
    await expect(card).toBeVisible();
    await expect(card.locator('iframe[sandbox=""]')).toBeAttached({ timeout: 30_000 });
    await expect(card).toContainText(/Edited/);

    // The list: Resume | Name on resume | Template | Edited.
    await page.getByRole('button', { name: 'List' }).click();
    const row = page.locator('[data-resume-row]').filter({ hasText: title });
    await expect(row).toContainText(name);

    // Rename ("Change resume name").
    await row.getByRole('button', { name: `Actions for ${title}` }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const rename = page.getByRole('dialog', { name: 'Change resume name' });
    await rename.getByLabel('Resume name').fill(renamed);
    await rename.getByRole('button', { name: 'Change' }).click();
    await expect(page.locator('[data-resume-row]').filter({ hasText: renamed })).toBeVisible();
    // Pinned by id from here on: the copy's name contains this one's.
    const id = await page.locator('[data-resume-row]').filter({ hasText: renamed }).getAttribute('data-resume-row');
    const renamedRow = page.locator(`[data-resume-row="${id}"]`);

    // Downloads: the PDF from the server's export, the JSON file made in the browser.
    for (const [item, extension] of [
      ['Download PDF', 'pdf'],
      ['Download JSON', 'json'],
    ] as const) {
      await renamedRow.getByRole('button', { name: `Actions for ${renamed}`, exact: true }).click();
      const download = page.waitForEvent('download', { timeout: 60_000 });
      await page.getByRole('menuitem', { name: item }).click();
      expect((await download).suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
    }

    // Duplicate it ("… (Copy)"), then make the copy the default: the ★ Default badge moves to it. (An account's first
    // resume is its default already, so the copy is the one that can be chosen.)
    await renamedRow.getByRole('button', { name: `Actions for ${renamed}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    const copy = `${renamed} (Copy)`;
    await expect(page.locator('[data-resume-row]').filter({ hasText: copy })).toBeVisible();
    const copyId = await page.locator('[data-resume-row]').filter({ hasText: copy }).getAttribute('data-resume-row');
    const copyRow = page.locator(`[data-resume-row="${copyId}"]`);
    await expect(copyRow.locator('[data-default-resume]')).toHaveCount(0);
    await copyRow.getByRole('button', { name: `Actions for ${copy}` }).click();
    await page.getByRole('menuitem', { name: 'Set as default' }).click();
    await expect(copyRow.locator('[data-default-resume]')).toBeVisible();
    await expect(renamedRow.locator('[data-default-resume]')).toHaveCount(0);
    await copyRow.getByRole('button', { name: `Actions for ${copy}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Set as default' })).toBeDisabled();
    await page.keyboard.press('Escape');

    // Delete both (a styled confirmation each): focus moves on to a neighbour.
    for (const [row, label] of [
      [copyRow, copy],
      [renamedRow, renamed],
    ] as const) {
      await row.getByRole('button', { name: `Actions for ${label}`, exact: true }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      const confirm = page.getByRole('alertdialog');
      await expect(confirm).toContainText("Are you sure you want to delete this resume? You won't be able to undo this action.");
      await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(row).toHaveCount(0);
    }
  });
});
