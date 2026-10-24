import {
  APPLICATION_STATUSES,
  STATUS,
  currentStatus,
  normalizeEvents,
  type ApplicationDetail,
  type ApplicationQuestion,
  type ApplicationStatus,
  type ApplicationSummary,
  type EmploymentType,
  type ResumeOrigin,
  type StatusEvent,
  type TrackerPayPeriod,
} from '@tailorit/shared';
import type { Db } from '../../core/db/connection';
import { notFound } from '../../core/http/errors';

// Rows of the tracker tables and their DTOs. Every read is scoped by user_id: another account's application is
// "not found", never "forbidden".
//
// The resume match flag (migration 0301). `resume_match_due = 1` asks the match worker to choose the application's
// resume. TailorIT chooses only for an application of a job that is Saved, not archived, and whose resume TailorIT
// chose or nobody chose yet (origin 'auto' or NULL). The writers here keep the flag to that: moving past Saved or
// archiving clears it; moving back to Saved or restoring such an application sets it, so the choice is made again.

export interface ApplicationRow {
  id: string;
  user_id: string;
  job_id: number | null;
  company_id: number | null;
  title: string;
  company_name: string;
  location: string;
  employment_type: EmploymentType;
  posting_url: string;
  description_html: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: TrackerPayPeriod | null;
  current_status: ApplicationStatus;
  favorite: number;
  archived_at: string | null;
  resume_id: string | null;
  /** Who chose resume_id: 'auto' (TailorIT's best match), 'user' (the person, a resume or none), NULL (nobody yet). */
  resume_origin: ResumeOrigin | null;
  /** When resume_id was chosen. */
  resume_matched_at: string | null;
  /** 1 while TailorIT is still to choose the resume (the match worker links it). */
  resume_match_due: number;
  cover_letter_id: string | null;
  notes_html: string;
  tracked_on: string;
  created_at: string;
  updated_at: string;
  /** companies.logo_path, joined. */
  logo_path: string | null;
}

/** The SELECT list every application read uses (alias `a`, companies joined as `c`). */
export const APPLICATION_COLUMNS = 'a.*, c.logo_path AS logo_path';
export const APPLICATION_FROM = 'applications a LEFT JOIN companies c ON c.id = a.company_id';

interface EventRow {
  application_id: string;
  status: ApplicationStatus;
  occurred_on: string;
}

interface QuestionRow {
  id: string;
  application_id: string;
  position: number;
  question: string;
  answer: string;
  created_at: string | null;
  updated_at: string | null;
}

/** One of the account's applications, or 404. */
export function loadOwnedRow(db: Db, userId: string, id: string): ApplicationRow {
  const row = db
    .prepare(`SELECT ${APPLICATION_COLUMNS} FROM ${APPLICATION_FROM} WHERE a.id = ? AND a.user_id = ?`)
    .get(id, userId) as ApplicationRow | undefined;
  if (!row) throw notFound('That application');
  return row;
}

export function loadEvents(db: Db, applicationId: string): StatusEvent[] {
  const rows = db
    .prepare('SELECT status, occurred_on FROM application_status_events WHERE application_id = ? ORDER BY status')
    .all(applicationId) as Array<Pick<EventRow, 'status' | 'occurred_on'>>;
  return normalizeEvents(rows.map((row) => ({ status: row.status, occurredOn: row.occurred_on })));
}

const ID_CHUNK = 500;

/** The events of many applications at once, keyed by application id (in status order). */
export function loadEventsFor(db: Db, ids: readonly string[]): Map<string, StatusEvent[]> {
  const out = new Map<string, StatusEvent[]>();
  for (const id of ids) out.set(id, []);
  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    const chunk = ids.slice(start, start + ID_CHUNK);
    const rows = db
      .prepare(
        `SELECT application_id, status, occurred_on FROM application_status_events
         WHERE application_id IN (${chunk.map(() => '?').join(',')}) ORDER BY application_id, status`,
      )
      .all(...chunk) as EventRow[];
    for (const row of rows) out.get(row.application_id)?.push({ status: row.status, occurredOn: row.occurred_on });
  }
  for (const [id, events] of out) out.set(id, normalizeEvents(events));
  return out;
}

/** TailorIT may choose the row's resume once it is Saved again (SQL over the row; `archived_at` as written). */
const CHOOSABLE_WHEN_SAVED = `job_id IS NOT NULL AND (resume_origin IS NULL OR resume_origin = 'auto')`;

/**
 * Writes an application's new event list: removed statuses are deleted, new ones inserted, changed dates updated;
 * the denormalized `current_status` follows. Past Saved, TailorIT no longer chooses the resume (the due flag is
 * cleared; the resume linked stays). Moved back to Saved, an active application of a job whose resume TailorIT chose
 * (or nobody chose) is marked due, so its best match is chosen again. Call inside a transaction.
 */
