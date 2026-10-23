import { randomUUID } from 'node:crypto';
import {
  FUTURE_DATE_MESSAGE,
  SALARY_ORDER_MESSAGE,
  SALARY_PERIOD_MESSAGE,
  STATUS,
  applyStatusChange,
  clearEventBlocker,
  currentStatus,
  formatLocationLine,
  initialEvents,
  normalizeCompanyName,
  normalizeUrlInput,
  readImportRow,
  removeStatusEvent,
  setEventDate,
  toIsoDate,
  type ApplicationDetail,
  type ApplicationQuestion,
  type ApplicationStatus,
  type BulkApplicationsBody,
  type CreateApplicationBody,
  type EmploymentType,
  type PatchApplicationBody,
  type StatusChangeResponse,
  type StatusEvent,
  type TrackerImportBody,
  type TrackerImportResponse,
  type TrackerPayPeriod,
} from '@tailorit/shared';
import { nowIso, todayIso, type AppDeps } from '../../core/context';
import { transaction, type Db } from '../../core/db/connection';
import { notFound, validationFailed } from '../../core/http/errors';
import { cleanRichText, textToParagraphs } from './sanitize';
import {
  getDetail,
  loadEvents,
  loadOwnedRow,
  loadQuestionRow,
  loadQuestions,
  toQuestion,
  writeEvents,
  type ApplicationRow,
} from './store';

// What the tracker's endpoints do, one function per operation. Multi-statement writes run in one transaction; the
// status rules are the shared pure functions, and `current_status` is rewritten with every event change.

type Deps = Pick<AppDeps, 'db' | 'now'>;

const JOB_PAY_PERIODS: readonly string[] = ['hour', 'day', 'week', 'month', 'year'];

/**
 * The latest calendar day a person can mean by "today": the date at UTC+14, the furthest-ahead time zone. The
 * browser sends its own local date; the server only refuses days that are in the future everywhere.
 */
