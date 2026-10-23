import {
  JobKeywordsSchema,
  KeywordGroupSchema,
  STATUS,
  buildExportCsv,
  eventDate,
  extractKeywords,
  htmlToText,
  insights,
  matchResult,
  noResumeMatch,
  normalizeCompanyName,
  sankeyData,
  type InsightsResponse,
  type JobKeywords,
  type KeywordGroup,
  type MatchResult,
  type SankeyResponse,
} from '@tailorit/shared';
import type { AppDeps } from '../../core/context';
import { getSkillLibrary } from '../../core/skills-vocabulary';
import { getResumeEvidence } from '../resumes/evidence';
import { allApplicationRows, filterClause, type ApplicationFilter, type SortSpec } from './query';
import { loadEventsFor, loadOwnedRow, type ApplicationRow } from './store';

// Read-only reports over the account's applications: the CSV export, the chart and its insights, the company names
// the Add Application combobox offers, and an application's resume score.

type Deps = Pick<AppDeps, 'db' | 'now'>;

/** A UTF-8 byte-order mark: Excel reads the file as UTF-8 only with it. */
const BOM = String.fromCharCode(0xfeff);

/** The export's file name: TailorIT_Tracked_Jobs_2026-10-22.csv. */
export function exportFileName(date: string): string {
  return `TailorIT_Tracked_Jobs_${date}.csv`;
}

/** Every application the filters select (no paging), as CSV with a byte-order mark so Excel reads it as UTF-8. */
export function exportCsv(deps: Deps, userId: string, filter: ApplicationFilter, spec: SortSpec): string {
  const rows = allApplicationRows(deps.db, filterClause(userId, filter), spec);
  const events = loadEventsFor(
    deps.db,
    rows.map((row) => row.id),
  );
  const csv = buildExportCsv(
    rows.map((row) => ({
      companyName: row.company_name,
      title: row.title,
      location: row.location,
      employmentType: row.employment_type,
      currentStatus: row.current_status,
      appliedOn: eventDate(events.get(row.id) ?? [], STATUS.applied),
      trackedOn: row.tracked_on,
      postingUrl: row.posting_url,
      salaryMin: row.salary_min,
      salaryMax: row.salary_max,
      salaryCurrency: row.salary_currency,
      salaryPeriod: row.salary_period,
      favorite: row.favorite === 1,
      archivedAt: row.archived_at,
      notesHtml: row.notes_html,
    })),
  );
  return `${BOM}${csv}\r\n`;
}

/** The active applications as the chart reads them. */
function chartApplications(deps: Deps, userId: string) {
  const rows = allApplicationRows(deps.db, filterClause(userId, { tab: 'active' }), { sort: 'tracked', order: 'asc' });
  const events = loadEventsFor(
    deps.db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({ title: row.title, companyName: row.company_name, events: events.get(row.id) ?? [] }));
}

export function sankeyReport(deps: Deps, userId: string): SankeyResponse {
  return sankeyData(chartApplications(deps, userId));
}

export function insightsReport(deps: Deps, userId: string): InsightsResponse {
  return insights(chartApplications(deps, userId), deps.now());
}

const MAX_COMPANY_SUGGESTIONS = 300;
const MAX_COMPANY_MATCHES = 50;

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Company names for the Add Application field: the companies the account has tracked and the ones the job board
 * knows, without repeats (case-insensitive). With `q`, the names containing it (those starting with it first);
 * without, every tracked company and the first job-board ones, alphabetically.
 */
