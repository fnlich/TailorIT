import {
  APPLICATION_STATUSES,
  STATUS,
  buildContactLine,
  composeLetterHtml,
  defaultLetterTitle,
  escapeHtml,
  letterVariableValues,
  normalizeResumeDocument,
  resumeLabel,
  substituteVariables,
  toIsoDate,
  type ApplicationStatus,
  type ResumeDocument,
} from '@tailorit/shared';
import type { AppDeps } from '../../core/context';
import { findOrCreateUser, getUserByEmail, isEmailAddress, normalizeEmail } from '../../core/auth/users';
import { transaction } from '../../core/db/connection';
import { getFileStore } from '../../core/files/index';
import { getPdfService } from '../../core/pdf/index';
import { changeStatus, createApplication, createQuestion, patchApplication, setArchived } from '../applications/service';
import { createTemplateRepository } from '../cover-letter-templates/repository';
import { applicationFacts, letterProfile } from '../cover-letters/context';
import { letterDocx } from '../cover-letters/export';
import { extractUploadHtml, titleFromFileName } from '../cover-letters/extract';
import { createLetterRepository } from '../cover-letters/repository';
import { sanitizeLetterHtml } from '../cover-letters/sanitize';
import { SEED_SOURCE_NAME, seedDemoJobs } from '../ingest/seed';
import { savePreferences } from '../me/preferences';
import { getResumeEvidence } from '../resumes/evidence';
import { exportBuiltResume } from '../resumes/export';
import { insertResume } from '../resumes/repository';
import { readUpload } from '../resumes/upload';
import {
  DEMO_APPLICATIONS,
  DEMO_EMAIL,
  DEMO_NAME,
  DEMO_PREFERENCES,
  DEMO_RESUMES,
  DEMO_TEMPLATES,
  DEMO_UPLOAD,
  GENERATED_LETTER,
  TEMPLATE_LETTER,
  UPLOADED_LETTER,
  type DemoApplication,
  type DemoResumeKey,
} from './content';

// `npm run seed:demo`: the demo jobs (J1's seed) plus a fully populated account, written through the features' own
// functions (resume repository, tracker service with the shared status rules, letter and template repositories) so
// the data reads exactly like data made in the app. No AI is called. Idempotent: what was seeded is recorded in
// app_settings (`demo_seed:<userId>`), a second run leaves the account alone, and `refresh` removes what the seed
// wrote (for the demo address: everything in the account) and writes it again.

export interface DemoSeedOptions {
  /** The account to fill (created when it does not exist). Default demo@tailorit.dev ("Alex Rivera"). */
  email?: string;
  /** Rebuild: remove the seeded data and write it again (and re-date the demo jobs). */
  refresh?: boolean;
  /** Make the uploaded PDF resume (needs Chrome or Edge). Default true; skipped with a note when none is installed. */
  pdf?: boolean;
}

export interface DemoSeedResult {
  email: string;
  userId: string;
  accountCreated: boolean;
  /** True when the account already had the demo data and `refresh` was not given: nothing was written. */
  alreadySeeded: boolean;
  seededAt: string;
  jobs: { status: string; fetched: number; created: number; updated: number; unchanged: number; failed: number };
  resumes: { built: number; uploaded: number; defaultLabel: string | null };
  /** Why the uploaded PDF resume was not made, or null when it was. */
  uploadSkipped: string | null;
  applications: {
    total: number;
    byStatus: Record<string, number>;
    fromJobBoard: number;
    favorites: number;
    archived: number;
    withNotes: number;
    withQuestions: number;
    /** Plans left out because the account already tracks that job (only for an existing account). */
    skipped: number;
  };
  coverLetters: number;
  templates: number;
}

/** What one seeding wrote, so a refresh can remove exactly that. */
interface DemoMarker {
  version: 1;
  email: string;
  seededAt: string;
  resumes: string[];
  letters: string[];
  templates: string[];
  applications: string[];
  files: string[];
}

