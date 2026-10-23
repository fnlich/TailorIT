import {
  EXPERIENCE_LEVELS,
  JobKeywordsSchema,
  LEADERSHIP,
  type ExperienceLevel,
  type JobAnalysisSource,
  type JobKeywords,
  type Leadership,
} from '@tailorit/shared';
import type { Db } from '../../core/db/connection';
import type { AnalysisDraft } from './deterministic';

// job_analyses rows: one per (content hash, source, version). A posting's best analysis is AI over free_tailor's
// lake over deterministic, the highest version within a source; jobs.analysis_id points at it.

export interface AnalysisRecord extends AnalysisDraft {
  id: number;
  contentHash: string;
  source: JobAnalysisSource;
  version: number;
  model: string | null;
  promptHash: string | null;
  createdAt: string;
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
 * existing row is kept; an AI or lake analysis replaces the row it repeats (a re-run, or the lake's newer reading).
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
    createdAt,
  ];
  const conflict =
    input.source === 'deterministic'
      ? 'DO NOTHING'
      : 'DO UPDATE SET model = excluded.model, prompt_hash = excluded.prompt_hash, requirements = excluded.requirements, ' +
        'responsibilities = excluded.responsibilities, desired = excluded.desired, keywords = excluded.keywords, ' +
        'experience_levels = excluded.experience_levels, leadership = excluded.leadership, min_years = excluded.min_years, ' +
        'category_id = excluded.category_id, subcategory_ids = excluded.subcategory_ids, extras = excluded.extras, ' +
        'created_at = excluded.created_at';
  db.prepare(
    'INSERT INTO job_analyses(content_hash, source, version, model, prompt_hash, requirements, responsibilities, desired, ' +
      'keywords, experience_levels, leadership, min_years, category_id, subcategory_ids, extras, created_at) ' +
      `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(content_hash, source, version) ${conflict}`,
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

/** The best of a set: AI over the lake over deterministic; within a source the highest version, then the newest. */
export function bestOf<T extends Pick<AnalysisRecord, 'source' | 'version' | 'id'>>(list: readonly T[]): T | null {
  let best: T | null = null;
  for (const item of list) {
    if (
      !best ||
      SOURCE_RANK[item.source] > SOURCE_RANK[best.source] ||
      (item.source === best.source && (item.version > best.version || (item.version === best.version && item.id > best.id)))
    ) {
      best = item;
    }
  }
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
