import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ashbyBoard } from '../src/features/ingest/adapters/ashby';
import { GREENHOUSE_API } from '../src/features/ingest/adapters/greenhouse';
import { IngestHttpError, type IngestHttp } from '../src/features/ingest/http';
import { createIngestService } from '../src/features/ingest/service';
import { repoRoot } from '../src/core/paths';
import { signIn, type TestAgent } from './auth-helpers';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';

let ctx: TestContext;
let admin: TestAgent;
let adminId: string;
beforeEach(async () => {
  ctx = createTestContext();
  const signedIn = await signIn(ctx, 'admin@tailorit.dev', { admin: true });
  admin = signedIn.agent;
  adminId = signedIn.account.id;
});
afterEach(() => ctx.cleanup());

const FREE_TAILOR_SHEET = [
  'Date,NO(DATE),Company,Job Title,Job Link,Job Description',
  '10/20/2026,1,Acme Robotics,Senior Data Engineer,https://acme.example/jobs/9,"Requirements:',
  '- 5+ years of SQL and Python',
  '- Airflow"',
  '10/21/2026,2,Globex,Product Designer,https://globex.example/careers/3,Design in Figma.',
  '10/21/2026,3,Globex,No Link Here,,Nothing to apply to.',
].join('\n');

async function waitForRun(id: number) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const res = await admin.get(`/api/admin/runs/${id}`);
    if (res.body.status !== 'running') return res.body;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`run ${id} did not finish`);
}

describe('guards', () => {
  const routes: Array<[method: 'get' | 'post' | 'patch' | 'delete', path: string]> = [
    ['get', '/api/admin/sources'],
    ['post', '/api/admin/sources'],
    ['post', '/api/admin/sources/test'],
    ['post', '/api/admin/sources/ft-lake/test'],
    ['get', '/api/admin/sources/1'],
    ['patch', '/api/admin/sources/1'],
    ['delete', '/api/admin/sources/1'],
    ['post', '/api/admin/sources/1/run'],
    ['get', '/api/admin/runs'],
    ['get', '/api/admin/runs/1'],
    ['post', '/api/admin/import/jobs/preview'],
    ['post', '/api/admin/import/jobs'],
    ['get', '/api/admin/import/sheets/account'],
    ['post', '/api/admin/import/sheets/preview'],
    ['post', '/api/admin/import/sheets/jobs'],
    ['get', '/api/admin/reports'],
    ['patch', '/api/admin/reports/1'],
    ['get', '/api/admin/ai/background'],
  ];

  it('answers 401 signed out and 403 to a signed-in non-admin', async () => {
    const member = await signIn(ctx, 'member@example.com');
    for (const [method, path] of routes) {
      const anonymous = await request(ctx.app)[method](path).set('Origin', ORIGIN).send({});
      expect([path, anonymous.status]).toEqual([path, 401]);
      const user = await member.agent[method](path).set('Origin', ORIGIN).send({});
      expect([path, user.status, user.body.error?.code]).toEqual([path, 403, 'forbidden']);
    }
  });
});

