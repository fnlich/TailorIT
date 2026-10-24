import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  ApplicationCountsSchema,
  ApplicationDetailSchema,
  ApplicationListResponseSchema,
  BoardResponseSchema,
  CANNOT_CLEAR_APPLIED,
  CANNOT_CLEAR_SAVED,
  FUTURE_DATE_MESSAGE,
  SALARY_ORDER_MESSAGE,
  StatusChangeResponseSchema,
  type ApplicationDetail,
  type ApplicationSummary,
} from '@tailorit/shared';
import { signIn, type TestAgent } from './auth-helpers';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';

// Work package T: the tracker's endpoints, the shared status rules as the API applies them, the board and list reads,
// archive/bulk, and the Jobs page's jobId contract. CSV, chart, questions and resume score: applications-reports.

let ctx: TestContext | null = null;
afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

function use(): TestContext {
  ctx = createTestContext();
  return ctx;
}

const TODAY = TEST_NOW.toISOString().slice(0, 10); // 2026-10-22

interface NewApp {
  title?: string;
  companyName?: string;
  location?: string;
  employmentType?: string;
  status?: number;
  occurredOn?: string;
  postingUrl?: string;
  jobId?: number;
  resumeId?: string | null;
}

async function create(agent: TestAgent, body: NewApp = {}): Promise<ApplicationDetail> {
  const res = await agent
    .post('/api/applications')
    .set('Origin', ORIGIN)
    .send({ title: 'Platform Engineer', companyName: 'Acme', employmentType: 'full_time', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return ApplicationDetailSchema.parse(res.body);
}

const statusesOf = (events: Array<{ status: number }>) => events.map((event) => event.status);

describe('access', () => {
  it('is for signed-in accounts only', async () => {
    const c = use();
    const calls = [
      request(c.app).get('/api/applications'),
      request(c.app).get('/api/applications/board'),
      request(c.app).get('/api/applications/counts'),
      request(c.app).post('/api/applications').set('Origin', ORIGIN).send({}),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('not_signed_in');
    }
  });

  it("answers 404 for another account's application, on every route", async () => {
    const c = use();
    const owner = await signIn(c, 'owner@example.com');
    const other = await signIn(c, 'other@example.com');
    const app = await create(owner.agent);
    const base = `/api/applications/${app.id}`;
    const calls = [
      () => other.agent.get(base),
      () => other.agent.patch(base).set('Origin', ORIGIN).send({ title: 'Mine now' }),
      () => other.agent.delete(base).set('Origin', ORIGIN),
      () => other.agent.put(`${base}/status`).set('Origin', ORIGIN).send({ status: 12 }),
      () => other.agent.put(`${base}/events/2`).set('Origin', ORIGIN).send({ occurredOn: TODAY }),
      () => other.agent.delete(`${base}/events/11`).set('Origin', ORIGIN),
      () => other.agent.post(`${base}/archive`).set('Origin', ORIGIN),
      () => other.agent.post(`${base}/restore`).set('Origin', ORIGIN),
      () => other.agent.get(`${base}/questions`),
      () => other.agent.post(`${base}/questions`).set('Origin', ORIGIN).send({ question: 'Why?' }),
      () => other.agent.get(`${base}/resume-score`),
    ];
    for (const call of calls) {
      const res = await call();
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: 'not_found', message: 'That application was not found.' });
    }
    // Bulk skips ids that are not the caller's.
    const bulk = await other.agent.post('/api/applications/bulk').set('Origin', ORIGIN).send({ ids: [app.id], action: 'delete' });
    expect(bulk.body).toEqual({ affected: 0 });
    expect((await owner.agent.get(base)).status).toBe(200);
    // Lists never show it.
    expect((await other.agent.get('/api/applications')).body.items).toEqual([]);
  });
});

