import { expect, test, type Page, type Route } from '@playwright/test';

/*
 * Work package WP12: Admin > Import jobs > Google Sheet. Runs against the dev server (`npm run dev`, with
 * AUTH_DEV_FIXED_CODE=000000 and admin@tailorit.dev in ADMIN_EMAILS). Google is never reached: the three sheet routes
 * (and, where a test needs them, the source and run lists) are stubbed with page.route, so nothing is saved.
 */

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const EMAIL = 'tailorit-e2e@tailorit-e2e-project.iam.gserviceaccount.com';
const SHEET_ID = '1E2eSheetAbCdEfGhIjKlMnOpQrStUvWxYz0123456';
const LINK = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=101`;
const TAB_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=101`;
const STAMP = '2026-10-22T12:00:00.000Z';

type Json = Record<string, unknown>;

async function signIn(page: Page, email: string) {
  const res = await page.request.post('/api/auth/email/verify', { headers: { Origin: ORIGIN }, data: { email, code: '000000' } });
  expect(res.ok(), `sign-in as ${email}`).toBeTruthy();
}

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const ACCOUNT = { configured: true, clientEmail: EMAIL, projectId: 'tailorit-e2e-project', keyFile: 'C:\\TailorIT\\service-account-key.json', problem: null };

const FIELDS = [
  ['title', 'Job title', true],
  ['company', 'Company', true],
  ['url', 'Job link', true],
  ['description', 'Job description', false],
  ['location', 'Location', false],
  ['postedAt', 'Posted date', false],
  ['salary', 'Salary', false],
  ['employmentType', 'Job type', false],
  ['workArrangement', 'Work arrangement', false],
  ['department', 'Department', false],
  ['id', 'Job id', false],
].map(([field, label, required]) => ({ field, label, required }));

const MAPPING = {
  title: 'Job Title',
  company: 'Company',
  url: 'Job Link',
  description: 'Job Description',
  location: null,
  postedAt: null,
  salary: 'Rate',
  employmentType: null,
  workArrangement: null,
  department: null,
  id: null,
};

const TABS = [
  { gid: 100, title: '10/21/2026', index: 0, hidden: false, rowCount: 1000, columnCount: 26 },
  { gid: 101, title: '10/22/2026', index: 1, hidden: false, rowCount: 1000, columnCount: 26 },
  { gid: 102, title: 'Archive', index: 2, hidden: true, rowCount: 1000, columnCount: 26 },
];

/** The preview the stub answers: the free_tailor day tab, with the request's choices applied. */
function previewFor(body: Json): Json {
  const mapping = { ...MAPPING, ...((body.mapping as Json | undefined) ?? {}) };
  const fromTab = (body.postedAtFromTab as boolean | undefined) ?? true;
  if (fromTab) mapping.postedAt = null;
  return {
    fileName: 'Job sheet (10/22/2026).csv',
    format: 'csv',
    columns: ['NO(DATE)', 'Company', 'Job Title', 'Job Link', 'Job Description', 'Rate', 'note'],
    mapping,
    fields: FIELDS,
    rowCount: 2,
    jobCount: 2,
    sample: [
      { 'NO(DATE)': '1', Company: 'Acme Robotics', 'Job Title': 'Senior Data Engineer', 'Job Link': 'https://acme.example/jobs/9', 'Job Description': 'SQL', Rate: '$150k', note: '' },
      { 'NO(DATE)': '2', Company: 'Globex', 'Job Title': 'Product Designer', 'Job Link': 'https://globex.example/careers/3', 'Job Description': 'Figma', Rate: '', note: '' },
    ],
    missingRequired: [],
    problems: [],
    spreadsheetId: SHEET_ID,
    spreadsheetTitle: 'Job sheet',
    url: TAB_URL,
    tabs: TABS,
    tab: TABS[1],
    headerRow: (body.headerRow as number | undefined) ?? 1,
    suggestedHeaderRow: null,
    tabDate: '2026-10-22',
    postedAtFromTab: fromTab,
    sourceName: (body.name as string | undefined) || 'Job sheet (10/22/2026)',
    existingSource: null,
    notes: [],
    readAt: STAMP,
  };
}

const SHEET_CONFIG = {
  spreadsheetId: SHEET_ID,
  gid: 101,
  tabTitle: '10/22/2026',
  spreadsheetTitle: 'Job sheet',
  url: TAB_URL,
  headerRow: 1,
  postedAt: '2026-10-22',
  readAt: STAMP,
};

const RUN = {
  id: 77,
  status: 'succeeded',
  trigger: 'upload',
  startedAt: STAMP,
  finishedAt: STAMP,
  fetched: 2,
  created: 2,
  updated: 0,
  unchanged: 0,
  deactivated: 0,
  failed: 0,
  error: null,
  sourceId: 4242,
  sourceKind: 'csv',
  sourceKindLabel: 'Google Sheet',
  sourceName: 'Job sheet (10/22/2026)',
};

