import { statSync } from 'node:fs';
import Database from 'better-sqlite3';
import { IngestError } from './types';

// free_tailor's Job Data Lake, read-only (docs/ARCHITECTURE.md Issue 6): a live WAL database another program writes.
// It is opened with { readonly, fileMustExist }, PRAGMA query_only, a busy timeout, and read in one short transaction;
// TailorIT never writes to it and never keeps it open.

export interface LakeRow {
  id: number;
  company: string;
  title: string;
  job_field_id: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  salary_raw: string | null;
  job_url: string;
  job_description: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  job_type: string | null;
  clearance: number | null;
  industry: string | null;
  /** job_analyses.analysis_json of the row's analysis (LEFT JOIN: null when it has none). */
  analysis_json: string | null;
  model_id: string | null;
}

export interface LakeSnapshot {
  rows: LakeRow[];
  /** job_lake rows in all. */
  total: number;
  withAnalysis: number;
}

export interface LakeFileInfo {
  path: string;
  exists: boolean;
  sizeBytes: number | null;
  modifiedAt: string | null;
}

export function lakeFileInfo(path: string): LakeFileInfo {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return { path, exists: false, sizeBytes: null, modifiedAt: null };
    return { path, exists: true, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
  } catch {
    return { path, exists: false, sizeBytes: null, modifiedAt: null };
  }
}

/** Columns a lake row is read with; ones an older free_tailor never added are read as NULL. */
const OPTIONAL_LAKE_COLUMNS = ['last_seen_at', 'job_type', 'clearance', 'industry'] as const;

function openReadOnly(path: string): Database.Database {
  let db: Database.Database;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw new IngestError(`The free_tailor database at ${path} could not be opened: ${(error as Error).message}`);
  }
  try {
    db.pragma('query_only = ON');
    db.pragma('busy_timeout = 5000');
  } catch (error) {
    db.close();
    throw new IngestError(`The free_tailor database at ${path} could not be read: ${(error as Error).message}`);
  }
  return db;
}

/**
 * Every lake row with its analysis, read in one transaction (a consistent snapshot of a database free_tailor keeps
 * writing). Throws IngestError when the file is missing or is not a free_tailor database.
 */
export function readLake(path: string, options: { limit?: number } = {}): LakeSnapshot {
  if (!lakeFileInfo(path).exists) {
    throw new IngestError(`There is no free_tailor database at ${path}. Set FT_LAKE_DB_PATH or the source's path.`);
  }
  const db = openReadOnly(path);
  try {
    const read = db.transaction(() => {
      const tables = new Set(
        db
          .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('job_lake', 'job_analyses')")
          .all()
          .map((row) => row.name),
      );
      if (!tables.has('job_lake')) throw new IngestError(`${path} is not a free_tailor database (it has no job_lake table).`);
      const columns = new Set(
        db
          .prepare<[], { name: string }>("SELECT name FROM pragma_table_info('job_lake')")
          .all()
          .map((row) => row.name),
      );
      const optional = OPTIONAL_LAKE_COLUMNS.map((column) => (columns.has(column) ? `l.${column}` : `NULL AS ${column}`)).join(', ');
      const analysis = tables.has('job_analyses')
        ? 'a.analysis_json AS analysis_json, a.model_id AS model_id FROM job_lake l LEFT JOIN job_analyses a ON a.id = l.analysis_id'
        : 'NULL AS analysis_json, NULL AS model_id FROM job_lake l';
      const limit = options.limit && options.limit > 0 ? ` LIMIT ${Math.floor(options.limit)}` : '';
      const rows = db
        .prepare<[], LakeRow>(
          'SELECT l.id, l.company, l.title, l.job_field_id, l.salary_min, l.salary_max, l.salary_currency, l.salary_period, ' +
            `l.salary_raw, l.job_url, l.job_description, l.created_at, l.updated_at, ${optional}, ${analysis} ORDER BY l.id${limit}`,
        )
        .all();
      const total = db.prepare<[], { n: number }>('SELECT count(*) AS n FROM job_lake').get()?.n ?? 0;
      const withAnalysis = tables.has('job_analyses')
        ? (db
            .prepare<[], { n: number }>('SELECT count(*) AS n FROM job_lake l JOIN job_analyses a ON a.id = l.analysis_id')
            .get()?.n ?? 0)
        : 0;
      return { rows, total, withAnalysis };
    });
    return read();
  } catch (error) {
    if (error instanceof IngestError) throw error;
    throw new IngestError(`The free_tailor database at ${path} could not be read: ${(error as Error).message}`);
  } finally {
    db.close();
  }
}