const MARKER_PREFIX = 'demo_seed:';
const DAY_MS = 86_400_000;

export class DemoSeedError extends Error {}

// ------------------------------------------------------------------------------------------------------ clock

/**
 * Days and times relative to the seed's "now", on the local calendar (the person's own days, as the tracker dates
 * events). A time is never later than now.
 */
function demoClock(anchor: Date) {
  const latest = anchor.getTime() - 60_000;
  const dateOf = (daysAgo: number) => new Date(anchor.getTime() - daysAgo * DAY_MS);
  return {
    day: (daysAgo: number) => toIsoDate(dateOf(daysAgo))!,
    time: (daysAgo: number, hour = 10, minute = 0) => {
      const date = dateOf(daysAgo);
      const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute).getTime();
      return new Date(Math.min(at, latest));
    },
  };
}

/** The same dependencies with the clock stopped at `time` (rows written through it carry that time). */
function at<T extends Pick<AppDeps, 'now'>>(deps: T, time: Date): T {
  return { ...deps, now: () => time };
}

// ----------------------------------------------------------------------------------------------------- marker

function readMarker(deps: Pick<AppDeps, 'db'>, userId: string): DemoMarker | null {
  const row = deps.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(`${MARKER_PREFIX}${userId}`) as
    | { value: string }
    | undefined;
  if (!row) return null;
  try {
    const value = JSON.parse(row.value) as DemoMarker;
    return value && value.version === 1 ? value : null;
  } catch {
    return null;
  }
}

