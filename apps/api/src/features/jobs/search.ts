import { JOBS_PAGE_SIZE, STATUS, annualize, parseLocations, type JobsQuery } from '@tailorit/shared';
import type { Db } from '../../core/db/connection';
import { decodeCursor, encodeCursor, type OrderMode } from './cursor';
import { BM25_WEIGHTS, buildFtsQuery } from './fts';
import { APPLICATION_JOIN, SUMMARY_COLUMNS, toListItem, type JobListItem, type SummaryRow } from './rows';

// GET /api/jobs: the Jobs page's list. One SQL query per page (keyset-paginated, 21 rows) plus one COUNT for "Found N
// jobs". Every value reaches SQLite as a bound parameter; only fixed SQL fragments are concatenated.

/** "Recently posted": the posting's own date, else when TailorIT first saw it. */
export const POSTED_SQL = 'COALESCE(j.posted_at, j.first_seen_at)';
/** "Recently updated" and the "Last updated" filter: the board's update time, else the posting date. */
export const UPDATED_SQL = 'COALESCE(j.source_updated_at, j.posted_at, j.first_seen_at)';
/** "Highest salary": yearly USD (the top of the range, else its bottom); no salary sorts last. */
export const SALARY_SQL = 'COALESCE(j.salary_annual_usd_max, j.salary_annual_usd_min, -1)';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Named parameters for one statement: `add` returns the placeholder of a new value. */
class Params {
  readonly values: Record<string, string | number | null> = {};
  private count = 0;

  constructor(initial: Record<string, string | number | null> = {}) {
    Object.assign(this.values, initial);
  }

  add(value: string | number | null): string {
    const name = `p${this.count++}`;
    this.values[name] = value;
    return `@${name}`;
  }

