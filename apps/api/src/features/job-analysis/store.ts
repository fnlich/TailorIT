import {
  EXPERIENCE_LEVELS,
  JobKeywordsSchema,
  LEADERSHIP,
  SALARY_PERIODS,
  WORK_ARRANGEMENTS,
  toAnnualUsd,
  type ExperienceLevel,
  type JobAnalysisSource,
  type JobKeywords,
  type JobTerms,
  type Leadership,
  type SalaryPeriod,
  type WorkArrangement,
} from '@tailorit/shared';
import { transaction, type Db } from '../../core/db/connection';
import { checkedArrangement } from './ai';
import type { AnalysisDraft, JobFacetsDraft } from './deterministic';

// job_analyses rows: one per (content hash, source, version). A posting's best analysis is AI over free_tailor's
// lake over deterministic, the highest version within a source; jobs.analysis_id points at it. The facets (soft
// skills, terms, required years) are NULL on rows stored before they were read; a deterministic row is filled in
// place (`fillFacets`). Also here: the AI facts put on the jobs of a text (`applyAiFacts`) and job_ai_attempts, the
// add-time AI backlog's memory of failures.

export interface AnalysisRecord extends AnalysisDraft {
  id: number;
  contentHash: string;
  source: JobAnalysisSource;
  version: number;
  model: string | null;
  promptHash: string | null;
  createdAt: string;
  /** Null: not read (a row stored before soft skills were read, a lake row, an AI answer that left them out). */
  softSkills: string[] | null;
  terms: JobTerms | null;
  requiredYears: number | null;
}

interface AnalysisRow {
  id: number;
  content_hash: string;
  source: JobAnalysisSource;
  version: number;
  model: string | null;
  prompt_hash: string | null;
  requirements: string;
  responsibilities: string;
  desired: string;
  keywords: string;
  experience_levels: string;
  leadership: string | null;
  min_years: number | null;
  category_id: string | null;
  subcategory_ids: string;
  extras: string;
  soft_skills: string | null;
  terms: string | null;
  required_years: number | null;
  created_at: string;
}

const SOURCE_RANK: Record<JobAnalysisSource, number> = { ai: 3, ft_lake: 2, deterministic: 1 };

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function levels(value: unknown): ExperienceLevel[] {
  return strings(value).filter((level): level is ExperienceLevel => (EXPERIENCE_LEVELS as readonly string[]).includes(level));
}

function keywordsOf(text: string): JobKeywords {
  const parsed = JobKeywordsSchema.safeParse(parseJson<unknown>(text, null));
  return parsed.success ? parsed.data : { high: [], low: [] };
}

function termsOf(text: string | null): JobTerms | null {
  if (text === null) return null;
  const value = parseJson<Record<string, unknown> | null>(text, null);
  return { certifications: strings(value?.certifications), domains: strings(value?.domains) };
}

function yearsOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 30 ? value : null;
}

function toRecord(row: AnalysisRow): AnalysisRecord {
  const leadership = (LEADERSHIP as readonly string[]).includes(row.leadership ?? '') ? (row.leadership as Leadership) : null;
  return {
    id: row.id,
    contentHash: row.content_hash,
    source: row.source,
    version: row.version,
    model: row.model,
    promptHash: row.prompt_hash,
    requirements: strings(parseJson(row.requirements, [])),
    responsibilities: strings(parseJson(row.responsibilities, [])),
    desired: strings(parseJson(row.desired, [])),
    keywords: keywordsOf(row.keywords),
    experienceLevels: levels(parseJson(row.experience_levels, [])),
    leadership,
    minYears: row.min_years,
    categoryId: row.category_id,
    subcategoryIds: strings(parseJson(row.subcategory_ids, [])),
    extras: parseJson<Record<string, unknown>>(row.extras, {}),
    softSkills: row.soft_skills === null ? null : strings(parseJson(row.soft_skills, [])),
    terms: termsOf(row.terms),
    requiredYears: yearsOrNull(row.required_years),
    createdAt: row.created_at,
  };
}

export interface SaveAnalysisInput extends AnalysisDraft {
  contentHash: string;
  source: JobAnalysisSource;
  version: number;
  model?: string | null;
  promptHash?: string | null;
}

/**
 * Stores an analysis and returns its id. A deterministic analysis of the same text is the same analysis, so an
 * existing row is kept (`fillFacets` completes one stored before its facets were read); an AI or lake analysis
 * replaces the row it repeats (a re-run, or the lake's newer reading).
 */
