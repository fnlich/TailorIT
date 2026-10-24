import { randomUUID } from 'node:crypto';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
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
  type ResumeOrigin,
  type SavedJobRef,
  type StatusChangeResponse,
  type StatusEvent,
  type TrackerImportBody,
  type TrackerImportResponse,
  type TrackerPayPeriod,
} from '@tailorit/shared';
import { nowIso, todayIso, type AppDeps } from '../../core/context';
import { transaction, type Db } from '../../core/db/connection';
import { notFound, validationFailed } from '../../core/http/errors';
import { writeAutoChoice } from '../resume-match/service';
import type { ResumeChoice } from './resume-choice';
import { cleanRichText, textToParagraphs } from './sanitize';
import {
  archiveRow,
  getDetail,
  loadEvents,
  loadOwnedRow,
  loadQuestionRow,
  loadQuestions,
  restoreRow,
  toQuestion,
  writeEvents,
  type ApplicationRow,
} from './store';

// What the tracker's endpoints do, one function per operation. Multi-statement writes run in one transaction; the
// status rules are the shared pure functions, and `current_status` is rewritten with every event change.
//
// The resume of a saved job. Saving a job at Saved with no resume named links TailorIT's best match (origin 'auto').
// The choice is made before the write (`bestResumes`, read-only and never AI) and handed in; the write links it
// through the full guard (`writeAutoChoice`). A job saved without a choice in hand is written due
// (resume_match_due = 1) and the match worker chooses within seconds. A resume the person names, or "none" (null or
// ''), is theirs (origin 'user') and never changed automatically. Applied and later statuses never get an automatic
// resume.

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
  /** The resume linked at insert: the person's choice, or none. TailorIT's choice is written after, through the guard. */
  resumeId: string | null;
  /** 'user' when the request named the resume (or "none"); null when nobody chose yet. */
  resumeOrigin: ResumeOrigin | null;
  /** 1 when TailorIT is to choose the resume (right after the insert when a choice is in hand, else the worker). */
  resumeMatchDue: 0 | 1;
  notesHtml: string;
  trackedOn: string;
  events: readonly StatusEvent[];
}

type ResumeFields = Pick<InsertInput, 'resumeId' | 'resumeOrigin' | 'resumeMatchDue'>;

/** Nobody chose the resume, and TailorIT will not (an application added by hand, Applied and later statuses). */
const NOT_CHOSEN: ResumeFields = { resumeId: null, resumeOrigin: null, resumeMatchDue: 0 };
/** TailorIT chooses: written due, then linked at once when a choice is in hand. */
const TO_CHOOSE: ResumeFields = { resumeId: null, resumeOrigin: null, resumeMatchDue: 1 };
/** The person named the resume, or none (null or ''): their choice, never changed automatically. */
const chosenByPerson = (resumeId: string | null): ResumeFields => ({ resumeId, resumeOrigin: 'user', resumeMatchDue: 0 });

