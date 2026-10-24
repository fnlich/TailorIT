import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setImmediate } from 'node:timers/promises';
import JSZip from 'jszip';
import {
  normalizeResumeDocument,
  RESUME_ZIP_MAX_APPLICATIONS,
  STATUS_INFO,
  type ApplicationStatus,
  type ResumeDocument,
} from '@tailorit/shared';
import type { AppDeps } from '../../core/context';
import type { Db } from '../../core/db/connection';
import { EXTENSION_BY_KIND, getFileStore } from '../../core/files/index';
import { AppError, validationFailed } from '../../core/http/errors';
import { getPdfService, type PdfService } from '../../core/pdf/index';
import { orderClause } from '../applications/query';
import { currentResumeAnalyses } from '../resumes/analysis/store';
import { getResumeEngine } from '../resumes/engine';
import { exportBuiltResume } from '../resumes/export';
import { documentOf, toSummary, type ResumeListRow } from '../resumes/repository';
import {
  needsSkippedFile,
  personFileStem,
  planFolders,
  resumeFileName,
  SKIPPED_FILE,
  skippedText,
  type SkippedApplication,
} from './zipNames';

// Building one resume ZIP (work package WP11): {Company}/{Role}/{First_Last}_resume.{ext} for each application.
//
// The order of work. The selection's due choices are made first (the resume match service, within a budget): storing
// them is the save-time match the person asked for. Then each application takes its linked resume, or the default one
// (counted as `usedDefault`). The size is added up from what is stored about the files (uploads' sizes, an estimate per
// built resume) and refused above the cap before any file is read. Uploads are copied byte for byte from disk, with
// their own extension: never converted, never rendered. Each distinct built resume is rendered once, as a PDF through
// the shared Chrome pool (max(1, PDF_MAX_CONCURRENCY - 1) at a time, so other people's exports keep a page, each
// waiting at most `pdfWaitMs` for one), or as a Word file when Chrome is missing, busy or failing, or the deadline is
// near. The zip is written to a temporary file (STORE entries, UTF-8 names, times in the person's time zone), read
// from disk one entry at a time; SKIPPED.txt says what was left out and why.
//
// Nothing here ever blocks the event loop for long: files are read and written with streams, renders are awaited, and
// the choices are made in the match service's cooperative slices.

/** The most a zip may hold: the browser keeps the whole download in memory before saving it. */
export const RESUME_ZIP_MAX_BYTES = 200 * 1024 * 1024;
/** What a built resume is counted as before it is rendered (a PDF of a few pages, generously). */
export const BUILT_RESUME_ESTIMATE_BYTES = 400 * 1024;
/** Upload readings (the person's name on them) computed during a build when missing; the backfill reads the rest. */
const NAME_READINGS_COMPUTED = 5;
/** The finished zip inside a build's folder. */
const ZIP_FILE = 'resumes.zip';

const NO_SAVED = 'You have no Saved applications. Save jobs first, or select applications in Manage jobs.';
const NONE_OF_THOSE = 'Those applications were not found.';
export const NO_RESUMES = 'You have no resumes yet. Upload or create one in Documents, then try again.';
const ALL_MISSING = 'The resume files for these applications are missing. Upload the resumes again in Documents.';
const ALL_FAILED = 'Your resumes could not be made into files right now. Please try again.';

function tooLarge(maxBytes: number): string {
  const megabytes = Math.max(1, Math.round(maxBytes / (1024 * 1024)));
  return `These resumes add up to more than ${megabytes} MB. Select fewer applications and try again.`;
}

const missingFile = (label: string) => `the uploaded file of "${label}" is missing. Upload it again in Documents.`;
const notMade = (label: string) =>
  `"${label}" could not be made into a PDF or Word file. Try Download PDF on it in Documents.`;
const goneResume = (label: string) => `"${label}" was deleted while the zip was being built.`;

// ------------------------------------------------------------------------------------------------ the selection

/** An application as the zip reads it. */
export interface ZipApplication {
  id: string;
  title: string;
  companyName: string;
  status: number;
  resumeId: string | null;
}

