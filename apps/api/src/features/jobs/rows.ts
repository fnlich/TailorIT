import {
  COMPANY_SIZE_IDS,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  LEADERSHIP,
  SALARY_PERIODS,
  WORK_ARRANGEMENTS,
  formatLocation,
  type CompanyDetail,
  type CompanySizeId,
  type EmploymentType,
  type ExperienceLevel,
  type JobDetail,
  type JobLocation,
  type JobSummary,
  type JobUserState,
  type Leadership,
  type Salary,
  type SalaryPeriod,
  type WorkArrangement,
  STATUS,
} from '@tailorit/shared';

// Rows of the jobs tables and their DTOs. Columns other packages write (ingestion) are read defensively: a value
// outside an enum reads as null, unreadable JSON as empty, and dates are normalized to ISO timestamps.

/** One card of GET /api/jobs, plus the tracker application it belongs to (needed to un-save from the list). */
export type JobListItem = JobSummary & { applicationId: string | null };

/** The columns every job read selects (jobs `j`, companies `c`, the viewer's application `a`). */
export const SUMMARY_COLUMNS = `
  j.id, j.title, j.company_id, c.name AS company_name, c.logo_path AS company_logo_path,
  j.primary_location, j.location_count, j.work_arrangement, j.employment_type, j.experience_levels,
  j.salary_min, j.salary_max, j.salary_currency, j.salary_period,
  j.posted_at, j.first_seen_at, j.source_updated_at, j.active,
  a.id AS application_id, a.current_status AS application_status,
  ${appliedOnSql('a')} AS applied_on`;

/**
 * The viewer's application for the job (at most one: applications(user_id, job_id) is unique). Bind `@userId`.
 */
export const APPLICATION_JOIN = 'LEFT JOIN applications a ON a.user_id = @userId AND a.job_id = j.id';

/**
 * The day an application reached Applied: its Applied event, else its earliest later event, else the tracked day,
 * and null while it is only Saved.
 */
export function appliedOnSql(alias: string): string {
  return `CASE WHEN ${alias}.current_status >= ${STATUS.applied} THEN COALESCE(
    (SELECT e.occurred_on FROM application_status_events e WHERE e.application_id = ${alias}.id AND e.status = ${STATUS.applied}),
    (SELECT MIN(e.occurred_on) FROM application_status_events e WHERE e.application_id = ${alias}.id AND e.status > ${STATUS.applied}),
    ${alias}.tracked_on) END`;
}

export interface SummaryRow {
  id: number;
  title: string;
  company_id: number;
  company_name: string;
  company_logo_path: string | null;
  primary_location: string;
  location_count: number;
  work_arrangement: string | null;
  employment_type: string | null;
  experience_levels: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  posted_at: string | null;
  first_seen_at: string;
  source_updated_at: string | null;
  active: number;
  application_id: string | null;
  application_status: number | null;
  applied_on: string | null;
}

export interface DetailRow extends SummaryRow {
  description_html: string;
  description_text: string;
  apply_url: string;
  content_hash: string;
  leadership: string | null;
  category_id: string | null;
  subcategory_ids: string;
  degree: string | null;
  sponsors_h1b: number | null;
  requires_clearance: number | null;
  industry: string | null;
  last_verified_at: string | null;
  closed_at: string | null;
  analysis_id: number | null;
  c_tagline: string | null;
  c_website: string | null;
  c_about: string | null;
  c_size_bucket: string | null;
  c_stage: string | null;
  c_funding: string | null;
  c_headquarters: string | null;
  c_founded_year: number | null;
  c_industry: string | null;
  c_links: string | null;
  c_sponsors_h1b: number | null;
  c_job_count: number;
}

export const DETAIL_COLUMNS = `${SUMMARY_COLUMNS},
  j.description_html, j.description_text, j.apply_url, j.content_hash, j.leadership, j.category_id, j.subcategory_ids,
  j.degree, j.sponsors_h1b, j.requires_clearance, j.industry, j.last_verified_at, j.closed_at, j.analysis_id,
  c.tagline AS c_tagline, c.website AS c_website, c.about AS c_about, c.size_bucket AS c_size_bucket, c.stage AS c_stage,
  c.funding AS c_funding, c.headquarters AS c_headquarters, c.founded_year AS c_founded_year, c.industry AS c_industry,
  c.links AS c_links, c.sponsors_h1b AS c_sponsors_h1b,
  (SELECT COUNT(*) FROM jobs cj WHERE cj.company_id = j.company_id AND cj.active = 1) AS c_job_count`;

export interface LocationRow {
  raw: string;
  city: string | null;
  region: string | null;
  country_code: string | null;
  is_remote: number;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : null;
}