export function writeEvents(
  db: Db,
  userId: string,
  applicationId: string,
  before: readonly StatusEvent[],
  after: readonly StatusEvent[],
  now: string,
): ApplicationStatus {
  const held = new Map(before.map((event) => [event.status, event.occurredOn] as const));
  const next = new Map(after.map((event) => [event.status, event.occurredOn] as const));
  const remove = db.prepare('DELETE FROM application_status_events WHERE application_id = ? AND status = ?');
  const insert = db.prepare(
    'INSERT INTO application_status_events(application_id, status, occurred_on, created_at) VALUES (?, ?, ?, ?)',
  );
  const update = db.prepare('UPDATE application_status_events SET occurred_on = ? WHERE application_id = ? AND status = ?');
  for (const status of held.keys()) if (!next.has(status)) remove.run(applicationId, status);
  for (const [status, occurredOn] of next) {
    if (!held.has(status)) insert.run(applicationId, status, occurredOn, now);
    else if (held.get(status) !== occurredOn) update.run(occurredOn, applicationId, status);
  }
  const current = currentStatus(after);
  const lowered = current === STATUS.saved && currentStatus(before) !== STATUS.saved;
  db.prepare(
    `UPDATE applications
     SET current_status = @current, updated_at = @now,
         resume_match_due = CASE
           WHEN @current <> ${STATUS.saved} THEN 0
           WHEN @lowered = 1 AND archived_at IS NULL AND ${CHOOSABLE_WHEN_SAVED} THEN 1
           ELSE resume_match_due END
     WHERE id = @id AND user_id = @userId`,
  ).run({ current, now, lowered: lowered ? 1 : 0, id: applicationId, userId });
  return current;
}

/**
 * Archives an application (archiving twice keeps the first time). An archived application is not TailorIT's to
 * choose a resume for, so it is no longer due.
 */
export function archiveRow(db: Db, userId: string, id: string, now: string): void {
  db.prepare(
    `UPDATE applications SET archived_at = COALESCE(archived_at, @now), updated_at = @now, resume_match_due = 0
     WHERE id = @id AND user_id = @userId`,
  ).run({ now, id, userId });
}

/**
 * Restores an application. One that comes back Saved, of a job, with a resume TailorIT chose (or nobody chose), is
 * marked due: what its choice depends on may have changed while it was archived. (SET reads the row as it was.)
 */
export function restoreRow(db: Db, userId: string, id: string, now: string): void {
  db.prepare(
    `UPDATE applications
     SET archived_at = NULL, updated_at = @now,
         resume_match_due = CASE
           WHEN archived_at IS NOT NULL AND current_status = ${STATUS.saved} AND ${CHOOSABLE_WHEN_SAVED} THEN 1
           ELSE resume_match_due END
     WHERE id = @id AND user_id = @userId`,
  ).run({ now, id, userId });
}

/**
 * A logo the browser can load as it is: an absolute http(s) URL or a same-origin path. Anything else (a file path
 * on the server) has no public address here, so the card falls back to the letter avatar.
 */
export function logoUrlOf(path: string | null): string | null {
  if (!path) return null;
  const value = path.trim();
  if (/^https?:\/\//i.test(value)) return value;
  // A same-origin path: "//host" and "/\host" would load from another site.
  if (/^\/(?![/\\])/.test(value)) return value;
  return null;
}

export function toSummary(row: ApplicationRow, events: readonly StatusEvent[]): ApplicationSummary {
  return {
    id: row.id,
    title: row.title,
    companyName: row.company_name,
    companyId: row.company_id,
    logoUrl: logoUrlOf(row.logo_path),
    location: row.location,
    employmentType: row.employment_type,
    currentStatus: row.current_status,
    events: [...events],
    favorite: row.favorite === 1,
    archivedAt: row.archived_at,
    trackedOn: row.tracked_on,
    jobId: row.job_id,
    postingUrl: row.posting_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toQuestion(row: QuestionRow): ApplicationQuestion {
  return {
    id: row.id,
    position: row.position,
    question: row.question,
    answer: row.answer,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function loadQuestions(db: Db, applicationId: string): ApplicationQuestion[] {
  const rows = db
    .prepare('SELECT * FROM application_questions WHERE application_id = ? ORDER BY position, created_at, id')
    .all(applicationId) as QuestionRow[];
  return rows.map(toQuestion);
}

export function loadQuestionRow(db: Db, applicationId: string, questionId: string): QuestionRow {
  const row = db
    .prepare('SELECT * FROM application_questions WHERE id = ? AND application_id = ?')
    .get(questionId, applicationId) as QuestionRow | undefined;
  if (!row) throw notFound('That question');
  return row;
}

export function toDetail(db: Db, row: ApplicationRow): ApplicationDetail {
  return {
    ...toSummary(row, loadEvents(db, row.id)),
    descriptionHtml: row.description_html,
    salary: {
      min: row.salary_min,
      max: row.salary_max,
      currency: row.salary_currency,
      period: row.salary_period,
    },
    resumeId: row.resume_id,
    resumeOrigin: row.resume_origin ?? null,
    resumeMatchedAt: row.resume_matched_at ?? null,
    resumeMatchPending: row.resume_match_due === 1,
    coverLetterId: row.cover_letter_id,
    notesHtml: row.notes_html,
    questions: loadQuestions(db, row.id),
  };
}

/** The account's application as the detail sheet reads it (404 for anyone else's). */
export function getDetail(db: Db, userId: string, id: string): ApplicationDetail {
  return toDetail(db, loadOwnedRow(db, userId, id));
}

/** Counts of the account's applications by status, active ones only, every status present. */
export function emptyStatusCounts(): Record<string, number> {
  return Object.fromEntries(APPLICATION_STATUSES.map((status) => [String(status), 0]));
}