const SOURCE = {
  id: 4242,
  kind: 'csv',
  kindLabel: 'Google Sheet',
  name: 'Job sheet (10/22/2026)',
  config: { file: '4242/x.csv', fileName: 'Job sheet (10/22/2026).csv', format: 'csv', mapping: MAPPING, sheet: SHEET_CONFIG },
  enabled: true,
  schedule: 'manual',
  deactivateMissing: false,
  lastRunAt: STAMP,
  lastSuccessAt: STAMP,
  lastStatus: 'succeeded',
  createdAt: STAMP,
  updatedAt: STAMP,
  jobCount: 2,
  activeJobCount: 2,
  running: false,
  lastRun: RUN,
};

/** Stubs the sheet routes and records what the page sent. */
async function stubSheets(page: Page, options: { account?: Json; preview?: (body: Json) => [number, unknown] } = {}) {
  const sent = { previews: [] as Json[], imports: [] as Json[] };
  await page.route('**/api/admin/import/sheets/account', (route) => json(route, 200, options.account ?? ACCOUNT));
  await page.route('**/api/admin/import/sheets/preview', (route) => {
    const body = route.request().postDataJSON() as Json;
    sent.previews.push(body);
    const [status, answer] = options.preview ? options.preview(body) : [200, previewFor(body)];
    return json(route, status, answer);
  });
  await page.route('**/api/admin/import/sheets/jobs', (route) => {
    sent.imports.push(route.request().postDataJSON() as Json);
    return json(route, 201, { source: SOURCE, run: { ...RUN, log: ['Saved: 2 new, 0 updated, 0 unchanged.'] }, runId: RUN.id });
  });
  return sent;
}