describe('creating', () => {
  it('defaults to Applied, dated today, with Saved beneath it', async () => {
    const c = use();
    const { agent } = await signIn(c, 'a@example.com');
    const app = await create(agent, { location: 'Remote in USA', postingUrl: 'acme.com/jobs/1' });
    expect(app).toMatchObject({
      title: 'Platform Engineer',
      companyName: 'Acme',
      location: 'Remote in USA',
      employmentType: 'full_time',
      currentStatus: 2,
      favorite: false,
      archivedAt: null,
      trackedOn: TODAY,
      jobId: null,
      postingUrl: 'https://acme.com/jobs/1',
      descriptionHtml: '',
      notesHtml: '',
      questions: [],
      salary: { min: null, max: null, currency: null, period: null },
    });
    expect(app.events).toEqual([
      { status: 1, occurredOn: TODAY },
      { status: 2, occurredOn: TODAY },
    ]);
  });

  it('creates Saved when asked, and later stages with Applied beneath', async () => {
    const c = use();
    const { agent } = await signIn(c, 'a@example.com');
    expect(statusesOf((await create(agent, { status: 1 })).events)).toEqual([1]);
    const interviewing = await create(agent, { status: 12, occurredOn: '2026-10-01' });
    expect(interviewing.currentStatus).toBe(12);
    expect(interviewing.events).toEqual([
      { status: 1, occurredOn: '2026-10-01' },
      { status: 2, occurredOn: '2026-10-01' },
      { status: 12, occurredOn: '2026-10-01' },
    ]);
    expect(interviewing.trackedOn).toBe('2026-10-01');
  });

  it('validates with Simplify sentences and refuses future dates', async () => {
    const c = use();
    const { agent } = await signIn(c, 'a@example.com');
    const missing = await agent.post('/api/applications').set('Origin', ORIGIN).send({ title: ' ' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields).toEqual({ title: 'Required', companyName: 'Required', employmentType: 'Required' });

    const badUrl = await agent
      .post('/api/applications')
      .set('Origin', ORIGIN)
      .send({ title: 'X', companyName: 'Y', employmentType: 'internship', postingUrl: 'not a url' });
    expect(badUrl.body.error.fields).toEqual({ postingUrl: 'Must be a valid url' });

    // "Today" somewhere on Earth is allowed (UTC+14); the day after is not.
    expect((await agent.post('/api/applications').set('Origin', ORIGIN).send({ title: 'X', companyName: 'Y', employmentType: 'internship', occurredOn: '2026-10-23' })).status).toBe(201);
    const future = await agent
      .post('/api/applications')
      .set('Origin', ORIGIN)
      .send({ title: 'X', companyName: 'Y', employmentType: 'internship', occurredOn: '2026-10-24' });
    expect(future.status).toBe(400);
    expect(future.body.error).toMatchObject({ message: FUTURE_DATE_MESSAGE, fields: { occurredOn: FUTURE_DATE_MESSAGE } });
  });

  it('links a resume only when it is the account’s', async () => {
    const c = use();
    const me = await signIn(c, 'a@example.com');
    const other = await signIn(c, 'b@example.com');
    const now = TEST_NOW.toISOString();
    c.deps.db
      .prepare("INSERT INTO resumes(id, user_id, kind, created_at, updated_at) VALUES ('r-mine', ?, 'built', ?, ?), ('r-other', ?, 'built', ?, ?)")
      .run(me.account.id, now, now, other.account.id, now, now);
    expect((await create(me.agent, { resumeId: 'r-mine' })).resumeId).toBe('r-mine');
    const refused = await me.agent
      .post('/api/applications')
      .set('Origin', ORIGIN)
      .send({ title: 'X', companyName: 'Y', employmentType: 'full_time', resumeId: 'r-other' });
    expect(refused.status).toBe(404);
    expect(refused.body.error.message).toBe('That resume was not found.');
  });
});

describe('the Jobs page contract (jobId)', () => {
  function insertJob(c: TestContext): number {
    const now = TEST_NOW.toISOString();
    const company = c.deps.db
      .prepare("INSERT INTO companies(name, name_key, logo_path, created_at, updated_at) VALUES ('Stripe, Inc.', 'stripe', 'https://logo.example/stripe.png', ?, ?)")
      .run(now, now);
    const job = c.deps.db
      .prepare(
        `INSERT INTO jobs(company_id, title, description_html, description_text, apply_url, content_hash, employment_type,
           work_arrangement, salary_min, salary_max, salary_currency, salary_period, primary_location, location_count,
           first_seen_at, last_seen_at, created_at, updated_at)
         VALUES (?, 'Backend Engineer', '<p>Build <b>APIs</b> with Go.</p><script>alert(1)</script>', 'Build APIs with Go.',
           'https://stripe.com/jobs/1', 'h1', 'full_time', 'hybrid', 150000, 200000, 'USD', 'year', 'San Francisco, CA, USA', 3,
           ?, ?, ?, ?)`,
      )
      .run(company.lastInsertRowid, now, now, now, now);
    return Number(job.lastInsertRowid);
  }

  it('prefills from the posting, keeps one application per job and only moves it forward', async () => {
    const c = use();
    const { agent } = await signIn(c, 'jobs@example.com');
    const jobId = insertJob(c);

    const saved = await agent.post('/api/applications').set('Origin', ORIGIN).send({ jobId, status: 1 });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({
      jobId,
      title: 'Backend Engineer',
      companyName: 'Stripe, Inc.',
      logoUrl: 'https://logo.example/stripe.png',
      location: 'San Francisco, CA, USA + 2 more',
      employmentType: 'full_time',
      postingUrl: 'https://stripe.com/jobs/1',
      currentStatus: 1,
      salary: { min: 150000, max: 200000, currency: 'USD', period: 'year' },
    });
    expect(saved.body.descriptionHtml).toBe('<p>Build <b>APIs</b> with Go.</p>');

    // Applying later moves the same application to Applied (200, not a second row).
    const applied = await agent.post('/api/applications').set('Origin', ORIGIN).send({ jobId, status: 2 });
    expect(applied.status).toBe(200);
    expect(applied.body.id).toBe(saved.body.id);
    expect(applied.body.currentStatus).toBe(2);

    // Saving again never moves it back.
    const again = await agent.post('/api/applications').set('Origin', ORIGIN).send({ jobId, status: 1 });
    expect(again.body).toMatchObject({ id: saved.body.id, currentStatus: 2 });

    // An archived one comes back when the job is saved again.
    await agent.post(`/api/applications/${saved.body.id}/archive`).set('Origin', ORIGIN);
    const restored = await agent.post('/api/applications').set('Origin', ORIGIN).send({ jobId });
    expect(restored.body.archivedAt).toBeNull();
    expect((await agent.get('/api/applications/counts')).body).toMatchObject({ active: 1, archived: 0 });

    // Unknown jobs are 404.
    const missing = await agent.post('/api/applications').set('Origin', ORIGIN).send({ jobId: 99999 });
    expect(missing.status).toBe(404);

    // The Jobs page also moves and deletes by id.
    const moved = await agent.put(`/api/applications/${saved.body.id}/status`).set('Origin', ORIGIN).send({ status: 11 });
    expect(moved.body.currentStatus).toBe(11);
    expect((await agent.delete(`/api/applications/${saved.body.id}`).set('Origin', ORIGIN)).status).toBe(204);
    expect((await agent.get(`/api/applications/${saved.body.id}`)).status).toBe(404);
  });

  it('links a typed company to the job board company of the same name (its logo)', async () => {
    const c = use();
    const { agent } = await signIn(c, 'jobs@example.com');
    insertJob(c);
    const app = await create(agent, { companyName: 'Stripe' });
    expect(app.logoUrl).toBe('https://logo.example/stripe.png');
    const renamed = await agent.patch(`/api/applications/${app.id}`).set('Origin', ORIGIN).send({ companyName: 'Acme' });
    expect(renamed.body).toMatchObject({ companyName: 'Acme', companyId: null, logoUrl: null });
  });
});

describe('status rules through the endpoints', () => {
  it('moves forward with Applied implied, back by dropping later steps, and keeps one ending', async () => {
    const c = use();
    const { agent } = await signIn(c, 'rules@example.com');
    const app = await create(agent, { status: 1, occurredOn: '2026-10-01' });
    const move = async (status: number, occurredOn?: string) => {
      const res = await agent.put(`/api/applications/${app.id}/status`).set('Origin', ORIGIN).send({ status, occurredOn });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return StatusChangeResponseSchema.parse(res.body);
    };

    const interviewing = await move(12, '2026-10-10');
    expect(interviewing.currentStatus).toBe(12);
    expect(interviewing.events).toEqual([
      { status: 1, occurredOn: '2026-10-01' },
      { status: 2, occurredOn: '2026-10-10' },
      { status: 12, occurredOn: '2026-10-10' },
    ]);

    const back = await move(11);
    expect(statusesOf(back.events)).toEqual([1, 2, 11]);
    expect(back.events[2]).toEqual({ status: 11, occurredOn: TODAY });

    expect(statusesOf((await move(23)).events)).toEqual([1, 2, 11, 23]);
    // Another ending replaces the first: Accepted is above Rejected, so Rejected goes.
    expect(statusesOf((await move(24)).events)).toEqual([1, 2, 11, 24]);
    // Withdrawn is below Accepted: Accepted is dropped as a later step.
    const withdrawn = await move(21);
    expect(statusesOf(withdrawn.events)).toEqual([1, 2, 11, 21]);

    const detail = (await agent.get(`/api/applications/${app.id}`)).body as ApplicationDetail;
    expect(detail.currentStatus).toBe(21);

    const future = await agent.put(`/api/applications/${app.id}/status`).set('Origin', ORIGIN).send({ status: 13, occurredOn: '2027-01-01' });
    expect(future.status).toBe(400);
    expect(future.body.error.message).toBe(FUTURE_DATE_MESSAGE);
  });

  it('dates, adds and clears timeline steps with the shared blockers', async () => {
    const c = use();
    const { agent } = await signIn(c, 'dates@example.com');
    const app = await create(agent, { status: 2, occurredOn: '2026-10-05' });
    const base = `/api/applications/${app.id}/events`;

    const redated = await agent.put(`${base}/2`).set('Origin', ORIGIN).send({ occurredOn: '2026-10-06' });
    expect(redated.body.events).toEqual([
      { status: 1, occurredOn: '2026-10-05' },
      { status: 2, occurredOn: '2026-10-06' },
    ]);

    // "Add date" on a later step makes it current.
    const added = await agent.put(`${base}/12`).set('Origin', ORIGIN).send({ occurredOn: '2026-10-15' });
    expect(added.body.currentStatus).toBe(12);
    expect(statusesOf(added.body.events)).toEqual([1, 2, 12]);

    const saved = await agent.delete(`${base}/1`).set('Origin', ORIGIN);
    expect(saved.status).toBe(400);
    expect(saved.body.error.message).toBe(CANNOT_CLEAR_SAVED);
    const applied = await agent.delete(`${base}/2`).set('Origin', ORIGIN);
    expect(applied.body.error.message).toBe(CANNOT_CLEAR_APPLIED);

    const cleared = await agent.delete(`${base}/12`).set('Origin', ORIGIN);
    expect(cleared.status).toBe(200);
    expect(cleared.body.currentStatus).toBe(2);
    // Clearing a step that has no date is a no-op.
    expect((await agent.delete(`${base}/13`).set('Origin', ORIGIN)).body.currentStatus).toBe(2);

    const future = await agent.put(`${base}/11`).set('Origin', ORIGIN).send({ occurredOn: '2026-12-01' });
    expect(future.status).toBe(400);
    expect(future.body.error.fields).toEqual({ occurredOn: FUTURE_DATE_MESSAGE });
    expect((await agent.put(`${base}/7`).set('Origin', ORIGIN).send({ occurredOn: TODAY })).status).toBe(400);

    // current_status stays in step with the events (the denormalized column the board reads).
    const row = c.deps.db.prepare('SELECT current_status FROM applications WHERE id = ?').get(app.id) as { current_status: number };
    expect(row.current_status).toBe(2);
  });
});

describe('editing', () => {
  it('saves the detail form with the pay rules, a clean description and notes', async () => {
    const c = use();
    const { agent } = await signIn(c, 'edit@example.com');
    const app = await create(agent);
    const patch = (body: object) => agent.patch(`/api/applications/${app.id}`).set('Origin', ORIGIN).send(body);

    const saved = await patch({
      title: 'Staff Engineer',
      location: 'Toronto, ON',
      employmentType: 'part_time',
      postingUrl: 'jobs.example.com/1',
      descriptionHtml: '<p onclick="x()">Hello <a href="javascript:alert(1)">bad</a> <a href="https://ok.example">ok</a></p><script>x()</script>',
      notesHtml: '<p>Call Sam</p>',
      salaryMin: 100000,
      salaryMax: 140000,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({
      title: 'Staff Engineer',
      location: 'Toronto, ON',
      employmentType: 'part_time',
      postingUrl: 'https://jobs.example.com/1',
      notesHtml: '<p>Call Sam</p>',
      // Simplify's hidden defaults: yearly, US dollars.
      salary: { min: 100000, max: 140000, currency: 'USD', period: 'year' },
    });
    expect(saved.body.descriptionHtml).toBe(
      '<p>Hello <a target="_blank" rel="noopener noreferrer nofollow">bad</a> <a href="https://ok.example" target="_blank" rel="noopener noreferrer nofollow">ok</a></p>',
    );

    const order = await patch({ salaryMax: 90000 });
    expect(order.status).toBe(400);
    expect(order.body.error.fields).toEqual({ salaryMax: SALARY_ORDER_MESSAGE });
    expect((await patch({ salaryMin: 1, salaryPeriod: null })).body.error.fields).toEqual({
      salaryPeriod: 'Please select a salary period',
    });
    expect((await patch({ salaryCurrency: 'cad', salaryPeriod: 'hour', salaryMin: 50, salaryMax: 60 })).body.salary).toEqual({
      min: 50,
      max: 60,
      currency: 'CAD',
      period: 'hour',
    });
    // An emptied editor is stored as nothing.
    expect((await patch({ notesHtml: '<p></p>' })).body.notesHtml).toBe('');
    expect((await patch({ title: '  ' })).body.error.fields).toEqual({ title: 'Required' });
    expect((await patch({ trackedOn: '2030-01-01' })).status).toBe(400);
    expect((await patch({ favorite: true })).body.favorite).toBe(true);
  });

  it('links documents the account owns', async () => {
    const c = use();
    const me = await signIn(c, 'docs@example.com');
    const other = await signIn(c, 'else@example.com');
    const now = TEST_NOW.toISOString();
    c.deps.db
      .prepare("INSERT INTO resumes(id, user_id, kind, created_at, updated_at) VALUES ('r1', ?, 'built', ?, ?)")
      .run(me.account.id, now, now);
    c.deps.db
      .prepare(
        "INSERT INTO cover_letters(id, user_id, title, origin, created_at, updated_at) VALUES ('l1', ?, 'Mine', 'blank', ?, ?), ('l2', ?, 'Theirs', 'blank', ?, ?)",
      )
      .run(me.account.id, now, now, other.account.id, now, now);
    const app = await create(me.agent);
    const patch = (body: object) => me.agent.patch(`/api/applications/${app.id}`).set('Origin', ORIGIN).send(body);
    expect((await patch({ resumeId: 'r1', coverLetterId: 'l1' })).body).toMatchObject({ resumeId: 'r1', coverLetterId: 'l1' });
    const refused = await patch({ coverLetterId: 'l2' });
    expect(refused.status).toBe(404);
    expect(refused.body.error.message).toBe('That cover letter was not found.');
    expect((await patch({ resumeId: null, coverLetterId: null })).body).toMatchObject({ resumeId: null, coverLetterId: null });
  });
});

describe('board and list reads', () => {
  async function seed(context: TestContext, agent: TestAgent) {
    let tick = 0;
    const make = (title: string, companyName: string, extra: NewApp = {}) => {
      // A second apart, so "Created Date" has an order (the clock is frozen otherwise).
      tick += 1;
      context.setNow(new Date(TEST_NOW.getTime() + tick * 1000));
      return create(agent, { title, companyName, ...extra });
    };
    const a = await make('OpenShift Platform Engineer', 'M&T Bank', { location: 'Remote in USA', occurredOn: '2026-10-20' });
    const b = await make('Senior Database Administrator', 'Foley', { location: 'Austin, TX', occurredOn: '2026-10-21' });
    const c = await make('Cloud Architect', 'Rubrik', { status: 12, occurredOn: '2026-09-15', employmentType: 'part_time' });
    const d = await make('Software Engineer Intern', 'Experian', { status: 1, employmentType: 'internship' });
    const e = await make('AI Foundry Platform Engineer', 'Applied Information Sciences', { status: 23, occurredOn: '2026-10-02' });
    return { a, b, c, d, e };
  }

  it('returns every column with totals, under search and filters', async () => {
    const c = use();
    const { agent } = await signIn(c, 'board@example.com');
    const apps = await seed(c, agent);
    await agent.patch(`/api/applications/${apps.b.id}`).set('Origin', ORIGIN).send({ favorite: true });

    const board = BoardResponseSchema.parse((await agent.get('/api/applications/board')).body);
    expect(board.columns.map((column) => column.status)).toEqual([1, 2, 11, 12, 13, 21, 22, 23, 24]);
    const totals = Object.fromEntries(board.columns.map((column) => [column.status, column.total]));
    expect(totals).toEqual({ 1: 1, 2: 2, 11: 0, 12: 1, 13: 0, 21: 0, 22: 0, 23: 1, 24: 0 });
    // Newest tracked first.
    expect(board.columns[1]!.items.map((item) => item.title)).toEqual([
      'Senior Database Administrator',
      'OpenShift Platform Engineer',
    ]);

    const read = async (query: string) =>
      BoardResponseSchema.parse((await agent.get(`/api/applications/board?${query}`)).body)
        .columns.flatMap((column) => column.items)
        .map((item: ApplicationSummary) => item.title)
        .sort();
    expect(await read('q=platform')).toEqual(['AI Foundry Platform Engineer', 'OpenShift Platform Engineer']);
    expect(await read('q=bank%20platform')).toEqual(['OpenShift Platform Engineer']);
    expect(await read('q=austin')).toEqual(['Senior Database Administrator']);
    expect(await read('q=100%25')).toEqual([]);
    expect(await read('favorites=1')).toEqual(['Senior Database Administrator']);
    expect(await read('jobType=internship')).toEqual(['Software Engineer Intern']);
    expect(await read('statuses=12,23')).toEqual(['AI Foundry Platform Engineer', 'Cloud Architect']);
    // Applied from/until read the Applied date (a Saved application its tracked day).
    expect(await read('from=2026-10-02&until=2026-10-20')).toEqual(['AI Foundry Platform Engineer', 'OpenShift Platform Engineer']);
    expect(await read(`from=${TODAY}`)).toEqual(['Software Engineer Intern']);
    const bad = await agent.get('/api/applications/board?from=2026-10-20&until=2026-10-01');
    expect(bad.status).toBe(400);
  });

  it('pages a column 25 at a time with a cursor', async () => {
    const c = use();
    const { agent } = await signIn(c, 'pages@example.com');
    for (let index = 0; index < 30; index += 1) {
      const day = String(1 + (index % 20)).padStart(2, '0');
      await create(agent, { title: `Role ${String(index).padStart(2, '0')}`, occurredOn: `2026-10-${day}` });
    }
    const first = BoardResponseSchema.parse((await agent.get('/api/applications/board')).body).columns[1]!;
    expect(first.total).toBe(30);
    expect(first.items).toHaveLength(25);
    expect(first.nextCursor).toBeTruthy();
    const next = BoardResponseSchema.parse(
      (await agent.get(`/api/applications/board?status=2&cursor=${first.nextCursor}`)).body,
    );
    expect(next.columns).toHaveLength(1);
    expect(next.columns[0]!.items).toHaveLength(5);
    expect(next.columns[0]!.nextCursor).toBeUndefined();
    const ids = new Set([...first.items, ...next.columns[0]!.items].map((item) => item.id));
    expect(ids.size).toBe(30);
    expect((await agent.get('/api/applications/board?status=2&cursor=garbage')).status).toBe(400);
  });

  it('lists with the three sorts, both orders, a total and keyset pages', async () => {
    const c = use();
    const { agent } = await signIn(c, 'list@example.com');
    await seed(c, agent);
    const titles = async (query: string) => {
      const res = await agent.get(`/api/applications?${query}`);
      expect(res.status).toBe(200);
      return ApplicationListResponseSchema.parse(res.body).items.map((item) => item.title);
    };
    expect(await titles('sort=title&order=asc')).toEqual([
      'AI Foundry Platform Engineer',
      'Cloud Architect',
      'OpenShift Platform Engineer',
      'Senior Database Administrator',
      'Software Engineer Intern',
    ]);
    expect((await titles('sort=title&order=desc'))[0]).toBe('Software Engineer Intern');
    expect(await titles('sort=tracked&order=asc')).toEqual([
      'Cloud Architect',
      'AI Foundry Platform Engineer',
      'OpenShift Platform Engineer',
      'Senior Database Administrator',
      'Software Engineer Intern',
    ]);
    // Created: the order of the requests.
    expect(await titles('sort=created&order=desc')).toEqual([
      'AI Foundry Platform Engineer',
      'Software Engineer Intern',
      'Cloud Architect',
      'Senior Database Administrator',
      'OpenShift Platform Engineer',
    ]);

    const first = ApplicationListResponseSchema.parse((await agent.get('/api/applications?sort=title&order=asc&limit=2')).body);
    expect(first.total).toBe(5);
    expect(first.items.map((item) => item.title)).toEqual(['AI Foundry Platform Engineer', 'Cloud Architect']);
    const second = ApplicationListResponseSchema.parse(
      (await agent.get(`/api/applications?sort=title&order=asc&limit=2&cursor=${first.nextCursor}`)).body,
    );
    expect(second.items.map((item) => item.title)).toEqual(['OpenShift Platform Engineer', 'Senior Database Administrator']);
    // The list carries the events the stepper draws.
    expect(second.items[0]!.events).toEqual([
      { status: 1, occurredOn: '2026-10-20' },
      { status: 2, occurredOn: '2026-10-20' },
    ]);
  });
});

describe('archive, counts and bulk', () => {
  it('archives and restores, counts both tabs, and lists the Archived tab', async () => {
    const c = use();
    const { agent } = await signIn(c, 'tabs@example.com');
    const one = await create(agent, { title: 'One' });
    await create(agent, { title: 'Two', status: 12 });
    await create(agent, { title: 'Three', status: 1 });

    const archived = await agent.post(`/api/applications/${one.id}/archive`).set('Origin', ORIGIN);
    expect(archived.body.archivedAt).toBe(TEST_NOW.toISOString());
    const counts = ApplicationCountsSchema.parse((await agent.get('/api/applications/counts')).body);
    expect(counts).toEqual({
      active: 2,
      archived: 1,
      byStatus: { '1': 1, '2': 0, '11': 0, '12': 1, '13': 0, '21': 0, '22': 0, '23': 0, '24': 0 },
    });
    expect((await agent.get('/api/applications?tab=archived')).body.items.map((item: ApplicationSummary) => item.title)).toEqual(['One']);
    expect((await agent.get('/api/applications/board')).body.columns[1].items).toEqual([]);

    await agent.post(`/api/applications/${one.id}/restore`).set('Origin', ORIGIN);
    expect((await agent.get('/api/applications/counts')).body).toMatchObject({ active: 3, archived: 0 });

    const all = await agent.post('/api/applications/archive-all').set('Origin', ORIGIN);
    expect(all.body).toEqual({ archived: 3 });
    expect((await agent.get('/api/applications/counts')).body).toMatchObject({ active: 0, archived: 3 });
  });

  it('runs Manage jobs actions over the selection', async () => {
    const c = use();
    const { agent } = await signIn(c, 'bulk@example.com');
    const ids = [] as string[];
    for (const title of ['A', 'B', 'C', 'D']) ids.push((await create(agent, { title })).id);
    const bulk = (body: object) => agent.post('/api/applications/bulk').set('Origin', ORIGIN).send(body);

    expect((await bulk({ ids: [ids[0], ids[1]], action: 'archive' })).body).toEqual({ affected: 2 });
    expect((await agent.get('/api/applications/counts')).body).toMatchObject({ active: 2, archived: 2 });
    expect((await bulk({ ids: [ids[0]], action: 'unarchive' })).body).toEqual({ affected: 1 });

    const status = await bulk({ ids: [ids[2], ids[3], 'nope'], action: 'status', status: 13 });
    expect(status.body).toEqual({ affected: 2 });
    for (const id of [ids[2], ids[3]]) {
      const detail = (await agent.get(`/api/applications/${id}`)).body as ApplicationDetail;
      expect(detail.currentStatus).toBe(13);
      expect(statusesOf(detail.events)).toEqual([1, 2, 13]);
    }
    expect((await bulk({ ids: [ids[2]], action: 'status' })).body.error.fields).toEqual({ status: 'Choose a status' });

    expect((await bulk({ ids: [ids[1], ids[3]], action: 'delete' })).body).toEqual({ affected: 2 });
    expect((await agent.get('/api/applications/counts')).body).toMatchObject({ active: 2, archived: 0 });
    const left = c.deps.db.prepare('SELECT COUNT(*) AS n FROM application_status_events').get() as { n: number };
    expect(left.n).toBe(5); // A: Saved+Applied, C: Saved+Applied+Offer
  });
});

describe('review hardening', () => {
  it('treats an empty resume or letter id as none (the person’s choice), and floors a fractional page size', async () => {
    const c = use();
    const { agent } = await signIn(c, 'edges@example.com');
    const res = await agent
      .post('/api/applications')
      .set('Origin', ORIGIN)
      .send({ title: 'X', companyName: 'Y', employmentType: 'full_time', resumeId: '' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ resumeId: null, resumeOrigin: 'user', resumeMatchPending: false });
    const patched = await agent.patch(`/api/applications/${res.body.id}`).set('Origin', ORIGIN).send({ resumeId: '', coverLetterId: '' });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ resumeId: null, resumeOrigin: 'user', coverLetterId: null });

    // Sending no resume at all is not a choice: nobody chose one yet.
    expect(await create(agent, { title: 'Second' })).toMatchObject({ resumeId: null, resumeOrigin: null, resumeMatchedAt: null });
    const list = await agent.get('/api/applications?limit=1.5');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect((await agent.get('/api/applications/board?limit=2.5')).status).toBe(200);
  });

  it('refuses calendar days that do not exist', async () => {
    const c = use();
    const { agent } = await signIn(c, 'calendar@example.com');
    const bad = await agent
      .post('/api/applications')
      .set('Origin', ORIGIN)
      .send({ title: 'X', companyName: 'Y', employmentType: 'full_time', occurredOn: '2026-02-30' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ message: 'Enter a real date (YYYY-MM-DD).', fields: { occurredOn: 'Enter a real date (YYYY-MM-DD).' } });
    const app = await create(agent);
    for (const date of ['2025-13-45', '2026-10-00']) {
      const res = await agent.put(`/api/applications/${app.id}/events/11`).set('Origin', ORIGIN).send({ occurredOn: date });
      expect(res.status).toBe(400);
    }
    expect((await agent.patch(`/api/applications/${app.id}`).set('Origin', ORIGIN).send({ trackedOn: '2026-04-31' })).status).toBe(400);
  });

  it('keeps the pay-period rule against stored amounts', async () => {
    const c = use();
    const { agent } = await signIn(c, 'period@example.com');
    const app = await create(agent);
    const patch = (body: object) => agent.patch(`/api/applications/${app.id}`).set('Origin', ORIGIN).send(body);
    expect((await patch({ salaryMin: 50, salaryMax: 60, salaryPeriod: 'hour' })).status).toBe(200);
    const cleared = await patch({ salaryPeriod: null });
    expect(cleared.status).toBe(400);
    expect(cleared.body.error.fields).toEqual({ salaryPeriod: 'Please select a salary period' });
    // Removing the amounts removes the period with them.
    expect((await patch({ salaryMin: null, salaryMax: null, salaryPeriod: null, salaryCurrency: null })).body.salary).toEqual({
      min: null,
      max: null,
      currency: null,
      period: null,
    });
  });

  it('ties a cursor to the sort and the column it came from', async () => {
    const c = use();
    const { agent } = await signIn(c, 'cursor@example.com');
    for (const title of ['A', 'B', 'C']) await create(agent, { title });
    for (const title of ['D', 'E']) await create(agent, { title, status: 12 });
    const first = await agent.get('/api/applications?sort=title&order=asc&limit=1');
    const cursor = first.body.nextCursor as string;
    expect((await agent.get(`/api/applications?sort=title&order=asc&limit=1&cursor=${cursor}`)).status).toBe(200);
    const other = await agent.get(`/api/applications?sort=title&order=desc&limit=1&cursor=${cursor}`);
    expect(other.status).toBe(400);
    expect(other.body.error.message).toBe('That page of applications is out of date. Reload the tracker and try again.');

    const board = await agent.get('/api/applications/board?limit=1');
    const columnCursor = board.body.columns[1].nextCursor as string;
    expect((await agent.get(`/api/applications/board?status=2&limit=1&cursor=${columnCursor}`)).status).toBe(200);
    expect((await agent.get(`/api/applications/board?status=12&limit=1&cursor=${columnCursor}`)).status).toBe(400);
  });

  it('keeps the first archive time and the account scope on every collection route', async () => {
    const c = use();
    const owner = await signIn(c, 'scope-owner@example.com');
    const other = await signIn(c, 'scope-other@example.com');
    const app = await create(owner.agent, { title: 'Mine', companyName: 'Secret Co' });
    await owner.agent.post(`/api/applications/${app.id}/archive`).set('Origin', ORIGIN);
    c.setNow(new Date(TEST_NOW.getTime() + 60_000));
    const again = await owner.agent.post(`/api/applications/${app.id}/archive`).set('Origin', ORIGIN);
    expect(again.body.archivedAt).toBe(TEST_NOW.toISOString());

    expect((await other.agent.get('/api/applications/counts')).body).toMatchObject({ active: 0, archived: 0 });
    expect((await other.agent.get('/api/applications/companies?q=secret')).body.items).toEqual([]);
    expect((await other.agent.get('/api/applications/sankey')).body.total).toBe(0);
    expect((await other.agent.post('/api/applications/archive-all').set('Origin', ORIGIN)).body).toEqual({ archived: 0 });
    for (const action of ['unarchive', 'archive'] as const) {
      expect((await other.agent.post('/api/applications/bulk').set('Origin', ORIGIN).send({ ids: [app.id], action })).body).toEqual({
        affected: 0,
      });
    }
    expect((await owner.agent.get(`/api/applications/${app.id}`)).body.archivedAt).toBe(TEST_NOW.toISOString());
    expect((await other.agent.get(`/api/applications/${app.id}/cover-letters`)).status).toBe(404);
  });

  it('never serves a logo path that leaves the site', async () => {
    const c = use();
    const { agent } = await signIn(c, 'logo@example.com');
    const now = TEST_NOW.toISOString();
    c.deps.db
      .prepare("INSERT INTO companies(name, name_key, logo_path, created_at, updated_at) VALUES ('Sneaky', 'sneaky', ?, ?, ?), ('Local', 'local', '/logos/local.png', ?, ?)")
      .run(String.raw`/\evil.example/x.png`, now, now, now, now);
    expect((await create(agent, { companyName: 'Sneaky' })).logoUrl).toBeNull();
    expect((await create(agent, { companyName: 'Local' })).logoUrl).toBe('/logos/local.png');
  });
});