function insertApplication(db: Db, input: InsertInput, now: string): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO applications(id, user_id, job_id, company_id, title, company_name, location, employment_type, posting_url,
       description_html, salary_min, salary_max, salary_currency, salary_period, current_status, favorite, archived_at,
       resume_id, resume_origin, resume_matched_at, resume_match_due, cover_letter_id, notes_html, tracked_on, created_at,
       updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
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
    input.resumeOrigin,
    input.resumeOrigin ? now : null,
    input.resumeMatchDue,
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

const JOB_COLUMNS = `j.id, j.title, j.description_html, j.apply_url, j.employment_type, j.work_arrangement,
  j.primary_location, j.location_count, j.salary_min, j.salary_max, j.salary_currency, j.salary_period, j.company_id,
  c.name AS company_name`;
const JOB_FROM = 'jobs j JOIN companies c ON c.id = j.company_id';

const placeholders = (values: readonly unknown[]) => values.map(() => '?').join(',');

function loadJob(db: Db, jobId: number): JobRow {
  const job = db.prepare(`SELECT ${JOB_COLUMNS} FROM ${JOB_FROM} WHERE j.id = ?`).get(jobId) as JobRow | undefined;
  if (!job) throw notFound('That job');
  return job;
}

/** The jobs among `ids` that exist, by id (one query; `ids` is a chunk, far below SQLite's variable limit). */
function loadJobs(db: Db, ids: readonly number[]): Map<number, JobRow> {
  const jobs = new Map<number, JobRow>();
  if (ids.length === 0) return jobs;
  const rows = db.prepare(`SELECT ${JOB_COLUMNS} FROM ${JOB_FROM} WHERE j.id IN (${placeholders(ids)})`).all(...ids) as JobRow[];
  for (const row of rows) jobs.set(row.id, row);
  return jobs;
}

function jobLocation(job: JobRow): string {
  const line = formatLocationLine(job.primary_location, job.location_count, null);
  if (line) return line;
  return job.work_arrangement === 'remote' ? 'Remote' : '';
}

/** What a request may override of a posting's prefill (the single save only). */
type PostingOverrides = Pick<CreateApplicationBody, 'title' | 'companyName' | 'location' | 'employmentType' | 'postingUrl'>;

/**
 * A new application from a posting, as the Jobs page saves it: title, company, location line, job type (full-time
 * when the posting does not say), link, cleaned description and pay, with the request's overrides. Its resume is not
 * chosen (the caller decides). Cleaning the description is the costly part: Save all prepares outside its writes.
 */
function fromPosting(
  userId: string,
  job: JobRow,
  options: { status: ApplicationStatus; date: string; body?: PostingOverrides },
): InsertInput {
  const body = options.body ?? {};
  const period = job.salary_period && JOB_PAY_PERIODS.includes(job.salary_period) ? (job.salary_period as TrackerPayPeriod) : null;
  const hasPay = job.salary_min !== null || job.salary_max !== null;
  return {
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
    ...NOT_CHOSEN,
    notesHtml: '',
    trackedOn: options.date,
    events: initialEvents(options.status, options.date),
  };
}

/** An application of a job as a save reads it. */
type JobApplication = Pick<ApplicationRow, 'id' | 'current_status' | 'archived_at' | 'resume_id' | 'resume_origin'>;

const JOB_APPLICATION_COLUMNS = 'id, current_status, archived_at, resume_id, resume_origin';

/**
 * Whether TailorIT chooses the resume when a job is saved at `status` (undefined: the status it has): for a new
 * application only at Saved; for an existing one only when it was un-saved (archived while only Saved), the save
 * does not move it on, and it has no resume the person chose (a resume TailorIT chose earlier is kept).
 */
function choosesOnSave(status: ApplicationStatus | undefined, existing: JobApplication | null): boolean {
  if (!existing) return status === STATUS.saved;
  if (status !== undefined && status > existing.current_status) return false;
  return (
    existing.archived_at !== null &&
    existing.current_status === STATUS.saved &&
    existing.resume_id === null &&
    existing.resume_origin !== 'user'
  );
}

/** A save names no resume (no `resumeId` key at all; null or '' is the person's "none") and TailorIT may choose. */
function choosesResume(body: CreateApplicationBody, existing: JobApplication | null): boolean {
  return body.jobId !== undefined && body.resumeId === undefined && choosesOnSave(body.status, existing);
}

/**
 * Links TailorIT's choice to a just-saved application through the full guard (`writeAutoChoice`: still the account's
 * Saved, active application of that job, chosen by TailorIT or by nobody, and a resume of the same account), which
 * clears the due flag. Without a choice, or when the guard refuses it (the resume was deleted meanwhile), the
 * application stays due and the match worker chooses.
 */
function linkChoice(
  db: Db,
  target: { id: string; userId: string; jobId: number },
  choice: ResumeChoice | null | undefined,
  now: string,
): void {
  if (choice && choice.jobId === target.jobId) writeAutoChoice(db, target, choice.resumeId, now);
}

/** The person's choice of resume (one of theirs, or none): never changed automatically, so never due. */
function setPersonsResume(db: Db, userId: string, id: string, resumeId: string | null, now: string): void {
  db.prepare(
    `UPDATE applications SET resume_id = ?, resume_origin = 'user', resume_matched_at = ?, resume_match_due = 0
     WHERE id = ? AND user_id = ?`,
  ).run(resumeId, now, id, userId);
}

export interface CreateResult {
  detail: ApplicationDetail;
  created: boolean;
}

export interface CreateOptions {
  /**
   * TailorIT's best resume for the job (`bestResumes`), chosen before the transaction. It is linked (origin 'auto') only
   * when TailorIT chooses for this save (see `wantsResumeMatch`); a choice whose resume is gone by then is not linked.
   */
  matchedResume?: ResumeChoice | null;
  /** The chooser did not finish for the job: the application is saved due, and the match worker chooses. */
  matchPending?: boolean;
}

/**
 * POST /api/applications. With `jobId` the application is the account's one for that job: created from the posting
 * (title, company, location, job type, link, pay, description) the first time; afterwards the existing one is
 * returned, restored if archived, and moved up to `status` when that is further along.
 *
 * Its resume, for a new application and for one un-saved earlier (archived while only Saved) that the save brings
 * back as it was; an application already tracked keeps its resume. A resume the body names (`resumeId`: an id of the
 * account's, or null / '' for none) is the person's choice. With no `resumeId` key, a job saved at Saved gets
 * TailorIT's best match (`options.matchedResume`, origin 'auto'), a brought-back one only when it has no resume; with
 * no choice in hand it is saved due and the match worker chooses (`detail.resumeMatchPending`). Applied and later
 * statuses, and applications added by hand, never get an automatic resume.
 */
export function createApplication(
  deps: Deps,
  userId: string,
  body: CreateApplicationBody,
  options: CreateOptions = {},
): CreateResult {
  const { db } = deps;
  const now = nowIso(deps);
  const date = body.occurredOn ?? todayIso(deps);
  assertValidDate(deps, date);
  const status: ApplicationStatus = body.status ?? STATUS.applied;
  const named = body.resumeId !== undefined;
  const resumeId = body.resumeId || null;
  const choice = options.matchPending ? null : (options.matchedResume ?? null);

  return transaction(db, () => {
    if (resumeId) assertOwnedResume(db, userId, resumeId);
    if (body.jobId !== undefined) {
      const job = loadJob(db, body.jobId);
      const existing = db
        .prepare(`SELECT ${JOB_APPLICATION_COLUMNS} FROM applications WHERE user_id = ? AND job_id = ?`)
        .get(userId, job.id) as JobApplication | undefined;
      if (existing) {
        const raisedTo = body.status !== undefined && body.status > existing.current_status ? body.status : null;
        // Un-saved earlier and saved again as it was: its resume is chosen as for a new application.
        const bringsBack = existing.archived_at !== null && existing.current_status === STATUS.saved && raisedTo === null;
        const chooses = choosesResume(body, existing);
        if (raisedTo !== null) {
          const before = loadEvents(db, existing.id);
          writeEvents(db, userId, existing.id, before, applyStatusChange(before, raisedTo, date), now);
        }
        if (existing.archived_at) restoreRow(db, userId, existing.id, now);
        if (bringsBack && named) setPersonsResume(db, userId, existing.id, resumeId, now);
        else if (chooses) linkChoice(db, { id: existing.id, userId, jobId: job.id }, choice, now);
        return { detail: getDetail(db, userId, existing.id), created: false };
      }
      const chooses = choosesResume(body, null);
      const resume = named ? chosenByPerson(resumeId) : chooses ? TO_CHOOSE : NOT_CHOSEN;
      const id = insertApplication(db, { ...fromPosting(userId, job, { status, date, body }), ...resume }, now);
      if (chooses) linkChoice(db, { id, userId, jobId: job.id }, choice, now);
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
        ...(named ? chosenByPerson(resumeId) : NOT_CHOSEN),
        notesHtml: '',
        trackedOn: date,
        events: initialEvents(status, date),
      },
      now,
    );
    return { detail: getDetail(db, userId, id), created: true };
  });
}