/** A stored JSON list of strings ('[]' on anything unreadable). */
export function jsonStrings(text: string | null | undefined): string[] {
  if (!text) return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function experienceLevelsOf(text: string | null | undefined): ExperienceLevel[] {
  const set = new Set(jsonStrings(text));
  return EXPERIENCE_LEVELS.filter((level) => set.has(level));
}

/** A stored time as an ISO-8601 UTC timestamp ("2026-10-22" becomes midnight UTC); null when unreadable. */
export function isoTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00.000Z`;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** A stored day as "YYYY-MM-DD"; null when unreadable. */
export function isoDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const stamp = isoTimestamp(text);
  return stamp ? stamp.slice(0, 10) : null;
}

/**
 * A logo the browser can load as it is: an absolute http(s) URL or a same-origin path. A server file path has no
 * public address, so the page shows the company's letter instead.
 */
export function logoUrlOf(path: string | null | undefined): string | null {
  if (!path) return null;
  const value = path.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  return null;
}

function amount(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function salaryOf(row: Pick<SummaryRow, 'salary_min' | 'salary_max' | 'salary_currency' | 'salary_period'>): Salary | null {
  const min = amount(row.salary_min);
  const max = amount(row.salary_max);
  if (min === null && max === null) return null;
  const currency = row.salary_currency && /^[A-Za-z]{3}$/.test(row.salary_currency) ? row.salary_currency.toUpperCase() : null;
  return { min, max, currency, period: oneOf<SalaryPeriod>(SALARY_PERIODS, row.salary_period) };
}

export function toJobLocation(row: LocationRow): JobLocation {
  return {
    raw: row.raw,
    city: row.city,
    region: row.region,
    countryCode: row.country_code,
    isRemote: row.is_remote === 1,
  };
}

export function toListItem(row: SummaryRow): JobListItem {
  const tracked = row.application_id !== null;
  return {
    id: row.id,
    title: row.title,
    company: { id: row.company_id, name: row.company_name, logoUrl: logoUrlOf(row.company_logo_path) },
    primaryLocation: row.primary_location ?? '',
    locationCount: Math.max(0, row.location_count ?? 0),
    workArrangement: oneOf<WorkArrangement>(WORK_ARRANGEMENTS, row.work_arrangement),
    employmentType: oneOf<EmploymentType>(EMPLOYMENT_TYPES, row.employment_type),
    experienceLevels: experienceLevelsOf(row.experience_levels),
    salary: salaryOf(row),
    postedAt: isoTimestamp(row.posted_at) ?? isoTimestamp(row.first_seen_at),
    updatedAt: isoTimestamp(row.source_updated_at),
    active: row.active === 1,
    saved: tracked && row.application_status === STATUS.saved,
    appliedOn: isoDay(row.applied_on),
    applicationId: row.application_id,
  };
}

export function toSummary(row: SummaryRow): JobSummary {
  const { applicationId: _applicationId, ...summary } = toListItem(row);
  return summary;
}

interface StoredLink {
  label: string;
  url: string;
}

function linkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.endsWith('linkedin.com')) return 'LinkedIn';
    if (host === 'twitter.com' || host === 'x.com') return 'X';
    if (host.endsWith('crunchbase.com')) return 'Crunchbase';
    if (host.endsWith('github.com')) return 'GitHub';
    return host;
  } catch {
    return url;
  }
}

/** companies.links: `[{label, url}]` or plain URL strings; only http(s) URLs are kept. */
export function companyLinksOf(text: string | null | undefined): StoredLink[] {
  if (!text) return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const out: StoredLink[] = [];
  for (const item of value) {
    const url = typeof item === 'string' ? item : item && typeof item === 'object' ? (item as { url?: unknown }).url : null;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) continue;
    const given = item && typeof item === 'object' ? (item as { label?: unknown }).label : null;
    const label = typeof given === 'string' && given.trim() ? given.trim() : linkLabel(url.trim());
    out.push({ label, url: url.trim() });
  }
  return out;
}

function flag(value: number | null | undefined): boolean | null {
  return value === null || value === undefined ? null : value === 1;
}

function webUrl(value: string | null): string | null {
  if (!value || !value.trim()) return null;
  const text = value.trim();
  if (/^https?:\/\//i.test(text)) return text;
  return /^[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(text) ? `https://${text}` : null;
}

export function toCompanyDetail(row: DetailRow): CompanyDetail {
  return {
    id: row.company_id,
    name: row.company_name,
    logoUrl: logoUrlOf(row.company_logo_path),
    tagline: row.c_tagline?.trim() || null,
    website: webUrl(row.c_website),
    jobCount: row.c_job_count,
    about: row.c_about?.trim() || null,
    sizeBucket: oneOf<CompanySizeId>(COMPANY_SIZE_IDS, row.c_size_bucket),
    stage: row.c_stage?.trim() || null,
    funding: row.c_funding?.trim() || null,
    headquarters: row.c_headquarters?.trim() || null,
    foundedYear: typeof row.c_founded_year === 'number' && Number.isInteger(row.c_founded_year) ? row.c_founded_year : null,
    industry: row.c_industry?.trim() || null,
    links: companyLinksOf(row.c_links),
    sponsorsH1b: flag(row.c_sponsors_h1b),
  };
}

export function toJobDetail(
  row: DetailRow,
  locations: readonly LocationRow[],
  descriptionHtml: string,
  state: Pick<JobUserState, 'hidden' | 'companyHidden'>,
): JobDetail {
  const summary = toListItem(row);
  const places = locations.map(toJobLocation);
  const primary = summary.primaryLocation || (places[0] ? formatLocation(places[0]) : '');
  const { applicationId, ...base } = summary;
  return {
    ...base,
    primaryLocation: primary,
    locationCount: Math.max(summary.locationCount, places.length),
    company: toCompanyDetail(row),
    locations: places,
    leadership: oneOf<Leadership>(LEADERSHIP, row.leadership),
    categoryId: row.category_id || null,
    subcategoryIds: jsonStrings(row.subcategory_ids),
    degree: row.degree?.trim() || null,
    sponsorsH1b: flag(row.sponsors_h1b) ?? flag(row.c_sponsors_h1b),
    requiresClearance: flag(row.requires_clearance),
    industry: row.industry || row.c_industry || null,
    descriptionHtml,
    applyUrl: /^https?:\/\//i.test(row.apply_url ?? '') ? row.apply_url : '',
    lastVerifiedAt: isoTimestamp(row.last_verified_at),
    closedAt: isoTimestamp(row.closed_at),
    userState: {
      saved: summary.saved,
      applicationId,
      appliedOn: summary.appliedOn,
      hidden: state.hidden,
      companyHidden: state.companyHidden,
    },
  };
}
