import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SheetPreviewSchema } from '@tailorit/shared';
import { fromGoogleResponse } from '../src/features/ingest/sheets/errors';
import { signIn, type TestAgent } from './auth-helpers';
import { FAKE_CLIENT_EMAIL, fakeSheetsClient, type FakeSheetsOptions, type FakeSpreadsheet } from './fake-sheets';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';

// Work package WP12: Admin > Import jobs > Google Sheet, through the routes, with a fake Google (no network).

let ctx: TestContext;
let admin: TestAgent;
beforeEach(async () => {
  ctx = createTestContext();
  admin = (await signIn(ctx, 'admin@tailorit.dev', { admin: true })).agent;
});
afterEach(() => {
  vi.restoreAllMocks();
  ctx.cleanup();
});

const ID = '1FtSheetAbCdEfGhIjKlMnOpQrStUvWxYz0123456';
const LINK = `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=101`;
const FT_HEADER = ['NO(DATE)', 'Company', 'Job Title', 'Job Link', 'Job Description', 'Rate', 'note', 'Job Finder', 'Filter Result', 'Filter Reason'];
/** free_tailor's day tab: the header on row 1, a blank row 3, a row with no link (5) and one with a link label (6). */
const DAY_ROWS = [
  FT_HEADER,
  ['1', 'Acme Robotics', 'Senior Data Engineer', 'https://acme.example/jobs/9', 'Requirements:\n- 5+ years of SQL and Python\n- Airflow', '$150k - $180k', '', 'bot', 'Pass'],
  [],
  ['2', 'Globex', 'Product Designer', 'https://globex.example/careers/3', 'Design in Figma.', '', 'remote ok'],
  ['3', 'Globex', 'No Link Here', '', 'Nothing to apply to.'],
  ['4', 'Initech', 'Support Lead', 'Apply', 'Help customers.'],
];

function freeTailorSheet(): Record<string, FakeSpreadsheet> {
  return {
    [ID]: {
      title: 'Job sheet',
      tabs: [
        { gid: 0, title: 'Notes', rows: [['Read me first']] },
        { gid: 100, title: '10/21/2026', rows: [FT_HEADER, ['1', 'Older Co', 'Old Role', 'https://older.example/1', 'Older posting.']] },
        { gid: 101, title: '10/22/2026', rows: DAY_ROWS },
        { gid: 102, title: 'Archive', hidden: true, rows: [FT_HEADER] },
      ],
    },
  };
}

function install(spreadsheets: Record<string, FakeSpreadsheet> = freeTailorSheet(), options: FakeSheetsOptions = {}) {
  const fake = fakeSheetsClient(spreadsheets, options);
  ctx.deps.services.sheets = fake;
  return fake;
}

const preview = (body: Record<string, unknown>) => admin.post('/api/admin/import/sheets/preview').set('Origin', ORIGIN).send(body);
const importSheet = (body: Record<string, unknown>) => admin.post('/api/admin/import/sheets/jobs').set('Origin', ORIGIN).send(body);
const importFile = (body: Record<string, unknown>) => admin.post('/api/admin/import/jobs').set('Origin', ORIGIN).send(body);
const parses = () => (ctx.deps.log as unknown as { lines: string[] }).lines.filter((line) => line.includes('[sheets] parsed')).length;

async function waitForRun(id: number) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const res = await admin.get(`/api/admin/runs/${id}`);
    if (res.body.status !== 'running') return res.body;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`run ${id} did not finish`);
}

const { privateKey: PRIVATE_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const CLIENT_EMAIL = 'tailor-test@tailorit-test-project.iam.gserviceaccount.com';
const keyJson = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'service_account',
    project_id: 'tailorit-test-project',
    private_key_id: 'key-id-0123456789',
    private_key: PRIVATE_KEY,
    client_email: CLIENT_EMAIL,
    client_id: '1234567890',
    token_uri: 'https://oauth2.googleapis.com/token',
    ...overrides,
  });

