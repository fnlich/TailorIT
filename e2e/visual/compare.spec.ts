import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { expect, test, type Locator, type Page } from '@playwright/test';

/*
 * Work package I: our pages beside the user's Simplify screenshots. Signs in as the demo account (`npm run seed:demo`
 * first), captures each page at 1567×889 (project "shots") into e2e/artifacts/compare/ours-N.png and writes
 * compare-N.png: the reference (e2e/reference/simplify-N.png, git-ignored) on the left, ours on the right. Where the
 * reference is a crop of a page (4, 6, 7), the composite shows the matching crop of ours.
 *   1 Jobs with a selected job   2 Tracker board   3 Documents › Resumes (ours: free_tailor's list view, by design)
 *   4 Documents › Cover Letters  5 a template in the template editor  6 the tracker's Options menu  7 Tracker list
 *   npx playwright test --project=shots e2e/visual/compare.spec.ts
 */

const OUT = join(process.cwd(), 'e2e', 'artifacts', 'compare');
const REFERENCE = join(process.cwd(), 'e2e', 'reference');
const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const EMAIL = process.env.DEMO_EMAIL ?? 'demo@tailorit.dev';
const CODE = process.env.AUTH_DEV_FIXED_CODE ?? '000000';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ------------------------------------------------------------------------------------------------- images

function crop(source: PNG, box: Box): PNG {
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  const width = Math.min(source.width - x, Math.round(box.width));
  const height = Math.min(source.height - y, Math.round(box.height));
  const out = new PNG({ width, height });
  PNG.bitblt(source, out, x, y, width, height, 0, 0);
  return out;
}

/** The reference on the left, ours on the right, on white with a grey rule between them. */
function sideBySide(reference: PNG, ours: PNG): PNG {
  const gap = 24;
  const width = reference.width + gap + ours.width;
  const height = Math.max(reference.height, ours.height);
  const out = new PNG({ width, height });
  out.data.fill(255);
  for (let row = 0; row < height; row += 1) {
    for (let column = reference.width + gap / 2 - 1; column <= reference.width + gap / 2; column += 1) {
      const at = (row * width + column) * 4;
      out.data[at] = 200;
      out.data[at + 1] = 200;
      out.data[at + 2] = 200;
    }
  }
  PNG.bitblt(reference, out, 0, 0, reference.width, reference.height, 0, 0);
  PNG.bitblt(ours, out, 0, 0, ours.width, ours.height, reference.width + gap, 0);
  return out;
}

/** Saves ours-N.png (the whole 1567×889 page) and, when the reference is here, compare-N.png. */
async function capture(page: Page, n: number, cropTo?: Box, suffix = ''): Promise<void> {
  const shot = PNG.sync.read(await page.screenshot());
  writeFileSync(join(OUT, `ours-${n}${suffix}.png`), PNG.sync.write(shot));
  const referencePath = join(REFERENCE, `simplify-${n}.png`);
  if (!existsSync(referencePath)) return;
  const reference = PNG.sync.read(readFileSync(referencePath));
  const ours = cropTo ? crop(shot, cropTo) : shot;
  writeFileSync(join(OUT, `compare-${n}${suffix}.png`), PNG.sync.write(sideBySide(reference, ours)));
}

// ------------------------------------------------------------------------------------------------ the app

async function signIn(page: Page): Promise<void> {
  let last = '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const res = await page.request
      .post('/api/auth/email/verify', { headers: { Origin: ORIGIN }, data: { email: EMAIL, code: CODE } })
      .catch(() => null);
    if (res?.ok()) return;
    last = res ? `${res.status()} ${await res.text()}` : 'no answer';
    await page.waitForTimeout(1500);
  }
  throw new Error(`sign-in as ${EMAIL} failed: ${last}`);
}

async function json<T>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(path);
  expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

async function settle(page: Page): Promise<void> {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(600);
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element is not on screen');
  return box;
}

async function showList(page: Page): Promise<void> {
  const list = page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'List' });
  await list.click();
  await expect(list).toHaveAttribute('aria-pressed', 'true');
}

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await signIn(page);
  const resumes = await json<{ items: unknown[] }>(page, '/api/resumes');
  const counts = await json<{ active: number }>(page, '/api/applications/counts');
  test.skip(resumes.items.length === 0 || counts.active === 0, `${EMAIL} has no demo data: run npm run seed:demo first`);
});

