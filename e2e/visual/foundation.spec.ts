import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';

/*
 * Work package F5 visual captures at the size of the user's Simplify screenshots (1567×889, project "shots"):
 * compare e2e/artifacts/foundation/*.png with e2e/reference/simplify-1.png (header, pills, inputs) and
 * simplify-3.png (Documents: action cards, tabs, table card). /dev/kit needs no API; /login shows whatever the API
 * answers (the email form, or the "can't reach the server" notice when it is down).
 *   npx playwright test --project=shots e2e/visual/foundation.spec.ts
 */

const OUT = join(process.cwd(), 'e2e', 'artifacts', 'foundation');

async function settle(page: Page) {
  // Next's dev-mode indicator would sit on top of the page.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  // Google's sign-in script can keep a connection open, so "network idle" is a hint, not a requirement.
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(600);
}

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test('sign-in page', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await settle(page);
  await page.screenshot({ path: join(OUT, 'login.png') });
});

const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const BOTH_METHODS = {
  google: { available: true, clientId: '000000000000-placeholder.apps.googleusercontent.com' },
  email: { available: true, devCodesInConsole: true },
  contactEmail: 'admin@example.com',
};

test('sign-in states (API answers stubbed)', async ({ page }) => {
  // Google and email offered together: Google's own button, the "or" divider, the email form.
  await page.route('**/api/auth/options', (route) => route.fulfill(json(200, BOTH_METHODS)));
  await page.goto('/login');
  await page.getByLabel('Email address').waitFor();
  await settle(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, 'login-google-and-email.png') });

  // The code step, then a disabled account.
  await page.route('**/api/auth/email/request', (route) =>
    route.fulfill(
      json(200, {
        sent: true,
        email: 'you@example.com',
        expiresInMinutes: 10,
        message: 'A six-digit code is on its way to you@example.com. It expires in 10 minutes.',
      }),
    ),
  );
  await page.route('**/api/auth/email/verify', (route) =>
    route.fulfill(
      json(403, {
        error: {
          code: 'account_disabled',
          message: 'That account has been disabled. Ask an administrator of this installation to re-enable it.',
        },
      }),
    ),
  );
  await page.getByLabel('Email address').fill('you@example.com');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('Six-digit code').fill('123456');
  await settle(page);
  await page.screenshot({ path: join(OUT, 'login-code-step.png') });
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'This account is disabled' }).waitFor();
  await settle(page);
  await page.screenshot({ path: join(OUT, 'login-disabled.png') });
});

test('sign-in when the API cannot be reached', async ({ page }) => {
  await page.route('**/api/auth/options', (route) => route.abort('connectionrefused'));
  await page.goto('/login');
  await page.getByText("We can't reach the server right now", { exact: false }).waitFor();
  await settle(page);
  await page.screenshot({ path: join(OUT, 'login-unreachable.png') });
});

test('kit: header + Documents page (compare with simplify-3.png)', async ({ page }) => {
  await page.goto('/dev/kit');
  await page.getByRole('heading', { name: 'My Documents' }).waitFor();
  await settle(page);
  await page.screenshot({ path: join(OUT, 'kit.png') });
  await page.screenshot({ path: join(OUT, 'kit-full.png'), fullPage: true });
});

test('kit: menus, pills, segmented controls (compare with simplify-1/2/6.png)', async ({ page }) => {
  await page.goto('/dev/kit');
  await settle(page);
  await page.locator('#pills').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Status', exact: true }).hover();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'kit-options-menu.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.locator('#documents').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /^More actions for PaaS/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'kit-row-menu.png') });
  await page.keyboard.press('Escape');
});

test('kit: cover letters as page thumbnails', async ({ page }) => {
  await page.goto('/dev/kit');
  await settle(page);
  const section = page.locator('#letters-grid');
  await section.getByRole('button', { name: 'Grid' }).click();
  await section.scrollIntoViewIfNeeded();
  await section.locator('iframe[sandbox=""]').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(800);
  await section.screenshot({ path: join(OUT, 'kit-letters-grid.png') });
  const resumes = page.locator('#resume-cards');
  await resumes.scrollIntoViewIfNeeded();
  await resumes.locator('iframe[sandbox=""]').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(800);
  await resumes.screenshot({ path: join(OUT, 'kit-resume-cards.png') });
});