describe('the service account key', () => {
  it('reports a missing key, and a preview then answers 503 without asking Google anything', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const keyFile = ctx.deps.config.ingest.googleServiceAccountKeyFile;
    expect(keyFile).toBe(join(ctx.dataDir, 'google-service-account.json'));
    const account = await admin.get('/api/admin/import/sheets/account');
    expect(account.status).toBe(200);
    expect(account.body).toEqual({
      configured: false,
      clientEmail: null,
      projectId: null,
      keyFile,
      problem: `There is no Google service account key at ${keyFile}. Save the key there (no restart needed), or set GOOGLE_SERVICE_ACCOUNT_KEY_FILE in .env and restart the API.`,
    });
    for (const call of [() => preview({ url: LINK }), () => importSheet({ url: LINK })]) {
      const res = await call();
      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({ code: 'sheets_unavailable', message: account.body.problem });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('picks up a key saved while the server runs, and never answers its private parts', async () => {
    const keyFile = ctx.deps.config.ingest.googleServiceAccountKeyFile;
    expect((await admin.get('/api/admin/import/sheets/account')).body.configured).toBe(false);
    writeFileSync(keyFile, keyJson());
    const res = await admin.get('/api/admin/import/sheets/account');
    expect(res.body).toEqual({ configured: true, clientEmail: CLIENT_EMAIL, projectId: 'tailorit-test-project', keyFile, problem: null });
    expect(JSON.stringify(res.body)).not.toMatch(/PRIVATE KEY|private_key|key-id-0123456789/);
  });

  it('says what is wrong with each kind of unusable key file', async () => {
    const keyFile = ctx.deps.config.ingest.googleServiceAccountKeyFile;
    const cases: Array<[contents: string, problem: RegExp | null]> = [
      ['this is not json', /is not a JSON key\. In the Google Cloud console open IAM & Admin > Service accounts/],
      [JSON.stringify({ type: 'authorized_user', client_id: 'x', refresh_token: 'y' }), /is a "authorized_user" credential, not a service account key/],
      [JSON.stringify({ type: 'service_account', client_email: CLIENT_EMAIL }), /has no client_email or private_key/],
      [keyJson({ private_key: '-----BEGIN PRIVATE KEY-----\nnot really a key at all\n-----END PRIVATE KEY-----\n' }), /The private key in .* cannot be read/],
      [`{"padding":"${'x'.repeat(70 * 1024)}"}`, /is too large to be a key file/],
      // A key whose line breaks were saved as the two characters "\n" still works.
      [keyJson({ private_key: PRIVATE_KEY.replace(/\n/g, '\\n') }), null],
    ];
    for (const [contents, problem] of cases) {
      writeFileSync(keyFile, contents);
      const res = await admin.get('/api/admin/import/sheets/account');
      if (problem) {
        expect([contents.slice(0, 40), res.body.configured]).toEqual([contents.slice(0, 40), false]);
        expect(res.body.problem).toMatch(problem);
        expect(res.body.problem).toContain(keyFile);
        expect(res.body.problem).not.toMatch(/not really a key|refresh_token|PRIVATE KEY/);
      } else {
        expect(res.body).toMatchObject({ configured: true, clientEmail: CLIENT_EMAIL, problem: null });
      }
    }
  });
});

describe('preview', () => {
  it("reads free_tailor's day tab: the columns, the tab's date, and problems naming the sheet's own rows", async () => {
    const fake = install();
    const res = await preview({ url: LINK });
    expect(res.status).toBe(200);
    expect(() => SheetPreviewSchema.parse(res.body)).not.toThrow();
    expect(res.body).toMatchObject({
      spreadsheetId: ID,
      spreadsheetTitle: 'Job sheet',
      url: `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=101`,
      tab: { gid: 101, title: '10/22/2026', hidden: false },
      fileName: 'Job sheet (10/22/2026).csv',
      format: 'csv',
      columns: FT_HEADER,
      mapping: { title: 'Job Title', company: 'Company', url: 'Job Link', description: 'Job Description', salary: 'Rate', postedAt: null, id: null },
      headerRow: 1,
      suggestedHeaderRow: null,
      tabDate: '2026-10-22',
      postedAtFromTab: true,
      rowCount: 4,
      jobCount: 2,
      missingRequired: [],
      sourceName: 'Job sheet (10/22/2026)',
      existingSource: null,
      notes: [],
      readAt: TEST_NOW.toISOString(),
    });
    expect(res.body.problems).toEqual([
      'Row 5 ("No Link Here") has no job link.',
      'Row 6 ("Support Lead") has a job link that is not a web address ("Apply"). Put the address itself in the column.',
    ]);
    expect(res.body.tabs.map((tab: { title: string; hidden: boolean }) => [tab.title, tab.hidden])).toEqual([
      ['Notes', false],
      ['10/21/2026', false],
      ['10/22/2026', false],
      ['Archive', true],
    ]);
    expect(res.body.sample[0]).toMatchObject({ 'Job Title': 'Senior Data Engineer', Company: 'Acme Robotics' });
    expect(fake.calls).toEqual([`spreadsheets.get ${ID}`, `values.get ${ID} '10/22/2026'!1:1000`]);
  });

  it('reads every link form, opens the newest day tab without a gid, and refuses other links on the link field', async () => {
    install();
    const forms: Array<[url: string, gid: number]> = [
      [`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=100`, 100],
      [`https://docs.google.com/spreadsheets/u/1/d/${ID}/edit#gid=0`, 0],
      [`docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing#gid=100`, 100],
      [ID, 101],
    ];
    for (const [url, gid] of forms) {
      const res = await preview({ url });
      expect([url, res.status, res.body.tab?.gid]).toEqual([url, 200, gid]);
    }
    const bare = await preview({ url: ID });
    expect(bare.body.notes).toEqual(['"10/22/2026" is the newest day tab, so it is shown first. Pick another tab from the list.']);

    const published = await preview({ url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQabcdefghijklmnopqrstuvwxyz0123/pubhtml' });
    expect(published.status).toBe(400);
    expect(published.body.error.fields.url).toMatch(/"Publish to the web" link/);
    const drive = await preview({ url: `https://drive.google.com/file/d/${ID}/view` });
    expect(drive.status).toBe(400);
    expect(drive.body.error.fields.url).toMatch(/not a Google Sheets link/);
    const unknown = await preview({ url: '1UnknownSheetAbCdEfGhIjKlMnOpQrStUvWx' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.fields.url).toMatch(/Google has no spreadsheet at that link/);
  });

  it('lists hidden tabs, keeps to the tab asked for, and falls back from a tab the link names that is gone', async () => {
    install();
    const hidden = await preview({ url: LINK, gid: 102 });
    expect(hidden.body.tab).toMatchObject({ gid: 102, title: 'Archive', hidden: true });
    const missing = await preview({ url: LINK, gid: 999 });
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields).toEqual({ gid: 'This spreadsheet has no tab with id 999. Pick a tab from the list.' });
    const gone = await preview({ url: `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=999` });
    expect(gone.status).toBe(200);
    expect(gone.body.tab.gid).toBe(101);
    expect(gone.body.notes).toEqual(['The link points to a tab that is no longer in this spreadsheet, so "10/22/2026" is shown instead.']);
  });

  it('reads a header row below banner rows, suggests it, and refuses a blank header row', async () => {
    install({
      [ID]: {
        title: 'Weekly',
        tabs: [
          {
            gid: 5,
            title: 'Jobs',
            rows: [
              ['Weekly job list'],
              [],
              ['Company', 'Job Title', 'Job Link', '', ''],
              ['Acme', 'Engineer', 'https://acme.example/1', '', 'extra'],
              [],
              ['Globex', '', 'https://globex.example/2'],
            ],
          },
        ],
      },
    });
    const first = await preview({ url: ID });
    // Cells past the header's last one still get a column (by letter).
    expect(first.body).toMatchObject({ headerRow: 1, suggestedHeaderRow: 3, columns: ['Weekly job list', 'Column B', 'Column C', 'Column D', 'Column E'] });
    expect(first.body.missingRequired).toEqual(['title', 'company', 'url']);

    const third = await preview({ url: ID, gid: 5, headerRow: 3, refresh: false });
    expect(third.body).toMatchObject({
      headerRow: 3,
      suggestedHeaderRow: null,
      columns: ['Company', 'Job Title', 'Job Link', 'Column D', 'Column E'],
      rowCount: 2,
      jobCount: 1,
      problems: ['Row 6 has no job title.'],
    });

    const blank = await preview({ url: ID, gid: 5, headerRow: 2, refresh: false });
    expect(blank.status).toBe(400);
    expect(blank.body.error.fields).toEqual({ headerRow: 'Row 2 of "Jobs" is empty. Enter the row that holds the column names.' });
    const outside = await preview({ url: ID, headerRow: 21 });
    expect(outside.status).toBe(400);
    expect(outside.body.error.fields.headerRow).toBe('Choose a header row from 1 to 20.');
  });

  it('refuses a tab with more than 10,000 rows below the header row', async () => {
    const rows = [['Company', 'Job Title', 'Job Link'], ...Array.from({ length: 10_001 }, (_, i) => [`Co ${i}`, `Role ${i}`, `https://big.example/${i}`])];
    install({ [ID]: { title: 'Big', tabs: [{ gid: 1, title: 'All', rows }] } });
    const res = await preview({ url: ID });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      'This tab has more than 10,000 rows below the header row. Split it into tabs of up to 10,000 rows and import each one.',
    );
  });

  it('says when a tab has more rows than one read takes', async () => {
    install({ [ID]: { title: 'Grid', tabs: [{ gid: 1, title: 'All', rowCount: 20_000, rows: [['Company', 'Job Title', 'Job Link'], ['A', 'B', 'https://a.example/1']] }] } });
    const res = await preview({ url: ID });
    expect(res.body.notes).toEqual(['Only rows 1 to 10,021 were read; this tab has 20,000 rows.']);
  });

  it('re-maps from the last read: no Google call and no new parse, until another header row or a fresh read', async () => {
    const fake = install();
    const first = await preview({ url: LINK });
    expect(fake.calls).toHaveLength(2);
    expect(parses()).toBe(1);
    const remapped = await preview({
      url: LINK,
      gid: 101,
      refresh: false,
      mapping: { ...first.body.mapping, salary: null, location: 'note' },
      postedAtFromTab: false,
    });
    expect(remapped.status).toBe(200);
    expect(remapped.body.mapping).toMatchObject({ salary: null, location: 'note', title: 'Job Title' });
    expect(remapped.body.postedAtFromTab).toBe(false);
    expect(fake.calls).toHaveLength(2);
    expect(parses()).toBe(1);

    const otherHeader = await preview({ url: LINK, gid: 101, refresh: false, headerRow: 2 });
    expect(otherHeader.body.headerRow).toBe(2);
    expect(fake.calls).toHaveLength(2);
    expect(parses()).toBe(2);

    // Another tab, or no refresh flag, reads Google again.
    await preview({ url: LINK, gid: 100, refresh: false });
    expect(fake.calls).toHaveLength(4);
    await preview({ url: LINK, gid: 100 });
    expect(fake.calls).toHaveLength(6);
  });

  it("uses the tab's date only by default for a day tab with no posted-date column, and never a future one", async () => {
    const header = ['Company', 'Job Title', 'Job Link', 'When'];
    const row = ['Acme', 'Engineer', 'https://acme.example/1', '10/01/2026'];
    install({
      [ID]: {
        title: 'Dates',
        tabs: [
          { gid: 1, title: '10/22/2026', rows: [header, row] },
          { gid: 2, title: '10/30/2026', rows: [header, row] },
        ],
      },
    });
    const guessed = await preview({ url: ID, gid: 1 });
    expect(guessed.body).toMatchObject({ tabDate: '2026-10-22', postedAtFromTab: true, mapping: { postedAt: null } });
    const mapped = await preview({ url: ID, gid: 1, refresh: false, mapping: { postedAt: 'When' } });
    expect(mapped.body).toMatchObject({ tabDate: '2026-10-22', postedAtFromTab: false, mapping: { postedAt: 'When' } });
    const both = await preview({ url: ID, gid: 1, refresh: false, mapping: { postedAt: 'When' }, postedAtFromTab: true });
    expect(both.body).toMatchObject({ postedAtFromTab: true, mapping: { postedAt: null } });
    const future = await preview({ url: ID, gid: 2, postedAtFromTab: true });
    expect(future.body).toMatchObject({ tabDate: null, postedAtFromTab: false });
  });

  it('reads formula errors (#REF!, #N/A) as blank cells, with one note', async () => {
    install({
      [ID]: {
        title: 'Errors',
        tabs: [
          {
            gid: 1,
            title: 'Jobs',
            rows: [
              ['Company', 'Job Title', 'Job Link'],
              ['#REF!', 'Engineer', 'https://acme.example/1'],
              ['Globex', '#N/A', 'https://globex.example/2'],
              ['Initech', 'Analyst', 'https://initech.example/3'],
            ],
          },
        ],
      },
    });
    const res = await preview({ url: ID });
    expect(res.body.problems).toEqual(['Row 2 ("Engineer") has no company.', 'Row 3 has no job title.']);
    expect(res.body.jobCount).toBe(1);
    expect(res.body.notes).toEqual(['2 cells hold a formula error (such as #REF! or #N/A); they were read as blank.']);
  });

  it("names the sheet's sharing address when Google refuses, and puts a range it refuses on the tab field", async () => {
    install(freeTailorSheet(), {
      fail: ({ operation }) =>
        operation === 'spreadsheets.get'
          ? fromGoogleResponse('spreadsheets.get', 403, { error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } }, {
              clientEmail: FAKE_CLIENT_EMAIL,
              projectId: null,
              keyFile: 'key.json',
            })
          : undefined,
    });
    const denied = await preview({ url: LINK });
    expect(denied.status).toBe(400);
    expect(denied.body.error.fields.url).toBe(
      `TailorIT can't open this spreadsheet. In Google Sheets, click Share, add ${FAKE_CLIENT_EMAIL} as a Viewer, then read the sheet again.`,
    );

    install(freeTailorSheet(), {
      fail: ({ operation, range }) =>
        operation === 'values.get'
          ? fromGoogleResponse('values.get', 400, { error: { code: 400, message: `Unable to parse range: ${range}`, status: 'INVALID_ARGUMENT' } }, {
              clientEmail: FAKE_CLIENT_EMAIL,
              projectId: null,
              keyFile: 'key.json',
            })
          : undefined,
    });
    const changed = await preview({ url: LINK });
    expect(changed.status).toBe(400);
    expect(changed.body.error.fields).toEqual({ gid: 'This tab changed while TailorIT read it. Read the sheet again.' });
  });

  it('lets a newer read replace one still waiting for Google', async () => {
    install(freeTailorSheet(), { delayMs: 400 });
    const first = preview({ url: LINK }).then((res) => res);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = await preview({ url: LINK });
    const replaced = await first;
    expect(replaced.status).toBe(409);
    expect(replaced.body.error.message).toBe('A newer read of a Google Sheet replaced this one.');
    expect(second.status).toBe(200);
  });
});

describe('import', () => {
  it('imports a tab as a Google Sheet source, again into the same source, and Run now reads only the stored copy', async () => {
    const fake = install();
    const res = await importSheet({ url: LINK });
    expect(res.status).toBe(201);
    const id = res.body.source.id as number;
    expect(res.body.source).toMatchObject({ kind: 'csv', kindLabel: 'Google Sheet', name: 'Job sheet (10/22/2026)', schedule: 'manual', deactivateMissing: false, jobCount: 2 });
    expect(res.body.source.config).toMatchObject({
      fileName: 'Job sheet (10/22/2026).csv',
      format: 'csv',
      mapping: { title: 'Job Title', company: 'Company', url: 'Job Link', postedAt: null },
      sheet: {
        spreadsheetId: ID,
        gid: 101,
        tabTitle: '10/22/2026',
        spreadsheetTitle: 'Job sheet',
        url: `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=101`,
        headerRow: 1,
        postedAt: '2026-10-22',
        readAt: TEST_NOW.toISOString(),
      },
    });
    expect(res.body.run).toMatchObject({ status: 'partial', trigger: 'upload', fetched: 4, created: 2, failed: 2, sourceKindLabel: 'Google Sheet' });
    expect(res.body.run.log.join('\n')).toContain('Google Sheet "Job sheet", tab "10/22/2026" (copy read 2026-10-22T12:00:00.000Z): 4 rows, 2 jobs.');
    expect(res.body.run.log.join('\n')).toContain('Row 5 ("No Link Here") has no job link.');
    const job = ctx.deps.db.prepare("SELECT title, posted_at, apply_url FROM jobs WHERE title = 'Senior Data Engineer'").get();
    expect(job).toEqual({ title: 'Senior Data Engineer', posted_at: '2026-10-22T00:00:00.000Z', apply_url: 'https://acme.example/jobs/9' });
    expect(fake.calls).toHaveLength(2);

    const folder = join(ctx.dataDir, 'ingest', 'imports', String(id));
    const [stored] = readdirSync(folder);
    expect(readFileSync(join(folder, stored!), 'utf8').split('\r\n').slice(0, 3)).toEqual([
      FT_HEADER.join(','),
      '1,Acme Robotics,Senior Data Engineer,https://acme.example/jobs/9,"Requirements:\n- 5+ years of SQL and Python\n- Airflow",$150k - $180k,,bot,Pass',
      '',
    ]);

    const again = await importSheet({ url: LINK });
    expect(again.status).toBe(201);
    expect(again.body.source.id).toBe(id);
    expect(again.body.run).toMatchObject({ created: 0, unchanged: 2 });
    expect(readdirSync(folder)).toHaveLength(1);
    expect(fake.calls).toHaveLength(4);

    const rerun = await admin.post(`/api/admin/sources/${id}/run`).set('Origin', ORIGIN);
    expect(rerun.status).toBe(202);
    expect(await waitForRun(rerun.body.runId)).toMatchObject({ status: 'partial', trigger: 'manual', unchanged: 2, sourceKindLabel: 'Google Sheet' });
    expect(fake.calls).toHaveLength(4);

    const runs = await admin.get('/api/admin/runs');
    expect(runs.body.items.map((run: { sourceKindLabel: string }) => run.sourceKindLabel)).toEqual(['Google Sheet', 'Google Sheet', 'Google Sheet']);
    const listed = await admin.get('/api/admin/sources');
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toMatchObject({ kindLabel: 'Google Sheet' });
  });

  it('imports the same tab into the same source after the spreadsheet and the tab were renamed', async () => {
    const fake = install();
    const first = await importSheet({ url: LINK });
    const id = first.body.source.id as number;
    fake.spreadsheets[ID]!.title = 'Renamed sheet';
    fake.spreadsheets[ID]!.tabs[2]!.title = '2026-10-22';

    const seen = await preview({ url: LINK });
    expect(seen.body).toMatchObject({ sourceName: 'Job sheet (10/22/2026)', existingSource: { id, name: 'Job sheet (10/22/2026)', sameSheet: true } });

    const again = await importSheet({ url: LINK });
    expect(again.status).toBe(201);
    expect(again.body.source).toMatchObject({ id, name: 'Job sheet (10/22/2026)' });
    expect(again.body.source.config.sheet).toMatchObject({ spreadsheetTitle: 'Renamed sheet', tabTitle: '2026-10-22', postedAt: '2026-10-22' });
    expect(again.body.run).toMatchObject({ created: 0, unchanged: 2 });

    const renamed = await importSheet({ url: LINK, name: 'Daily jobs' });
    expect(renamed.body.source).toMatchObject({ id, name: 'Daily jobs' });
    expect((await admin.get('/api/admin/sources')).body.items).toHaveLength(1);
  });

  it('imports a large tab in the background (202), and refuses a second import of it before reading Google', async () => {
    const rows = [['Company', 'Job Title', 'Job Link'], ...Array.from({ length: 2001 }, (_, i) => [`Big Co ${i % 7}`, `Role ${i}`, `https://big.example/jobs/${i}`])];
    const fake = install({ [ID]: { title: 'Big', tabs: [{ gid: 7, title: 'All', rows }] } });
    const res = await importSheet({ url: ID, gid: 7 });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ run: null, source: { kindLabel: 'Google Sheet', running: true } });
    const calls = fake.calls.length;
    const busy = await importSheet({ url: ID, gid: 7 });
    expect(busy.status).toBe(409);
    expect(busy.body.error.message).toBe('This import is running. Wait for it to finish.');
    expect(fake.calls).toHaveLength(calls);
    expect(await waitForRun(res.body.runId)).toMatchObject({ status: 'succeeded', created: 2001 });
  });

  it('answers 202 when the run would outlast the time left to answer', async () => {
    ctx.deps.services.sheetsTiming = { responseBudgetMs: 25 };
    const rows = [['Company', 'Job Title', 'Job Link'], ...Array.from({ length: 1200 }, (_, i) => [`Co ${i % 5}`, `Role ${i}`, `https://slow.example/jobs/${i}`])];
    install({ [ID]: { title: 'Slow', tabs: [{ gid: 3, title: 'All', rows }] } });
    const res = await importSheet({ url: ID });
    expect(res.status).toBe(202);
    expect(res.body.run).toBeNull();
    expect(await waitForRun(res.body.runId)).toMatchObject({ status: 'succeeded', created: 1200 });
  });

  it('keeps file imports and sheet imports apart, and one tab per source name', async () => {
    install();
    expect((await importSheet({ url: LINK })).status).toBe(201);
    const file = await importFile({ fileName: 'x.csv', content: 'Company,Job Title,Job Link\nA,B,https://a.example/1', name: 'Job sheet (10/22/2026)' });
    expect(file.status).toBe(409);
    expect(file.body.error.message).toBe('A Google Sheet import is already named "Job sheet (10/22/2026)". Choose another source name.');

    expect((await importFile({ fileName: 'jobs.csv', content: 'Company,Job Title,Job Link\nA,B,https://a.example/1' })).status).toBe(201);
    const warned = await preview({ url: LINK, gid: 100, name: 'jobs.csv' });
    expect(warned.body.existingSource).toMatchObject({ name: 'jobs.csv', sameSheet: false });
    const overFile = await importSheet({ url: LINK, gid: 100, name: 'jobs.csv' });
    expect(overFile.status).toBe(409);
    expect(overFile.body.error.message).toBe('A file import is already named "jobs.csv". Choose another source name.');
    const overTab = await importSheet({ url: LINK, gid: 100, name: 'Job sheet (10/22/2026)' });
    expect(overTab.status).toBe(409);
    expect(overTab.body.error.message).toBe('"Job sheet (10/22/2026)" imports another tab ("10/22/2026" of "Job sheet"). Choose another source name.');

    const missing = await importSheet({ url: LINK, mapping: { title: null } });
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toBe('Choose the column for job title.');
  });

  it('deletes a sheet source with its stored copy, and never touches the sheet', async () => {
    const fake = install();
    const res = await importSheet({ url: LINK });
    const folder = join(ctx.dataDir, 'ingest', 'imports', String(res.body.source.id));
    expect(existsSync(folder)).toBe(true);
    const calls = fake.calls.length;
    const removed = await admin.delete(`/api/admin/sources/${res.body.source.id}`).set('Origin', ORIGIN);
    expect(removed.status).toBe(204);
    expect(existsSync(folder)).toBe(false);
    expect(fake.calls).toHaveLength(calls);
  });
});
