import { createHash, randomUUID } from 'node:crypto';
import { formatLocation, parseLocations, toAnnualUsd } from '@tailorit/shared';
import type { Db } from '../src/core/db/connection';

// Rows as ingestion and the tracker write them, inserted directly (jobs with their jobs_fts and job_locations rows):
// companies, jobs, tracker applications with their status events, and uploaded resumes.

export interface CompanyInput {
  name: string;
  tagline?: string;
  about?: string;
  sizeBucket?: string | null;
  industry?: string | null;
  sponsorsH1b?: number | null;
  logoPath?: string | null;
  links?: unknown;
}

export function insertCompany(db: Db, input: CompanyInput): number {
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

export interface JobInput {
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

export function insertJob(db: Db, input: JobInput): number {
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
export function insertApplication(db: Db, userId: string, jobId: number, status: 1 | 2 | 11 | 23, appliedOn = '2026-10-20'): string {
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

export function insertResume(db: Db, userId: string, text: string): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO resumes(id, user_id, kind, title, extracted_text, created_at, updated_at)
     VALUES (?, ?, 'uploaded', 'My resume', ?, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
  ).run(id, userId, text);
  return id;
}