test.describe('admin: Google Sheet import', () => {
  test('copies the share address, reads a tab, maps its columns and imports it', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
    await signIn(page, 'admin@tailorit.dev');
    const sent = await stubSheets(page);
    await page.goto('/settings/admin?tab=import');
    await page.getByRole('tablist', { name: 'Import from' }).getByRole('tab', { name: 'Google Sheet' }).click();

    await expect(page.getByRole('heading', { name: 'Share the sheet with TailorIT' })).toBeVisible();
    await expect(page.getByTestId('sheet-client-email')).toHaveText(EMAIL);
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(page.getByText('Address copied')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(EMAIL);

    await page.getByLabel('Sheet link').fill(LINK);
    await page.getByRole('button', { name: 'Read sheet' }).click();
    await expect(page.getByRole('heading', { name: 'Job sheet', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open in Google Sheets' })).toHaveAttribute('href', TAB_URL);

    const tab = page.getByLabel('Tab', { exact: true });
    await expect(tab).toContainText('10/22/2026');
    await tab.click();
    await expect(page.getByRole('option', { name: 'Archive (hidden)' })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByLabel('Header row')).toHaveValue('1');
    await expect(page.getByRole('checkbox', { name: /Use the tab name \(10\/22\/2026\) as every job's posted date/ })).toBeChecked();
    await expect(page.getByLabel('Posted date', { exact: true })).toContainText('From the tab name');
    await expect(page.getByLabel('Job title', { exact: true })).toContainText('Job Title');
    await expect(page.getByText('2 rows, 2 jobs to import (Google Sheet)')).toBeVisible();
    await expect(page.getByRole('table', { name: 'First rows of the sheet' })).toContainText('Senior Data Engineer');

    // A new mapping asks the server again without reading Google (refresh: false).
    await page.getByLabel('Salary', { exact: true }).click();
    await page.getByRole('option', { name: 'Not in this tab' }).click();
    await expect.poll(() => sent.previews.length).toBe(2);

    await page.getByRole('button', { name: 'Import 2 jobs' }).click();
    await expect(page.getByText('Imported into Job sheet (10/22/2026)')).toBeVisible();
    await expect(page.getByText('2 new. 2 live jobs from this tab.')).toBeVisible();

    expect(sent.previews[0]).toEqual({ url: LINK, refresh: true });
    expect(sent.previews[1]).toMatchObject({ url: LINK, gid: 101, headerRow: 1, refresh: false, mapping: { salary: null, title: 'Job Title' } });
    expect(sent.imports).toHaveLength(1);
    expect(sent.imports[0]).toMatchObject({ url: LINK, gid: 101, headerRow: 1, postedAtFromTab: true, mapping: { title: 'Job Title', company: 'Company', url: 'Job Link' } });
  });

  test('says the import is off without a key and keeps Read sheet disabled', async ({ page }) => {
    await signIn(page, 'admin@tailorit.dev');
    const keyFile = 'C:\\TailorIT\\service-account-key.json';
    await stubSheets(page, {
      account: {
        configured: false,
        clientEmail: null,
        projectId: null,
        keyFile,
        problem: `There is no Google service account key at ${keyFile}. Save the key there (no restart needed), or set GOOGLE_SERVICE_ACCOUNT_KEY_FILE in .env and restart the API.`,
      },
    });
    await page.goto('/settings/admin?tab=import');
    await page.getByRole('tablist', { name: 'Import from' }).getByRole('tab', { name: 'Google Sheet' }).click();
    const off = page.getByRole('alert').filter({ hasText: 'Google Sheet import is off on this server' });
    await expect(off).toBeVisible();
    await expect(off).toContainText(keyFile);
    await expect(off.getByRole('button', { name: 'Check again' })).toBeVisible();
    await expect(page.getByLabel('Sheet link')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Read sheet' })).toBeDisabled();
    await expect(page.getByTestId('sheet-client-email')).toHaveCount(0);
  });

  test("shows Google's refusal under the link", async ({ page }) => {
    await signIn(page, 'admin@tailorit.dev');
    const share = `TailorIT can't open this spreadsheet. In Google Sheets, click Share, add ${EMAIL} as a Viewer, then read the sheet again.`;
    await stubSheets(page, { preview: () => [400, { error: { code: 'validation_failed', message: share, fields: { url: share } } }] });
    await page.goto('/settings/admin?tab=import');
    await page.getByRole('tablist', { name: 'Import from' }).getByRole('tab', { name: 'Google Sheet' }).click();
    await page.getByLabel('Sheet link').fill(LINK);
    await page.getByRole('button', { name: 'Read sheet' }).click();
    await expect(page.getByText(share)).toBeVisible();
    await expect(page.getByLabel('Sheet link')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('heading', { name: 'Columns' })).toHaveCount(0);
  });

  test('a published link is refused before anything is sent', async ({ page }) => {
    await signIn(page, 'admin@tailorit.dev');
    const sent = await stubSheets(page);
    await page.goto('/settings/admin?tab=import');
    await page.getByRole('tablist', { name: 'Import from' }).getByRole('tab', { name: 'Google Sheet' }).click();
    await page.getByLabel('Sheet link').fill('https://docs.google.com/spreadsheets/d/e/2PACX-1vQabcdefghijklmnopqrstuvwxyz0123/pubhtml');
    await page.getByLabel('Sheet link').blur();
    await expect(page.getByText(/"Publish to the web" link, which TailorIT can't read/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Read sheet' })).toBeDisabled();
    expect(sent.previews).toHaveLength(0);
  });

  test('Sources and Runs name a sheet source, and Import the sheet again reopens its tab', async ({ page }) => {
    await signIn(page, 'admin@tailorit.dev');
    const sent = await stubSheets(page);
    await page.route('**/api/admin/sources', (route) =>
      route.request().method() === 'GET' ? json(route, 200, { items: [SOURCE], total: 1 }) : route.fallback(),
    );
    await page.route('**/api/admin/runs?*', (route) => json(route, 200, { items: [RUN] }));

    await page.goto('/settings/admin?tab=sources');
    const row = page.getByRole('table', { name: 'Job sources' }).getByRole('row').filter({ hasText: SOURCE.name });
    await expect(row).toContainText('Google Sheet');
    await expect(row).toContainText('Job sheet, tab 10/22/2026');

    await page.getByRole('tab', { name: 'Runs' }).click();
    const run = page.getByRole('table', { name: 'Ingest runs' }).getByRole('row').filter({ hasText: SOURCE.name });
    await expect(run).toContainText('Google Sheet · Run 77');
    await expect(run).toContainText('Import');

    await page.getByRole('tab', { name: 'Sources' }).click();
    await row.getByRole('button', { name: `More actions for ${SOURCE.name}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Open in Google Sheets' })).toHaveAttribute('href', TAB_URL);
    await page.getByRole('menuitem', { name: 'Import the sheet again' }).click();

    await expect(page).toHaveURL(/tab=import&source=4242/);
    await expect(page.getByRole('tablist', { name: 'Import from' }).getByRole('tab', { name: 'Google Sheet' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Sheet link')).toHaveValue(TAB_URL);
    await expect.poll(() => sent.previews[0]).toEqual({
      url: TAB_URL,
      gid: 101,
      headerRow: 1,
      postedAtFromTab: true,
      name: SOURCE.name,
      refresh: true,
    });
    await expect(page.getByRole('heading', { name: 'Job sheet', exact: true })).toBeVisible();
  });
});