export function saveAnalysis(db: Db, input: SaveAnalysisInput, createdAt: string): number {
  const values = [
    input.contentHash,
    input.source,
    input.version,
    input.model ?? null,
    input.promptHash ?? null,
    JSON.stringify(input.requirements),
    JSON.stringify(input.responsibilities),
    JSON.stringify(input.desired),
    JSON.stringify(input.keywords),
    JSON.stringify(input.experienceLevels),
    input.leadership,
    input.minYears,
    input.categoryId,
    JSON.stringify(input.subcategoryIds),
    JSON.stringify(input.extras ?? {}),
    input.softSkills == null ? null : JSON.stringify(input.softSkills),
    input.terms == null ? null : JSON.stringify(input.terms),
    yearsOrNull(input.requiredYears),
    createdAt,
  ];
  const conflict =
    input.source === 'deterministic'
      ? 'DO NOTHING'
      : 'DO UPDATE SET model = excluded.model, prompt_hash = excluded.prompt_hash, requirements = excluded.requirements, ' +
        'responsibilities = excluded.responsibilities, desired = excluded.desired, keywords = excluded.keywords, ' +
        'experience_levels = excluded.experience_levels, leadership = excluded.leadership, min_years = excluded.min_years, ' +
        'category_id = excluded.category_id, subcategory_ids = excluded.subcategory_ids, extras = excluded.extras, ' +
        'soft_skills = excluded.soft_skills, terms = excluded.terms, required_years = excluded.required_years, ' +
        'created_at = excluded.created_at';
  db.prepare(
    'INSERT INTO job_analyses(content_hash, source, version, model, prompt_hash, requirements, responsibilities, desired, ' +
      'keywords, experience_levels, leadership, min_years, category_id, subcategory_ids, extras, soft_skills, terms, ' +
      'required_years, created_at) ' +
      `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(content_hash, source, version) ${conflict}`,
  ).run(...values);
  const row = db
    .prepare<[string, string, number], { id: number }>(
      'SELECT id FROM job_analyses WHERE content_hash = ? AND source = ? AND version = ?',
    )
    .get(input.contentHash, input.source, input.version);
  if (!row) throw new Error('The job analysis was not stored.');
  return row.id;
}

/** Whether an analysis of this text, source and version is stored. */
export function hasAnalysis(db: Db, contentHash: string, source: JobAnalysisSource, version: number): boolean {
  return Boolean(
    db
      .prepare('SELECT 1 FROM job_analyses WHERE content_hash = ? AND source = ? AND version = ?')
      .get(contentHash, source, version),
  );
}

/** Every stored analysis of one text. */
export function analysesFor(db: Db, contentHash: string): AnalysisRecord[] {
  return db
    .prepare<[string], AnalysisRow>('SELECT * FROM job_analyses WHERE content_hash = ? ORDER BY id')
    .all(contentHash)
    .map(toRecord);
}

export function analysisById(db: Db, id: number): AnalysisRecord | null {
  const row = db.prepare<[number], AnalysisRow>('SELECT * FROM job_analyses WHERE id = ?').get(id);
  return row ? toRecord(row) : null;
}

type Ranked = Pick<AnalysisRecord, 'source' | 'version' | 'id'>;

/** Whether `a` ranks above `b`: AI over the lake over deterministic; within a source the higher version, the newer. */
function outranks(a: Ranked, b: Ranked): boolean {
  return (
    SOURCE_RANK[a.source] > SOURCE_RANK[b.source] ||
    (a.source === b.source && (a.version > b.version || (a.version === b.version && a.id > b.id)))
  );
}

/** The best of a set: AI over the lake over deterministic; within a source the highest version, then the newest. */
export function bestOf<T extends Ranked>(list: readonly T[]): T | null {
  let best: T | null = null;
  for (const item of list) if (!best || outranks(item, best)) best = item;
  return best;
}

/** The best analysis stored for a text, or null. */
export function bestAnalysis(db: Db, contentHash: string): AnalysisRecord | null {
  return bestOf(analysesFor(db, contentHash));
}