  list(values: readonly (string | number)[]): string {
    return values.map((value) => this.add(value)).join(', ');
  }
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Remote work, optionally limited to a country: a remote place in it, or a remote posting that names it. */
function remoteSql(countryCode: string | null, params: Params): string {
  const country = countryCode ? ` AND jl.country_code = ${params.add(countryCode)}` : '';
  const anyCountry = countryCode ? '' : ` OR j.work_arrangement = 'remote'`;
  return `(EXISTS (SELECT 1 FROM job_locations jl WHERE jl.job_id = j.id
             AND (jl.is_remote = 1 OR j.work_arrangement = 'remote')${country})${anyCountry})`;
}

/** One place of the Location filter ("Fremont, CA, USA", "California", "Canada", "Remote in USA", free text). */
function placeSql(text: string, params: Params): string | null {
  const parsed = parseLocations(text)[0];
  if (!parsed) return null;
  if (parsed.isRemote) return remoteSql(parsed.countryCode, params);
  const parts: string[] = [];
  if (parsed.city) parts.push(`jl.city = ${params.add(parsed.city)} COLLATE NOCASE`);
  if (parsed.region) parts.push(`jl.region = ${params.add(parsed.region)} COLLATE NOCASE`);
  if (parsed.countryCode) parts.push(`jl.country_code = ${params.add(parsed.countryCode)}`);
  const asWritten = `j.locations_text LIKE ${params.add(`%${escapeLike(text.trim())}%`)} ESCAPE '\\'`;
  if (parts.length === 0) return asWritten;
  const place = `EXISTS (SELECT 1 FROM job_locations jl WHERE jl.job_id = j.id AND ${parts.join(' AND ')})`;
  // A name the parser could not place (no region or country) may be part of a longer place: "Tranquility Base".
  return parsed.region || parsed.countryCode ? place : `(${place} OR ${asWritten})`;
}

export interface SearchScope {
  userId: string;
  now: Date;
}

/**
 * The WHERE conditions of a query (jobs `j`, companies `c`). Always: active jobs only, never one the viewer hid or
 * from a company they hid. Lists within one filter are OR, filters are AND; the Location filter's places and its
 * "Remote in" country are one OR group.
 */
export function filterConditions(query: JobsQuery, scope: SearchScope, params: Params): string[] {
  const where = [
    'j.active = 1',
    `NOT EXISTS (SELECT 1 FROM user_job_state s WHERE s.user_id = @userId AND s.job_id = j.id AND s.hidden_at IS NOT NULL)`,
    `NOT EXISTS (SELECT 1 FROM user_hidden_companies h WHERE h.user_id = @userId AND h.company_id = j.company_id)`,
  ];

  const places = query.locations.map((text) => placeSql(text, params)).filter((sql): sql is string => sql !== null);
  if (query.remote) places.push(remoteSql(query.remote, params));
  if (places.length > 0) where.push(`(${places.join(' OR ')})`);

  if (query.jobTypes.length > 0) where.push(`j.employment_type IN (${params.list(query.jobTypes)})`);
  if (query.levels.length > 0) {
    where.push(`EXISTS (SELECT 1 FROM json_each(j.experience_levels) lv WHERE lv.value IN (${params.list(query.levels)}))`);
  }
  const categoryParts: string[] = [];
  if (query.categories.length > 0) categoryParts.push(`j.category_id IN (${params.list(query.categories)})`);
  if (query.subcategories.length > 0) {
    categoryParts.push(
      `EXISTS (SELECT 1 FROM json_each(j.subcategory_ids) sc WHERE sc.value IN (${params.list(query.subcategories)}))`,
    );
  }
  if (categoryParts.length > 0) where.push(`(${categoryParts.join(' OR ')})`);
  if (query.leadership.length > 0) where.push(`j.leadership IN (${params.list(query.leadership)})`);
  if (query.arrangements.length > 0) where.push(`j.work_arrangement IN (${params.list(query.arrangements)})`);

  if (query.minSalary) {
    // The slider's amount is per `payPeriod` (yearly by default) in US dollars; jobs carry yearly USD.
    const yearly = Math.round(annualize(query.minSalary, query.payPeriod ?? 'year'));
    where.push(`COALESCE(j.salary_annual_usd_max, j.salary_annual_usd_min) >= ${params.add(yearly)}`);
  }
  if (query.h1b) where.push('(j.sponsors_h1b = 1 OR (j.sponsors_h1b IS NULL AND c.sponsors_h1b = 1))');
  if (query.industries.length > 0) {
    where.push(`COALESCE(NULLIF(j.industry, ''), NULLIF(c.industry, ''), 'not_specified') IN (${params.list(query.industries)})`);
  }
  if (query.companySizes.length > 0) where.push(`c.size_bucket IN (${params.list(query.companySizes)})`);
  if (query.companies.length > 0) where.push(`j.company_id IN (${params.list(query.companies.map(Number))})`);
  if (query.clearance === 'required') where.push('j.requires_clearance = 1');
  if (query.clearance === 'not_required') where.push('COALESCE(j.requires_clearance, 0) = 0');
  if (query.hideApplied) {
    where.push(`NOT EXISTS (SELECT 1 FROM applications ap WHERE ap.user_id = @userId AND ap.job_id = j.id
      AND (ap.current_status >= ${STATUS.applied}
        OR EXISTS (SELECT 1 FROM application_status_events ev WHERE ev.application_id = ap.id AND ev.status >= ${STATUS.applied})))`);
  }
  if (query.updatedWithin) {
    const since = new Date(scope.now.getTime() - query.updatedWithin * DAY_MS).toISOString();
    where.push(`${UPDATED_SQL} >= ${params.add(since)}`);
  }
  return where;
}

/** How "Most relevant" and the other sorts order rows, and which expression is the keyset key. */
function ordering(query: JobsQuery, hasSearch: boolean): { mode: OrderMode; key: string; direction: 'ASC' | 'DESC' } {
  switch (query.sort) {
    case 'posted':
      return { mode: 'posted', key: POSTED_SQL, direction: 'DESC' };
    case 'updated':
      return { mode: 'updated', key: UPDATED_SQL, direction: 'DESC' };
    case 'salary':
      return { mode: 'salary', key: SALARY_SQL, direction: 'DESC' };
    default:
      // bm25 is lower for a better match; without a search, the newest postings come first.
      return hasSearch ? { mode: 'rank', key: 'f.rank', direction: 'ASC' } : { mode: 'posted', key: POSTED_SQL, direction: 'DESC' };
  }
}

const FTS_JOIN = `JOIN (SELECT rowid AS job_id, bm25(jobs_fts, ${BM25_WEIGHTS.join(', ')}) AS rank
                       FROM jobs_fts WHERE jobs_fts MATCH @fts) f ON f.job_id = j.id`;

export interface JobsPage {
  items: JobListItem[];
  total: number;
  nextCursor?: string;
}

/** True when SQLite refused the MATCH expression (it should never happen: the query is built from tokens). */
function isFtsSyntaxError(error: unknown): boolean {
  return error instanceof Error && /fts5|syntax error|unterminated|no such column/i.test(error.message);
}

/** One page of the list for `query` as `scope.userId` sees it. */
export function searchJobs(db: Db, query: JobsQuery, scope: SearchScope): JobsPage {
  const fts = buildFtsQuery(query.q);
  const params = new Params({ userId: scope.userId, ...(fts ? { fts } : {}) });
  const where = filterConditions(query, scope, params);
  const from = `jobs j JOIN companies c ON c.id = j.company_id ${fts ? FTS_JOIN : ''}`;
  const order = ordering(query, fts !== null);

  const countParams = { ...params.values };
  const cursor = decodeCursor(query.cursor, order.mode);
  const pageWhere = [...where];
  if (cursor) {
    const key = params.add(cursor.key);
    const id = params.add(cursor.id);
    const beyond = order.direction === 'ASC' ? '>' : '<';
    pageWhere.push(`(${order.key} ${beyond} ${key} OR (${order.key} = ${key} AND j.id < ${id}))`);
  }
  const limit = params.add(JOBS_PAGE_SIZE + 1);

  const pageSql = `
    WITH page AS (
      SELECT j.id AS id, ${order.key} AS sort_key
      FROM ${from}
      WHERE ${pageWhere.join('\n        AND ')}
      ORDER BY sort_key ${order.direction}, j.id DESC
      LIMIT ${limit}
    )
    SELECT ${SUMMARY_COLUMNS}, page.sort_key AS sort_key
    FROM page
    JOIN jobs j ON j.id = page.id
    JOIN companies c ON c.id = j.company_id
    ${APPLICATION_JOIN}
    ORDER BY page.sort_key ${order.direction}, j.id DESC`;
  const countSql = `SELECT COUNT(*) AS total FROM ${from} WHERE ${where.join('\n AND ')}`;

  let rows: Array<SummaryRow & { sort_key: string | number }>;
  let total: number;
  try {
    rows = db.prepare(pageSql).all(params.values) as Array<SummaryRow & { sort_key: string | number }>;
    total = (db.prepare(countSql).get(countParams) as { total: number }).total;
  } catch (error) {
    if (fts && isFtsSyntaxError(error)) return { items: [], total: 0 };
    throw error;
  }

  const hasMore = rows.length > JOBS_PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, JOBS_PAGE_SIZE) : rows;
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map(toListItem),
    total,
    ...(hasMore && last ? { nextCursor: encodeCursor({ mode: order.mode, key: last.sort_key, id: last.id }) } : {}),
  };
}

/** "Found N jobs" alone (the All filters dialog's "Show N jobs" button). */
export function countJobs(db: Db, query: JobsQuery, scope: SearchScope): number {
  const fts = buildFtsQuery(query.q);
  const params = new Params({ userId: scope.userId, ...(fts ? { fts } : {}) });
  const where = filterConditions(query, scope, params);
  const sql = `SELECT COUNT(*) AS total FROM jobs j JOIN companies c ON c.id = j.company_id ${fts ? FTS_JOIN : ''}
               WHERE ${where.join(' AND ')}`;
  try {
    return (db.prepare(sql).get(params.values) as { total: number }).total;
  } catch (error) {
    if (fts && isFtsSyntaxError(error)) return 0;
    throw error;
  }
}