test('1: Jobs with a selected job', async ({ page }) => {
  // The demo's Lumenwave SRE application went past Applied, so its header shows the Applied chip.
  const tracked = await json<{ items: Array<{ jobId: number | null; title: string; companyName: string }> }>(
    page,
    '/api/applications?q=Lumenwave&limit=50',
  );
  const job = tracked.items.find((item) => item.jobId && item.title === 'Senior Site Reliability Engineer');
  expect(job, 'the demo Lumenwave SRE application').toBeTruthy();
  await page.goto(
    `/jobs?q=${encodeURIComponent('site reliability')}&type=full_time&category=devops-infrastructure&category=software-engineering&jobId=${job!.jobId}`,
  );
  const detail = page.getByRole('region', { name: 'Job details' });
  await expect(detail.getByRole('heading', { level: 1 })).toHaveText(job!.title);
  await expect(detail.locator('[data-applied-chip]')).toBeVisible();
  await page.locator('[data-improve-card] [data-keyword]').first().waitFor({ timeout: 30_000 });
  await settle(page);
  await capture(page, 1);
});

test('2: Tracker board', async ({ page }) => {
  await page.goto('/tracker');
  await page.locator('[data-application-card]').first().waitFor();
  await settle(page);
  await capture(page, 2);
});

test('3: Documents › Resumes', async ({ page }) => {
  await page.goto('/documents?tab=resumes');
  await showList(page);
  await page.locator('[data-resume-row]').first().waitFor();
  await settle(page);
  await capture(page, 3);
  // The thumbnail grid, the Resumes tab's other view.
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Grid' }).click();
  await page.locator('[data-resume-card] iframe, [data-resume-card] img').first().waitFor({ timeout: 30_000 });
  await settle(page);
  await capture(page, 3, undefined, '-grid');
  await showList(page);
});

test('4: Documents › Cover Letters', async ({ page }) => {
  await page.goto('/documents?tab=cover-letters');
  await showList(page);
  await page.locator('[data-cover-letter-row]').first().waitFor();
  await settle(page);
  // The reference is the tabs and the table, 1551×565, from 85 px left of the tabs.
  const tabs = await boxOf(page.getByRole('tablist').first());
  await capture(page, 4, { x: tabs.x - 85, y: tabs.y - 25, width: 1551, height: 565 });
});

test('5: a template in the template editor', async ({ page }) => {
  const templates = await json<{ items: Array<{ id: string; name: string }> }>(page, '/api/cover-letter-templates');
  const template = templates.items.find((item) => item.name === 'Creative Industry Cover Letter');
  expect(template, 'the demo template "Creative Industry Cover Letter"').toBeTruthy();
  await page.goto(`/cover-letter-template/${template!.id}`);
  await page.locator('[data-letter-editor] [data-variable]').first().waitFor();
  await settle(page);
  await capture(page, 5);
});

test('6: the tracker Options menu', async ({ page }) => {
  await page.goto('/tracker');
  await page.locator('[data-application-card]').first().waitFor();
  await settle(page);
  const options = page.getByRole('button', { name: /^Options/ });
  await options.click();
  const menu = page.getByRole('menu').first();
  await menu.waitFor();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  // The reference is a 340×587 crop: the List / Chart / Options buttons and the menu under them.
  const button = await boxOf(options);
  const popup = await boxOf(menu);
  await capture(page, 6, { x: popup.x - 35, y: button.y - 12, width: 340, height: 587 });
  await page.keyboard.press('Escape');
});

test('7: Tracker list view', async ({ page }) => {
  await page.goto('/tracker?view=list');
  await page.locator('[data-application-row]').first().waitFor();
  await settle(page);
  // The reference is a 1564×724 crop from just above the search pill.
  const search = await boxOf(page.getByRole('searchbox', { name: 'Search for roles or companies' }));
  await capture(page, 7, { x: search.x - 45, y: search.y - 13, width: 1564, height: 724 });
});
