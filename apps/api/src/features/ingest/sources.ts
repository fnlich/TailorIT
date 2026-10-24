import { z } from 'zod';
import { IsoDateTime, SHEET_SOURCE_LABEL, SheetSourceConfigSchema } from '@tailorit/shared';
import type { Db } from '../../core/db/connection';
import {
  RUN_STATUSES,
  RUN_TRIGGERS,
  SCHEDULED_KINDS,
  SOURCE_KINDS,
  SOURCE_KIND_LABEL,
  type RunStatus,
  type RunTrigger,
  type SourceKind,
  type SourceRecord,
} from './types';

// job_sources and ingest_runs as the admin console sees them. The admin DTOs live here (the shared package has no
// admin contracts); apps/web/src/features/settings/admin/types.ts mirrors them.

interface SourceRow {
  id: number;
  kind: SourceKind;
  name: string;
  config: string;
  company_id: number | null;
  enabled: number;
  schedule: string;
  deactivate_missing: number;
  last_run_at: string | null;
  last_success_at: string | null;
  last_status: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** A source's config column as an object ({} when it is not one). */
function configOf(text: string | null | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** How a source's kind reads in the console: "Google Sheet" for a csv source that holds a copy of a sheet tab. */
export function kindLabelOf(kind: SourceKind, config: Record<string, unknown>): string {
  return kind === 'csv' && SheetSourceConfigSchema.safeParse(config.sheet).success ? SHEET_SOURCE_LABEL : SOURCE_KIND_LABEL[kind];
}

export function toSourceRecord(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    config: configOf(row.config),
    companyId: row.company_id,
    enabled: row.enabled === 1,
    schedule: row.schedule,
    deactivateMissing: row.deactivate_missing === 1,
    lastRunAt: row.last_run_at,
    lastSuccessAt: row.last_success_at,
    lastStatus: row.last_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getSourceRecord(db: Db, id: number): SourceRecord | null {
  const row = db.prepare<[number], SourceRow>('SELECT * FROM job_sources WHERE id = ?').get(id);
  return row ? toSourceRecord(row) : null;
}

export function findSourceRecord(db: Db, kind: SourceKind, name: string): SourceRecord | null {
  const row = db.prepare<[string, string], SourceRow>('SELECT * FROM job_sources WHERE kind = ? AND name = ?').get(kind, name);
  return row ? toSourceRecord(row) : null;
}

export function listSourceRecords(db: Db): SourceRecord[] {
  return db.prepare<[], SourceRow>('SELECT * FROM job_sources ORDER BY created_at DESC, id DESC').all().map(toSourceRecord);
}

/**
 * The csv source that holds a copy of this sheet tab, matched by spreadsheet and tab id rather than by name (renaming
 * the spreadsheet or the tab changes the default name, not the tab).
 */
export function findSheetSource(db: Db, spreadsheetId: string, gid: number): SourceRecord | null {
  const rows = db
    .prepare<[string, number], SourceRow>(
      "SELECT * FROM job_sources WHERE kind = 'csv' AND json_extract(config, '$.sheet.spreadsheetId') = ? " +
        "AND json_extract(config, '$.sheet.gid') = ? ORDER BY id",
    )
    .all(spreadsheetId, gid);
  return rows.map(toSourceRecord).find((source) => SheetSourceConfigSchema.safeParse(source.config.sheet).success) ?? null;
}

export interface NewSource {
  kind: SourceKind;
  name: string;
  config: Record<string, unknown>;
  enabled?: boolean;
  schedule?: string;
  deactivateMissing?: boolean;
}

/** The schedule a new source of this kind gets: boards and the lake daily, uploads and the seed by hand. */
export function defaultSchedule(kind: SourceKind): string {
  return SCHEDULED_KINDS.includes(kind) ? 'daily' : 'manual';
}

export function insertSource(db: Db, source: NewSource, now: string): SourceRecord {
  const result = db
    .prepare(
      'INSERT INTO job_sources(kind, name, config, enabled, schedule, deactivate_missing, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      source.kind,
      source.name,
      JSON.stringify(source.config),
      source.enabled === false ? 0 : 1,
      source.schedule ?? defaultSchedule(source.kind),
      // An upload adds jobs; a later upload of another file must not close the first one's.
      (source.deactivateMissing ?? !['csv', 'json'].includes(source.kind)) ? 1 : 0,
      now,
      now,
    );
  return getSourceRecord(db, Number(result.lastInsertRowid))!;
}

// ------------------------------------------------------------------------------------------------- admin DTOs

export const SourceRunSummarySchema = z.object({
  id: z.number().int(),
  status: z.enum(RUN_STATUSES),
  trigger: z.enum(RUN_TRIGGERS),
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
  fetched: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  deactivated: z.number().int(),
  failed: z.number().int(),
  error: z.string().nullable(),
});
export type SourceRunSummary = z.infer<typeof SourceRunSummarySchema>;

export const AdminSourceSchema = z.object({
  id: z.number().int(),
  kind: z.enum(SOURCE_KINDS),
  kindLabel: z.string(),
  name: z.string(),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  schedule: z.string(),
  deactivateMissing: z.boolean(),
  lastRunAt: IsoDateTime.nullable(),
  lastSuccessAt: IsoDateTime.nullable(),
  lastStatus: z.string().nullable(),
  createdAt: IsoDateTime.nullable(),
  updatedAt: IsoDateTime.nullable(),
  /** Jobs this source links to, and how many of them are live. */
  jobCount: z.number().int(),
  activeJobCount: z.number().int(),
  running: z.boolean(),
  lastRun: SourceRunSummarySchema.nullable(),
});
export type AdminSource = z.infer<typeof AdminSourceSchema>;

export const AdminRunSchema = SourceRunSummarySchema.extend({
  sourceId: z.number().int(),
  sourceKind: z.enum(SOURCE_KINDS),
  /** "Greenhouse", "CSV import", "Google Sheet"... (kindLabelOf). */
  sourceKindLabel: z.string(),
  sourceName: z.string(),
});
export type AdminRun = z.infer<typeof AdminRunSchema>;

export const AdminRunDetailSchema = AdminRunSchema.extend({ log: z.array(z.string()) });
export type AdminRunDetail = z.infer<typeof AdminRunDetailSchema>;

interface RunRow {
  id: number;
  source_id: number;
  trigger: RunTrigger;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  failed: number;
  error: string | null;
  log: string | null;
  kind?: SourceKind;
  name?: string;
  /** The source's config (joined in by the run queries, for its kind label). */
  config?: string;
}

function toRunSummary(row: RunRow): SourceRunSummary {
  return {
    id: row.id,
    status: row.status,
    trigger: row.trigger,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    fetched: row.fetched ?? 0,
    created: row.created ?? 0,
    updated: row.updated ?? 0,
    unchanged: row.unchanged ?? 0,
    deactivated: row.deactivated ?? 0,
    failed: row.failed ?? 0,
    error: row.error,
  };
}

function toAdminRun(row: RunRow): AdminRun {
  const kind = row.kind ?? 'seed';
  return {
    ...toRunSummary(row),
    sourceId: row.source_id,
    sourceKind: kind,
    sourceKindLabel: kindLabelOf(kind, configOf(row.config)),
    sourceName: row.name ?? '',
  };
}

/** Every source with its job counts and latest run, newest first. */
export function adminSources(db: Db, running: (id: number) => boolean): AdminSource[] {
  const counts = new Map(
    db
      .prepare<[], { source_id: number; total: number; live: number }>(
        'SELECT l.source_id, count(*) AS total, coalesce(sum(j.active), 0) AS live FROM job_source_links l ' +
          'JOIN jobs j ON j.id = l.job_id GROUP BY l.source_id',
      )
      .all()
      .map((row) => [row.source_id, row]),
  );
  const latest = new Map(
    db
      .prepare<[], RunRow>(
        'SELECT r.* FROM ingest_runs r WHERE r.id = (SELECT max(id) FROM ingest_runs x WHERE x.source_id = r.source_id)',
      )
      .all()
      .map((row) => [row.source_id, toRunSummary(row)]),
  );
  return listSourceRecords(db).map((source) => toAdminSource(source, counts.get(source.id), latest.get(source.id) ?? null, running(source.id)));
}

export function adminSource(db: Db, id: number, running: boolean): AdminSource | null {
  const source = getSourceRecord(db, id);
  if (!source) return null;
  const count = db
    .prepare<[number], { total: number; live: number }>(
      'SELECT count(*) AS total, coalesce(sum(j.active), 0) AS live FROM job_source_links l JOIN jobs j ON j.id = l.job_id WHERE l.source_id = ?',
    )
    .get(id);
  const run = db.prepare<[number], RunRow>('SELECT * FROM ingest_runs WHERE source_id = ? ORDER BY id DESC LIMIT 1').get(id);
  return toAdminSource(source, count, run ? toRunSummary(run) : null, running);
}

function toAdminSource(
  source: SourceRecord,
  count: { total: number; live: number } | undefined,
  lastRun: SourceRunSummary | null,
  running: boolean,
): AdminSource {
  return {
    id: source.id,
    kind: source.kind,
    kindLabel: kindLabelOf(source.kind, source.config),
    name: source.name,
    config: source.config,
    enabled: source.enabled,
    schedule: source.schedule,
    deactivateMissing: source.deactivateMissing,
    lastRunAt: source.lastRunAt,
    lastSuccessAt: source.lastSuccessAt,
    lastStatus: source.lastStatus,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    jobCount: count?.total ?? 0,
    activeJobCount: count?.live ?? 0,
    running,
    lastRun,
  };
}

/** Runs, newest first; `before` is the cursor (a run id). */
export function adminRuns(db: Db, options: { sourceId?: number; limit: number; before?: number }): { items: AdminRun[]; nextCursor?: string } {
  const where: string[] = [];
  const params: Array<number> = [];
  if (options.sourceId !== undefined) {
    where.push('r.source_id = ?');
    params.push(options.sourceId);
  }
  if (options.before !== undefined) {
    where.push('r.id < ?');
    params.push(options.before);
  }
  const rows = db
    .prepare<number[], RunRow>(
      'SELECT r.*, s.kind AS kind, s.name AS name, s.config AS config FROM ingest_runs r JOIN job_sources s ON s.id = r.source_id ' +
        `${where.length ? `WHERE ${where.join(' AND ')} ` : ''}ORDER BY r.id DESC LIMIT ?`,
    )
    .all(...params, options.limit + 1);
  const items = rows.slice(0, options.limit).map(toAdminRun);
  return rows.length > options.limit ? { items, nextCursor: String(items[items.length - 1]!.id) } : { items };
}

export function adminRun(db: Db, id: number): AdminRunDetail | null {
  const row = db
    .prepare<[number], RunRow>(
      'SELECT r.*, s.kind AS kind, s.name AS name, s.config AS config FROM ingest_runs r JOIN job_sources s ON s.id = r.source_id WHERE r.id = ?',
    )
    .get(id);
  if (!row) return null;
  return { ...toAdminRun(row), log: (row.log ?? '').split('\n').filter(Boolean) };
}
