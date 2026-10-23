import { EXPERIENCE_LEVELS, type ExperienceLevel, type JobReportBody } from '@tailorit/shared';
import { nowIso, type AppDeps } from '../../core/context';
import { transaction } from '../../core/db/connection';
import { notFound } from '../../core/http/errors';
import { APPLICATION_JOIN, DETAIL_COLUMNS, jsonStrings, type DetailRow, type LocationRow } from './rows';

// Reads and writes of the viewer's relation to jobs: the detail row, hidden jobs and companies, views, reports.
// Every write is scoped by user id; another account's state is never read or changed.

/** The job's detail row as `userId` sees it, or 404. */
export function loadDetailRow(deps: Pick<AppDeps, 'db'>, userId: string, jobId: number): DetailRow {
  const row = deps.db
    .prepare(
      `SELECT ${DETAIL_COLUMNS}
       FROM jobs j JOIN companies c ON c.id = j.company_id ${APPLICATION_JOIN}
       WHERE j.id = @jobId`,
    )
    .get({ userId, jobId }) as DetailRow | undefined;
  if (!row) throw notFound('That job');
  return row;
}

export function loadLocations(deps: Pick<AppDeps, 'db'>, jobId: number): LocationRow[] {
  return deps.db
    .prepare('SELECT raw, city, region, country_code, is_remote FROM job_locations WHERE job_id = ? ORDER BY position')
    .all(jobId) as LocationRow[];
}

/** The job's id and company, or 404. */
export function requireJob(deps: Pick<AppDeps, 'db'>, jobId: number): { id: number; company_id: number; experience_levels: string } {
  const row = deps.db.prepare('SELECT id, company_id, experience_levels FROM jobs WHERE id = ?').get(jobId) as
    | { id: number; company_id: number; experience_levels: string }
    | undefined;
  if (!row) throw notFound('That job');
  return row;
}

export function requireCompany(deps: Pick<AppDeps, 'db'>, companyId: number): void {
  const row = deps.db.prepare('SELECT id FROM companies WHERE id = ?').get(companyId);
  if (!row) throw notFound('That company');
}

export function hiddenState(
  deps: Pick<AppDeps, 'db'>,
  userId: string,
  jobId: number,
  companyId: number,
): { hidden: boolean; companyHidden: boolean } {
  const job = deps.db
    .prepare('SELECT hidden_at FROM user_job_state WHERE user_id = ? AND job_id = ?')
    .get(userId, jobId) as { hidden_at: string | null } | undefined;
  const company = deps.db
    .prepare('SELECT 1 AS hidden FROM user_hidden_companies WHERE user_id = ? AND company_id = ?')
    .get(userId, companyId);
  return { hidden: Boolean(job?.hidden_at), companyHidden: Boolean(company) };
}

/** Records that the viewer opened the job; its view count goes up on their first view only. */
export function markViewed(deps: AppDeps, userId: string, jobId: number): void {
  const now = nowIso(deps);
  transaction(deps.db, () => {
    const seen = deps.db
      .prepare('SELECT viewed_at FROM user_job_state WHERE user_id = ? AND job_id = ?')
      .get(userId, jobId) as { viewed_at: string | null } | undefined;
    deps.db
      .prepare(
        `INSERT INTO user_job_state(user_id, job_id, viewed_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id, job_id) DO UPDATE SET viewed_at = excluded.viewed_at`,
      )
      .run(userId, jobId, now);
    if (!seen?.viewed_at) deps.db.prepare('UPDATE jobs SET view_count = view_count + 1 WHERE id = ?').run(jobId);
  });
}

export function setJobHidden(deps: AppDeps, userId: string, jobId: number, hidden: boolean): void {
  if (hidden) {
    deps.db
      .prepare(
        `INSERT INTO user_job_state(user_id, job_id, hidden_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id, job_id) DO UPDATE SET hidden_at = COALESCE(user_job_state.hidden_at, excluded.hidden_at)`,
      )
      .run(userId, jobId, nowIso(deps));
  } else {
    deps.db.prepare('UPDATE user_job_state SET hidden_at = NULL WHERE user_id = ? AND job_id = ?').run(userId, jobId);
  }
}

export function setCompanyHidden(deps: AppDeps, userId: string, companyId: number, hidden: boolean): void {
  if (hidden) {
    deps.db
      .prepare('INSERT OR IGNORE INTO user_hidden_companies(user_id, company_id, created_at) VALUES (?, ?, ?)')
      .run(userId, companyId, nowIso(deps));
  } else {
    deps.db.prepare('DELETE FROM user_hidden_companies WHERE user_id = ? AND company_id = ?').run(userId, companyId);
  }
}

export interface ReportResult {
  id: number;
  status: 'open';
}

/**
 * Files the viewer's report on a job for the admin console. A second report while the first is still open replaces
 * its reason and details instead of adding another.
 */
export function reportJob(deps: AppDeps, userId: string, jobId: number, body: JobReportBody): ReportResult {
  const now = nowIso(deps);
  return transaction(deps.db, () => {
    const open = deps.db
      .prepare("SELECT id FROM job_reports WHERE user_id = ? AND job_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1")
      .get(userId, jobId) as { id: number } | undefined;
    if (open) {
      deps.db
        .prepare('UPDATE job_reports SET reason = ?, details = ?, created_at = ? WHERE id = ?')
        .run(body.reason, body.details, now, open.id);
      return { id: open.id, status: 'open' as const };
    }
    const result = deps.db
      .prepare('INSERT INTO job_reports(user_id, job_id, reason, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, jobId, body.reason, body.details, 'open', now);
    return { id: Number(result.lastInsertRowid), status: 'open' as const };
  });
}

/** The experience levels the viewer is looking for (Settings), for the facts grid's level check. */
export function preferredLevels(deps: Pick<AppDeps, 'db'>, userId: string): ExperienceLevel[] {
  const row = deps.db.prepare('SELECT experience_levels FROM user_preferences WHERE user_id = ?').get(userId) as
    | { experience_levels: string }
    | undefined;
  const set = new Set(jsonStrings(row?.experience_levels));
  return EXPERIENCE_LEVELS.filter((level) => set.has(level));
}