export function latestAllowedDate(deps: Pick<AppDeps, 'now'>): string {
  return new Date(deps.now().getTime() + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const INVALID_DATE_MESSAGE = 'Enter a real date (YYYY-MM-DD).';

/** A real calendar day ("2026-02-30" is not) that is not in the future anywhere. */
export function assertValidDate(deps: Pick<AppDeps, 'now'>, date: string, field = 'occurredOn'): void {
  if (toIsoDate(date) !== date) throw validationFailed(INVALID_DATE_MESSAGE, { [field]: INVALID_DATE_MESSAGE });
  if (date > latestAllowedDate(deps)) throw validationFailed(FUTURE_DATE_MESSAGE, { [field]: FUTURE_DATE_MESSAGE });
}

/** The column limit of a rich-text field (the PATCH contract's 200,000 characters). */
const MAX_HTML = 200_000;

/** Clean HTML that fits MAX_HTML (a cut posting is cleaned again, which closes its open tags). */
function clippedRichText(html: string): string {
  const clean = cleanRichText(html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html);
  return clean.length > MAX_HTML ? cleanRichText(clean.slice(0, MAX_HTML - 2_000)) : clean;
}

/** The jobs-table company with this name, so a tracked application shows its logo. */
function companyIdFor(db: Db, name: string): number | null {
  const key = normalizeCompanyName(name);
  if (!key) return null;
  const row = db.prepare('SELECT id FROM companies WHERE name_key = ?').get(key) as { id: number } | undefined;
  return row?.id ?? null;
}

function assertOwnedResume(db: Db, userId: string, resumeId: string): void {
  const row = db.prepare('SELECT 1 FROM resumes WHERE id = ? AND user_id = ?').get(resumeId, userId);
  if (!row) throw notFound('That resume');
}

function assertOwnedLetter(db: Db, userId: string, letterId: string): void {
  const row = db.prepare('SELECT 1 FROM cover_letters WHERE id = ? AND user_id = ?').get(letterId, userId);
  if (!row) throw notFound('That cover letter');
}

interface InsertInput {
  userId: string;
  jobId: number | null;
  companyId: number | null;
  title: string;
  companyName: string;
  location: string;
  employmentType: EmploymentType;
  postingUrl: string;
  descriptionHtml: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: TrackerPayPeriod | null;
  resumeId: string | null;
  notesHtml: string;
  trackedOn: string;
  events: readonly StatusEvent[];
}

function insertApplication(db: Db, input: InsertInput, now: string): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO applications(id, user_id, job_id, company_id, title, company_name, location, employment_type, posting_url,
       description_html, salary_min, salary_max, salary_currency, salary_period, current_status, favorite, archived_at,
       resume_id, cover_letter_id, notes_html, tracked_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, NULL, ?, ?, ?, ?)`,
  ).run(
    id,
    input.userId,
    input.jobId,
    input.companyId,
    input.title,
    input.companyName,
    input.location,
    input.employmentType,
    input.postingUrl,
    input.descriptionHtml,
    input.salaryMin,
    input.salaryMax,
    input.salaryCurrency,
    input.salaryPeriod,
    currentStatus(input.events),
    input.resumeId,
    input.notesHtml,
    input.trackedOn,
    now,
    now,
  );
  const insertEvent = db.prepare(
    'INSERT INTO application_status_events(application_id, status, occurred_on, created_at) VALUES (?, ?, ?, ?)',
  );
  for (const event of input.events) insertEvent.run(id, event.status, event.occurredOn, now);
  return id;
}

interface JobRow {
  id: number;
  title: string;
  description_html: string;
  apply_url: string;
  employment_type: EmploymentType | null;
  work_arrangement: string | null;
  primary_location: string;
  location_count: number;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  company_id: number;
  company_name: string;
}

function loadJob(db: Db, jobId: number): JobRow {
  const job = db
    .prepare(
      `SELECT j.id, j.title, j.description_html, j.apply_url, j.employment_type, j.work_arrangement, j.primary_location,
              j.location_count, j.salary_min, j.salary_max, j.salary_currency, j.salary_period, j.company_id,
              c.name AS company_name
       FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = ?`,
    )
    .get(jobId) as JobRow | undefined;
  if (!job) throw notFound('That job');
  return job;
}

function jobLocation(job: JobRow): string {
  const line = formatLocationLine(job.primary_location, job.location_count, null);
  if (line) return line;
  return job.work_arrangement === 'remote' ? 'Remote' : '';
}

export interface CreateResult {
  detail: ApplicationDetail;
  created: boolean;
}

/**
 * POST /api/applications. With `jobId` the application is the account's one for that job: created from the posting
 * (title, company, location, job type, link, pay, description) the first time; afterwards the existing one is
 * returned, restored if archived, and moved up to `status` when that is further along.
 */
export function createApplication(deps: Deps, userId: string, body: CreateApplicationBody): CreateResult {
  const { db } = deps;
  const now = nowIso(deps);
  const date = body.occurredOn ?? todayIso(deps);
  assertValidDate(deps, date);
  const status: ApplicationStatus = body.status ?? STATUS.applied;
  const resumeId = body.resumeId || null;
  if (resumeId) assertOwnedResume(db, userId, resumeId);

  return transaction(db, () => {
    if (body.jobId !== undefined) {
      const job = loadJob(db, body.jobId);
      const existing = db
        .prepare('SELECT id, current_status, archived_at FROM applications WHERE user_id = ? AND job_id = ?')
        .get(userId, job.id) as Pick<ApplicationRow, 'id' | 'current_status' | 'archived_at'> | undefined;
      if (existing) {
        if (body.status !== undefined && body.status > existing.current_status) {
          const before = loadEvents(db, existing.id);
          writeEvents(db, userId, existing.id, before, applyStatusChange(before, body.status, date), now);
        }
        if (existing.archived_at) {
          db.prepare('UPDATE applications SET archived_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?').run(
            now,
            existing.id,
            userId,
          );
        }
        return { detail: getDetail(db, userId, existing.id), created: false };
      }
      const period = job.salary_period && JOB_PAY_PERIODS.includes(job.salary_period) ? (job.salary_period as TrackerPayPeriod) : null;
      const hasPay = job.salary_min !== null || job.salary_max !== null;
      const id = insertApplication(
        db,
        {
          userId,
          jobId: job.id,
          companyId: job.company_id,
          title: body.title || job.title,
          companyName: body.companyName || job.company_name,
          location: body.location ?? jobLocation(job),
          employmentType: body.employmentType ?? job.employment_type ?? 'full_time',
          postingUrl: body.postingUrl ?? normalizeUrlInput(job.apply_url) ?? '',
          descriptionHtml: clippedRichText(job.description_html),
          salaryMin: job.salary_min,
          salaryMax: job.salary_max,
          salaryCurrency: hasPay ? (job.salary_currency ?? 'USD') : job.salary_currency,
          salaryPeriod: hasPay ? (period ?? 'year') : period,
          resumeId,
          notesHtml: '',
          trackedOn: date,
          events: initialEvents(status, date),
        },
        now,
      );
      return { detail: getDetail(db, userId, id), created: true };
    }

    const title = body.title ?? '';
    const companyName = body.companyName ?? '';
    const id = insertApplication(
      db,
      {
        userId,
        jobId: null,
        companyId: companyIdFor(db, companyName),
        title,
        companyName,
        location: body.location ?? '',
        employmentType: body.employmentType ?? 'full_time',
        postingUrl: body.postingUrl ?? '',
        descriptionHtml: '',
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        resumeId,
        notesHtml: '',
        trackedOn: date,
        events: initialEvents(status, date),
      },
      now,
    );
    return { detail: getDetail(db, userId, id), created: true };
  });
}

/** PATCH /api/applications/:id: the given fields; the pay is checked as it will be stored. */
export function patchApplication(deps: Deps, userId: string, id: string, body: PatchApplicationBody): ApplicationDetail {
  const { db } = deps;
  const row = loadOwnedRow(db, userId, id);
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };

  if (body.title !== undefined) set('title', body.title);
  if (body.companyName !== undefined) {
    set('company_name', body.companyName);
    if (body.companyName !== row.company_name) set('company_id', companyIdFor(db, body.companyName));
  }
  if (body.location !== undefined) set('location', body.location);
  if (body.employmentType !== undefined) set('employment_type', body.employmentType);
  if (body.postingUrl !== undefined) set('posting_url', body.postingUrl);
  if (body.descriptionHtml !== undefined) set('description_html', cleanRichText(body.descriptionHtml));
  if (body.notesHtml !== undefined) set('notes_html', cleanRichText(body.notesHtml));
  if (body.favorite !== undefined) set('favorite', body.favorite ? 1 : 0);
  if (body.trackedOn !== undefined) {
    assertValidDate(deps, body.trackedOn, 'trackedOn');
    set('tracked_on', body.trackedOn);
  }
  if (body.resumeId !== undefined) {
    const resumeId = body.resumeId || null;
    if (resumeId) assertOwnedResume(db, userId, resumeId);
    set('resume_id', resumeId);
  }
  if (body.coverLetterId !== undefined) {
    const coverLetterId = body.coverLetterId || null;
    if (coverLetterId) assertOwnedLetter(db, userId, coverLetterId);
    set('cover_letter_id', coverLetterId);
  }

  const touchesPay =
    body.salaryMin !== undefined ||
    body.salaryMax !== undefined ||
    body.salaryCurrency !== undefined ||
    body.salaryPeriod !== undefined;
  if (touchesPay) {
    const min = body.salaryMin !== undefined ? body.salaryMin : row.salary_min;
    const max = body.salaryMax !== undefined ? body.salaryMax : row.salary_max;
    let currency = body.salaryCurrency !== undefined ? body.salaryCurrency : row.salary_currency;
    let period = body.salaryPeriod !== undefined ? body.salaryPeriod : row.salary_period;
    if (min !== null && max !== null && max < min) {
      throw validationFailed(SALARY_ORDER_MESSAGE, { salaryMax: SALARY_ORDER_MESSAGE });
    }
    // Clearing the period of a stored amount is refused, as clearing it beside a new amount is.
    if ((min !== null || max !== null) && body.salaryPeriod === null) {
      throw validationFailed(SALARY_PERIOD_MESSAGE, { salaryPeriod: SALARY_PERIOD_MESSAGE });
    }
    // Simplify's hidden defaults: an amount without a period is yearly, without a currency US dollars.
    if (min !== null || max !== null) {
      period ??= 'year';
      currency ??= 'USD';
    }
    set('salary_min', min);
    set('salary_max', max);
    set('salary_currency', currency);
    set('salary_period', period);
  }

  if (sets.length > 0) {
    set('updated_at', nowIso(deps));
    db.prepare(`UPDATE applications SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params, id, userId);
  }
  return getDetail(db, userId, id);
}