/** Points every job with this text at its best analysis. */
export function refreshAnalysisLinks(db: Db, contentHash: string): number | null {
  const rows = db
    .prepare<[string], { id: number; source: JobAnalysisSource; version: number }>(
      'SELECT id, source, version FROM job_analyses WHERE content_hash = ?',
    )
    .all(contentHash);
  const best = bestOf(rows);
  if (!best) return null;
  db.prepare('UPDATE jobs SET analysis_id = ? WHERE content_hash = ? AND (analysis_id IS NULL OR analysis_id <> ?)').run(
    best.id,
    contentHash,
    best.id,
  );
  return best.id;
}

// ------------------------------------------------------------------------------------------------- facets

/**
 * Stores the facets of an analysis stored before they were read (soft_skills NULL); a row that has them keeps them.
 * True when it filled them.
 */
export function fillFacets(db: Db, analysisId: number, facets: JobFacetsDraft): boolean {
  return (
    statements(db).fillFacets.run(JSON.stringify(facets.softSkills), JSON.stringify(facets.terms), yearsOrNull(facets.requiredYears), analysisId)
      .changes > 0
  );
}

/** What a job shows beside its keywords. */
export interface ViewFacets {
  softSkills: string[];
  terms: JobTerms;
  requiredYears: number | null;
}

/**
 * The facets of a set of analyses of one text: per list, the best analysis (as `bestOf` ranks them) that has a
 * non-empty one, so a deterministic reading stands in for an AI or lake one that has none; the required years of the
 * best that states them.
 */
export function facetsOf(list: readonly AnalysisRecord[]): ViewFacets {
  const ranked = [...list].sort((a, b) => (outranks(a, b) ? -1 : outranks(b, a) ? 1 : 0));
  const firstList = (pick: (record: AnalysisRecord) => string[] | null | undefined): string[] =>
    ranked.map(pick).find((items): items is string[] => Array.isArray(items) && items.length > 0) ?? [];
  return {
    softSkills: firstList((record) => record.softSkills),
    terms: {
      certifications: firstList((record) => record.terms?.certifications),
      domains: firstList((record) => record.terms?.domains),
    },
    requiredYears: ranked.find((record) => record.requiredYears !== null)?.requiredYears ?? null,
  };
}

// --------------------------------------------------------------------------------------- the AI's facts on jobs

interface FactJobRow {
  id: number;
  title: string;
  locations_text: string;
  description_text: string;
}

interface StoredFacts {
  workArrangement: WorkArrangement | null;
  sponsorsH1b: boolean | null;
  requiresClearance: boolean | null;
  degree: string | null;
  salary: { min: number | null; max: number | null; currency: string; period: SalaryPeriod } | null;
}

function amountOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** The facts an AI analysis stored in `extras` (ai.ts AiFacts), read defensively. */
function storedFacts(extras: Record<string, unknown>): StoredFacts {
  const flag = (value: unknown) => (typeof value === 'boolean' ? value : null);
  const arrangement = extras.workArrangement;
  const salary = extras.salary && typeof extras.salary === 'object' ? (extras.salary as Record<string, unknown>) : null;
  const min = amountOrNull(salary?.min);
  const max = amountOrNull(salary?.max);
  const currency = typeof salary?.currency === 'string' && /^[A-Z]{3}$/.test(salary.currency) ? salary.currency : null;
  const period = typeof salary?.period === 'string' && (SALARY_PERIODS as readonly string[]).includes(salary.period) ? (salary.period as SalaryPeriod) : null;
  return {
    workArrangement:
      typeof arrangement === 'string' && (WORK_ARRANGEMENTS as readonly string[]).includes(arrangement) ? (arrangement as WorkArrangement) : null,
    sponsorsH1b: flag(extras.sponsorsH1b),
    requiresClearance: flag(extras.requiresClearance),
    degree: typeof extras.degree === 'string' && extras.degree.trim() ? extras.degree.trim().slice(0, 60) : null,
    salary: (min !== null || max !== null) && currency && period ? { min, max, currency, period } : null,
  };
}

const flagValue = (value: boolean | null) => (value === null ? null : value ? 1 : 0);

/**
 * Puts the best AI analysis of a text on every job with that text, where the job's own value is empty: levels,
 * category, leadership, visa sponsorship, clearance, degree and pay, and the work arrangement only when that job's own
 * words, read loosely, say the same (`checkedArrangement`): a stored AI arrangement the posting contradicts stays off.
 * Runs when an AI analysis lands and after every ingest write, so rewriting a posting never loses what Claude read.
 * Returns how many jobs it looked at (0 when the text has no AI analysis).
 */
