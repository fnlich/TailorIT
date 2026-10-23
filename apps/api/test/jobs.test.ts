import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  JOBS_PAGE_SIZE,
  JobAnalysisViewSchema,
  JobDetailSchema,
  JobFacetResponseSchema,
  JobFacetsSummarySchema,
  JobSummarySchema,
  MatchResultSchema,
  SavedSearchSchema,
  formatLocation,
  parseLocations,
  toAnnualUsd,
  type JobAnalysisView,
} from '@tailorit/shared';
import type { Db } from '../src/core/db/connection';
import { ORIGIN, createTestContext, type TestContext } from './helpers';
import { signIn, type SignedIn } from './auth-helpers';

// Work package J2: GET /api/jobs (FTS5 search, every filter, sorts, keyset pages, "Found N"), the detail, analysis
// and match, hide/report, facets and saved searches. Jobs are inserted directly (with their jobs_fts rows), as
// ingestion would write them.

// ------------------------------------------------------------------------------------------------- fixtures

interface CompanyInput {
  name: string;
  tagline?: string;
  about?: string;
  sizeBucket?: string | null;
  industry?: string | null;
  sponsorsH1b?: number | null;
  logoPath?: string | null;
  links?: unknown;
}

function insertCompany(db: Db, input: CompanyInput): number {
  const key = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const existing = db.prepare('SELECT id FROM companies WHERE name_key = ?').get(key) as { id: number } | undefined;
  if (existing) return existing.id;
  const result = db
    .prepare(
      `INSERT INTO companies(name, name_key, website, logo_path, tagline, about, size_bucket, industry, links, sponsors_h1b,
         headquarters, founded_year, stage, funding, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Austin, TX, USA', 2010, 'Series B', '$50M', ?, ?)`,
    )
    .run(
      input.name,
      key,
      `https://${key}.example.com`,
      input.logoPath ?? null,
      input.tagline ?? `${input.name} builds things`,
      input.about ?? `About ${input.name}.`,
      input.sizeBucket ?? null,
      input.industry ?? null,
      JSON.stringify(input.links ?? []),
      input.sponsorsH1b ?? null,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
  return Number(result.lastInsertRowid);
}

interface JobInput {
  title: string;
  company?: string | CompanyInput;
  location?: string;
  description?: string;
  type?: 'internship' | 'full_time' | 'part_time' | 'contract' | null;
  arrangement?: 'remote' | 'hybrid' | 'onsite' | null;
  levels?: string[];
  leadership?: 'ic' | 'manager' | null;
  category?: string | null;
  subcategories?: string[];
  salary?: { min: number | null; max: number | null; currency: string; period: 'year' | 'month' | 'week' | 'day' | 'hour' };
  h1b?: number | null;
  clearance?: number | null;
  industry?: string | null;
  degree?: string | null;
  postedAt?: string | null;
  updatedAt?: string | null;
  firstSeenAt?: string;
  active?: boolean;
  applyUrl?: string;
  analysisId?: number | null;
}

let jobCounter = 0;

function insertJob(db: Db, input: JobInput): number {
  jobCounter += 1;
  const company = typeof input.company === 'object' ? input.company : { name: input.company ?? 'Acme Robotics' };
  const companyId = insertCompany(db, company);
  const html = input.description ?? `<p>${input.title} at ${company.name}.</p>`;
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const places = parseLocations(input.location ?? '');
  const annual = input.salary ? toAnnualUsd(input.salary.min, input.salary.max, input.salary.currency, input.salary.period) : null;
  const firstSeen = input.firstSeenAt ?? '2026-09-01T00:00:00.000Z';
  const result = db
    .prepare(
      `INSERT INTO jobs(company_id, title, description_html, description_text, apply_url, link_key, content_hash,
         employment_type, work_arrangement, experience_levels, leadership, category_id, subcategory_ids,
         salary_min, salary_max, salary_currency, salary_period, salary_annual_usd_min, salary_annual_usd_max,
         sponsors_h1b, requires_clearance, degree, industry, locations_text, primary_location, location_count,
         posted_at, source_updated_at, last_verified_at, first_seen_at, last_seen_at, active, analysis_id, created_at, updated_at)
       VALUES (@companyId, @title, @html, @text, @applyUrl, @linkKey, @hash, @type, @arrangement, @levels, @leadership,
         @category, @subcategories, @salaryMin, @salaryMax, @currency, @period, @annualMin, @annualMax, @h1b, @clearance,
         @degree, @industry, @locationsText, @primary, @locationCount, @postedAt, @updatedAt, @firstSeen, @firstSeen,
         @firstSeen, @active, @analysisId, @firstSeen, @firstSeen)`,
    )
    .run({
      companyId,
      title: input.title,
      html,
      text,
      applyUrl: input.applyUrl ?? `https://jobs.example.com/${jobCounter}`,
      linkKey: `jobs.example.com/${jobCounter}`,
      hash: createHash('sha256').update(`${jobCounter}:${text}`).digest('hex'),
      type: input.type === undefined ? 'full_time' : input.type,
      arrangement: input.arrangement ?? null,
      levels: JSON.stringify(input.levels ?? []),
      leadership: input.leadership ?? null,
      category: input.category ?? null,
      subcategories: JSON.stringify(input.subcategories ?? []),
      salaryMin: input.salary?.min ?? null,
      salaryMax: input.salary?.max ?? null,
      currency: input.salary?.currency ?? null,
      period: input.salary?.period ?? null,
      annualMin: annual?.min ?? null,
      annualMax: annual?.max ?? null,
      h1b: input.h1b ?? null,
      clearance: input.clearance ?? null,
      degree: input.degree ?? null,
      industry: input.industry ?? null,
      locationsText: input.location ?? '',
      primary: places[0] ? formatLocation(places[0]) : '',
      locationCount: places.length,
      postedAt: input.postedAt === undefined ? firstSeen : input.postedAt,
      updatedAt: input.updatedAt ?? null,
      firstSeen,
      active: input.active === false ? 0 : 1,
      analysisId: input.analysisId ?? null,
    });
  const jobId = Number(result.lastInsertRowid);
  places.forEach((place, position) => {
    db.prepare(
      'INSERT INTO job_locations(job_id, position, raw, city, region, country_code, is_remote) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(jobId, position, place.raw, place.city, place.region, place.countryCode, place.isRemote ? 1 : 0);
  });
  db.prepare('INSERT INTO jobs_fts(rowid, title, company_name, locations_text, description_text) VALUES (?, ?, ?, ?, ?)').run(
    jobId,
    input.title,
    company.name,
    input.location ?? '',
    text,
  );
  return jobId;
}

/** A tracker application with its status events (as work package T writes them). */
function insertApplication(db: Db, userId: string, jobId: number, status: 1 | 2 | 11 | 23, appliedOn = '2026-10-20'): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO applications(id, user_id, job_id, title, company_name, employment_type, current_status, tracked_on, created_at, updated_at)
     VALUES (?, ?, ?, 'Tracked job', 'Acme', 'full_time', ?, '2026-10-19', '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z')`,
  ).run(id, userId, jobId, status);
  const event = db.prepare('INSERT INTO application_status_events(application_id, status, occurred_on, created_at) VALUES (?, ?, ?, ?)');
  event.run(id, 1, '2026-10-19', '2026-10-19T00:00:00.000Z');
  if (status >= 2) event.run(id, 2, appliedOn, '2026-10-20T00:00:00.000Z');
  if (status > 2) event.run(id, status, '2026-10-21', '2026-10-21T00:00:00.000Z');
  return id;
}

function insertResume(db: Db, userId: string, text: string): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO resumes(id, user_id, kind, title, extracted_text, created_at, updated_at)
     VALUES (?, ?, 'uploaded', 'My resume', ?, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
  ).run(id, userId, text);
  return id;
}

function setPreferredLevels(db: Db, userId: string, levels: string[]): void {
  db.prepare(
    `INSERT INTO user_preferences(user_id, experience_levels, updated_at) VALUES (?, ?, '2026-10-01T00:00:00.000Z')
     ON CONFLICT(user_id) DO UPDATE SET experience_levels = excluded.experience_levels`,
  ).run(userId, JSON.stringify(levels));
}

const ids = (body: { items: Array<{ id: number }> }) => body.items.map((item) => item.id);

// --------------------------------------------------------------------------------------------------- set-up

let ctx: TestContext;
let me: SignedIn;

beforeEach(async () => {
  ctx = createTestContext();
  // Tests see the jobs feature on its own: no J1 analysis service (a stub is installed where a test needs one).
  delete ctx.deps.services.jobAnalysis;
  me = await signIn(ctx, 'seeker@example.com');
});

afterEach(() => {
  ctx.cleanup();
});

const get = (path: string) => me.agent.get(path);

// ------------------------------------------------------------------------------------------------- the list

describe('GET /api/jobs', () => {
  it('needs a signed-in account', async () => {
    const res = await request(ctx.app).get('/api/jobs');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('not_signed_in');
  });

  it('lists active jobs newest first with "Found N" and the card fields', async () => {
    const db = ctx.deps.db;
    const older = insertJob(db, {
      title: 'Platform Engineer',
      company: { name: 'Northwind', logoPath: 'https://logos.example.com/northwind.png' },
      location: 'Fremont, CA; Austin, TX',
      arrangement: 'onsite',
      levels: ['senior'],
      salary: { min: 120000, max: 150000, currency: 'USD', period: 'year' },
      postedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-18T00:00:00.000Z',
    });
    const newer = insertJob(db, { title: 'Data Analyst', company: { name: 'Contoso', logoPath: 'C:/logos/contoso.png' }, postedAt: '2026-10-20T00:00:00.000Z' });
    insertJob(db, { title: 'Closed Role', postedAt: '2026-10-21T00:00:00.000Z', active: false });

    const res = await get('/api/jobs');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.nextCursor).toBeUndefined();
    expect(ids(res.body)).toEqual([newer, older]);
    for (const item of res.body.items) expect(JobSummarySchema.safeParse(item).success).toBe(true);

    const card = res.body.items[1];
    expect(card).toMatchObject({
      title: 'Platform Engineer',
      company: { name: 'Northwind', logoUrl: 'https://logos.example.com/northwind.png' },
      primaryLocation: 'Fremont, CA, USA',
      locationCount: 2,
      workArrangement: 'onsite',
      employmentType: 'full_time',
      experienceLevels: ['senior'],
      salary: { min: 120000, max: 150000, currency: 'USD', period: 'year' },
      postedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-18T00:00:00.000Z',
      active: true,
      saved: false,
      appliedOn: null,
      applicationId: null,
    });
    // A server file path is no URL: the page shows the company's letter.
    expect(res.body.items[0].company.logoUrl).toBeNull();
  });

  it('pages 21 at a time with a keyset cursor, no repeats or gaps, for every sort', async () => {
    const db = ctx.deps.db;
    const all: number[] = [];
    for (let index = 0; index < 50; index += 1) {
      all.push(
        insertJob(db, {
          title: `Engineer ${index}`,
          // Several jobs share a date and a salary, so ties are broken by id.
          postedAt: `2026-10-${String(1 + (index % 9)).padStart(2, '0')}T00:00:00.000Z`,
          updatedAt: index % 4 === 0 ? null : `2026-10-${String(10 + (index % 7)).padStart(2, '0')}T00:00:00.000Z`,
          salary: index % 5 === 0 ? undefined : { min: 50000, max: 100000 + (index % 6) * 10000, currency: 'USD', period: 'year' },
        }),
      );
    }
    for (const sort of ['relevant', 'posted', 'updated', 'salary']) {
      const seen: number[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const res = await get(`/api/jobs?sort=${sort}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(50);
        expect(res.body.items.length).toBeLessThanOrEqual(JOBS_PAGE_SIZE);
        seen.push(...ids(res.body));
        cursor = res.body.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);
      expect(pages).toBe(3);
      expect(new Set(seen).size).toBe(50);
      expect([...seen].sort((a, b) => a - b)).toEqual([...all].sort((a, b) => a - b));
    }
  });

  it('sorts by posting date, update date and highest salary (no salary last)', async () => {
    const db = ctx.deps.db;
    const a = insertJob(db, { title: 'A', postedAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z', salary: { min: 90000, max: 100000, currency: 'USD', period: 'year' } });
    const b = insertJob(db, { title: 'B', postedAt: '2026-10-10T00:00:00.000Z', updatedAt: null });
    const c = insertJob(db, { title: 'C', postedAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z', salary: { min: 60, max: 80, currency: 'USD', period: 'hour' } });
    const d = insertJob(db, { title: 'D', postedAt: null, firstSeenAt: '2026-10-08T00:00:00.000Z', salary: { min: 100000, max: 120000, currency: 'GBP', period: 'year' } });

    expect(ids((await get('/api/jobs?sort=posted')).body)).toEqual([b, d, a, c]);
    expect(ids((await get('/api/jobs?sort=updated')).body)).toEqual([a, c, b, d]);
    // $80/hr = $166,400/yr; £120k ≈ $152,400; $100k; none.
    expect(ids((await get('/api/jobs?sort=salary')).body)).toEqual([c, d, a, b]);
    // Without a search, "Most relevant" is the newest first.
    expect(ids((await get('/api/jobs')).body)).toEqual([b, d, a, c]);
  });

  it('searches title, company and location (words as prefixes), not the description', async () => {
    const db = ctx.deps.db;
    const title = insertJob(db, { title: 'Senior Data Engineer', company: 'Globex', location: 'Austin, TX' });
    const company = insertJob(db, { title: 'Analyst', company: 'Data Engineering Partners', location: 'Boston, MA' });
    const place = insertJob(db, { title: 'Site Lead', company: 'Initech', location: 'Montréal, QC' });
    insertJob(db, { title: 'Recruiter', company: 'Hooli', description: '<p>We hire data engineers.</p>' });

    expect(ids((await get('/api/jobs?q=data%20eng')).body).sort()).toEqual([title, company].sort());
    expect(ids((await get('/api/jobs?q=globex')).body)).toEqual([title]);
    // Every word of 3+ letters is a prefix.
    expect(ids((await get('/api/jobs?q=sen%20eng')).body)).toEqual([title]);
    // Accents fold, prefix of the last word.
    expect(ids((await get('/api/jobs?q=montre')).body)).toEqual([place]);
    expect((await get('/api/jobs?q=engineers')).body.total).toBe(0);
    // Most relevant: a title match outranks a company-name match.
    expect(ids((await get('/api/jobs?q=data%20engineer')).body)).toEqual([title, company]);
  });

  it('treats operators, quotes and punctuation in the search as plain words', async () => {
    const db = ctx.deps.db;
    const job = insertJob(db, { title: 'C++ Developer (Node.js)', company: 'Umbrella' });
    for (const q of ['"', 'NOT', 'title:developer', '(AND OR NEAR', '*', 'c++ node.js', "dev' OR 1=1 --", '{title} : x']) {
      const res = await get(`/api/jobs?q=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(200);
    }
    expect(ids((await get(`/api/jobs?q=${encodeURIComponent('c++ node.js')}`)).body)).toEqual([job]);
    expect(ids((await get(`/api/jobs?q=${encodeURIComponent('+++ ***')}`)).body)).toEqual([job]);
  });

  it('filters by job type, level, category/subcategory, leadership and arrangement', async () => {
    const db = ctx.deps.db;
    const intern = insertJob(db, { title: 'Intern', type: 'internship', levels: ['entry'], arrangement: 'onsite', leadership: 'ic' });
    const sre = insertJob(db, {
      title: 'SRE',
      levels: ['mid', 'senior'],
      category: 'devops-infrastructure',
      subcategories: ['site-reliability-engineering'],
      arrangement: 'remote',
      leadership: 'ic',
    });
    const manager = insertJob(db, { title: 'Manager', type: 'contract', levels: ['expert'], category: 'engineering-management', leadership: 'manager', arrangement: 'hybrid' });
    const frontend = insertJob(db, { title: 'Frontend', category: 'software-engineering', subcategories: ['frontend'], arrangement: 'hybrid' });

    const list = async (qs: string) => ids((await get(`/api/jobs?${qs}`)).body).sort((x, y) => x - y);
    expect(await list('type=internship&type=contract')).toEqual([intern, manager].sort((x, y) => x - y));
    expect(await list('level=senior')).toEqual([sre]);
    expect(await list('level=entry&level=expert')).toEqual([intern, manager].sort((x, y) => x - y));
    expect(await list('category=engineering-management')).toEqual([manager]);
    // A subcategory alone, and OR between categories and subcategories.
    expect(await list('subcategory=site-reliability-engineering')).toEqual([sre]);
    expect(await list('category=engineering-management&subcategory=frontend')).toEqual([manager, frontend].sort((x, y) => x - y));
    expect(await list('leadership=manager')).toEqual([manager]);
    expect(await list('arrangement=hybrid')).toEqual([manager, frontend].sort((x, y) => x - y));
    // Filters AND together; unknown values are ignored.
    expect(await list('arrangement=hybrid&type=contract&level=bogus')).toEqual([manager]);
  });

  it('filters by place (city, state, country), free text and "Remote in" a country', async () => {
    const db = ctx.deps.db;
    const fremont = insertJob(db, { title: 'Fremont', location: 'Fremont, CA, USA', arrangement: 'onsite' });
    const austin = insertJob(db, { title: 'Austin', location: 'Austin, TX', arrangement: 'hybrid' });
    const london = insertJob(db, { title: 'London', location: 'London, UK' });
    const remoteUs = insertJob(db, { title: 'Remote US', location: 'Remote - US', arrangement: 'remote' });
    const remoteCa = insertJob(db, { title: 'Remote Canada', location: 'Remote in Canada', arrangement: 'remote' });
    const sfRemote = insertJob(db, { title: 'SF remote', location: 'San Francisco, CA', arrangement: 'remote' });
    const nowhere = insertJob(db, { title: 'Moon base', location: 'Tranquility Base' });

    const list = async (qs: string) => ids((await get(`/api/jobs?${qs}`)).body).sort((x, y) => x - y);
    const sorted = (...values: number[]) => values.sort((x, y) => x - y);
    expect(await list('location=California')).toEqual(sorted(fremont, sfRemote));
    expect(await list(`location=${encodeURIComponent('Fremont, CA, USA')}`)).toEqual([fremont]);
    expect(await list('location=Austin')).toEqual([austin]);
    expect(await list('location=UK')).toEqual([london]);
    expect(await list(`location=${encodeURIComponent('Tranquility')}`)).toEqual([nowhere]);
    expect(await list('remote=US')).toEqual(sorted(remoteUs, sfRemote));
    expect(await list('remote=CA')).toEqual([remoteCa]);
    expect(await list(`location=${encodeURIComponent('Remote in USA')}`)).toEqual(sorted(remoteUs, sfRemote));
    // Places and "Remote in" are one OR group.
    expect(await list(`location=Austin&remote=CA`)).toEqual(sorted(austin, remoteCa));
  });

  it('filters by minimum salary in the chosen pay period, H1B, industry, company size, company and clearance', async () => {
    const db = ctx.deps.db;
    const rich = insertJob(db, {
      title: 'Rich',
      company: { name: 'Big Co', sizeBucket: '10001+', industry: 'finance', sponsorsH1b: 1 },
      salary: { min: 150000, max: 200000, currency: 'USD', period: 'year' },
      clearance: 1,
    });
    const hourly = insertJob(db, {
      title: 'Hourly',
      company: { name: 'Small Co', sizeBucket: '11-50', industry: 'technology', sponsorsH1b: 0 },
      salary: { min: 40, max: 60, currency: 'USD', period: 'hour' },
      h1b: 1,
      industry: 'healthcare',
      clearance: 0,
    });
    const unknown = insertJob(db, { title: 'Unknown', company: { name: 'Mystery Co' } });

    const list = async (qs: string) => ids((await get(`/api/jobs?${qs}`)).body).sort((x, y) => x - y);
    const sorted = (...values: number[]) => values.sort((x, y) => x - y);
    // $60/hr = $124,800/yr.
    expect(await list('minSalary=120000')).toEqual(sorted(rich, hourly));
    expect(await list('minSalary=130000')).toEqual([rich]);
    expect(await list('minSalary=55&period=hour')).toEqual(sorted(rich, hourly));
    expect(await list('minSalary=70&period=hour')).toEqual([rich]);
    // The job's own H1B flag wins over the company's.
    expect(await list('h1b=1')).toEqual(sorted(rich, hourly));
    // The job's own industry wins; no industry at all is "not specified".
    expect(await list('industry=healthcare')).toEqual([hourly]);
    expect(await list('industry=finance&industry=not_specified')).toEqual(sorted(rich, unknown));
    expect(await list('size=11-50')).toEqual([hourly]);
    const companyId = (db.prepare('SELECT company_id FROM jobs WHERE id = ?').get(unknown) as { company_id: number }).company_id;
    expect(await list(`company=${companyId}`)).toEqual([unknown]);
    expect(await list('clearance=required')).toEqual([rich]);
    expect(await list('clearance=not_required')).toEqual(sorted(hourly, unknown));
  });

  it('filters by "Last updated" within 1, 7 or 30 days', async () => {
    const db = ctx.deps.db;
    // Frozen now: 2026-10-22T12:00Z.
    const today = insertJob(db, { title: 'Today', postedAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-10-22T08:00:00.000Z' });
    const week = insertJob(db, { title: 'Week', postedAt: '2026-10-18T00:00:00.000Z' });
    insertJob(db, { title: 'Old', postedAt: '2026-08-01T00:00:00.000Z' });
    const list = async (qs: string) => ids((await get(`/api/jobs?${qs}`)).body).sort((x, y) => x - y);
    expect(await list('updated=1')).toEqual([today]);
    expect(await list('updated=7')).toEqual([today, week].sort((x, y) => x - y));
    expect((await get('/api/jobs?updated=30')).body.total).toBe(2);
  });

  it('hides applied jobs on request, and never shows hidden jobs or companies', async () => {
    const db = ctx.deps.db;
    const saved = insertJob(db, { title: 'Saved one' });
    const applied = insertJob(db, { title: 'Applied one' });
    const interviewing = insertJob(db, { title: 'Interviewing one' });
    const hidden = insertJob(db, { title: 'Hidden one' });
    const hiddenCompany = insertJob(db, { title: 'Hidden company job', company: 'Spam Corp' });
    const plain = insertJob(db, { title: 'Plain' });
    insertApplication(db, me.account.id, saved, 1);
    insertApplication(db, me.account.id, applied, 2, '2026-10-20');
    insertApplication(db, me.account.id, interviewing, 11);
    // Another account's application and hidden state change nothing for this one.
    const other = await signIn(ctx, 'other@example.com');
    insertApplication(db, other.account.id, plain, 2);

    expect((await me.agent.post(`/api/jobs/${hidden}/hide`).set('Origin', ORIGIN)).body).toEqual({ hidden: true });
    const companyId = (db.prepare('SELECT company_id FROM jobs WHERE id = ?').get(hiddenCompany) as { company_id: number }).company_id;
    expect((await me.agent.post(`/api/companies/${companyId}/hide`).set('Origin', ORIGIN)).body).toEqual({ hidden: true });

    const all = await get('/api/jobs');
    expect(all.body.total).toBe(4);
    expect(ids(all.body).sort((x, y) => x - y)).toEqual([saved, applied, interviewing, plain].sort((x, y) => x - y));
    const byId = new Map(all.body.items.map((item: { id: number }) => [item.id, item]));
    expect(byId.get(saved)).toMatchObject({ saved: true, appliedOn: null });
    expect(byId.get(applied)).toMatchObject({ saved: false, appliedOn: '2026-10-20' });
    expect(byId.get(interviewing)).toMatchObject({ saved: false, appliedOn: '2026-10-20' });
    expect(byId.get(plain)).toMatchObject({ saved: false, appliedOn: null, applicationId: null });

    const withoutApplied = await get('/api/jobs?hideApplied=1');
    expect(ids(withoutApplied.body).sort((x, y) => x - y)).toEqual([saved, plain].sort((x, y) => x - y));

    // The other account still sees everything.
    expect((await other.agent.get('/api/jobs')).body.total).toBe(6);
    expect((await other.agent.get('/api/jobs?hideApplied=true')).body.total).toBe(5);

    // Unhiding brings them back.
    await me.agent.delete(`/api/jobs/${hidden}/hide`).set('Origin', ORIGIN).expect(200);
    await me.agent.delete(`/api/companies/${companyId}/hide`).set('Origin', ORIGIN).expect(200);
    expect((await get('/api/jobs')).body.total).toBe(6);
  });

  it('counts with every filter (GET /api/jobs/count)', async () => {
    const db = ctx.deps.db;
    insertJob(db, { title: 'Backend Engineer', type: 'full_time' });
    insertJob(db, { title: 'Backend Intern', type: 'internship' });
    insertJob(db, { title: 'Designer', type: 'full_time' });
    expect((await get('/api/jobs/count?q=backend')).body).toEqual({ total: 2 });
    expect((await get('/api/jobs/count?q=backend&type=internship')).body).toEqual({ total: 1 });
    expect((await get('/api/jobs/count')).body).toEqual({ total: 3 });
  });

  it('starts over when the cursor is unreadable or from another sort', async () => {
    const db = ctx.deps.db;
    for (let index = 0; index < 25; index += 1) insertJob(db, { title: `Job ${index}`, postedAt: `2026-10-01T00:00:${String(index).padStart(2, '0')}.000Z` });
    const first = await get('/api/jobs?sort=posted');
    const cursor = first.body.nextCursor as string;
    expect(cursor).toBeTruthy();
    const second = await get(`/api/jobs?sort=posted&cursor=${encodeURIComponent(cursor)}`);
    expect(second.body.items).toHaveLength(4);
    // The same cursor under another sort, or garbage: page one again.
    expect(ids((await get(`/api/jobs?sort=salary&cursor=${encodeURIComponent(cursor)}`)).body)).toHaveLength(21);
    expect(ids((await get('/api/jobs?sort=posted&cursor=bm90LWEtY3Vyc29y')).body)).toEqual(ids(first.body));
  });
});

// ------------------------------------------------------------------------------------------------ the detail

describe('GET /api/jobs/:id', () => {
  it('answers the detail with company, places, sanitized HTML and the viewer state', async () => {
    const db = ctx.deps.db;
    const id = insertJob(db, {
      title: 'Lead SRE',
      company: {
        name: 'Voltaic',
        tagline: 'Electric vehicles',
        about: 'We build cars.',
        sizeBucket: '10001+',
        industry: 'manufacturing',
        sponsorsH1b: 1,
        links: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/company/voltaic' }, 'https://x.com/voltaic', 'javascript:alert(1)'],
      },
      location: 'Fremont, CA; Remote - US',
      arrangement: 'onsite',
      levels: ['senior'],
      category: 'devops-infrastructure',
      subcategories: ['site-reliability-engineering'],
      degree: "Bachelor's degree",
      description:
        '<h3>Requirements</h3><ul><li>Kubernetes</li></ul><script>alert(1)</script><p onclick="x()">Hi <a href="javascript:alert(1)">bad</a> <a href="https://example.com">ok</a></p><img src="x.png">',
      applyUrl: 'https://careers.example.com/lead-sre',
    });
    const res = await get(`/api/jobs/${id}`);
    expect(res.status).toBe(200);
    expect(JobDetailSchema.safeParse(res.body).success).toBe(true);
    const detail = res.body;
    expect(detail).toMatchObject({
      id,
      title: 'Lead SRE',
      primaryLocation: 'Fremont, CA, USA',
      locationCount: 2,
      categoryId: 'devops-infrastructure',
      subcategoryIds: ['site-reliability-engineering'],
      degree: "Bachelor's degree",
      sponsorsH1b: true,
      industry: 'manufacturing',
      applyUrl: 'https://careers.example.com/lead-sre',
      userState: { saved: false, applicationId: null, appliedOn: null, hidden: false, companyHidden: false },
    });
    expect(detail.company).toMatchObject({
      name: 'Voltaic',
      tagline: 'Electric vehicles',
      about: 'We build cars.',
      sizeBucket: '10001+',
      sponsorsH1b: true,
      foundedYear: 2010,
      headquarters: 'Austin, TX, USA',
      jobCount: 1,
    });
    expect(detail.company.links).toEqual([
      { label: 'LinkedIn', url: 'https://www.linkedin.com/company/voltaic' },
      { label: 'X', url: 'https://x.com/voltaic' },
    ]);
    expect(detail.locations).toEqual([
      { raw: 'Fremont, CA', city: 'Fremont', region: 'CA', countryCode: 'US', isRemote: false },
      { raw: 'Remote - US', city: null, region: null, countryCode: 'US', isRemote: true },
    ]);
    expect(detail.descriptionHtml).toContain('<h3>Requirements</h3>');
    expect(detail.descriptionHtml).not.toMatch(/script|onclick|javascript:|<img/i);
    expect(detail.descriptionHtml).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">ok</a>');
  });

  it('shows saved, applied and hidden state, and records the first view', async () => {
    const db = ctx.deps.db;
    const id = insertJob(db, { title: 'Watched', company: 'Hidden Inc' });
    const applicationId = insertApplication(db, me.account.id, id, 2, '2026-10-21');
    await me.agent.post(`/api/jobs/${id}/hide`).set('Origin', ORIGIN).expect(200);
    const companyId = (db.prepare('SELECT company_id FROM jobs WHERE id = ?').get(id) as { company_id: number }).company_id;
    await me.agent.post(`/api/companies/${companyId}/hide`).set('Origin', ORIGIN).expect(200);

    const res = await get(`/api/jobs/${id}`);
    expect(res.body.userState).toEqual({ saved: false, applicationId, appliedOn: '2026-10-21', hidden: true, companyHidden: true });
    const views = () =>
      db.prepare('SELECT view_count FROM jobs WHERE id = ?').get(id) as { view_count: number };
    expect(views().view_count).toBe(1);
    const state = db.prepare('SELECT viewed_at FROM user_job_state WHERE user_id = ? AND job_id = ?').get(me.account.id, id) as {
      viewed_at: string;
    };
    expect(state.viewed_at).toBe('2026-10-22T12:00:00.000Z');
    await get(`/api/jobs/${id}`);
    expect(views().view_count).toBe(1);

    // Still Saved: saved is true and there is no applied date.
    const other = insertJob(db, { title: 'Bookmarked' });
    insertApplication(db, me.account.id, other, 1);
    expect((await get(`/api/jobs/${other}`)).body.userState).toMatchObject({ saved: true, appliedOn: null });
  });

  it('opens inactive jobs, and 404s unknown or malformed ids', async () => {
    const db = ctx.deps.db;
    const closed = insertJob(db, { title: 'Closed', active: false });
    const res = await get(`/api/jobs/${closed}`);
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
    expect((await get('/api/jobs/999999')).status).toBe(404);
    expect((await get('/api/jobs/abc')).status).toBe(404);
    expect((await get('/api/jobs/-1/analysis')).status).toBe(404);
  });
});

// --------------------------------------------------------------------------------------------- the analysis

describe('GET /api/jobs/:id/analysis', () => {
  const posting =
    '<h3>What you will do</h3><ul><li>Run Kubernetes clusters.</li><li>Automate with Terraform.</li></ul>' +
    '<p><strong>Requirements</strong></p><ul><li>5+ years with Kubernetes and Docker.</li><li>Strong Python.</li></ul>' +
    '<h3>Nice to have</h3><ul><li>Experience with Kafka.</li></ul><h3>Benefits</h3><ul><li>Free lunch.</li></ul>';

  it('without the analysis service, computes a deterministic one from the posting', async () => {
    const id = insertJob(ctx.deps.db, { title: 'Platform Engineer', description: posting, levels: ['senior'], category: 'devops-infrastructure' });
    const res = await get(`/api/jobs/${id}/analysis`);
    expect(res.status).toBe(200);
    expect(JobAnalysisViewSchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({
      source: 'deterministic',
      refining: false,
      responsibilities: ['Run Kubernetes clusters.', 'Automate with Terraform.'],
      requirements: ['5+ years with Kubernetes and Docker.', 'Strong Python.'],
      desired: ['Experience with Kafka.'],
      experienceLevels: ['senior'],
      categoryId: 'devops-infrastructure',
    });
    const terms = [...res.body.keywords.high, ...res.body.keywords.low].map((group: { term: string }) => group.term);
    expect(terms).toEqual(expect.arrayContaining(['Kubernetes', 'Docker', 'Python', 'Terraform', 'Kafka']));
    // Named in the requirements: high priority.
    expect(res.body.keywords.high.map((group: { term: string }) => group.term)).toEqual(expect.arrayContaining(['Kubernetes', 'Docker', 'Python']));
  });

  it('uses the analysis stored on the job when there is one', async () => {
    const db = ctx.deps.db;
    const analysisId = Number(
      db
        .prepare(
          `INSERT INTO job_analyses(content_hash, source, version, requirements, responsibilities, desired, keywords, experience_levels, category_id, subcategory_ids, created_at)
           VALUES ('h', 'ft_lake', 1, '["Know Rust"]', '[]', '[]', '{"high":[{"term":"Rust","synonyms":[]}],"low":[]}', '["mid"]', 'software-engineering', '["backend"]', '2026-10-01T00:00:00.000Z')`,
        )
        .run().lastInsertRowid,
    );
    const id = insertJob(db, { title: 'Rust Engineer', description: posting, analysisId });
    const res = await get(`/api/jobs/${id}/analysis`);
    expect(res.body).toMatchObject({
      source: 'ft_lake',
      requirements: ['Know Rust'],
      keywords: { high: [{ term: 'Rust', synonyms: [] }], low: [] },
      experienceLevels: ['mid'],
      categoryId: 'software-engineering',
      subcategoryIds: ['backend'],
    });
  });

  it("asks J1's service (queueing the AI analysis) and passes on its refining flag; falls back when it fails", async () => {
    const id = insertJob(ctx.deps.db, { title: 'Platform Engineer', description: posting });
    const calls: Array<{ jobId: number; interactive?: boolean; requestedBy?: string; via: string }> = [];
    const view: JobAnalysisView = {
      source: 'ai',
      refining: false,
      requirements: ['From the AI'],
      responsibilities: [],
      desired: [],
      keywords: { high: [{ term: 'Kubernetes', synonyms: ['k8s'] }], low: [{ term: 'Haskell', synonyms: [] }] },
      experienceLevels: ['senior'],
      categoryId: null,
      subcategoryIds: [],
    };
    ctx.deps.services.jobAnalysis = {
      ensure: (jobId, options) => {
        calls.push({ jobId, interactive: options?.interactive, requestedBy: options?.requestedBy, via: 'ensure' });
        return { analysis: view, refining: true };
      },
      get: (jobId) => {
        calls.push({ jobId, via: 'get' });
        return { analysis: view, refining: false };
      },
    };
    const res = await get(`/api/jobs/${id}/analysis`);
    expect(res.body).toMatchObject({ source: 'ai', refining: true, requirements: ['From the AI'] });
    // A view queues on the background slot, against the viewer's hourly budget of new AI analyses.
    expect(calls).toEqual([{ jobId: id, interactive: false, requestedBy: me.account.id, via: 'ensure' }]);

    // The match reads the current analysis without queueing anything.
    insertResume(ctx.deps.db, me.account.id, 'I run k8s in production.');
    const match = await get(`/api/jobs/${id}/match`);
    expect(match.body).toMatchObject({ matchedCount: 1, total: 2, matched: [{ term: 'Kubernetes', priority: 'high' }] });
    expect(calls.at(-1)).toEqual({ jobId: id, via: 'get' });

    ctx.deps.services.jobAnalysis = {
      ensure: () => {
        throw new Error('boom');
      },
      get: () => null,
    };
    const fallback = await get(`/api/jobs/${id}/analysis`);
    expect(fallback.status).toBe(200);
    expect(fallback.body.source).toBe('deterministic');
  });
});

// ------------------------------------------------------------------------------------------------- the match

describe('GET /api/jobs/:id/match', () => {
  const description =
    '<h3>Requirements</h3><ul><li>Kubernetes and Docker in production.</li><li>Python or Go.</li></ul><p>We use Terraform.</p>';

  it('says no_resume (every keyword missing) until the account has a resume', async () => {
    const id = insertJob(ctx.deps.db, { title: 'Platform Engineer', description, levels: ['senior'] });
    const res = await get(`/api/jobs/${id}/match`);
    expect(res.status).toBe(200);
    expect(MatchResultSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.state).toBe('no_resume');
    expect(res.body.matchedCount).toBe(0);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.missing.length).toBe(res.body.total);
    expect(res.body.levelMatch).toEqual({ state: 'none', jobLabels: ['Senior'], preferredLabels: [], matchingLabels: [], lines: [] });
  });

  it("scores the default resume's text against the job keywords (matched first, high before low)", async () => {
    const db = ctx.deps.db;
    const id = insertJob(db, { title: 'Platform Engineer', description, levels: ['senior'] });
    const older = insertResume(db, me.account.id, 'Nothing relevant here.');
    const best = insertResume(db, me.account.id, 'Shipped Kubernetes platforms and wrote Python tooling. Some Terraform.');
    db.prepare('UPDATE users SET default_resume_id = ? WHERE id = ?').run(best, me.account.id);
    const res = await get(`/api/jobs/${id}/match`);
    expect(res.body.state).toBe('ok');
    expect(res.body.resumeId).toBe(best);
    expect(res.body.resumeId).not.toBe(older);
    const matched = res.body.matched.map((keyword: { term: string }) => keyword.term);
    const missing = res.body.missing.map((keyword: { term: string }) => keyword.term);
    expect(matched).toEqual(expect.arrayContaining(['Kubernetes', 'Python', 'Terraform']));
    expect(missing).toEqual(expect.arrayContaining(['Docker']));
    expect(res.body.matchedCount).toBe(matched.length);
    expect(res.body.total).toBe(matched.length + missing.length);
    expect(res.body.percentage).toBe(Math.round((matched.length / res.body.total) * 100));
  });

  it("checks the job's levels against the levels the account prefers", async () => {
    const db = ctx.deps.db;
    const senior = insertJob(db, { title: 'Senior Engineer', levels: ['senior'] });
    const junior = insertJob(db, { title: 'Junior Engineer', levels: ['entry', 'junior'] });
    const none = insertJob(db, { title: 'Engineer' });
    setPreferredLevels(db, me.account.id, ['mid', 'senior']);

    const match = (await get(`/api/jobs/${senior}/match`)).body.levelMatch;
    expect(match).toEqual({
      state: 'match',
      jobLabels: ['Senior'],
      preferredLabels: ['Mid', 'Senior'],
      matchingLabels: ['Senior'],
      lines: ['Your experience level matches one of the following: Senior'],
    });
    const mismatch = (await get(`/api/jobs/${junior}/match`)).body.levelMatch;
    expect(mismatch.state).toBe('mismatch');
    expect(mismatch.lines).toEqual([
      'This job asks for: Entry, Junior',
      "You're looking for: Mid, Senior",
      'You can still be a good fit — employers often consider adjacent experience levels.',
    ]);
    expect((await get(`/api/jobs/${none}/match`)).body.levelMatch.state).toBe('none');
  });
});

// ------------------------------------------------------------------------------------- hide, report, guards

describe('hide and report', () => {
  it('hides and unhides a job and a company (404 for unknown ones)', async () => {
    const db = ctx.deps.db;
    const id = insertJob(db, { title: 'Job' });
    expect((await me.agent.post(`/api/jobs/${id}/hide`).set('Origin', ORIGIN)).body).toEqual({ hidden: true });
    expect((await me.agent.post(`/api/jobs/${id}/hide`).set('Origin', ORIGIN)).body).toEqual({ hidden: true });
    expect((await me.agent.delete(`/api/jobs/${id}/hide`).set('Origin', ORIGIN)).body).toEqual({ hidden: false });
    expect((await me.agent.post('/api/jobs/424242/hide').set('Origin', ORIGIN)).status).toBe(404);
    expect((await me.agent.post('/api/companies/424242/hide').set('Origin', ORIGIN)).status).toBe(404);
    expect((await me.agent.post('/api/companies/abc/hide').set('Origin', ORIGIN)).status).toBe(404);
  });

  it('refuses mutations from another origin', async () => {
    const id = insertJob(ctx.deps.db, { title: 'Job' });
    const res = await me.agent.post(`/api/jobs/${id}/hide`).set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('bad_origin');
  });

  it('files a report for the admin console, updating an open one instead of piling up', async () => {
    const db = ctx.deps.db;
    const id = insertJob(db, { title: 'Spam' });
    const first = await me.agent.post(`/api/jobs/${id}/report`).set('Origin', ORIGIN).send({ reason: 'spam', details: '  Looks fake  ' });
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ id: expect.any(Number), status: 'open' });
    const second = await me.agent.post(`/api/jobs/${id}/report`).set('Origin', ORIGIN).send({ reason: 'inactive' });
    expect(second.body.id).toBe(first.body.id);
    const rows = db.prepare('SELECT user_id, job_id, reason, details, status FROM job_reports').all();
    expect(rows).toEqual([{ user_id: me.account.id, job_id: id, reason: 'inactive', details: '', status: 'open' }]);

    const bad = await me.agent.post(`/api/jobs/${id}/report`).set('Origin', ORIGIN).send({ reason: 'boring' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_failed');
    expect((await me.agent.post('/api/jobs/999/report').set('Origin', ORIGIN).send({ reason: 'spam' })).status).toBe(404);
  });
});

// --------------------------------------------------------------------------------------------------- facets

describe('GET /api/jobs/facets', () => {
  beforeEach(() => {
    const db = ctx.deps.db;
    insertJob(db, { title: 'SRE 1', category: 'devops-infrastructure', subcategories: ['site-reliability-engineering'], location: 'Fremont, CA', company: { name: 'Voltaic', industry: 'manufacturing', sizeBucket: '10001+' } });
    insertJob(db, { title: 'SRE 2', category: 'devops-infrastructure', subcategories: ['site-reliability-engineering', 'observability'], location: 'Austin, TX', company: { name: 'Voltaic' } });
    insertJob(db, { title: 'Frontend', category: 'software-engineering', subcategories: ['frontend'], location: 'Remote - US', arrangement: 'remote', company: { name: 'Quill', sizeBucket: '51-200' }, salary: { min: 1, max: 2, currency: 'USD', period: 'year' }, leadership: 'ic' });
    insertJob(db, { title: 'Closed', category: 'design', location: 'Paris, France', active: false });
  });

  it('counts categories and subcategories (with their parent) over active jobs', async () => {
    const categories = await get('/api/jobs/facets/categories');
    expect(JobFacetResponseSchema.safeParse(categories.body).success).toBe(true);
    expect(categories.body.items).toEqual([
      { value: 'devops-infrastructure', label: 'DevOps & Infrastructure', count: 2 },
      { value: 'software-engineering', label: 'Software Engineering', count: 1 },
    ]);
    const subcategories = await get('/api/jobs/facets/subcategories?q=site');
    expect(subcategories.body.items).toEqual([
      { value: 'site-reliability-engineering', label: 'Site Reliability Engineering', count: 2, parent: 'devops-infrastructure' },
    ]);
  });

  it('suggests places (city, state, country) and remote countries', async () => {
    const places = await get('/api/jobs/facets/locations?q=ca');
    const labels = places.body.items.map((item: { label: string }) => item.label);
    expect(labels).toEqual(expect.arrayContaining(['Fremont, CA, USA', 'California']));
    expect(labels).not.toContain('Paris, France');
    const usa = (await get('/api/jobs/facets/locations?q=usa')).body.items.find((item: { label: string }) => item.label === 'USA');
    expect(usa).toEqual({ value: 'USA', label: 'USA', count: 3 });
    expect((await get('/api/jobs/facets/remoteCountries')).body.items).toEqual([{ value: 'US', label: 'Remote in USA', count: 1 }]);
  });

  it('lists companies (searchable), industries and company sizes', async () => {
    const companies = await get('/api/jobs/facets/companies?q=volt');
    expect(companies.body.items).toEqual([{ value: expect.stringMatching(/^\d+$/), label: 'Voltaic', count: 2 }]);
    const industries = await get('/api/jobs/facets/industries');
    expect(industries.body.items).toEqual(
      expect.arrayContaining([
        { value: 'manufacturing', label: 'Manufacturing', count: 2 },
        { value: 'not_specified', label: 'Not specified', count: 1 },
      ]),
    );
    expect((await get('/api/jobs/facets/companySizes')).body.items).toEqual([
      { value: '51-200', label: '51-200', count: 1 },
      { value: '10001+', label: '10,001+', count: 2 },
    ]);
    expect((await get('/api/jobs/facets/bogus')).status).toBe(404);
  });

  it('summarizes which filters the data can answer', async () => {
    const res = await get('/api/jobs/facets/summary');
    expect(JobFacetsSummarySchema.safeParse(res.body).success).toBe(true);
    expect(res.body.total).toBe(3);
    expect(res.body.available).toEqual({
      salary: true,
      h1b: false,
      clearance: false,
      leadership: true,
      industries: true,
      companySizes: true,
      arrangements: true,
      levels: false,
    });
    expect(res.body.categories).toHaveLength(2);
    expect(res.body.remoteCountries).toEqual([{ value: 'US', label: 'Remote in USA', count: 1 }]);
  });
});

// ------------------------------------------------------------------------------------------- saved searches

describe('/api/saved-searches', () => {
  it('saves a normalized query without its cursor, lists, renames and deletes', async () => {
    const created = await me.agent
      .post('/api/saved-searches')
      .set('Origin', ORIGIN)
      .send({
        name: '  Remote SRE  ',
        query: { q: ' sre ', jobTypes: ['full_time', 'full_time', 'bogus'], remote: 'us', sort: 'posted', cursor: 'abc', minSalary: 0 },
      });
    expect(created.status).toBe(201);
    expect(SavedSearchSchema.safeParse(created.body).success).toBe(true);
    expect(created.body).toMatchObject({ name: 'Remote SRE', createdAt: '2026-10-22T12:00:00.000Z' });
    expect(created.body.query).toMatchObject({ q: 'sre', jobTypes: ['full_time'], remote: 'US', sort: 'posted' });
    expect(created.body.query.cursor).toBeUndefined();
    expect(created.body.query.minSalary).toBeUndefined();

    const list = await get('/api/saved-searches');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].id).toBe(created.body.id);

    const renamed = await me.agent.patch(`/api/saved-searches/${created.body.id}`).set('Origin', ORIGIN).send({ name: 'SRE jobs' });
    expect(renamed.body.name).toBe('SRE jobs');

    // Another account can neither see nor delete it.
    const other = await signIn(ctx, 'other@example.com');
    expect((await other.agent.get('/api/saved-searches')).body.items).toEqual([]);
    expect((await other.agent.delete(`/api/saved-searches/${created.body.id}`).set('Origin', ORIGIN)).status).toBe(404);

    expect((await me.agent.delete(`/api/saved-searches/${created.body.id}`).set('Origin', ORIGIN)).status).toBe(204);
    expect((await get('/api/saved-searches')).body.items).toEqual([]);
    expect((await me.agent.delete(`/api/saved-searches/${created.body.id}`).set('Origin', ORIGIN)).status).toBe(404);
  });

  it('requires a name and caps the number of saved searches', async () => {
    const blank = await me.agent.post('/api/saved-searches').set('Origin', ORIGIN).send({ name: '   ', query: {} });
    expect(blank.status).toBe(400);
    expect(blank.body.error.fields.name).toBe('Give the search a name');
    for (let index = 0; index < 50; index += 1) {
      await me.agent.post('/api/saved-searches').set('Origin', ORIGIN).send({ name: `Search ${index}`, query: { q: `q${index}` } }).expect(201);
    }
    const over = await me.agent.post('/api/saved-searches').set('Origin', ORIGIN).send({ name: 'One more', query: {} });
    expect(over.status).toBe(409);
  });
});