function statusResponse(deps: Deps, id: string): StatusChangeResponse {
  const row = deps.db.prepare('SELECT current_status, updated_at FROM applications WHERE id = ?').get(id) as {
    current_status: ApplicationStatus;
    updated_at: string;
  };
  return { id, currentStatus: row.current_status, events: loadEvents(deps.db, id), updatedAt: row.updated_at };
}

/** PUT /api/applications/:id/status: the shared move rule, dated `occurredOn` (default today). */
export function changeStatus(
  deps: Deps,
  userId: string,
  id: string,
  status: ApplicationStatus,
  occurredOn?: string,
): StatusChangeResponse {
  const date = occurredOn ?? todayIso(deps);
  assertValidDate(deps, date);
  return transaction(deps.db, () => {
    loadOwnedRow(deps.db, userId, id);
    const before = loadEvents(deps.db, id);
    writeEvents(deps.db, userId, id, before, applyStatusChange(before, status, date), nowIso(deps));
    return statusResponse(deps, id);
  });
}

/** PUT /api/applications/:id/events/:status: a step's date ("Add date" or the pencil). */
export function setStatusDate(
  deps: Deps,
  userId: string,
  id: string,
  status: ApplicationStatus,
  occurredOn: string,
): StatusChangeResponse {
  assertValidDate(deps, occurredOn);
  return transaction(deps.db, () => {
    loadOwnedRow(deps.db, userId, id);
    const before = loadEvents(deps.db, id);
    writeEvents(deps.db, userId, id, before, setEventDate(before, status, occurredOn), nowIso(deps));
    return statusResponse(deps, id);
  });
}