export function applyAiFacts(db: Db, contentHash: string): number {
  const sql = statements(db);
  const row = sql.bestAi.get(contentHash);
  if (!row) return 0;
  const ai = toRecord(row);
  const facts = storedFacts(ai.extras);
  const levelsJson = ai.experienceLevels.length ? JSON.stringify(ai.experienceLevels) : '[]';
  const subcategories = ai.categoryId ? JSON.stringify(ai.subcategoryIds) : null;
  const annual = facts.salary ? toAnnualUsd(facts.salary.min, facts.salary.max, facts.salary.currency, facts.salary.period) : null;
  const jobs = sql.jobsOfText.all(contentHash);
  for (const job of jobs) {
    const arrangement = checkedArrangement(facts.workArrangement, {
      title: job.title,
      locations: job.locations_text,
      text: job.description_text,
    });
    sql.fillJobFacts.run(
      levelsJson,
      ai.categoryId,
      ai.categoryId,
      subcategories,
      ai.categoryId,
      subcategories,
      ai.leadership,
      arrangement,
      flagValue(facts.sponsorsH1b),
      flagValue(facts.requiresClearance),
      facts.degree,
      job.id,
    );
    if (facts.salary) {
      const { min, max, currency, period } = facts.salary;
      sql.fillSalary.run(min, max, currency, period, annual?.min ?? null, annual?.max ?? null, job.id);
    }
  }
  return jobs.length;
}

// ------------------------------------------------------------------- job_ai_attempts (the add-time backlog's memory)

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** After this many failures a text is given up on: it is tried again only once a day. */
export const AI_FAILURES_BEFORE_GIVING_UP = 3;
/** The waits after a text's first and second failure. */
export const AI_RETRY_AFTER_MS: readonly number[] = [30 * MINUTE, 60 * MINUTE];
/** The wait once a text is given up on. */
export const AI_RETRY_GIVEN_UP_MS = 24 * HOUR;
/** The least an outage (Claude unavailable, which is not a failure) moves a text's next try. */
export const AI_OUTAGE_WAIT_MS = 5 * MINUTE;

export interface AiAttempts {
  contentHash: string;
  version: number;
  /** Failures so far (ai_failed only). */
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  updatedAt: string;
}

interface AttemptRow {
  content_hash: string;
  version: number;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  updated_at: string;
}

const toAttempts = (row: AttemptRow): AiAttempts => ({
  contentHash: row.content_hash,
  version: row.version,
  attempts: row.attempts,
  nextAttemptAt: row.next_attempt_at,
  lastError: row.last_error,
  updatedAt: row.updated_at,
});

/** How long a text waits after its `attempts`-th failure. */
export function retryDelayMs(attempts: number): number {
  return attempts >= AI_FAILURES_BEFORE_GIVING_UP ? AI_RETRY_GIVEN_UP_MS : (AI_RETRY_AFTER_MS[attempts - 1] ?? AI_RETRY_GIVEN_UP_MS);
}

export function aiAttemptsOf(db: Db, contentHash: string, version: number): AiAttempts | null {
  const row = statements(db).attempt.get(contentHash, version);
  return row ? toAttempts(row) : null;
}

/** Counts one failure of Claude on a text (an `ai_failed` answer) and sets when the backlog may try it again. */
export function recordAiFailure(
  db: Db,
  input: { contentHash: string; version: number; message: string; now: Date },
): AiAttempts {
  return transaction(db, () => {
    const sql = statements(db);
    const attempts = (sql.attempt.get(input.contentHash, input.version)?.attempts ?? 0) + 1;
    const next = new Date(input.now.getTime() + retryDelayMs(attempts)).toISOString();
    sql.upsertAttempt.run(input.contentHash, input.version, attempts, next, input.message.slice(0, 500), input.now.toISOString());
    return toAttempts(sql.attempt.get(input.contentHash, input.version)!);
  });
}

/** Moves a text's next try to `until` without counting a failure (Claude was unavailable; an outage is not one). */
export function deferAiAttempt(
  db: Db,
  input: { contentHash: string; version: number; message: string; until: Date; now: Date },
): void {
  const sql = statements(db);
  transaction(db, () => {
    const attempts = sql.attempt.get(input.contentHash, input.version)?.attempts ?? 0;
    sql.upsertAttempt.run(
      input.contentHash,
      input.version,
      attempts,
      input.until.toISOString(),
      input.message.slice(0, 500),
      input.now.toISOString(),
    );
  });
}

