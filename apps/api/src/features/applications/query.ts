import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
  type ApplicationSummary,
  type BoardColumn,
  type EmploymentType,
  type SortOrder,
  type TrackerSort,
} from '@tailorit/shared';
import type { Db } from '../../core/db/connection';
import { validationFailed } from '../../core/http/errors';
import { APPLICATION_COLUMNS, APPLICATION_FROM, loadEventsFor, toSummary, type ApplicationRow } from './store';

// Reads over many applications: the Options-menu filters and search as SQL, the three sorts, and keyset cursors
// (the sort key plus the id) so "Load more" never skips or repeats a card when others move between pages.

export type TabScope = 'active' | 'archived' | 'all';

export interface ApplicationFilter {
  tab: TabScope;
  q?: string;
  statuses?: readonly ApplicationStatus[];
  jobType?: EmploymentType;
  favorites?: boolean;
  /** Applied from / until, inclusive "YYYY-MM-DD". */
  from?: string;
  until?: string;
}

export interface SortSpec {
  sort: TrackerSort;
  order: SortOrder;
}

interface Fragment {
  sql: string;
  params: unknown[];
}

/**
 * The day an application counts as applied for the date filters: its Applied event, else the day it was tracked
 * (a Saved application has not been applied to yet; it is filtered by when it was added).
 */
const APPLIED_ON_SQL =
  '(COALESCE((SELECT e.occurred_on FROM application_status_events e WHERE e.application_id = a.id AND e.status = 2), substr(a.tracked_on, 1, 10)))';

const SORT_KEY_SQL: Record<TrackerSort, string> = {
  // The tracked day, then the moment it was added (several applications share a day).
  tracked: "(substr(a.tracked_on, 1, 10) || '|' || a.created_at)",
  created: 'a.created_at',
  title: 'lower(a.title)',
};

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** The WHERE clause of a filter for one account (table alias `a`). */
export function filterClause(userId: string, filter: ApplicationFilter): Fragment {
  const parts = ['a.user_id = ?'];
  const params: unknown[] = [userId];
  if (filter.tab === 'active') parts.push('a.archived_at IS NULL');
  else if (filter.tab === 'archived') parts.push('a.archived_at IS NOT NULL');

  // Every word must appear in the title, the company or the location.
  const terms = (filter.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 10);
  for (const term of terms) {
    const like = `%${escapeLike(term)}%`;
    parts.push("(a.title LIKE ? ESCAPE '\\' OR a.company_name LIKE ? ESCAPE '\\' OR a.location LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  if (filter.statuses && filter.statuses.length > 0) {
    parts.push(`a.current_status IN (${filter.statuses.map(() => '?').join(', ')})`);
    params.push(...filter.statuses);
  }
  if (filter.jobType) {
    parts.push('a.employment_type = ?');
    params.push(filter.jobType);
  }
  if (filter.favorites) parts.push('a.favorite = 1');
  if (filter.from) {
    parts.push(`${APPLIED_ON_SQL} >= ?`);
    params.push(filter.from);
  }
  if (filter.until) {
    parts.push(`${APPLIED_ON_SQL} <= ?`);
    params.push(filter.until);
  }
  return { sql: parts.join(' AND '), params };
}

interface CursorValue {
  /** The last row's sort key. */
  k: string;
  id: string;
  /** What the page was read under (sort, order, board column): a cursor is only valid for the same read. */
  s: string;
}

const STALE_CURSOR = 'That page of applications is out of date. Reload the tracker and try again.';

export function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string, scope: string): CursorValue {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorValue>;
    if (typeof value.k === 'string' && typeof value.id === 'string' && value.s === scope) {
      return { k: value.k, id: value.id, s: value.s };
    }
  } catch {
    // fall through
  }
  throw validationFailed(STALE_CURSOR);
}

/** The read a cursor belongs to. */
export function cursorScope(spec: SortSpec, column?: ApplicationStatus): string {
  return `${spec.sort}:${spec.order}${column === undefined ? '' : `:${column}`}`;
}

