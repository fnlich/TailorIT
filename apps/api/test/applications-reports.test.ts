import { afterEach, describe, expect, it } from 'vitest';
import {
  EXPORT_CSV_COLUMNS,
  InsightsResponseSchema,
  MatchResultSchema,
  SankeyResponseSchema,
  TrackerImportResponseSchema,
  guessImportMapping,
  type ApplicationDetail,
  type JobAnalysisView,
  type JobKeywords,
  type MatchResult,
  type TrackerImportField,
} from '@tailorit/shared';
import { signIn, type TestAgent } from './auth-helpers';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';

// Work package T: CSV export and import (and their round trip), the chart's Sankey and insights, application
// questions, the company suggestions and the resume score.

let ctx: TestContext | null = null;
afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

function use(): TestContext {
  ctx = createTestContext();
  return ctx;
}

async function create(agent: TestAgent, body: Record<string, unknown>): Promise<ApplicationDetail> {
  const res = await agent
    .post('/api/applications')
    .set('Origin', ORIGIN)
    .send({ employmentType: 'full_time', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as ApplicationDetail;
}

/** A small RFC 4180 reader (quotes, doubled quotes, CRLF), enough to read our own export back. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function exportRows(agent: TestAgent, query = ''): Promise<{ header: string[]; rows: string[][]; disposition: string }> {
  const res = await agent.get(`/api/applications/export.csv${query}`).buffer(true).parse((response, done) => {
    let data = '';
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => (data += chunk));
    response.on('end', () => done(null, data));
  });
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
  const text = res.body as string;
  expect(text.startsWith('\uFEFF')).toBe(true);
  const [header, ...rows] = parseCsv(text.slice(1));
  return { header: header!, rows, disposition: String(res.headers['content-disposition']) };
}

describe('CSV export', () => {
  it('writes the current filters as TailorIT_Tracked_Jobs_{date}.csv', async () => {
    const c = use();
    const { agent } = await signIn(c, 'csv@example.com');
    const one = await create(agent, {
      title: 'Data Engineer',
      companyName: 'Acme, "the" company',
      location: 'Remote',
      status: 12,
      occurredOn: '2026-10-03',
      postingUrl: 'https://acme.example/jobs/9',
    });
    await agent
      .patch(`/api/applications/${one.id}`)
      .set('Origin', ORIGIN)
      .send({ notesHtml: '<p>Recruiter: Sam</p><p>=SUM(A1)</p>', salaryMin: 120000, salaryMax: 150000, favorite: true });
    await create(agent, { title: 'Intern', companyName: 'Beta', status: 1, employmentType: 'internship' });

    const { header, rows, disposition } = await exportRows(agent);
    expect(disposition).toBe('attachment; filename="TailorIT_Tracked_Jobs_2026-10-22.csv"');
    expect(header).toEqual([...EXPORT_CSV_COLUMNS]);
    expect(rows).toHaveLength(2);
    const data = rows.find((row) => row[1] === 'Data Engineer')!;
    expect(data).toEqual([
      'Acme, "the" company',
      'Data Engineer',
      'Remote',
      'Full-Time',
      'Interviewing',
      '2026-10-03',
      '2026-10-03',
      'https://acme.example/jobs/9',
      '120000',
      '150000',
      'USD',
      'Yearly',
      'Yes',
      'No',
      'Recruiter: Sam\n=SUM(A1)',
    ]);
    const intern = rows.find((row) => row[1] === 'Intern')!;
    expect(intern.slice(3, 6)).toEqual(['Internship', 'Saved', '']);

    // Filters and tabs apply.
    expect((await exportRows(agent, '?statuses=1')).rows.map((row) => row[1])).toEqual(['Intern']);
    expect((await exportRows(agent, '?tab=archived')).rows).toEqual([]);
    expect((await exportRows(agent, '?q=acme')).rows.map((row) => row[1])).toEqual(['Data Engineer']);
  });
});

describe('CSV import', () => {
  it('reads mapped rows with the status map, job type guesses and application dates', async () => {
    const c = use();
    const { agent } = await signIn(c, 'import@example.com');
    const res = await agent
      .post('/api/applications/import')
      .set('Origin', ORIGIN)
      .send({
        rows: [
          { title: 'Software Engineering Intern', companyName: 'Acme', status: 'Phone call', appliedOn: '10/01/2026' },
          { title: 'Backend Engineer', companyName: 'Beta', status: 'Rejected', employmentType: 'Contract', postingUrl: 'beta.io/jobs/2', notes: 'Line one\nline two' },
          { title: '', companyName: 'Gamma' },
          { title: 'Platform Engineer', companyName: 'Delta', appliedOn: 'someday' },
          { title: 'Future Role', companyName: 'Epsilon', appliedOn: '2027-01-01' },
          { title: 'Part-time Tutor', companyName: 'Zeta', status: 'wishlist' },
        ],
        statusMap: { 'phone call': 11 },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(TrackerImportResponseSchema.parse(res.body)).toEqual({
      imported: 3,
      skipped: 3,
      errors: [
        { row: 3, message: 'Position Title is required.' },
        { row: 4, message: '"someday" is not a date we can read.' },
        { row: 5, message: "Dates can't be in the future." },
      ],
    });

    const list = (await agent.get('/api/applications?sort=title&order=asc')).body.items as ApplicationDetail[];
    expect(list.map((item) => [item.title, item.employmentType, item.currentStatus, item.trackedOn])).toEqual([
      ['Backend Engineer', 'contract', 23, '2026-10-22'],
      ['Part-time Tutor', 'part_time', 1, '2026-10-22'],
      ['Software Engineering Intern', 'internship', 11, '2026-10-01'],
    ]);
    const intern = list[2]!;
    // The Application Date dates the Applied step (and the steps the row says it reached).
    expect(intern.events).toEqual([
      { status: 1, occurredOn: '2026-10-01' },
      { status: 2, occurredOn: '2026-10-01' },
      { status: 11, occurredOn: '2026-10-01' },
    ]);
    const backend = (await agent.get(`/api/applications/${list[0]!.id}`)).body as ApplicationDetail;
    expect(backend.postingUrl).toBe('https://beta.io/jobs/2');
    expect(backend.notesHtml).toBe('<p>Line one<br />line two</p>');

    const empty = await agent.post('/api/applications/import').set('Origin', ORIGIN).send({ rows: [] });
    expect(empty.status).toBe(400);
  });

  it("tells the wizard which of a file's companies TailorIT knows (Review companies)", async () => {
    const c = use();
    const { agent } = await signIn(c, 'import-companies@example.com');
    const now = TEST_NOW.toISOString();
    c.deps.db.prepare("INSERT INTO companies(name, name_key, created_at, updated_at) VALUES ('Stripe', 'stripe', ?, ?)").run(now, now);
    await create(agent, { title: 'Role', companyName: 'Globex Corporation' });
    const ask = (who: TestAgent, names: unknown) => who.post('/api/applications/import/companies').set('Origin', ORIGIN).send({ names });

    // Compared as the logo link compares names: case, punctuation and legal suffixes aside; the account's own first.
    const res = await ask(agent, ['Stripe, Inc.', 'stripe', 'globex corporation', 'Initech', '  ']);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ known: { 'Stripe, Inc.': 'Stripe', stripe: 'Stripe', 'globex corporation': 'Globex Corporation' } });

    // Another account's applications are not known to this one.
    const other = await signIn(c, 'other-companies@example.com');
    expect((await ask(other.agent, ['Globex Corporation'])).body).toEqual({ known: {} });

    expect((await ask(agent, [])).status).toBe(400);
    expect((await ask(agent, 'Stripe')).status).toBe(400);
  });

  it('round-trips: what the export writes, the import reads back the same', async () => {
    const c = use();
    const source = await signIn(c, 'source@example.com');
    const target = await signIn(c, 'target@example.com');
    await create(source.agent, { title: 'Staff Engineer', companyName: 'Acme', location: 'NYC', status: 13, occurredOn: '2026-09-01', postingUrl: 'https://acme.example/1' });
    const intern = await create(source.agent, { title: 'Intern', companyName: 'Beta', status: 1, employmentType: 'internship' });
    await source.agent.patch(`/api/applications/${intern.id}`).set('Origin', ORIGIN).send({ notesHtml: '<p>Ask about housing, "stipend"</p>' });
    await create(source.agent, { title: 'Analyst', companyName: 'Gamma', status: 22, occurredOn: '2026-08-15', employmentType: 'part_time' });

    const exported = await exportRows(source.agent, '?sort=title&order=asc');
    const mapping = guessImportMapping(exported.header);
    expect(mapping).toMatchObject({ title: 1, companyName: 0, location: 2, employmentType: 3, status: 4, appliedOn: 5, postingUrl: 7, notes: 14 });
    const rows = exported.rows.map((row) => {
      const out: Partial<Record<TrackerImportField, string>> = {};
      for (const [field, index] of Object.entries(mapping)) out[field as TrackerImportField] = row[index as number] ?? '';
      return out;
    });
    const imported = await target.agent.post('/api/applications/import').set('Origin', ORIGIN).send({ rows });
    expect(imported.body).toMatchObject({ imported: 3, skipped: 0 });

    const again = await exportRows(target.agent, '?sort=title&order=asc');
    const comparable = (table: string[][]) => table.map((row) => [row[0], row[1], row[2], row[3], row[4], row[5], row[7], row[14]]);
    expect(comparable(again.rows)).toEqual(comparable(exported.rows));
  });
});

describe('chart', () => {
  it('builds the application flow and the insights from active applications', async () => {
    const c = use();
    const { agent } = await signIn(c, 'chart@example.com');
    await create(agent, { title: 'A', companyName: 'One', status: 2, occurredOn: '2026-10-19' }); // Monday
    await create(agent, { title: 'B', companyName: 'Two', status: 2, occurredOn: '2026-10-05' });
    const screened = await create(agent, { title: 'C', companyName: 'Three', status: 2, occurredOn: '2026-10-12' });
    await agent.put(`/api/applications/${screened.id}/status`).set('Origin', ORIGIN).send({ status: 11, occurredOn: '2026-10-16' });
    await agent.put(`/api/applications/${screened.id}/status`).set('Origin', ORIGIN).send({ status: 12, occurredOn: '2026-10-18' });
    await create(agent, { title: 'D', companyName: 'Four', status: 1 }); // Saved: not charted
    const archived = await create(agent, { title: 'E', companyName: 'Five', status: 23 });
    await agent.post(`/api/applications/${archived.id}/archive`).set('Origin', ORIGIN);

    const sankey = SankeyResponseSchema.parse((await agent.get('/api/applications/sankey')).body);
    expect(sankey.total).toBe(3);
    expect(sankey.nodes.map((node) => [node.id, node.value, node.color])).toEqual([
      ['Applied', 3, '#4a86e8'],
      ['Screening', 1, '#5E97B7'],
      ['Interviewing', 1, '#47C1AD'],
    ]);
    expect(sankey.links).toEqual([
      { source: 'Applied', target: 'Screening', value: 1 },
      { source: 'Screening', target: 'Interviewing', value: 1 },
    ]);

    const insights = InsightsResponseSchema.parse((await agent.get('/api/applications/insights')).body);
    expect(insights.activity.total).toBe(3);
    expect(insights.activity.mostActiveDay).toEqual({ weekday: 'Monday', count: 3 });
    expect(insights.funnel.appliedToScreening).toEqual({ percent: 33, from: 3, to: 1 });
    expect(insights.funnel.screeningToInterview).toEqual({ percent: 100, from: 1, to: 1 });
    expect(insights.response.averageResponseDays).toBe(4);
    expect(insights.response.longestWait).toEqual({ days: 17, title: 'B', companyName: 'Two' });

    // An account with nothing tracked gets the empty shapes.
    const empty = await signIn(c, 'empty@example.com');
    expect(SankeyResponseSchema.parse((await empty.agent.get('/api/applications/sankey')).body)).toEqual({ nodes: [], links: [], total: 0 });
    expect((await empty.agent.get('/api/applications/insights')).body.activity).toEqual({
      total: 0,
      mostActiveDay: null,
      perDay: 0,
      perWeek: 0,
      perMonth: 0,
    });
  });
});

describe('questions', () => {
  it('adds, edits, reorders and deletes Application Questions in order', async () => {
    const c = use();
    const { agent } = await signIn(c, 'questions@example.com');
    const app = await create(agent, { title: 'Role', companyName: 'Acme' });
    const base = `/api/applications/${app.id}/questions`;
    const add = (question: string) => agent.post(base).set('Origin', ORIGIN).send({ question });
    const first = (await add('Why Acme?')).body;
    const second = (await add('Salary expectations?')).body;
    const third = (await add('Visa sponsorship?')).body;
    expect([first.position, second.position, third.position]).toEqual([0, 1, 2]);
    expect((await add('  ')).body.error.fields).toEqual({ question: 'Required' });

    const answered = await agent.patch(`${base}/${second.id}`).set('Origin', ORIGIN).send({ answer: '$150k' });
    expect(answered.body).toMatchObject({ question: 'Salary expectations?', answer: '$150k' });

    await agent.patch(`${base}/${third.id}`).set('Origin', ORIGIN).send({ position: 0 });
    const order = (await agent.get(base)).body.items.map((item: { question: string; position: number }) => [item.position, item.question]);
    expect(order).toEqual([
      [0, 'Visa sponsorship?'],
      [1, 'Why Acme?'],
      [2, 'Salary expectations?'],
    ]);

    expect((await agent.delete(`${base}/${first.id}`).set('Origin', ORIGIN)).status).toBe(204);
    const detail = (await agent.get(`/api/applications/${app.id}`)).body as ApplicationDetail;
    expect(detail.questions.map((item) => [item.position, item.question])).toEqual([
      [0, 'Visa sponsorship?'],
      [1, 'Salary expectations?'],
    ]);
    expect((await agent.delete(`${base}/${first.id}`).set('Origin', ORIGIN)).status).toBe(404);

    // Questions of another application are not reachable through this one.
    const other = await create(agent, { title: 'Other', companyName: 'Beta' });
    expect((await agent.patch(`/api/applications/${other.id}/questions/${second.id}`).set('Origin', ORIGIN).send({ answer: 'x' })).status).toBe(404);
  });
});

describe('suggestions and score', () => {
  it('offers tracked and known companies for the combobox', async () => {
    const c = use();
    const { agent } = await signIn(c, 'companies@example.com');
    const now = TEST_NOW.toISOString();
    c.deps.db.prepare("INSERT INTO companies(name, name_key, created_at, updated_at) VALUES ('Zeta', 'zeta', ?, ?), ('acme', 'acme', ?, ?)").run(now, now, now, now);
    await create(agent, { title: 'Role', companyName: 'Acme' });
    await create(agent, { title: 'Role 2', companyName: 'Beta' });
    expect((await agent.get('/api/applications/companies')).body).toEqual({ items: ['Acme', 'Beta', 'Zeta'] });
  });

  it('scores the linked or default resume against the description keywords', async () => {
    const c = use();
    const { agent, account } = await signIn(c, 'score@example.com');
    const app = await create(agent, { title: 'Senior Kubernetes Engineer', companyName: 'Acme' });
    await agent
      .patch(`/api/applications/${app.id}`)
      .set('Origin', ORIGIN)
      .send({ descriptionHtml: '<p>We run Kubernetes and Terraform on AWS. You write Python every day; Python and Terraform are required.</p>' });

    const none = MatchResultSchema.parse((await agent.get(`/api/applications/${app.id}/resume-score`)).body);
    expect(none.state).toBe('no_resume');
    expect(none.matched).toEqual([]);
    expect(none.missing.map((keyword) => keyword.term).sort()).toEqual(['AWS', 'Kubernetes', 'Python', 'Terraform']);

    const now = TEST_NOW.toISOString();
    const data = JSON.stringify({ name: 'Dana', title: 'Platform Engineer', skills: ['Kubernetes', 'Python'], experience: [] });
    c.deps.db
      .prepare("INSERT INTO resumes(id, user_id, kind, title, data, created_at, updated_at) VALUES ('r1', ?, 'built', 'Main', ?, ?, ?)")
      .run(account.id, data, now, now);
    c.deps.db.prepare('UPDATE users SET default_resume_id = ? WHERE id = ?').run('r1', account.id);

    const scored = MatchResultSchema.parse((await agent.get(`/api/applications/${app.id}/resume-score`)).body);
    expect(scored.state).toBe('ok');
    expect(scored.resumeId).toBe('r1');
    expect(scored.matched.map((keyword) => keyword.term).sort()).toEqual(['Kubernetes', 'Python']);
    expect(scored.missing.map((keyword) => keyword.term).sort()).toEqual(['AWS', 'Terraform']);
    expect(scored).toMatchObject({ matchedCount: 2, total: 4, percentage: 50 });
    // High priority: named twice or in the title.
    expect(scored.matched.find((keyword) => keyword.term === 'Kubernetes')?.priority).toBe('high');

    // A linked resume wins over the default.
    c.deps.db
      .prepare("INSERT INTO resumes(id, user_id, kind, title, extracted_text, created_at, updated_at) VALUES ('r2', ?, 'uploaded', 'Upload', 'AWS and Terraform', ?, ?)")
      .run(account.id, now, now);
    await agent.patch(`/api/applications/${app.id}`).set('Origin', ORIGIN).send({ resumeId: 'r2' });
    const linked = MatchResultSchema.parse((await agent.get(`/api/applications/${app.id}/resume-score`)).body);
    expect(linked.resumeId).toBe('r2');
    expect(linked.matched.map((keyword) => keyword.term).sort()).toEqual(['AWS', 'Terraform']);

    // No description: nothing to score yet.
    const blank = await create(agent, { title: 'Role', companyName: 'Acme' });
    expect((await agent.get(`/api/applications/${blank.id}/resume-score`)).body).toMatchObject({ state: 'ok', total: 0, percentage: 0 });
  });

  it("scores an application tracked from a job with the job's analysis, as the Jobs page's match does", async () => {
    const c = use();
    const { agent, account } = await signIn(c, 'job-score@example.com');
    const now = TEST_NOW.toISOString();
    const db = c.deps.db;
    const company = db.prepare("INSERT INTO companies(name, name_key, created_at, updated_at) VALUES ('Acme', 'acme', ?, ?)").run(now, now);
    const html = '<h3>Requirements</h3><ul><li>Kubernetes and Docker in production.</li><li>Python or Go.</li></ul><p>We use Terraform.</p>';
    const hash = 'a'.repeat(64);
    const jobId = Number(
      db
        .prepare(
          `INSERT INTO jobs(company_id, title, description_html, description_text, apply_url, content_hash, employment_type,
             first_seen_at, last_seen_at, created_at, updated_at)
           VALUES (?, 'Platform Engineer', ?, 'Requirements Kubernetes and Docker in production. Python or Go. We use Terraform.',
             'https://acme.example/jobs/1', ?, 'full_time', ?, ?, ?, ?)`,
        )
        .run(company.lastInsertRowid, html, hash, now, now, now, now).lastInsertRowid,
    );
    db.prepare(
      "INSERT INTO resumes(id, user_id, kind, title, extracted_text, created_at, updated_at) VALUES ('r1', ?, 'uploaded', 'Main', 'Kubernetes, Python and Terraform.', ?, ?)",
    ).run(account.id, now, now);
    db.prepare('UPDATE users SET default_resume_id = ? WHERE id = ?').run('r1', account.id);
    const app = await create(agent, { jobId });

    const score = async () => MatchResultSchema.parse((await agent.get(`/api/applications/${app.id}/resume-score`)).body);
    const jobMatch = async () => MatchResultSchema.parse((await agent.get(`/api/jobs/${jobId}/match`)).body);
    const terms = (keywords: MatchResult['matched']) => keywords.map((keyword) => keyword.term).sort();

    // The job analysis service's analysis: the same answer on both pages.
    const first = await score();
    expect(first.total).toBeGreaterThan(0);
    expect(first).toEqual(await jobMatch());

    // A description rewritten in the tracker does not change the job's keywords (AWS is only in the new text).
    await agent.patch(`/api/applications/${app.id}`).set('Origin', ORIGIN).send({ descriptionHtml: '<p>We only use AWS.</p>' });
    const edited = await score();
    expect(edited).toEqual(await jobMatch());
    expect(terms([...edited.matched, ...edited.missing])).not.toContain('AWS');

    // Whatever the service answers is what both score: keywords the posting never names prove the source.
    const keywords: JobKeywords = { high: [{ term: 'Rust', synonyms: [] }], low: [{ term: 'Kubernetes', synonyms: ['k8s'] }] };
    const view: JobAnalysisView = {
      source: 'ai',
      refining: false,
      requirements: [],
      responsibilities: [],
      desired: [],
      keywords,
      experienceLevels: [],
      categoryId: null,
      subcategoryIds: [],
    };
    c.deps.services.jobAnalysis = {
      ensure: () => ({ analysis: view, refining: false }),
      get: (id) => (id === jobId ? { analysis: view, refining: false } : null),
    };
    const stubbed = await score();
    expect(stubbed).toEqual(await jobMatch());
    expect(stubbed).toMatchObject({
      matched: [{ term: 'Kubernetes', priority: 'low' }],
      missing: [{ term: 'Rust', priority: 'high' }],
      matchedCount: 1,
      total: 2,
      percentage: 50,
    });

    // The service failing (or missing): the analysis stored on the job.
    const analysisId = Number(
      db
        .prepare("INSERT INTO job_analyses(content_hash, source, version, keywords, created_at) VALUES (?, 'ft_lake', 1, ?, ?)")
        .run(hash, JSON.stringify({ high: [{ term: 'Python', synonyms: [] }], low: [{ term: 'Haskell', synonyms: [] }] }), now)
        .lastInsertRowid,
    );
    db.prepare('UPDATE jobs SET analysis_id = ? WHERE id = ?').run(analysisId, jobId);
    c.deps.services.jobAnalysis = {
      ensure: () => {
        throw new Error('boom');
      },
      get: () => {
        throw new Error('boom');
      },
    };
    const stored = await score();
    expect(stored).toEqual(await jobMatch());
    expect([terms(stored.matched), terms(stored.missing)]).toEqual([['Python'], ['Haskell']]);
    delete c.deps.services.jobAnalysis;
    expect(await score()).toEqual(stored);

    // Once the job is gone, the application's own description is scored.
    db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
    const own = await score();
    expect([terms(own.matched), terms(own.missing)]).toEqual([[], ['AWS']]);
  });
});

describe('review hardening', () => {
  it('searches company suggestions beyond the first page of names', async () => {
    const c = use();
    const { agent } = await signIn(c, 'company-search@example.com');
    const now = TEST_NOW.toISOString();
    const insert = c.deps.db.prepare('INSERT INTO companies(name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?)');
    for (let index = 0; index < 320; index += 1) insert.run(`Aardvark ${index}`, `aardvark${index}`, now, now);
    insert.run('Zebra Robotics', 'zebrarobotics', now, now);
    insert.run('Robo Zebra', 'robozebra', now, now);
    insert.run('100%_Co', '100co', now, now);
    expect((await agent.get('/api/applications/companies')).body.items).not.toContain('Zebra Robotics');
    expect((await agent.get('/api/applications/companies?q=zebra')).body.items).toEqual(['Zebra Robotics', 'Robo Zebra']);
    expect((await agent.get('/api/applications/companies?q=%25_')).body.items).toEqual(['100%_Co']);
  });

  it('lists the cover letters written for an application', async () => {
    const c = use();
    const { agent, account } = await signIn(c, 'letters-for@example.com');
    const app = await create(agent, { title: 'Role', companyName: 'Acme' });
    const now = TEST_NOW.toISOString();
    c.deps.db
      .prepare(
        "INSERT INTO cover_letters(id, user_id, title, origin, application_id, created_at, updated_at) VALUES ('l1', ?, 'For Acme', 'generated', ?, ?, ?), ('l2', ?, 'Other', 'blank', NULL, ?, ?)",
      )
      .run(account.id, app.id, now, now, account.id, now, now);
    expect((await agent.get(`/api/applications/${app.id}/cover-letters`)).body).toEqual({
      items: [{ id: 'l1', title: 'For Acme', updatedAt: now }],
    });
  });

  it('cuts an over-long cell instead of failing the batch', async () => {
    const c = use();
    const { agent } = await signIn(c, 'long-cells@example.com');
    const res = await agent
      .post('/api/applications/import')
      .set('Origin', ORIGIN)
      .send({ rows: [{ title: 'T'.repeat(900), companyName: 'Acme', notes: 'n'.repeat(30_000), postingUrl: `https://a.example/${'x'.repeat(3_000)}` }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ imported: 1, skipped: 0 });
    const [row] = (await agent.get('/api/applications')).body.items as ApplicationDetail[];
    expect(row!.title).toHaveLength(200);
  });
});