/** DELETE /api/applications/:id/events/:status: "Clear" in the date popover. */
export function clearStatusDate(deps: Deps, userId: string, id: string, status: ApplicationStatus): StatusChangeResponse {
  return transaction(deps.db, () => {
    loadOwnedRow(deps.db, userId, id);
    const before = loadEvents(deps.db, id);
    const blocker = clearEventBlocker(before, status);
    if (blocker) throw validationFailed(blocker, { status: blocker });
    const after = removeStatusEvent(before, status);
    if (after.length !== before.length) writeEvents(deps.db, userId, id, before, after, nowIso(deps));
    return statusResponse(deps, id);
  });
}

export function setArchived(deps: Deps, userId: string, id: string, archived: boolean): ApplicationDetail {
  loadOwnedRow(deps.db, userId, id);
  const now = nowIso(deps);
  if (archived) {
    // Archiving twice keeps the first time.
    deps.db
      .prepare('UPDATE applications SET archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE id = ? AND user_id = ?')
      .run(now, now, id, userId);
  } else {
    deps.db.prepare('UPDATE applications SET archived_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?').run(now, id, userId);
  }
  return getDetail(deps.db, userId, id);
}

export function deleteApplication(deps: Deps, userId: string, id: string): void {
  loadOwnedRow(deps.db, userId, id);
  deps.db.prepare('DELETE FROM applications WHERE id = ? AND user_id = ?').run(id, userId);
}

/** POST /api/applications/bulk ("Manage jobs"). Ids that are not the account's are skipped, not reported. */
export function bulkApplications(deps: Deps, userId: string, body: BulkApplicationsBody): number {
  const { db } = deps;
  const now = nowIso(deps);
  const date = body.occurredOn ?? todayIso(deps);
  if (body.action === 'status') assertValidDate(deps, date);
  const ids = [...new Set(body.ids)];
  return transaction(db, () => {
    let affected = 0;
    for (const id of ids) {
      const owned = db.prepare('SELECT archived_at FROM applications WHERE id = ? AND user_id = ?').get(id, userId) as
        | { archived_at: string | null }
        | undefined;
      if (!owned) continue;
      switch (body.action) {
        case 'archive':
          db.prepare(
            'UPDATE applications SET archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE id = ? AND user_id = ?',
          ).run(now, now, id, userId);
          break;
        case 'unarchive':
          db.prepare('UPDATE applications SET archived_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?').run(now, id, userId);
          break;
        case 'delete':
          db.prepare('DELETE FROM applications WHERE id = ? AND user_id = ?').run(id, userId);
          break;
        case 'status': {
          const before = loadEvents(db, id);
          writeEvents(db, userId, id, before, applyStatusChange(before, body.status!, date), now);
          break;
        }
      }
      affected += 1;
    }
    return affected;
  });
}

export function archiveAll(deps: Deps, userId: string): number {
  const now = nowIso(deps);
  return deps.db
    .prepare('UPDATE applications SET archived_at = ?, updated_at = ? WHERE user_id = ? AND archived_at IS NULL')
    .run(now, now, userId).changes;
}

/**
 * POST /api/applications/import: rows the wizard mapped. Each row is read with the shared rules (status map, job type
 * guess, flexible dates); its Application Date dates its events and its tracked day. Bad rows are reported by their
 * 1-based number and skipped; the rest are written in one transaction.
 */