/**
 * The next try of a text the backlog has set aside for good (`setAsideAiTexts`): never reached. Admin › AI counts such
 * texts nowhere, as it counts no text under MIN_TEXT_FOR_AI bytes.
 */
export const AI_SET_ASIDE_UNTIL = '9999-12-31T23:59:59.999Z';

/**
 * Sets texts aside for good, keeping any failures on record: texts the backlog does not ask Claude about (too short
 * once trimmed), so they leave its candidates and it reaches the jobs after them. One transaction for them all. A new
 * prompt version reads them again; a change to readableForAi's rule alone would have to delete these rows.
 */
export function setAsideAiTexts(
  db: Db,
  input: { contentHashes: readonly string[]; version: number; message: string; now: Date },
): void {
  if (input.contentHashes.length === 0) return;
  const sql = statements(db);
  transaction(db, () => {
    for (const contentHash of new Set(input.contentHashes)) {
      const attempts = sql.attempt.get(contentHash, input.version)?.attempts ?? 0;
      sql.upsertAttempt.run(contentHash, input.version, attempts, AI_SET_ASIDE_UNTIL, input.message.slice(0, 500), input.now.toISOString());
    }
  });
}

/** Forgets a text's failures (its AI analysis landed). */
export function clearAiAttempts(db: Db, contentHash: string, version: number): void {
  statements(db).clearAttempt.run(contentHash, version);
}

// --------------------------------------------------------------------------------------- prepared statements

function prepare(db: Db) {
  return {
    fillFacets: db.prepare('UPDATE job_analyses SET soft_skills = ?, terms = ?, required_years = ? WHERE id = ? AND soft_skills IS NULL'),
    bestAi: db.prepare<[string], AnalysisRow>(
      "SELECT * FROM job_analyses WHERE content_hash = ? AND source = 'ai' ORDER BY version DESC, id DESC LIMIT 1",
    ),
    jobsOfText: db.prepare<[string], FactJobRow>(
      'SELECT id, title, locations_text, description_text FROM jobs WHERE content_hash = ? ORDER BY id',
    ),
    fillJobFacts: db.prepare(
      "UPDATE jobs SET experience_levels = CASE WHEN experience_levels = '[]' THEN ? ELSE experience_levels END, " +
        "category_id = CASE WHEN ? IS NOT NULL AND (category_id IS NULL OR category_id = 'other') THEN ? ELSE category_id END, " +
        "subcategory_ids = CASE WHEN ? IS NOT NULL AND (category_id IS NULL OR category_id = 'other' OR (category_id = ? AND subcategory_ids = '[]')) THEN ? ELSE subcategory_ids END, " +
        'leadership = COALESCE(leadership, ?), work_arrangement = COALESCE(work_arrangement, ?), ' +
        'sponsors_h1b = COALESCE(sponsors_h1b, ?), requires_clearance = COALESCE(requires_clearance, ?), degree = COALESCE(degree, ?) ' +
        'WHERE id = ?',
    ),
    fillSalary: db.prepare(
      'UPDATE jobs SET salary_min = ?, salary_max = ?, salary_currency = ?, salary_period = ?, salary_annual_usd_min = ?, ' +
        'salary_annual_usd_max = ? WHERE id = ? AND salary_min IS NULL AND salary_max IS NULL',
    ),
    attempt: db.prepare<[string, number], AttemptRow>('SELECT * FROM job_ai_attempts WHERE content_hash = ? AND version = ?'),
    upsertAttempt: db.prepare(
      'INSERT INTO job_ai_attempts(content_hash, version, attempts, next_attempt_at, last_error, updated_at) VALUES (?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(content_hash, version) DO UPDATE SET attempts = excluded.attempts, next_attempt_at = excluded.next_attempt_at, ' +
        'last_error = excluded.last_error, updated_at = excluded.updated_at',
    ),
    clearAttempt: db.prepare('DELETE FROM job_ai_attempts WHERE content_hash = ? AND version = ?'),
  };
}

const PREPARED = new WeakMap<Db, ReturnType<typeof prepare>>();

/** The statements above, prepared once per database (applyAiFacts runs for every posting an ingest writes). */
function statements(db: Db): ReturnType<typeof prepare> {
  let prepared = PREPARED.get(db);
  if (!prepared) {
    prepared = prepare(db);
    PREPARED.set(db, prepared);
  }
  return prepared;
}