function cursorClause(spec: SortSpec, cursor: string | undefined, scope: string): Fragment | null {
  if (!cursor) return null;
  const { k, id } = decodeCursor(cursor, scope);
  const key = SORT_KEY_SQL[spec.sort];
  const op = spec.order === 'desc' ? '<' : '>';
  return { sql: `(${key} ${op} ? OR (${key} = ? AND a.id ${op} ?))`, params: [k, k, id] };
}

/** The ORDER BY of a sort (table alias `a`), the id breaking ties; the resume ZIP lists applications this way too. */
export function orderClause(spec: SortSpec): string {
  const direction = spec.order === 'desc' ? 'DESC' : 'ASC';
  return `ORDER BY ${SORT_KEY_SQL[spec.sort]} ${direction}, a.id ${direction}`;
}

type SortedRow = ApplicationRow & { sort_key: string };

export interface PageResult {
  items: ApplicationSummary[];
  nextCursor?: string;
}

/** One page of matching applications (events included), with the cursor of the next page when there is one. */
export function pageOfApplications(
  db: Db,
  where: Fragment,
  spec: SortSpec,
  cursor: string | undefined,
  pageSize: number,
  scope: string = cursorScope(spec),
): PageResult {
  // SQLite binds a fractional LIMIT as a type mismatch.
  const limit = Math.max(1, Math.floor(pageSize));
  const after = cursorClause(spec, cursor, scope);
  const rows = db
    .prepare(
      `SELECT ${APPLICATION_COLUMNS}, ${SORT_KEY_SQL[spec.sort]} AS sort_key FROM ${APPLICATION_FROM}
       WHERE ${where.sql}${after ? ` AND ${after.sql}` : ''} ${orderClause(spec)} LIMIT ?`,
    )
    .all(...where.params, ...(after?.params ?? []), limit + 1) as SortedRow[];
  const page = rows.slice(0, limit);
  const events = loadEventsFor(
    db,
    page.map((row) => row.id),
  );
  const last = page[page.length - 1];
  return {
    items: page.map((row) => toSummary(row, events.get(row.id) ?? [])),
    ...(rows.length > limit && last ? { nextCursor: encodeCursor({ k: last.sort_key, id: last.id, s: scope }) } : {}),
  };
}

export function countApplications(db: Db, where: Fragment): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM applications a WHERE ${where.sql}`).get(...where.params) as { n: number };
  return row.n;
}

/** Every matching application row (CSV export, chart), in the given order, without paging. */
export function allApplicationRows(db: Db, where: Fragment, spec: SortSpec): ApplicationRow[] {
  return db
    .prepare(`SELECT ${APPLICATION_COLUMNS} FROM ${APPLICATION_FROM} WHERE ${where.sql} ${orderClause(spec)}`)
    .all(...where.params) as ApplicationRow[];
}

function withStatus(where: Fragment, status: ApplicationStatus): Fragment {
  return { sql: `${where.sql} AND a.current_status = ?`, params: [...where.params, status] };
}

/**
 * The board: one column per status with its total under the filter and its first page (or, with `only`, that one
 * column from `cursor`). A status the filter leaves out is an empty column.
 */
export function boardColumns(
  db: Db,
  userId: string,
  filter: ApplicationFilter,
  spec: SortSpec,
  limit: number,
  only?: { status: ApplicationStatus; cursor?: string },
): BoardColumn[] {
  const where = filterClause(userId, filter);
  const totals = new Map<number, number>();
  const rows = db
    .prepare(`SELECT a.current_status AS status, COUNT(*) AS n FROM applications a WHERE ${where.sql} GROUP BY a.current_status`)
    .all(...where.params) as Array<{ status: number; n: number }>;
  for (const row of rows) totals.set(row.status, row.n);

  const statuses = only ? [only.status] : APPLICATION_STATUSES;
  return statuses.map((status) => {
    const total = totals.get(status) ?? 0;
    if (total === 0) return { status, total, items: [] };
    const page = pageOfApplications(db, withStatus(where, status), spec, only?.cursor, limit, cursorScope(spec, status));
    return { status, total, items: page.items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
  });
}