/**
 * Whether this POST /api/applications lets TailorIT choose the resume, so the router asks the chooser before the
 * write (which checks again): a job, no `resumeId` key, and either no application yet with status Saved, or an
 * un-saved one (archived, only Saved, no resume the person chose) that the save does not move on. Read-only.
 */
export function wantsResumeMatch(db: Db, userId: string, body: CreateApplicationBody): boolean {
  if (body.jobId === undefined || body.resumeId !== undefined) return false;
  const row = db
    .prepare(
      `SELECT j.id AS job_id, a.id, a.current_status, a.archived_at, a.resume_id, a.resume_origin
       FROM jobs j LEFT JOIN applications a ON a.user_id = ? AND a.job_id = j.id
       WHERE j.id = ?`,
    )
    .get(userId, body.jobId) as (Omit<JobApplication, 'id'> & { job_id: number; id: string | null }) | undefined;
  // An unknown job: the save answers 404.
  if (!row) return false;
  return choosesResume(body, row.id === null ? null : { ...row, id: row.id });
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
    // The person's choice (a resume, or none): TailorIT never changes it.
    set('resume_id', resumeId);
    set('resume_origin', 'user');
    set('resume_matched_at', nowIso(deps));
    set('resume_match_due', 0);
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

/**
 * Archive (the Jobs page's un-save too) or restore. A Saved application of a job that comes back is due again
 * (`detail.resumeMatchPending`), unless the person chose its resume.
 */
export function setArchived(deps: Deps, userId: string, id: string, archived: boolean): ApplicationDetail {
  loadOwnedRow(deps.db, userId, id);
  const now = nowIso(deps);
  if (archived) archiveRow(deps.db, userId, id, now);
  else restoreRow(deps.db, userId, id, now);
  return getDetail(deps.db, userId, id);
}

export function deleteApplication(deps: Deps, userId: string, id: string): void {
  loadOwnedRow(deps.db, userId, id);
  deps.db.prepare('DELETE FROM applications WHERE id = ? AND user_id = ?').run(id, userId);
}

/**
 * POST /api/applications/bulk ("Manage jobs"). Ids that are not the account's are skipped, not reported. With
 * `onlySaved` (Save all's Undo), archiving leaves alone, and does not count, applications that moved past Saved.
 */
export function bulkApplications(deps: Deps, userId: string, body: BulkApplicationsBody): number {
  const { db } = deps;
  const now = nowIso(deps);
  const date = body.occurredOn ?? todayIso(deps);
  if (body.action === 'status') assertValidDate(deps, date);
  const ids = [...new Set(body.ids)];
  return transaction(db, () => {
    let affected = 0;
    for (const id of ids) {
      const owned = db.prepare('SELECT current_status FROM applications WHERE id = ? AND user_id = ?').get(id, userId) as
        | { current_status: ApplicationStatus }
        | undefined;
      if (!owned) continue;
      switch (body.action) {
        case 'archive':
          if (body.onlySaved && owned.current_status !== STATUS.saved) continue;
          archiveRow(db, userId, id, now);
          break;
        case 'unarchive':
          restoreRow(db, userId, id, now);
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
    .prepare(
      'UPDATE applications SET archived_at = ?, updated_at = ?, resume_match_due = 0 WHERE user_id = ? AND archived_at IS NULL',
    )
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
          ...NOT_CHOSEN,
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

// ------------------------------------------------------------------------------------------------- Save all

/** The most jobs `saveJobs` writes in one transaction. */
export const SAVE_JOBS_CHUNK = 25;
/** The longest one chunk of `saveJobs` spends preparing its new applications (cleaning descriptions) before it writes. */
export const SAVE_JOBS_CHUNK_MS = 200;

/** Which resume to link to some jobs (`bestResumes`, or `resumeChooser` for one budget over every chunk). */
export type ChooseResumes = (jobIds: readonly number[]) => Promise<{ choices: ReadonlyMap<number, ResumeChoice> }>;

export interface SaveJobsOptions {
  /** The day the jobs are saved ("YYYY-MM-DD", the browser's today): their Saved event and tracked day. */
  occurredOn: string;
  /**
   * Asked once per chunk, outside its transaction, about the jobs it will write with no resume. A job it gives no
   * choice for is saved due (the match worker chooses). Must not throw: a throw is logged and the jobs are left due.
   */
  chooseResumes: ChooseResumes;
  /** The longest one chunk prepares before it writes; default SAVE_JOBS_CHUNK_MS. */
  chunkMs?: number;
}

export interface SaveJobsResult {
  /** The jobs saved, in the order asked (each once), from committed chunks only. */
  items: SavedJobRef[];
  /** Jobs left as they were: tracked already (an active application, or Applied and later even when archived), or gone. */
  skipped: number;
  /** Saved applications whose resume TailorIT is still choosing (resume_match_due = 1); the worker links it soon. */
  pendingMatches: number;
  /** Set when a chunk after the first failed: `items` is what the chunks before it saved. A failing first chunk throws. */
  error?: unknown;
}

/** Besides the database and the clock: the match worker to wake, and the log for a chooser that throws. */
type SaveJobsDeps = Deps & Partial<Pick<AppDeps, 'services' | 'log'>>;

interface SavedChunk {
  /** How many of the jobs offered the chunk took (the rest go to the next one). */
  taken: number;
  items: SavedJobRef[];
  skipped: number;
  pending: number;
}

const IN_TRANSACTION =
  'saveJobs cannot run inside an open transaction: it waits between its chunks, and other writes would join the transaction meanwhile.';

/** The account's applications of these jobs, by job id. */
function applicationsOfJobs(db: Db, userId: string, jobIds: readonly number[]): Map<number, JobApplication> {
  const byJob = new Map<number, JobApplication>();
  if (jobIds.length === 0) return byJob;
  const rows = db
    .prepare(`SELECT job_id, ${JOB_APPLICATION_COLUMNS} FROM applications WHERE user_id = ? AND job_id IN (${placeholders(jobIds)})`)
    .all(userId, ...jobIds) as Array<JobApplication & { job_id: number }>;
  for (const { job_id: jobId, ...application } of rows) byJob.set(jobId, application);
  return byJob;
}

/** The chooser's answer. One that throws (it must not) is logged, and its jobs are left for the match worker. */
async function choicesFor(
  deps: SaveJobsDeps,
  userId: string,
  chooseResumes: ChooseResumes,
  jobIds: readonly number[],
): Promise<ReadonlyMap<number, ResumeChoice>> {
  try {
    return (await chooseResumes(jobIds)).choices;
  } catch (error) {
    deps.log?.warn(
      `[applications] choosing resumes for ${jobIds.length} saved job(s) of account ${userId} failed; the match worker chooses them`,
      error,
    );
    return new Map();
  }
}

/**
 * One chunk's write, inside its transaction: the applications are read again (anything may have changed while the
 * chunk was prepared and its resumes chosen). Returns the items, which count only once the transaction commits.
 */
function writeSavedJobs(
  db: Db,
  userId: string,
  chunk: readonly number[],
  prepared: ReadonlyMap<number, InsertInput>,
  choices: ReadonlyMap<number, ResumeChoice>,
  date: string,
  now: string,
): Omit<SavedChunk, 'taken'> {
  const current = applicationsOfJobs(db, userId, chunk);
  const alive = new Set(
    (db.prepare(`SELECT id FROM jobs WHERE id IN (${placeholders(chunk)})`).all(...chunk) as Array<{ id: number }>).map(
      (row) => row.id,
    ),
  );
  const saved: Array<{ jobId: number; applicationId: string; created: boolean }> = [];
  let skipped = 0;
  for (const jobId of chunk) {
    const existing = current.get(jobId) ?? null;
    if (existing) {
      // Tracked already, and it keeps its status: an active application, or one that reached Applied.
      if (existing.archived_at === null || existing.current_status !== STATUS.saved) {
        skipped += 1;
        continue;
      }
      // Un-saved earlier: it comes back with its events, notes and favourite; a resume only when it has none.
      restoreRow(db, userId, existing.id, now);
      if (choosesOnSave(STATUS.saved, existing)) linkChoice(db, { id: existing.id, userId, jobId }, choices.get(jobId), now);
      saved.push({ jobId, applicationId: existing.id, created: false });
      continue;
    }
    if (!alive.has(jobId)) {
      skipped += 1;
      continue;
    }
    // Prepared before the transaction; one whose application disappeared meanwhile is prepared now.
    const input = prepared.get(jobId) ?? fromPosting(userId, loadJob(db, jobId), { status: STATUS.saved, date });
    const id = insertApplication(db, { ...input, ...TO_CHOOSE }, now);
    linkChoice(db, { id, userId, jobId }, choices.get(jobId), now);
    saved.push({ jobId, applicationId: id, created: true });
  }

  const ids = saved.map((entry) => entry.applicationId);
  const rows =
    ids.length === 0
      ? []
      : (db
          .prepare(`SELECT id, resume_id, resume_match_due FROM applications WHERE id IN (${placeholders(ids)})`)
          .all(...ids) as Array<{ id: string; resume_id: string | null; resume_match_due: number }>);
  const state = new Map(rows.map((row) => [row.id, row]));
  let pending = 0;
  const items = saved.map(({ jobId, applicationId, created }): SavedJobRef => {
    const row = state.get(applicationId);
    if (row?.resume_match_due === 1) pending += 1;
    return { jobId, applicationId, resumeId: row?.resume_id ?? null, created };
  });
  return { items, skipped, pending };
}

/**
 * One chunk: up to SAVE_JOBS_CHUNK of the jobs offered, fewer once preparing took `chunkMs`. Outside any transaction,
 * the new applications are prepared (cleaning the descriptions is the costly part) and TailorIT's resumes chosen;
 * then one IMMEDIATE transaction writes. The event loop gets a turn in between.
 */
async function saveChunk(
  deps: SaveJobsDeps,
  userId: string,
  offered: readonly number[],
  options: SaveJobsOptions,
): Promise<SavedChunk> {
  const { db } = deps;
  const date = options.occurredOn;
  const limitMs = Math.max(0, options.chunkMs ?? SAVE_JOBS_CHUNK_MS);
  // Read outside any transaction, and again in the write: what each job has; the new applications are prepared.
  const known = applicationsOfJobs(db, userId, offered);
  const jobs = loadJobs(db, offered.filter((jobId) => !known.has(jobId)));
  const prepared = new Map<number, InsertInput>();
  const started = performance.now();
  let taken = 0;
  for (const jobId of offered) {
    taken += 1;
    const job = jobs.get(jobId);
    if (job) prepared.set(jobId, fromPosting(userId, job, { status: STATUS.saved, date }));
    if (performance.now() - started >= limitMs) break;
  }
  const chunk = offered.slice(0, taken);
  await yieldToEventLoop();

  // Only the jobs that will be written with no resume are asked about.
  const asked = chunk.filter((jobId) => {
    const existing = known.get(jobId);
    return existing ? choosesOnSave(STATUS.saved, existing) : jobs.has(jobId);
  });
  const choices = asked.length > 0 ? await choicesFor(deps, userId, options.chooseResumes, asked) : new Map<number, ResumeChoice>();

  if (db.inTransaction) throw new Error(IN_TRANSACTION);
  const written = transaction(db, () => writeSavedJobs(db, userId, chunk, prepared, choices, date, nowIso(deps)));
  return { taken, ...written };
}

/**
 * Save all's writes (work package WP7 selects the jobs): each job is saved at Saved on `occurredOn` with the single
 * Save's prefill. A job with no application gets one, with its Saved event and TailorIT's best resume; one un-saved
 * earlier (archived while only Saved) comes back, its resume filled only when it has none; a job already tracked (an
 * active application, or Applied and later even when archived) or gone is skipped and left untouched. No AI work is
 * queued.
 *
 * Duplicates are saved once. The jobs go in chunks (see `saveChunk`), each committed on its own: items are counted
 * after their chunk commits, so a chunk that rolls back leaves no application ids behind. When the first chunk fails
 * the error is thrown and nothing is saved; when a later one fails, what the earlier chunks saved is returned with
 * `error`. Applications left due wake the match worker once, at the end. It refuses to run inside an open
 * transaction, which other requests' writes would join while it waits.
 */
export async function saveJobs(
  deps: SaveJobsDeps,
  userId: string,
  jobIds: readonly number[],
  options: SaveJobsOptions,
): Promise<SaveJobsResult> {
  if (deps.db.inTransaction) throw new Error(IN_TRANSACTION);
  assertValidDate(deps, options.occurredOn);
  const ids = [...new Set(jobIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const result: SaveJobsResult = { items: [], skipped: 0, pendingMatches: 0 };
  let start = 0;
  while (start < ids.length) {
    let chunk: SavedChunk;
    try {
      chunk = await saveChunk(deps, userId, ids.slice(start, start + SAVE_JOBS_CHUNK), options);
    } catch (error) {
      if (start === 0) throw error;
      result.error = error;
      break;
    }
    result.items.push(...chunk.items);
    result.skipped += chunk.skipped;
    result.pendingMatches += chunk.pending;
    start += chunk.taken;
    if (start < ids.length) await yieldToEventLoop();
  }
  if (result.pendingMatches > 0) deps.services?.resumeMatch?.nudge();
  return result;
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