describe('sources', () => {
  it('creates, lists, edits and deletes job sources', async () => {
    const created = await admin
      .post('/api/admin/sources')
      .set('Origin', ORIGIN)
      .send({ kind: 'greenhouse', config: { token: 'https://boards.greenhouse.io/gitlab', companyName: 'GitLab' } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      kind: 'greenhouse',
      kindLabel: 'Greenhouse',
      name: 'gitlab',
      config: { token: 'gitlab', companyName: 'GitLab' },
      enabled: true,
      schedule: 'daily',
      deactivateMissing: true,
      jobCount: 0,
      running: false,
      lastRun: null,
    });
    const duplicate = await admin.post('/api/admin/sources').set('Origin', ORIGIN).send({ kind: 'greenhouse', config: { token: 'gitlab' } });
    expect(duplicate.status).toBe(409);
    const invalid = await admin.post('/api/admin/sources').set('Origin', ORIGIN).send({ kind: 'lever', config: { site: '' } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.message).toMatch(/Lever site name/);
    const lake = await admin.post('/api/admin/sources').set('Origin', ORIGIN).send({ kind: 'ft_lake', config: { path: join(ctx.dataDir, 'nope.db') } });
    expect(lake.status).toBe(400);
    expect(lake.body.error.message).toMatch(/There is no free_tailor database/);

    const list = await admin.get('/api/admin/sources');
    expect(list.body.items.map((item: { name: string }) => item.name)).toEqual(['gitlab']);

    const id = created.body.id as number;
    const patched = await admin.patch(`/api/admin/sources/${id}`).set('Origin', ORIGIN).send({ enabled: false, config: { token: 'boards.greenhouse.io/gitlab-two' } });
    expect(patched.body).toMatchObject({ enabled: false, config: { token: 'gitlab-two', companyName: 'GitLab' } });

    const removed = await admin.delete(`/api/admin/sources/${id}`).set('Origin', ORIGIN);
    expect(removed.status).toBe(204);
    expect((await admin.get(`/api/admin/sources/${id}`)).status).toBe(404);
  });

  it('reads an Ashby board name with a stray "%" as typed instead of failing with a 500', async () => {
    expect(ashbyBoard('acme%')).toBe('acme');
    expect(ashbyBoard('https://jobs.ashbyhq.com/acme%E0%A4%A')).toBe('acmeE0A4A');
    expect(ashbyBoard('https://jobs.ashbyhq.com/Acme%20Labs')).toBe('Acme Labs');
    const created = await admin.post('/api/admin/sources').set('Origin', ORIGIN).send({ kind: 'ashby', config: { board: 'acme%' } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: 'ashby', name: 'acme', config: { board: 'acme' } });
    const patched = await admin
      .patch(`/api/admin/sources/${created.body.id}`)
      .set('Origin', ORIGIN)
      .send({ config: { board: 'https://jobs.ashbyhq.com/acme%zz' } });
    expect(patched.status).toBe(200);
    expect(patched.body.config).toMatchObject({ board: 'acmezz' });
  });

  it('tests a board without saving anything', async () => {
    const listing = JSON.parse(readFileSync(join(repoRoot(), 'tools', 'ats-fixtures', 'greenhouse-gitlab.json'), 'utf8'));
    const http: IngestHttp = {
      async getJson(url, options = {}) {
        if (url === `${GREENHOUSE_API}/gitlab/jobs?content=true`) return { status: 200, data: listing };
        if (url === `${GREENHOUSE_API}/gitlab`) return { status: 200, data: { name: 'GitLab' } };
        if (options.allow?.includes(404)) return { status: 404, data: null };
        throw new IngestHttpError('not found', 404, url);
      },
    };
    ctx.deps.services.ingest = createIngestService(ctx.deps, { http });
    const ok = await admin.post('/api/admin/sources/test').set('Origin', ORIGIN).send({ kind: 'greenhouse', config: { token: 'gitlab' } });
    expect(ok.body).toMatchObject({ ok: true, count: listing.jobs.length, companyName: 'GitLab' });
    expect(ok.body.samples).toHaveLength(3);
    const missing = await admin.post('/api/admin/sources/test').set('Origin', ORIGIN).send({ kind: 'greenhouse', config: { token: 'nope' } });
    expect(missing.body).toMatchObject({ ok: false, count: 0 });
    expect(missing.body.message).toMatch(/Greenhouse has no job board "nope"/);
    expect((await admin.get('/api/admin/sources')).body.items).toEqual([]);
    expect((ctx.deps.db.prepare('SELECT count(*) AS n FROM jobs').get() as { n: number }).n).toBe(0);
  });

  it('runs a source now (202) and records the run with its log', async () => {
    const created = await admin.post('/api/admin/sources').set('Origin', ORIGIN).send({ kind: 'seed' });
    expect(created.body).toMatchObject({ kind: 'seed', name: 'Demo jobs', schedule: 'manual' });
    const started = await admin.post(`/api/admin/sources/${created.body.id}/run`).set('Origin', ORIGIN);
    expect(started.status).toBe(202);
    const run = await waitForRun(started.body.runId);
    expect(run).toMatchObject({ status: 'succeeded', trigger: 'manual', sourceKind: 'seed', sourceName: 'Demo jobs', failed: 0 });
    expect(run.created).toBeGreaterThan(100);
    expect(run.log.join('\n')).toMatch(/Saved: \d+ new/);
    const runs = await admin.get('/api/admin/runs').query({ sourceId: created.body.id });
    expect(runs.body.items).toHaveLength(1);
    expect(runs.body.items[0]).not.toHaveProperty('log');
    const source = await admin.get(`/api/admin/sources/${created.body.id}`);
    expect(source.body).toMatchObject({ lastStatus: 'succeeded', lastRun: { id: run.id, status: 'succeeded' } });
    expect(source.body.activeJobCount).toBeGreaterThan(100);
    expect((await admin.get('/api/admin/runs/99999')).status).toBe(404);
  });

  it('checks a free_tailor lake path and counts what it holds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tailorit-lake-route-'));
    try {
      const path = join(dir, 'lake.db');
      const db = new Database(path);
      db.exec(
        "CREATE TABLE job_lake (id INTEGER PRIMARY KEY, company TEXT, job_field_id TEXT, title TEXT, salary_min REAL, salary_max REAL, salary_currency TEXT, salary_period TEXT, salary_raw TEXT, job_url TEXT, job_description TEXT, analysis_id TEXT, created_at TEXT, updated_at TEXT);" +
          "INSERT INTO job_lake VALUES (1, 'Acme', 'devops', 'SRE', NULL, NULL, NULL, NULL, NULL, 'https://a.example/1', 'Run things', NULL, '2026-10-20T00:00:00Z', '2026-10-20T00:00:00Z');",
      );
      db.close();
      const ok = await admin.post('/api/admin/sources/ft-lake/test').set('Origin', ORIGIN).send({ path });
      expect(ok.body).toMatchObject({ ok: true, exists: true, counts: { jobs: 1, withAnalysis: 0, recent: 1 } });
      const missing = await admin.post('/api/admin/sources/ft-lake/test').set('Origin', ORIGIN).send({ path: join(dir, 'missing.db') });
      expect(missing.body).toMatchObject({ ok: false, exists: false, counts: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('import jobs', () => {
  it("previews a free_tailor sheet: guessed columns, rows and the rows that are not jobs", async () => {
    const res = await admin.post('/api/admin/import/jobs/preview').set('Origin', ORIGIN).send({ fileName: 'sheet.csv', content: FREE_TAILOR_SHEET });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      fileName: 'sheet.csv',
      format: 'csv',
      columns: ['Date', 'NO(DATE)', 'Company', 'Job Title', 'Job Link', 'Job Description'],
      mapping: { title: 'Job Title', company: 'Company', url: 'Job Link', description: 'Job Description', postedAt: 'Date' },
      rowCount: 3,
      jobCount: 2,
      missingRequired: [],
    });
    expect(res.body.problems).toEqual(['Row 4 ("No Link Here") has no job link.']);
    expect(res.body.sample[0]['Job Title']).toBe('Senior Data Engineer');
    expect(res.body.fields.find((field: { field: string }) => field.field === 'url')).toEqual({ field: 'url', label: 'Job link', required: true });
  });

  it('imports an uploaded file as a csv source, and again into the same source', async () => {
    const upload = () =>
      admin
        .post('/api/admin/import/jobs')
        .set('Origin', ORIGIN)
        .attach('file', Buffer.from(FREE_TAILOR_SHEET, 'utf8'), { filename: 'sheet.csv', contentType: 'text/csv' })
        .field('mapping', JSON.stringify({ title: 'Job Title', company: 'Company', url: 'Job Link', description: 'Job Description', postedAt: 'Date' }));
    const res = await upload();
    expect(res.status).toBe(201);
    expect(res.body.source).toMatchObject({ kind: 'csv', name: 'sheet.csv', schedule: 'manual', deactivateMissing: false, jobCount: 2 });
    expect(res.body.run).toMatchObject({ status: 'partial', trigger: 'upload', fetched: 3, created: 2, failed: 1 });
    const job = ctx.deps.db.prepare("SELECT title, posted_at, apply_url FROM jobs WHERE title = 'Senior Data Engineer'").get();
    expect(job).toEqual({ title: 'Senior Data Engineer', posted_at: '2026-10-20T00:00:00.000Z', apply_url: 'https://acme.example/jobs/9' });
    const analysis = ctx.deps.db.prepare("SELECT a.requirements FROM jobs j JOIN job_analyses a ON a.id = j.analysis_id WHERE j.title = 'Senior Data Engineer'").get() as { requirements: string };
    expect(JSON.parse(analysis.requirements)).toEqual(['5+ years of SQL and Python', 'Airflow']);

    const again = await upload();
    expect(again.body.source.id).toBe(res.body.source.id);
    expect(again.body.run).toMatchObject({ created: 0, unchanged: 2 });

    const rerun = await admin.post(`/api/admin/sources/${res.body.source.id}/run`).set('Origin', ORIGIN);
    expect((await waitForRun(rerun.body.runId)).unchanged).toBe(2);
  });

  it('imports JSON and refuses a mapping without the required columns', async () => {
    const jobs = [{ name: 'Data Analyst', employer: 'Initech', link: 'https://initech.example/1', description: 'SQL and Tableau.' }];
    const ok = await admin.post('/api/admin/import/jobs').set('Origin', ORIGIN).send({ fileName: 'jobs.json', content: JSON.stringify(jobs) });
    expect(ok.status).toBe(201);
    expect(ok.body.source).toMatchObject({ kind: 'json', name: 'jobs.json' });
    expect(ok.body.run.created).toBe(1);
    const bad = await admin
      .post('/api/admin/import/jobs')
      .set('Origin', ORIGIN)
      .send({ fileName: 'x.csv', content: 'a,b\n1,2', mapping: { title: 'a' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/Choose the column for company, job link/);
    const empty = await admin.post('/api/admin/import/jobs/preview').set('Origin', ORIGIN).send({ fileName: 'x.json', content: '{"nope":1}' });
    expect(empty.status).toBe(400);
  });
});

describe('reports', () => {
  it('lists open reports with the job and reporter, and resolves one (closing the job)', async () => {
    const reporter = await signIn(ctx, 'reporter@example.com', { name: 'Rae Porter' });
    await admin.post('/api/admin/import/jobs').set('Origin', ORIGIN).send({ fileName: 'sheet.csv', content: FREE_TAILOR_SHEET });
    const job = ctx.deps.db.prepare("SELECT id FROM jobs WHERE title = 'Product Designer'").get() as { id: number };
    const insert = ctx.deps.db.prepare("INSERT INTO job_reports(user_id, job_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?)");
    insert.run(reporter.account.id, job.id, 'inactive', 'The page says it is filled.', TEST_NOW.toISOString());
    insert.run(reporter.account.id, job.id, 'spam', '', new Date(TEST_NOW.getTime() + 1000).toISOString());

    const open = await admin.get('/api/admin/reports');
    expect(open.body.counts).toEqual({ open: 2, resolved: 0, dismissed: 0 });
    expect(open.body.items[1]).toMatchObject({
      status: 'open',
      reason: 'inactive',
      reasonLabel: 'The job is no longer open',
      details: 'The page says it is filled.',
      reporter: { email: 'reporter@example.com', name: 'Rae Porter' },
      job: { id: job.id, title: 'Product Designer', companyName: 'Globex', active: true, applyUrl: 'https://globex.example/careers/3' },
    });

    const resolved = await admin.patch(`/api/admin/reports/${open.body.items[1].id}`).set('Origin', ORIGIN).send({ status: 'resolved', closeJob: true });
    expect(resolved.body).toMatchObject({ status: 'resolved', resolvedBy: 'admin@tailorit.dev', job: { active: false } });
    expect(resolved.body.resolvedAt).toBe(TEST_NOW.toISOString());
    const dismissed = await admin.patch(`/api/admin/reports/${open.body.items[0].id}`).set('Origin', ORIGIN).send({ status: 'dismissed' });
    expect(dismissed.body.status).toBe('dismissed');
    expect((await admin.get('/api/admin/reports')).body.items).toEqual([]);
    expect((await admin.get('/api/admin/reports').query({ status: 'all' })).body.counts).toEqual({ open: 0, resolved: 1, dismissed: 1 });
    const reopened = await admin.patch(`/api/admin/reports/${open.body.items[0].id}`).set('Origin', ORIGIN).send({ status: 'open' });
    expect(reopened.body).toMatchObject({ status: 'open', resolvedAt: null, resolvedBy: null });
    expect((await admin.patch('/api/admin/reports/12345').set('Origin', ORIGIN).send({ status: 'resolved' })).status).toBe(404);
    expect(adminId).toBeTruthy();
  });
});