function writeMarker(deps: Pick<AppDeps, 'db'>, userId: string, marker: DemoMarker, now: string): void {
  deps.db
    .prepare(
      `INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(`${MARKER_PREFIX}${userId}`, JSON.stringify(marker), now);
}

/** Markers of accounts that no longer exist. */
function forgetOrphanMarkers(deps: Pick<AppDeps, 'db'>): void {
  deps.db
    .prepare(
      `DELETE FROM app_settings WHERE key LIKE '${MARKER_PREFIX}%'
         AND substr(key, ${MARKER_PREFIX.length + 1}) NOT IN (SELECT id FROM users)`,
    )
    .run();
}

/**
 * Removes what an earlier seeding wrote. The demo address's account is the seed's own, so everything in it goes (it
 * comes back as seeded); any other account loses only the rows the marker lists.
 */
function purge(deps: AppDeps, userId: string, marker: DemoMarker | null, wholeAccount: boolean): void {
  const files: string[] = [];
  transaction(deps.db, () => {
    const db = deps.db;
    const inList = (ids: readonly string[]) => ids.map(() => '?').join(',') || "''";
    if (wholeAccount) {
      const owned = db.prepare('SELECT id FROM stored_files WHERE user_id = ?').all(userId) as Array<{ id: string }>;
      files.push(...owned.map((row) => row.id));
      for (const table of ['applications', 'cover_letters', 'resumes', 'user_skills', 'saved_searches', 'user_job_state', 'user_hidden_companies']) {
        db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
      }
      db.prepare('DELETE FROM cover_letter_templates WHERE user_id = ? AND is_system = 0').run(userId);
      db.prepare('UPDATE users SET default_resume_id = NULL WHERE id = ?').run(userId);
    } else if (marker) {
      files.push(...marker.files);
      db.prepare(`DELETE FROM applications WHERE user_id = ? AND id IN (${inList(marker.applications)})`).run(userId, ...marker.applications);
      db.prepare(`DELETE FROM cover_letters WHERE user_id = ? AND id IN (${inList(marker.letters)})`).run(userId, ...marker.letters);
      db.prepare(`DELETE FROM cover_letter_templates WHERE user_id = ? AND is_system = 0 AND id IN (${inList(marker.templates)})`).run(
        userId,
        ...marker.templates,
      );
      db.prepare(`DELETE FROM resumes WHERE user_id = ? AND id IN (${inList(marker.resumes)})`).run(userId, ...marker.resumes);
    }
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(`${MARKER_PREFIX}${userId}`);
  });
  const store = getFileStore(deps);
  for (const id of files) {
    try {
      store.remove(id, userId);
    } catch (error) {
      deps.log.warn(`[demo] could not remove stored file ${id}`, error);
    }
  }
}

// ------------------------------------------------------------------------------------------------------- jobs

/** The demo jobs by their seed id (static/seed/jobs.json), as database ids. */
function seedJobIds(deps: Pick<AppDeps, 'db'>): Map<string, number> {
  const rows = deps.db
    .prepare(
      `SELECT l.source_job_id AS seedId, l.job_id AS jobId FROM job_source_links l
         JOIN job_sources s ON s.id = l.source_id WHERE s.kind = 'seed' AND s.name = ?`,
    )
    .all(SEED_SOURCE_NAME) as Array<{ seedId: string; jobId: number }>;
  return new Map(rows.map((row) => [row.seedId, row.jobId]));
}

// ------------------------------------------------------------------------------------------------------ seed

interface PreparedUpload {
  fileId: string;
  text: string | null;
}

/** The uploaded resume: the platform resume printed by the PDF service, stored as an upload would be. */
async function prepareResumeUpload(
  deps: AppDeps,
  userId: string,
  documents: Map<DemoResumeKey, ResumeDocument>,
): Promise<{ upload: PreparedUpload | null; skipped: string | null }> {
  const pdf = getPdfService(deps);
  if (!pdf.available()) {
    return { upload: null, skipped: 'no Chrome or Edge was found (set CHROME_PATH or run npm run setup:browser)' };
  }
  const document = documents.get(DEMO_UPLOAD.from)!;
  const exported = await exportBuiltResume(
    deps,
    userId,
    { label: resumeLabel(document), title: null, templateId: document.preferredTemplate || null, document },
    'pdf',
  );
  const reading = await readUpload(deps, exported.buffer, 'pdf');
  const store = getFileStore(deps);
  const stored = store.save({ userId, purpose: 'resume', buffer: exported.buffer, originalName: DEMO_UPLOAD.fileName });
  // As an upload: the picture and the page count are best effort.
  try {
    if (reading.thumbnail) store.saveThumbnail(stored.id, reading.thumbnail);
  } catch (error) {
    deps.log.warn('[demo] could not store the uploaded resume thumbnail', error);
  }
  if (reading.pageCount) store.setPageCount(stored.id, reading.pageCount);
  return { upload: { fileId: stored.id, text: reading.text }, skipped: null };
}

/** The uploaded cover letter: the text saved as a Word file (no browser needed) and read back as an upload is. */
async function prepareLetterUpload(deps: AppDeps, userId: string): Promise<{ fileId: string; html: string; title: string }> {
  const buffer = await letterDocx({
    title: titleFromFileName(UPLOADED_LETTER.fileName),
    contentHtml: UPLOADED_LETTER.html,
    fontFamily: 'Times New Roman',
  });
  const { html } = await extractUploadHtml(buffer);
  const stored = getFileStore(deps).save({ userId, purpose: 'letter_import', buffer, originalName: UPLOADED_LETTER.fileName });
  return { fileId: stored.id, html: sanitizeLetterHtml(html), title: titleFromFileName(UPLOADED_LETTER.fileName) };
}

function notesHtml(lines: readonly string[]): string {
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
}

export async function seedDemo(deps: AppDeps, options: DemoSeedOptions = {}): Promise<DemoSeedResult> {
  const email = normalizeEmail(options.email ?? DEMO_EMAIL);
  if (!isEmailAddress(email)) throw new DemoSeedError(`"${options.email}" is not an email address.`);
  const ownsAccount = email === DEMO_EMAIL;

  // 1. The demo jobs (idempotent; refresh re-dates them so "posted this week" is true again).
  const run = await seedDemoJobs(deps, { refresh: options.refresh });
  if (run.status === 'failed') throw new DemoSeedError(`The demo jobs could not be loaded: ${run.error ?? 'unknown error'}`);
  const jobs = { status: run.status, fetched: run.fetched, created: run.created, updated: run.updated, unchanged: run.unchanged, failed: run.failed };

  // 2. The account.
  const existing = getUserByEmail(deps, email);
  const { user, created: accountCreated } = existing
    ? { user: existing, created: false }
    : findOrCreateUser(deps, { email, ...(ownsAccount ? { name: DEMO_NAME } : {}) });
  if (ownsAccount && user.name !== DEMO_NAME) {
    deps.db.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').run(DEMO_NAME, deps.now().toISOString(), user.id);
  }
  const userId = user.id;
  forgetOrphanMarkers(deps);

  const previous = readMarker(deps, userId);
  const emptyResult = (seededAt: string, alreadySeeded: boolean): DemoSeedResult => ({
    email,
    userId,
    accountCreated,
    alreadySeeded,
    seededAt,
    jobs,
    resumes: { built: 0, uploaded: 0, defaultLabel: null },
    uploadSkipped: null,
    applications: { total: 0, byStatus: {}, fromJobBoard: 0, favorites: 0, archived: 0, withNotes: 0, withQuestions: 0, skipped: 0 },
    coverLetters: 0,
    templates: 0,
  });
  if (previous && !options.refresh) return emptyResult(previous.seededAt, true);
  if (options.refresh || ownsAccount) purge(deps, userId, previous, ownsAccount);

  // 3. Files first (they need the PDF service and the file store, outside the database transaction).
  const anchor = deps.now();
  const clock = demoClock(anchor);
  const documents = new Map<DemoResumeKey, ResumeDocument>(
    DEMO_RESUMES.map((resume) => [resume.key, normalizeResumeDocument(resume.document)]),
  );
  const savedFiles: string[] = [];
  let resumeUpload: PreparedUpload | null = null;
  let uploadSkipped: string | null = null;
  try {
    if (options.pdf === false) {
      uploadSkipped = 'skipped on request (--no-pdf)';
    } else {
      try {
        const prepared = await prepareResumeUpload(deps, userId, documents);
        resumeUpload = prepared.upload;
        uploadSkipped = prepared.skipped;
        if (resumeUpload) savedFiles.push(resumeUpload.fileId);
      } catch (error) {
        // The browser would not print: the rest of the data set is still worth having.
        uploadSkipped = `the PDF could not be printed (${error instanceof Error ? error.message : String(error)})`;
      }
    }
    const letterUpload = await prepareLetterUpload(deps, userId);
    savedFiles.push(letterUpload.fileId);

    // 4. Everything else in one transaction.
    return transaction(deps.db, () => {
      const marker: DemoMarker = {
        version: 1,
        email,
        seededAt: anchor.toISOString(),
        resumes: [],
        letters: [],
        templates: [],
        applications: [],
        files: [...savedFiles],
      };
      const result = emptyResult(marker.seededAt, false);
      result.uploadSkipped = uploadSkipped;

      // Preferences: the demo account's always; another account's only when it has none.
      const hasPreferences = deps.db.prepare('SELECT 1 FROM user_preferences WHERE user_id = ?').get(userId);
      if (ownsAccount || !hasPreferences) savePreferences(at(deps, clock.time(118, 9)), userId, DEMO_PREFERENCES);

      // Resumes.
      const resumeIds = new Map<DemoResumeKey | 'upload', string>();
      for (const resume of DEMO_RESUMES) {
        const document = documents.get(resume.key)!;
        const id = insertResume(at(deps, clock.time(resume.createdDaysAgo, 9, 30)), userId, { kind: 'built', document });
        const edited = clock.time(resume.editedDaysAgo, 16, 20).toISOString();
        deps.db.prepare('UPDATE resumes SET updated_at = ?, last_edited_at = ? WHERE id = ?').run(edited, edited, id);
        resumeIds.set(resume.key, id);
        marker.resumes.push(id);
        result.resumes.built += 1;
      }
      if (resumeUpload) {
        // Read by the rules like any upload; Claude is not asked (the seed calls no AI).
        const id = insertResume(at(deps, clock.time(DEMO_UPLOAD.createdDaysAgo, 11)), userId, {
          kind: 'uploaded',
          fileId: resumeUpload.fileId,
          extractedText: resumeUpload.text,
          aiRefine: false,
        });
        resumeIds.set('upload', id);
        marker.resumes.push(id);
        result.resumes.uploaded += 1;
      }
      const platformId = resumeIds.get('platform')!;
      const currentDefault = deps.db.prepare('SELECT default_resume_id AS id FROM users WHERE id = ?').get(userId) as { id: string | null };
      if (ownsAccount || !currentDefault.id) {
        deps.db.prepare('UPDATE users SET default_resume_id = ? WHERE id = ?').run(platformId, userId);
      }
      const defaultId = (deps.db.prepare('SELECT default_resume_id AS id FROM users WHERE id = ?').get(userId) as { id: string | null }).id;
      const defaultDocument = [...resumeIds].find(([, id]) => id === defaultId)?.[0];
      result.resumes.defaultLabel =
        defaultDocument && defaultDocument !== 'upload' ? resumeLabel(documents.get(defaultDocument)!) : defaultId ? 'your own resume' : null;

      // Applications.
      const jobIds = seedJobIds(deps);
      const tracked = new Set(
        (deps.db.prepare('SELECT job_id FROM applications WHERE user_id = ? AND job_id IS NOT NULL').all(userId) as Array<{ job_id: number }>).map(
          (row) => row.job_id,
        ),
      );
      const applicationIds = new Map<string, string>();
      for (const plan of DEMO_APPLICATIONS) {
        const id = seedApplication(deps, clock, userId, plan, jobIds, tracked, resumeIds, result);
        if (!id) continue;
        applicationIds.set(plan.key, id);
        marker.applications.push(id);
      }

      // Cover letters: "generated" (the no-template wrapper), from a starter template, and uploaded.
      const profile = letterProfile(getResumeEvidence(deps, userId, platformId)!);
      const linkLetter = (applicationKey: string, letterId: string, time: Date) => {
        const applicationId = applicationIds.get(applicationKey);
        if (applicationId) patchApplication(at(deps, time), userId, applicationId, { coverLetterId: letterId });
      };
      const factsFor = (applicationKey: string) => {
        const applicationId = applicationIds.get(applicationKey);
        return applicationId ? applicationFacts(deps, userId, applicationId) : null;
      };

      {
        const created = clock.time(GENERATED_LETTER.createdDaysAgo, 20, 15);
        const facts = factsFor(GENERATED_LETTER.application);
        const html = sanitizeLetterHtml(
          composeLetterHtml({ name: profile.fullName, contactLine: buildContactLine(profile), paragraphs: GENERATED_LETTER.paragraphs }),
        );
        const row = createLetterRepository(at(deps, created)).create(userId, {
          title: defaultLetterTitle(created),
          origin: 'generated',
          contentHtml: html,
          applicationId: facts?.applicationId ?? null,
          jobId: facts?.jobId ?? null,
          companyName: facts?.companyName ?? 'Lumenwave Analytics',
          jobTitle: facts?.jobTitle ?? 'Senior Site Reliability Engineer',
          jobDescription: facts?.jobDescription ?? '',
        });
        deps.db.prepare('UPDATE cover_letters SET resume_id = ? WHERE id = ?').run(platformId, row.id);
        linkLetter(GENERATED_LETTER.application, row.id, created);
        marker.letters.push(row.id);
      }
      {
        const created = clock.time(TEMPLATE_LETTER.createdDaysAgo, 19, 40);
        const edited = clock.time(TEMPLATE_LETTER.editedDaysAgo, 8, 55);
        const template = deps.db
          .prepare('SELECT id, content_html, font_family FROM cover_letter_templates WHERE system_key = ? AND is_system = 1')
          .get(TEMPLATE_LETTER.systemKey) as { id: string; content_html: string; font_family: string } | undefined;
        if (!template) throw new DemoSeedError(`The starter template "${TEMPLATE_LETTER.systemKey}" is missing.`);
        const facts = factsFor(TEMPLATE_LETTER.application);
        const companyName = facts?.companyName ?? 'Sunmere Grid';
        const jobTitle = facts?.jobTitle ?? 'Backend Engineer';
        const values = {
          ...letterVariableValues({ profile, job: { companyName, jobTitle, hiringManager: null }, today: created }),
          ...TEMPLATE_LETTER.values,
        };
        const row = createLetterRepository(at(deps, created)).create(userId, {
          title: defaultLetterTitle(created),
          origin: 'generated',
          contentHtml: sanitizeLetterHtml(substituteVariables(template.content_html, values)),
          fontFamily: template.font_family,
          applicationId: facts?.applicationId ?? null,
          jobId: facts?.jobId ?? null,
          companyName,
          jobTitle,
          jobDescription: facts?.jobDescription ?? '',
          templateId: template.id,
        });
        deps.db
          .prepare('UPDATE cover_letters SET resume_id = ?, last_edited_at = ?, updated_at = ? WHERE id = ?')
          .run(resumeIds.get('backend') ?? platformId, edited.toISOString(), edited.toISOString(), row.id);
        linkLetter(TEMPLATE_LETTER.application, row.id, created);
        marker.letters.push(row.id);
      }
      {
        const created = clock.time(UPLOADED_LETTER.createdDaysAgo, 21, 5);
        const facts = factsFor(UPLOADED_LETTER.application);
        const row = createLetterRepository(at(deps, created)).create(userId, {
          title: letterUpload.title,
          origin: 'uploaded',
          contentHtml: letterUpload.html,
          fileId: letterUpload.fileId,
          applicationId: facts?.applicationId ?? null,
          jobId: facts?.jobId ?? null,
          companyName: facts?.companyName ?? '',
          jobTitle: facts?.jobTitle ?? '',
        });
        linkLetter(UPLOADED_LETTER.application, row.id, created);
        marker.letters.push(row.id);
      }
      result.coverLetters = marker.letters.length;

      // The person's own templates.
      for (const plan of DEMO_TEMPLATES) {
        const created = clock.time(plan.createdDaysAgo, 14, 10);
        let contentHtml = plan.contentHtml ?? '';
        let fontFamily = plan.fontFamily ?? 'Times New Roman';
        if (plan.duplicateOf) {
          const source = deps.db
            .prepare('SELECT content_html, font_family FROM cover_letter_templates WHERE system_key = ? AND is_system = 1')
            .get(plan.duplicateOf) as { content_html: string; font_family: string } | undefined;
          if (!source) throw new DemoSeedError(`The starter template "${plan.duplicateOf}" is missing.`);
          contentHtml = source.content_html;
          fontFamily = plan.fontFamily ?? source.font_family;
        }
        const row = createTemplateRepository(at(deps, created)).create(userId, {
          name: plan.name,
          origin: plan.origin,
          contentHtml: sanitizeLetterHtml(contentHtml),
          fontFamily,
          aiPrompt: plan.aiPrompt,
        });
        if (plan.editedDaysAgo !== null) {
          const edited = clock.time(plan.editedDaysAgo, 17, 45).toISOString();
          deps.db.prepare('UPDATE cover_letter_templates SET last_edited_at = ?, updated_at = ? WHERE id = ?').run(edited, edited, row.id);
        }
        marker.templates.push(row.id);
      }
      result.templates = marker.templates.length;

      writeMarker(deps, userId, marker, anchor.toISOString());
      return result;
    });
  } catch (error) {
    const store = getFileStore(deps);
    for (const id of savedFiles) {
      try {
        store.remove(id, userId);
      } catch {
        /* best effort */
      }
    }
    throw error;
  }
}

/**
 * One tracked application: created Saved on its first day (from the demo job when there is one), then moved through
 * its later steps on their own days with the tracker's status rules, then pay, link, notes, favourite, resume,
 * questions and archive. Returns its id, or null when the account already tracks that job.
 */
function seedApplication(
  deps: AppDeps,
  clock: ReturnType<typeof demoClock>,
  userId: string,
  plan: DemoApplication,
  jobIds: Map<string, number>,
  tracked: Set<number>,
  resumeIds: Map<DemoResumeKey | 'upload', string>,
  result: DemoSeedResult,
): string | null {
  const [first, ...later] = plan.steps;
  if (!first || first[0] !== STATUS.saved) throw new DemoSeedError(`The demo application ${plan.key} must start Saved.`);
  const jobId = plan.seedJobId ? jobIds.get(plan.seedJobId) : undefined;
  if (jobId !== undefined && tracked.has(jobId)) {
    result.applications.skipped += 1;
    return null;
  }
  const savedAt = clock.time(first[1], 9 + (plan.key.length % 8), (plan.key.length * 7) % 60);
  const { detail } = createApplication(
    at(deps, savedAt),
    userId,
    jobId !== undefined
      ? { jobId, status: STATUS.saved, occurredOn: clock.day(first[1]) }
      : {
          title: plan.title,
          companyName: plan.company,
          location: plan.location,
          employmentType: plan.employmentType,
          ...(plan.postingUrl ? { postingUrl: plan.postingUrl } : {}),
          status: STATUS.saved,
          occurredOn: clock.day(first[1]),
        },
  );
  const id = detail.id;
  if (jobId !== undefined) result.applications.fromJobBoard += 1;

  patchApplication(at(deps, savedAt), userId, id, {
    ...(jobId === undefined && plan.salary
      ? { salaryMin: plan.salary.min, salaryMax: plan.salary.max, salaryCurrency: 'USD', salaryPeriod: 'year' as const }
      : {}),
    ...(jobId === undefined && plan.description ? { descriptionHtml: plan.description } : {}),
    ...(plan.favorite ? { favorite: true } : {}),
  });

  let last = first;
  for (const step of later) {
    const [status, daysAgo] = step;
    changeStatus(at(deps, clock.time(daysAgo, 13, 30)), userId, id, status, clock.day(daysAgo));
    last = step;
  }
  const lastTime = clock.time(last[1], 18, 5);

  const resumeId = plan.resume ? resumeIds.get(plan.resume) : undefined;
  if (resumeId || plan.notes) {
    patchApplication(at(deps, lastTime), userId, id, {
      ...(resumeId ? { resumeId } : {}),
      ...(plan.notes ? { notesHtml: notesHtml(plan.notes) } : {}),
    });
  }
  for (const [question, answer] of plan.questions ?? []) {
    createQuestion(at(deps, lastTime), userId, id, { question, answer });
  }
  if (plan.archived) setArchived(at(deps, clock.time(Math.max(0, last[1] - 1), 12)), userId, id, true);

  const status: ApplicationStatus = last[0];
  result.applications.total += 1;
  result.applications.byStatus[String(status)] = (result.applications.byStatus[String(status)] ?? 0) + 1;
  if (plan.favorite) result.applications.favorites += 1;
  if (plan.archived) result.applications.archived += 1;
  if (plan.notes) result.applications.withNotes += 1;
  if (plan.questions?.length) result.applications.withQuestions += 1;
  return id;
}

/** "Saved 5, Applied 8, ..." in the tracker's status order. */
export function describeStatusCounts(byStatus: Record<string, number>, labels: Record<number, string>): string {
  return APPLICATION_STATUSES.filter((status) => byStatus[String(status)])
    .map((status) => `${labels[status]} ${byStatus[String(status)]}`)
    .join(', ');
}