interface ApplicationRow {
  id: string;
  title: string;
  company_name: string;
  current_status: number;
  resume_id: string | null;
}

const APPLICATION_COLUMNS = 'a.id, a.title, a.company_name, a.current_status, a.resume_id';
/** The tracker's own order (tracked day, newest first): "(2)" folders and SKIPPED.txt follow it. */
const TRACKED_ORDER = orderClause({ sort: 'tracked', order: 'desc' });

function toApplication(row: ApplicationRow): ZipApplication {
  return {
    id: row.id,
    title: row.title,
    companyName: row.company_name,
    status: row.current_status,
    resumeId: row.resume_id,
  };
}

/** The account's applications among `ids` (any status, archived or not; another account's are left out), in order. */
export function applicationsByIds(db: Db, userId: string, ids: readonly string[]): ZipApplication[] {
  const unique = [...new Set(ids)].slice(0, RESUME_ZIP_MAX_APPLICATIONS);
  if (unique.length === 0) return [];
  const rows = db
    .prepare(
      `SELECT ${APPLICATION_COLUMNS} FROM applications a
       WHERE a.user_id = ? AND a.id IN (${unique.map(() => '?').join(', ')}) ${TRACKED_ORDER}`,
    )
    .all(userId, ...unique) as ApplicationRow[];
  return rows.map(toApplication);
}

export interface ZipScope {
  applications: ZipApplication[];
  /** Saved applications past RESUME_ZIP_MAX_APPLICATIONS (only without ids). */
  leftOut: number;
}

/**
 * What one build covers: with `ids`, those of the account's applications (404 when none is theirs); without, every
 * active Saved application, the first RESUME_ZIP_MAX_APPLICATIONS in the tracker's order (400 when there is none).
 */