export function importApplications(deps: Deps, userId: string, body: TrackerImportBody): TrackerImportResponse {
  const { db } = deps;
  const now = nowIso(deps);
  const today = todayIso(deps);
  const latest = latestAllowedDate(deps);
  const errors: TrackerImportResponse['errors'] = [];
  let imported = 0;
  transaction(db, () => {
    const companyIds = new Map<string, number | null>();
    body.rows.forEach((raw, index) => {
      const row = readImportRow(raw, body.statusMap);
      if (!row.ok) {
        errors.push({ row: index + 1, message: row.message });
        return;
      }
      if (raw.appliedOn && raw.appliedOn.trim() && !row.appliedOn) {
        errors.push({ row: index + 1, message: `"${raw.appliedOn.trim().slice(0, 40)}" is not a date we can read.` });
        return;
      }
      if (row.appliedOn && row.appliedOn > latest) {
        errors.push({ row: index + 1, message: FUTURE_DATE_MESSAGE });
        return;
      }
      const day = row.appliedOn ?? today;
      if (!companyIds.has(row.companyName)) companyIds.set(row.companyName, companyIdFor(db, row.companyName));
      insertApplication(
        db,
        {
          userId,
          jobId: null,
          companyId: companyIds.get(row.companyName) ?? null,
          title: row.title,
          companyName: row.companyName,
          location: row.location,
          employmentType: row.employmentType,
          postingUrl: normalizeUrlInput(row.postingUrl.slice(0, 2000)) ?? '',
          descriptionHtml: '',
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
          salaryPeriod: null,
          resumeId: null,
          notesHtml: cleanRichText(textToParagraphs(row.notes)),
          trackedOn: day,
          events: initialEvents(row.status, day),
        },
        now,
      );
      imported += 1;
    });
  });
  return { imported, skipped: errors.length, errors };
}

// ------------------------------------------------------------------------------------------------- questions

export function createQuestion(
  deps: Deps,
  userId: string,
  applicationId: string,
  input: { question: string; answer: string },
): ApplicationQuestion {
  const { db } = deps;
  loadOwnedRow(db, userId, applicationId);
  const now = nowIso(deps);
  const id = randomUUID();
  transaction(db, () => {
    const { next } = db
      .prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM application_questions WHERE application_id = ?')
      .get(applicationId) as { next: number };
    db.prepare(
      'INSERT INTO application_questions(id, application_id, position, question, answer, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, applicationId, next, input.question, input.answer, now, now);
    db.prepare('UPDATE applications SET updated_at = ? WHERE id = ? AND user_id = ?').run(now, applicationId, userId);
  });
  return toQuestion(loadQuestionRow(db, applicationId, id));
}

/** Rewrites positions 0..n-1 in the given order. */
function renumber(db: Db, ids: readonly string[]): void {
  const update = db.prepare('UPDATE application_questions SET position = ? WHERE id = ?');
  ids.forEach((id, index) => update.run(index, id));
}

export function patchQuestion(
  deps: Deps,
  userId: string,
  applicationId: string,
  questionId: string,
  input: { question?: string; answer?: string; position?: number },
): ApplicationQuestion {
  const { db } = deps;
  loadOwnedRow(db, userId, applicationId);
  loadQuestionRow(db, applicationId, questionId);
  const now = nowIso(deps);
  transaction(db, () => {
    if (input.question !== undefined) {
      db.prepare('UPDATE application_questions SET question = ? WHERE id = ?').run(input.question, questionId);
    }
    if (input.answer !== undefined) {
      db.prepare('UPDATE application_questions SET answer = ? WHERE id = ?').run(input.answer, questionId);
    }
    if (input.position !== undefined) {
      const order = loadQuestions(db, applicationId)
        .map((question) => question.id)
        .filter((id) => id !== questionId);
      order.splice(Math.min(input.position, order.length), 0, questionId);
      renumber(db, order);
    }
    db.prepare('UPDATE application_questions SET updated_at = ? WHERE id = ?').run(now, questionId);
    db.prepare('UPDATE applications SET updated_at = ? WHERE id = ? AND user_id = ?').run(now, applicationId, userId);
  });
  return toQuestion(loadQuestionRow(db, applicationId, questionId));
}

export function deleteQuestion(deps: Deps, userId: string, applicationId: string, questionId: string): void {
  const { db } = deps;
  loadOwnedRow(db, userId, applicationId);
  loadQuestionRow(db, applicationId, questionId);
  transaction(db, () => {
    db.prepare('DELETE FROM application_questions WHERE id = ?').run(questionId);
    renumber(
      db,
      loadQuestions(db, applicationId).map((question) => question.id),
    );
    db.prepare('UPDATE applications SET updated_at = ? WHERE id = ? AND user_id = ?').run(nowIso(deps), applicationId, userId);
  });
}