export function companyNames(deps: Pick<AppDeps, 'db'>, userId: string, q?: string): string[] {
  const query = (q ?? '').trim().slice(0, 100);
  let own: Array<{ name: string }>;
  let known: Array<{ name: string }>;
  if (query) {
    const like = `%${escapeLike(query)}%`;
    own = deps.db
      .prepare(
        `SELECT DISTINCT company_name AS name FROM applications
         WHERE user_id = ? AND company_name LIKE ? ESCAPE '\\' LIMIT ?`,
      )
      .all(userId, like, MAX_COMPANY_MATCHES) as Array<{ name: string }>;
    known = deps.db
      .prepare(
        `SELECT name FROM companies WHERE name LIKE ? ESCAPE '\\'
         ORDER BY (name LIKE ? ESCAPE '\\') DESC, name COLLATE NOCASE LIMIT ?`,
      )
      .all(like, `${escapeLike(query)}%`, MAX_COMPANY_MATCHES) as Array<{ name: string }>;
  } else {
    own = deps.db
      .prepare("SELECT DISTINCT company_name AS name FROM applications WHERE user_id = ? AND company_name <> ''")
      .all(userId) as Array<{ name: string }>;
    known = deps.db
      .prepare("SELECT name FROM companies WHERE name <> '' ORDER BY name COLLATE NOCASE LIMIT ?")
      .all(MAX_COMPANY_SUGGESTIONS) as Array<{ name: string }>;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { name } of [...own, ...known]) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name.trim());
  }
  const lower = query.toLowerCase();
  const rank = (name: string) => (lower && name.toLowerCase().startsWith(lower) ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

/**
 * POST /api/applications/import/companies: which of an import file's company names TailorIT already knows, each with
 * the name it knows it by: a company the account tracks (first) or the job board lists, compared the way an
 * application finds its company's logo (case, punctuation and legal suffixes aside). Unknown names are left out.
 */
export function knownCompanies(deps: Pick<AppDeps, 'db'>, userId: string, names: readonly string[]): Record<string, string> {
  const byKey = new Map<string, string>();
  const own = deps.db
    .prepare("SELECT DISTINCT company_name AS name FROM applications WHERE user_id = ? AND company_name <> ''")
    .all(userId) as Array<{ name: string }>;
  for (const { name } of own) {
    const key = normalizeCompanyName(name);
    if (key && !byKey.has(key)) byKey.set(key, name.trim());
  }
  const board = deps.db.prepare('SELECT name FROM companies WHERE name_key = ? LIMIT 1');
  const known: Record<string, string> = {};
  for (const name of names) {
    const key = normalizeCompanyName(name);
    if (!key) continue;
    if (!byKey.has(key)) {
      const row = board.get(key) as { name: string } | undefined;
      if (row?.name.trim()) byKey.set(key, row.name.trim());
    }
    const match = byKey.get(key);
    if (match) known[name] = match;
  }
  return known;
}

/** Cover letters written for one application (the cover letter editor stores the application it was opened from). */
export function lettersForApplication(deps: Pick<AppDeps, 'db'>, userId: string, id: string) {
  loadOwnedRow(deps.db, userId, id);
  const rows = deps.db
    .prepare(
      'SELECT id, title, updated_at FROM cover_letters WHERE user_id = ? AND application_id = ? ORDER BY updated_at DESC, id',
    )
    .all(userId, id) as Array<{ id: string; title: string; updated_at: string }>;
  return rows.map((row) => ({ id: row.id, title: row.title, updatedAt: row.updated_at }));
}

type ScoreDeps = Pick<AppDeps, 'db' | 'services' | 'log'>;

/** Keyword groups in the shared contract; a group that breaks it is dropped rather than the whole list. */
function readKeywords(value: unknown): JobKeywords | null {
  const strict = JobKeywordsSchema.safeParse(value);
  if (strict.success) return strict.data;
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const groups = (list: unknown): KeywordGroup[] =>
    Array.isArray(list)
      ? list.flatMap((item) => {
          const group = KeywordGroupSchema.safeParse(item);
          return group.success ? [group.data] : [];
        })
      : [];
  return { high: groups(record.high), low: groups(record.low) };
}

/**
 * The keywords of the job an application was tracked from, as the Jobs page's match reads them: the job analysis
 * service's current analysis, else the analysis stored on the job. Null when there is neither.
 */
function jobKeywords(deps: ScoreDeps, jobId: number): JobKeywords | null {
  const service = deps.services.jobAnalysis;
  if (service && typeof service.get === 'function') {
    try {
      const keywords = readKeywords(service.get(jobId)?.analysis.keywords);
      if (keywords) return keywords;
    } catch (error) {
      deps.log.warn(`[applications] the job analysis service failed for job ${jobId}; using the stored analysis`, error);
    }
  }
  const stored = deps.db
    .prepare('SELECT a.keywords FROM jobs j JOIN job_analyses a ON a.id = j.analysis_id WHERE j.id = ?')
    .get(jobId) as { keywords: string } | undefined;
  if (!stored) return null;
  try {
    return readKeywords(JSON.parse(stored.keywords));
  } catch {
    return null;
  }
}

/** The keywords of an application's own description (the skill vocabulary, the title making one high priority). */
function descriptionKeywords(row: ApplicationRow): JobKeywords {
  const text = htmlToText(row.description_html);
  return text.trim() ? extractKeywords(text, getSkillLibrary().vocabulary, { title: row.title }) : { high: [], low: [] };
}

/**
 * GET /api/applications/:id/resume-score: the posting's keywords against the linked resume, else the account's
 * default one; `no_resume` when there is none. An application tracked from the Jobs page scores its job's keywords
 * (the ones that page's match uses, so the two agree); one added by hand, or whose job is gone, its description's.
 */
export function resumeScore(deps: ScoreDeps, userId: string, id: string): MatchResult {
  const row = loadOwnedRow(deps.db, userId, id);
  const keywords = (row.job_id !== null ? jobKeywords(deps, row.job_id) : null) ?? descriptionKeywords(row);
  const evidence = (row.resume_id ? getResumeEvidence(deps, userId, row.resume_id) : null) ?? getResumeEvidence(deps, userId);
  if (!evidence) return noResumeMatch(keywords);
  return matchResult(evidence.text, keywords, evidence.resumeId);
}