export function selectScope(db: Db, userId: string, ids?: readonly string[]): ZipScope {
  if (ids) {
    const applications = applicationsByIds(db, userId, ids);
    if (applications.length === 0) throw new AppError('not_found', NONE_OF_THOSE);
    return { applications, leftOut: 0 };
  }
  // The predicates are written out as the board's index has them (user, archived, status).
  const saved = 'a.user_id = ? AND a.archived_at IS NULL AND a.current_status = 1';
  const rows = db
    .prepare(`SELECT ${APPLICATION_COLUMNS} FROM applications a WHERE ${saved} ${TRACKED_ORDER} LIMIT ?`)
    .all(userId, RESUME_ZIP_MAX_APPLICATIONS + 1) as ApplicationRow[];
  if (rows.length === 0) throw validationFailed(NO_SAVED);
  let leftOut = 0;
  if (rows.length > RESUME_ZIP_MAX_APPLICATIONS) {
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM applications a WHERE ${saved}`).get(userId) as { n: number };
    leftOut = Math.max(0, n - RESUME_ZIP_MAX_APPLICATIONS);
  }
  return { applications: rows.slice(0, RESUME_ZIP_MAX_APPLICATIONS).map(toApplication), leftOut };
}

// --------------------------------------------------------------------------------------------- which resume

/** What is stored about the account's resumes: enough to choose and to add up sizes, no document and no text. */
export interface ResumeFacts {
  byId: Map<string, { kind: 'built' | 'uploaded'; fileBytes: number | null }>;
  /** What an application with no resume linked gets: the default resume, else the most recently updated one. */
  fallbackId: string | null;
  fallbackIsDefault: boolean;
}

export function resumeFacts(db: Db, userId: string): ResumeFacts {
  const rows = db
    .prepare(
      `SELECT r.id, r.kind, f.size_bytes AS file_bytes FROM resumes r
       LEFT JOIN stored_files f ON f.id = r.file_id AND f.user_id = r.user_id
       WHERE r.user_id = ? ORDER BY r.updated_at DESC, r.created_at DESC, r.id ASC`,
    )
    .all(userId) as Array<{ id: string; kind: 'built' | 'uploaded'; file_bytes: number | null }>;
  const byId = new Map(rows.map((row) => [row.id, { kind: row.kind, fileBytes: row.file_bytes }]));
  const user = db.prepare('SELECT default_resume_id FROM users WHERE id = ?').get(userId) as
    | { default_resume_id: string | null }
    | undefined;
  const defaultId = user?.default_resume_id ?? null;
  const fallbackIsDefault = defaultId !== null && byId.has(defaultId);
  return { byId, fallbackId: fallbackIsDefault ? defaultId : (rows[0]?.id ?? null), fallbackIsDefault };
}

/** One application and the resume it gets. */
export interface Assignment {
  application: ZipApplication;
  resumeId: string;
  /** No resume was linked: it gets the fallback (the default resume). */
  usedDefault: boolean;
}

/** Each application's resume: the linked one, else the fallback. Call only when the account has a resume. */
export function assignResumes(applications: readonly ZipApplication[], facts: ResumeFacts): Assignment[] {
  const fallback = facts.fallbackId;
  if (!fallback) throw validationFailed(NO_RESUMES);
  return applications.map((application) => {
    const linked = application.resumeId !== null && facts.byId.has(application.resumeId) ? application.resumeId : null;
    return { application, resumeId: linked ?? fallback, usedDefault: linked === null };
  });
}

/** The zip's size from what is stored, before anything is read: each upload's size, an estimate per built resume. */
export function estimatedZipBytes(assignments: readonly Assignment[], facts: ResumeFacts): number {
  let total = 0;
  for (const assignment of assignments) {
    const fact = facts.byId.get(assignment.resumeId);
    total += fact?.kind === 'uploaded' ? (fact.fileBytes ?? 0) : BUILT_RESUME_ESTIMATE_BYTES;
  }
  return total;
}

/**
 * The checks a request answers at once, from stored data only (nothing is read from disk): the scope (404/400), a
 * resume to use (400) and the size cap (413, `file_too_large`). The build checks the same again after the due choices.
 */
export function prepareResumeZip(db: Db, userId: string, ids: readonly string[] | undefined, maxBytes: number): ZipScope {
  const scope = selectScope(db, userId, ids);
  const facts = resumeFacts(db, userId);
  if (facts.byId.size === 0) throw validationFailed(NO_RESUMES);
  assertZipFits(estimatedZipBytes(assignResumes(scope.applications, facts), facts), maxBytes);
  return scope;
}

function assertZipFits(bytes: number, maxBytes: number): void {
  if (bytes > maxBytes) throw new AppError('file_too_large', tooLarge(maxBytes));
}

// ---------------------------------------------------------------------------------------------- the resumes

interface ZipResume {
  id: string;
  kind: 'built' | 'uploaded';
  label: string;
  /** "First_Last" for its file names, or null ("resume.pdf"). */
  stem: string | null;
  built: { title: string | null; templateId: string | null; document: ResumeDocument } | null;
  /** An upload's stored file (null when its row is gone) and extension. */
  upload: { path: string; extension: string } | null;
  /** How many applications of this zip use it (progress). */
  uses: number;
}

const RESUME_COLUMNS = `r.id, r.user_id, r.kind, r.title, r.template_id, r.data, r.file_id, r.source_resume_id,
  r.created_at, r.updated_at, r.last_edited_at, f.original_name AS file_name, f.mime AS file_mime,
  f.size_bytes AS file_size, f.page_count AS file_pages, f.thumb_path AS file_thumb`;

/** The person's name read from each upload (WP3's reading), where there is one. Never fails a build. */
function uploadPersonNames(deps: AppDeps, userId: string, ids: readonly string[]): Map<string, string | null> {
  const names = new Map<string, string | null>();
  if (ids.length === 0) return names;
  try {
    const readings = currentResumeAnalyses(deps, userId, { resumeIds: ids, computeLimit: NAME_READINGS_COMPUTED });
    for (const id of ids) names.set(id, readings.get(id)?.data.personName ?? null);
  } catch (error) {
    deps.log.warn(`[resume-zip] could not read the names on the uploads of account ${userId}; the account name is used`, error);
  }
  return names;
}

/** Rows read (and documents normalised) between two turns of the event loop. */
const ROWS_PER_TURN = 25;

/** The resumes the zip uses, by id: labels, documents (built), stored files (uploads) and the name for file names. */
async function loadResumes(
  deps: AppDeps,
  userId: string,
  assignments: readonly Assignment[],
  defaultId: string | null,
  signal: AbortSignal,
): Promise<Map<string, ZipResume>> {
  // In the order the zip first uses them (the tracker's), so the work is done in that order too.
  const uses = new Map<string, number>();
  for (const assignment of assignments) uses.set(assignment.resumeId, (uses.get(assignment.resumeId) ?? 0) + 1);
  const ids = [...uses.keys()];
  const found = new Map<string, ResumeListRow>();
  for (let start = 0; start < ids.length; start += RESUME_ZIP_MAX_APPLICATIONS) {
    const chunk = ids.slice(start, start + RESUME_ZIP_MAX_APPLICATIONS);
    const chunkRows = deps.db
      .prepare(
        `SELECT ${RESUME_COLUMNS} FROM resumes r LEFT JOIN stored_files f ON f.id = r.file_id AND f.user_id = r.user_id
         WHERE r.user_id = ? AND r.id IN (${chunk.map(() => '?').join(', ')})`,
      )
      .all(userId, ...chunk) as ResumeListRow[];
    for (const row of chunkRows) found.set(row.id, row);
  }
  const rows = ids.flatMap((id) => found.get(id) ?? []);
  const account = deps.db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string } | undefined;
  const accountStem = personFileStem(account?.name);
  const uploadNames = uploadPersonNames(
    deps,
    userId,
    rows.filter((row) => row.kind === 'uploaded').map((row) => row.id),
  );
  const store = getFileStore(deps);
  const resumes = new Map<string, ZipResume>();
  for (const [index, row] of rows.entries()) {
    if (index > 0 && index % ROWS_PER_TURN === 0) {
      await setImmediate();
      signal.throwIfAborted();
    }
    const summary = toSummary(deps, row, defaultId);
    let built: ZipResume['built'] = null;
    let upload: ZipResume['upload'] = null;
    let ownName: string | null;
    if (row.kind === 'built') {
      const document = documentOf(row) ?? normalizeResumeDocument({});
      built = { title: summary.title, templateId: document.preferredTemplate || null, document };
      ownName = document.name;
    } else {
      const file = row.file_id ? store.get(row.file_id, userId) : null;
      if (file?.kind) upload = { path: store.pathOf(file), extension: EXTENSION_BY_KIND[file.kind].replace(/^\./, '') };
      ownName = uploadNames.get(row.id) ?? null;
    }
    resumes.set(row.id, {
      id: row.id,
      kind: row.kind,
      label: summary.label,
      stem: personFileStem(ownName) ?? accountStem,
      built,
      upload,
      uses: uses.get(row.id) ?? 0,
    });
  }
  return resumes;
}

// ------------------------------------------------------------------------------------------------ rendering

/** A file ready to go into the zip. */
interface ZipSource {
  path: string;
  extension: string;
}

/** Why a resume could not go into the zip: its upload's file is gone, or it could not be rendered. */
type Failure = { failed: 'missing' | 'not_made'; reason: string };

type Outcome = { source: ZipSource; word: boolean } | Failure;

export interface ZipBuildOptions {
  /** The size cap (413 `file_too_large` above it). */
  maxBytes: number;
  /** A PDF is started only while at least this much of the deadline is left (Word files after that). */
  pdfReserveMs: number;
  /** The longest one PDF waits for a free Chrome page before it becomes a Word file. */
  pdfWaitMs: number;
  /** The time the due choices may take. */
  drainBudgetMs: number;
}

/** A PdfService that waits at most `waitMs` for a page and stops with the build (exportBuiltResume reads deps.services). */
function withPrintControl(deps: AppDeps, control: { signal: AbortSignal; waitMs: number }): AppDeps {
  const pdf = getPdfService(deps);
  const limited: PdfService = {
    printPdf: (html, options) => pdf.printPdf(html, { ...options, signal: control.signal, waitMs: control.waitMs }),
    screenshotPng: (html, options) => pdf.screenshotPng(html, options),
    available: () => pdf.available(),
    executablePath: () => pdf.executablePath(),
    close: () => pdf.close(),
  };
  return { ...deps, services: { ...deps.services, pdf: limited } };
}

function chromeAvailable(deps: AppDeps): boolean {
  try {
    return getPdfService(deps).available();
  } catch {
    return false; // no PDF service on this server
  }
}

function stopReason(signal: AbortSignal, error: unknown): unknown {
  return signal.aborted ? (signal.reason ?? error) : error;
}

/**
 * `work`, or a rejection with the signal's reason as soon as it aborts, even when `work` itself ignores the signal: a
 * render or a choice that hangs must never keep a build (and with it the server's one build slot) running.
 */
export function unlessAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  work.catch(() => undefined);
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

interface RenderContext {
  dir: string;
  signal: AbortSignal;
  deadlineAt: number;
  options: ZipBuildOptions;
  onDone: (resume: ZipResume) => void;
}

/**
 * Renders each built resume once: a PDF while Chrome works and time allows, else (or when the PDF fails) a Word file;
 * a resume neither can make is a failure with its reason. The files go to the build's folder, not to memory.
 */
async function renderBuilt(deps: AppDeps, userId: string, resumes: readonly ZipResume[], context: RenderContext): Promise<Map<string, Outcome>> {
  const { signal, options } = context;
  const outcomes = new Map<string, Outcome>();
  if (resumes.length === 0) return outcomes;
  let chrome = chromeAvailable(deps);
  if (!chrome) deps.log.info('[resume-zip] no browser to print PDFs with: built resumes are added as Word files');
  const pdfDeps = chrome ? withPrintControl(deps, { signal, waitMs: options.pdfWaitMs }) : deps;

  const save = async (buffer: Buffer, index: number, extension: string): Promise<ZipSource> => {
    const path = join(context.dir, `render-${index}.${extension}`);
    await writeFile(path, buffer, { signal });
    return { path, extension };
  };

  const renderOne = async (resume: ZipResume, index: number): Promise<Outcome> => {
    const input = { label: resume.label, ...resume.built! };
    if (chrome && context.deadlineAt - Date.now() > options.pdfReserveMs) {
      try {
        const pdf = await unlessAborted(exportBuiltResume(pdfDeps, userId, input, 'pdf'), signal);
        return { source: await save(pdf.buffer, index, 'pdf'), word: false };
      } catch (error) {
        if (signal.aborted) throw stopReason(signal, error);
        if (error instanceof AppError && error.code === 'browser_unavailable') {
          chrome = false;
          deps.log.warn('[resume-zip] Chrome is unavailable: the remaining built resumes are added as Word files', error);
        } else {
          deps.log.warn(`[resume-zip] resume ${resume.id} could not be printed as a PDF; it is added as a Word file`, error);
        }
      }
    }
    try {
      const docx = await unlessAborted(exportBuiltResume(deps, userId, input, 'docx'), signal);
      return { source: await save(docx.buffer, index, 'docx'), word: true };
    } catch (error) {
      if (signal.aborted) throw stopReason(signal, error);
      deps.log.warn(`[resume-zip] resume ${resume.id} could not be made into a Word file either`, error);
      return { failed: 'not_made', reason: notMade(resume.label) };
    }
  };

  let next = 0;
  const worker = async () => {
    for (;;) {
      signal.throwIfAborted();
      const index = next;
      next += 1;
      const resume = resumes[index];
      if (!resume) return;
      outcomes.set(resume.id, await renderOne(resume, index));
      context.onDone(resume);
    }
  };
  const workers = Math.min(resumes.length, Math.max(1, deps.config.render.pdfMaxConcurrency - 1));
  // Every worker is settled before this returns, so none writes into the folder after the build cleaned it.
  const results = await Promise.allSettled(Array.from({ length: workers }, () => worker()));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
  return outcomes;
}

// --------------------------------------------------------------------------------------------------- the zip

/** A file read only when its entry's turn comes, so a zip of 500 entries never holds 500 files open. */
function lazyFile(path: string, signal: AbortSignal): Readable {
  async function* chunks() {
    yield* createReadStream(path, { signal });
  }
  return Readable.from(chunks(), { objectMode: false });
}

interface ZipEntryPlan {
  path: string;
  source: ZipSource;
}

/**
 * Writes the zip to `target`: STORE entries (no compression: PDFs and Word files are compressed already), UTF-8 names
 * (jszip sets the language encoding flag for any name that is not ASCII), every entry dated `date`, and each entry's
 * sizes in its local header (no data descriptors, which some readers refuse on stored entries).
 */
async function writeZip(target: string, entries: readonly ZipEntryPlan[], skipped: string | null, date: Date, signal: AbortSignal): Promise<void> {
  const zip = new JSZip();
  const options = { binary: true, compression: 'STORE' as const, date, createFolders: false };
  if (skipped !== null) zip.file(SKIPPED_FILE, Buffer.from(skipped, 'utf8'), options);
  const streams: Readable[] = [];
  for (const entry of entries) {
    const stream = lazyFile(entry.source.path, signal);
    streams.push(stream);
    zip.file(entry.path, stream, options);
  }
  const partial = `${target}.part`;
  try {
    await pipeline(
      zip.generateNodeStream({ type: 'nodebuffer', compression: 'STORE', platform: 'DOS', streamFiles: false }),
      createWriteStream(partial, { flags: 'wx' }),
      { signal },
    );
    await rename(partial, target);
  } finally {
    for (const stream of streams) stream.destroy();
    await rm(partial, { force: true });
  }
}

// -------------------------------------------------------------------------------------------------- a build

export interface ZipCounts {
  included: number;
  skipped: number;
  word: number;
  leftOut: number;
  usedDefault: number;
}

export interface ZipBuildInput {
  userId: string;
  /** The applications, in the tracker's order (from `prepareResumeZip`). */
  applicationIds: readonly string[];
  leftOut: number;
  /** The person's offset east of UTC: the entries' times are their local time. */
  tzOffsetMinutes: number;
  /** The build's own folder (created here; the caller removes it). */
  dir: string;
  /** Stops the build (the deadline, a shutdown). */
  signal: AbortSignal;
  /** Date.now() past which the build is stopped (the PDF reserve is counted from it). */
  deadlineAt: number;
  progress: { setTotal(total: number): void; advance(count: number): void };
}

export interface ZipBuildResult {
  file: string;
  size: number;
  counts: ZipCounts;
}

const statusLabel = (status: number) => STATUS_INFO[status as ApplicationStatus]?.label ?? 'Saved';

function skippedEntry(application: ZipApplication): SkippedApplication {
  return { company: application.companyName, role: application.title, status: statusLabel(application.status) };
}

/** The selection's due choices, within the budget. Never fails a build: the links are then used as they are. */
async function drainChoices(deps: AppDeps, input: ZipBuildInput, budgetMs: number): Promise<void> {
  const service = deps.services.resumeMatch;
  if (!service) return;
  try {
    const { pending } = await unlessAborted(
      service.ensureChoices(input.userId, input.applicationIds, { budgetMs, signal: input.signal }),
      input.signal,
    );
    if (pending > 0) {
      deps.log.info(`[resume-zip] ${pending} of the selection's resume choices were not made in time; the default resume is used for them`);
    }
  } catch (error) {
    if (input.signal.aborted) throw stopReason(input.signal, error);
    deps.log.warn(`[resume-zip] could not make the due resume choices of account ${input.userId}; the links are used as they are`, error);
  }
}

/** Builds the zip into `input.dir`. Throws an AppError with the sentence to show, or the signal's reason when stopped. */
export async function buildResumeZip(deps: AppDeps, input: ZipBuildInput, options: ZipBuildOptions): Promise<ZipBuildResult> {
  const { userId, signal } = input;
  await mkdir(input.dir, { recursive: true });
  getResumeEngine(deps);

  await drainChoices(deps, input, options.drainBudgetMs);
  signal.throwIfAborted();

  // The applications and resumes as they are now (one may have been deleted, or linked, since the request).
  const applications = applicationsByIds(deps.db, userId, input.applicationIds);
  if (applications.length === 0) throw new AppError('not_found', NONE_OF_THOSE);
  const facts = resumeFacts(deps.db, userId);
  if (facts.byId.size === 0) throw validationFailed(NO_RESUMES);
  const assignments = assignResumes(applications, facts);
  assertZipFits(estimatedZipBytes(assignments, facts), options.maxBytes);
  input.progress.setTotal(assignments.length);

  const resumes = await loadResumes(deps, userId, assignments, facts.fallbackIsDefault ? facts.fallbackId : null, signal);
  const outcomes = new Map<string, Outcome>();
  for (const resume of resumes.values()) {
    if (resume.kind !== 'uploaded') continue;
    signal.throwIfAborted();
    const upload = resume.upload;
    const present = upload ? await stat(upload.path).then((info) => info.isFile(), () => false) : false;
    outcomes.set(
      resume.id,
      upload && present ? { source: upload, word: false } : { failed: 'missing', reason: missingFile(resume.label) },
    );
    input.progress.advance(resume.uses);
  }
  const built = [...resumes.values()].filter((resume) => resume.kind === 'built');
  const rendered = await renderBuilt(deps, userId, built, {
    dir: input.dir,
    signal,
    deadlineAt: input.deadlineAt,
    options,
    onDone: (resume) => input.progress.advance(resume.uses),
  });
  for (const [id, outcome] of rendered) outcomes.set(id, outcome);

  // The entries, in the tracker's order.
  const included: Array<{ assignment: Assignment; resume: ZipResume; source: ZipSource; word: boolean }> = [];
  const skipped: Array<SkippedApplication & { reason: string }> = [];
  for (const assignment of assignments) {
    const resume = resumes.get(assignment.resumeId);
    const outcome = resume ? outcomes.get(resume.id) : undefined;
    if (resume && outcome && 'source' in outcome) {
      included.push({ assignment, resume, source: outcome.source, word: outcome.word });
    } else {
      const reason = outcome && 'failed' in outcome ? outcome.reason : goneResume(resume?.label ?? 'The resume');
      skipped.push({ ...skippedEntry(assignment.application), reason });
    }
  }
  if (included.length === 0) {
    // One sentence for an empty result: the files are missing, or (any other mix) they could not be made now.
    const allMissing = [...outcomes.values()].every((outcome) => 'failed' in outcome && outcome.failed === 'missing');
    throw allMissing ? new AppError('not_found', ALL_MISSING) : new AppError('render_failed', ALL_FAILED);
  }

  const folders = planFolders(
    included.map(({ assignment }) => ({
      id: assignment.application.id,
      companyName: assignment.application.companyName,
      title: assignment.application.title,
    })),
  );
  const entries: ZipEntryPlan[] = included.map(({ assignment, resume, source }) => ({
    path: `${folders.get(assignment.application.id)!}/${resumeFileName(resume.stem, source.extension)}`,
    source,
  }));
  const usedDefault = included.filter(({ assignment }) => assignment.usedDefault);
  const fallback = facts.fallbackId ? resumes.get(facts.fallbackId) : undefined;
  const report = {
    skipped,
    usedDefault:
      usedDefault.length > 0
        ? {
            label: fallback?.label ?? 'Untitled resume',
            isDefault: facts.fallbackIsDefault,
            applications: usedDefault.map(({ assignment }) => skippedEntry(assignment.application)),
          }
        : null,
    leftOut: input.leftOut,
    maxApplications: RESUME_ZIP_MAX_APPLICATIONS,
  };

  const file = join(input.dir, ZIP_FILE);
  // jszip writes each entry's time from the date's UTC fields: shifted by the offset, they read as local time.
  const date = new Date(deps.now().getTime() + input.tzOffsetMinutes * 60_000);
  await writeZip(file, entries, needsSkippedFile(report) ? skippedText(report) : null, date, signal);
  // The rendered files are in the zip now; only the zip stays until it is downloaded.
  await Promise.all(
    [...rendered.values()].map((outcome) => ('source' in outcome ? rm(outcome.source.path, { force: true }) : undefined)),
  );
  const { size } = await stat(file);
  return {
    file,
    size,
    counts: {
      included: included.length,
      skipped: skipped.length,
      word: included.filter((entry) => entry.word).length,
      leftOut: input.leftOut,
      usedDefault: usedDefault.length,
    },
  };
}
