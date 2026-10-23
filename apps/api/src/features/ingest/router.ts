import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { JOB_REPORT_REASON_LABEL, JOB_REPORT_REASONS, IsoDateTime } from '@tailorit/shared';
import { requireAdmin, userOf } from '../../core/auth/guards';
import { nowIso, type AppDeps } from '../../core/context';
import { transaction } from '../../core/db/connection';
import { getFileStore } from '../../core/files/index';
import { asyncHandler, conflict, notFound, validationFailed } from '../../core/http/errors';
import { parseInput } from '../../core/http/validate';
import { ashbyBoard } from './adapters/ashby';
import { greenhouseToken } from './adapters/greenhouse';
import { leverSite } from './adapters/lever';
import { importFilePath, importsRoot, tablePostings } from './adapters/tabular';
import { lakeFileInfo, readLake } from './lake';
import { requireIngest } from './service';
import { adminRun, adminRuns, adminSource, adminSources, findSourceRecord, getSourceRecord, insertSource } from './sources';
import {
  IMPORT_FIELDS,
  IMPORT_FIELD_LABEL,
  REQUIRED_IMPORT_FIELDS,
  cleanMapping,
  guessMapping,
  readTable,
  type ImportMapping,
} from './tabular';
import { IngestError, SOURCE_KIND_LABEL, type SourceKind } from './types';

// Admin > Sources, Runs, Import jobs and Reports (docs/ARCHITECTURE.md §8). Every route is administrator-only.

const Id = z.coerce.number().int().positive();

/** Imports with more rows than this run in the background instead of holding the request (Next's proxy waits 120 s). */
export const BACKGROUND_IMPORT_ROWS = 2000;

const name = z.string().trim().max(100, 'Keep the name under 100 characters.').optional();
const companyName = z.string().trim().max(200).optional();
const enabled = z.boolean().optional();

const GreenhouseConfig = z.object({ token: z.string().trim().min(1, 'Enter the Greenhouse board token.').max(300), companyName });
const LeverConfig = z.object({
  site: z.string().trim().min(1, 'Enter the Lever site name.').max(300),
  region: z.enum(['global', 'eu']).optional(),
  companyName,
});
const AshbyConfig = z.object({ board: z.string().trim().min(1, 'Enter the Ashby job board name.').max(300), companyName });
const LakeConfig = z.object({ path: z.string().trim().max(1000).optional() });

const CreateSourceBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('greenhouse'), name, enabled, config: GreenhouseConfig }),
  z.object({ kind: z.literal('lever'), name, enabled, config: LeverConfig }),
  z.object({ kind: z.literal('ashby'), name, enabled, config: AshbyConfig }),
  z.object({ kind: z.literal('ft_lake'), name, enabled, config: LakeConfig.default({}) }),
  z.object({ kind: z.literal('seed'), name, enabled, config: z.object({}).default({}) }),
]);

const TestSourceBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('greenhouse'), config: GreenhouseConfig }),
  z.object({ kind: z.literal('lever'), config: LeverConfig }),
  z.object({ kind: z.literal('ashby'), config: AshbyConfig }),
  z.object({ kind: z.literal('ft_lake'), config: LakeConfig.default({}) }),
]);

const PatchSourceBody = z.object({
  name: z.string().trim().min(1, 'A source needs a name.').max(100).optional(),
  enabled: z.boolean().optional(),
  deactivateMissing: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const RunsQuery = z.object({
  sourceId: Id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: Id.optional(),
});

const MappingSchema = z.partialRecord(z.enum(IMPORT_FIELDS), z.string().max(300).nullable());

const ImportJsonBody = z.object({
  fileName: z.string().trim().min(1).max(200).default('import.csv'),
  content: z.string().min(1, 'The file is empty.'),
  mapping: MappingSchema.optional(),
  name: z.string().trim().max(100).optional(),
});

const ReportsQuery = z.object({ status: z.enum(['open', 'resolved', 'dismissed', 'all']).default('open') });
const PatchReportBody = z.object({
  status: z.enum(['open', 'resolved', 'dismissed']),
  /** Close the reported job too (a report that it is no longer open, found true). */
  closeJob: z.boolean().optional(),
});

export const AdminReportSchema = z.object({
  id: z.number().int(),
  status: z.enum(['open', 'resolved', 'dismissed']),
  reason: z.enum(JOB_REPORT_REASONS),
  reasonLabel: z.string(),
  details: z.string(),
  createdAt: IsoDateTime,
  resolvedAt: IsoDateTime.nullable(),
  resolvedBy: z.string().nullable(),
  reporter: z.object({ id: z.string(), email: z.string(), name: z.string() }),
  job: z.object({ id: z.number().int(), title: z.string(), companyName: z.string(), active: z.boolean(), applyUrl: z.string() }),
});
export type AdminReport = z.infer<typeof AdminReportSchema>;

/** The text of an uploaded import: the multipart `file`, or a JSON body { fileName, content } (scripts, tests). */
function importText(req: Request): { fileName: string; text: string; mapping?: Partial<ImportMapping>; name?: string } {
  const file = req.file;
  if (file) {
    const buffer = file.buffer;
    const text =
      buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe
        ? buffer.subarray(2).toString('utf16le')
        : buffer.toString('utf8').replace(/^\ufeff/, '');
    let mapping: Partial<ImportMapping> | undefined;
    if (typeof req.body?.mapping === 'string' && req.body.mapping.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(req.body.mapping);
      } catch {
        throw validationFailed('The column mapping is not valid JSON.');
      }
      mapping = parseInput(MappingSchema, parsed, 'column mapping');
    }
    const label = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 100) : undefined;
    return { fileName: file.originalname || 'import.csv', text, mapping, name: label || undefined };
  }
  const body = parseInput(ImportJsonBody, req.body ?? {}, 'import');
  return { fileName: body.fileName, text: body.content, mapping: body.mapping, name: body.name || undefined };
}

function readImport(fileName: string, text: string) {
  try {
    return readTable(fileName, text);
  } catch (error) {
    if (error instanceof IngestError) throw validationFailed(error.message);
    throw error;
  }
}

function safeFileName(fileName: string): string {
  return fileName.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(-80) || 'import';
}

/** Mounted at /api/admin/sources. */
export function createSourcesRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAdmin);
  const { db } = deps;
  const running = (id: number) => deps.services.ingest?.isRunning(id) ?? false;

  router.get('/', (_req, res) => {
    const items = adminSources(db, running);
    res.json({ items, total: items.length });
  });

  router.post('/', (req, res) => {
    const body = parseInput(CreateSourceBody, req.body ?? {}, 'job source');
    let config: Record<string, unknown>;
    let label: string;
    switch (body.kind) {
      case 'greenhouse': {
        const token = greenhouseToken(body.config.token);
        if (!token) throw validationFailed('Enter the Greenhouse board token.', { 'config.token': 'Enter the board token.' });
        config = { token, ...(body.config.companyName ? { companyName: body.config.companyName } : {}) };
        label = body.name || token;
        break;
      }
      case 'lever': {
        const site = leverSite(body.config.site);
        if (!site) throw validationFailed('Enter the Lever site name.', { 'config.site': 'Enter the site name.' });
        config = { site, region: body.config.region ?? 'global', ...(body.config.companyName ? { companyName: body.config.companyName } : {}) };
        label = body.name || site;
        break;
      }
      case 'ashby': {
        const board = ashbyBoard(body.config.board);
        if (!board) throw validationFailed('Enter the Ashby job board name.', { 'config.board': 'Enter the board name.' });
        config = { board, ...(body.config.companyName ? { companyName: body.config.companyName } : {}) };
        label = body.name || board;
        break;
      }
      case 'ft_lake': {
        const path = body.config.path?.trim() || null;
        const target = path ?? deps.config.ingest.ftLakeDbPath;
        if (!lakeFileInfo(target).exists) {
          throw validationFailed(`There is no free_tailor database at ${target}. Check the path.`, { 'config.path': 'No file at this path.' });
        }
        config = path ? { path } : {};
        label = body.name || 'free_tailor lake';
        break;
      }
      case 'seed':
        config = { anchor: nowIso(deps) };
        label = body.name || 'Demo jobs';
        break;
    }
    if (findSourceRecord(db, body.kind, label)) {
      throw conflict(`A ${SOURCE_KIND_LABEL[body.kind]} source named "${label}" already exists.`);
    }
    const created = insertSource(db, { kind: body.kind, name: label, config, enabled: body.enabled }, nowIso(deps));
    res.status(201).json(adminSource(db, created.id, false));
  });

  router.post(
    '/test',
    asyncHandler(async (req, res) => {
      const body = parseInput(TestSourceBody, req.body ?? {}, 'test');
      const config: Record<string, unknown> =
        body.kind === 'greenhouse'
          ? { ...body.config, token: greenhouseToken(body.config.token) }
          : body.kind === 'lever'
            ? { ...body.config, site: leverSite(body.config.site) }
            : body.kind === 'ashby'
              ? { ...body.config, board: ashbyBoard(body.config.board) }
              : body.config;
      res.json(await requireIngest(deps).test(body.kind, config));
    }),
  );

  /** POST /api/admin/sources/ft-lake/test {path?}: is free_tailor's database there, and what does it hold. */
  router.post('/ft-lake/test', (req, res) => {
    const body = parseInput(LakeConfig, req.body ?? {}, 'test');
    const path = body.path?.trim() || deps.config.ingest.ftLakeDbPath;
    const file = lakeFileInfo(path);
    if (!file.exists) {
      res.json({ ...file, ok: false, message: `There is no free_tailor database at ${path}.`, counts: null, newestUpdatedAt: null });
      return;
    }
    try {
      const snapshot = readLake(path);
      const now = deps.now().getTime();
      const maxAge = deps.config.ingest.ftLakeMaxAgeDays * 86_400_000;
      const fresh = snapshot.rows.filter((row) => now - Math.max(Date.parse(row.updated_at) || 0, Date.parse(row.last_seen_at ?? '') || 0) <= maxAge);
      const newest = snapshot.rows.map((row) => row.updated_at).sort().at(-1) ?? null;
      res.json({
        ...file,
        ok: true,
        message: `${snapshot.total} jobs, ${snapshot.withAnalysis} with an analysis, ${fresh.length} updated in the last ${deps.config.ingest.ftLakeMaxAgeDays} days.`,
        counts: { jobs: snapshot.total, withAnalysis: snapshot.withAnalysis, recent: fresh.length },
        newestUpdatedAt: newest,
      });
    } catch (error) {
      res.json({ ...file, ok: false, message: (error as Error).message, counts: null, newestUpdatedAt: null });
    }
  });

  router.get('/:id', (req, res) => {
    const id = parseInput(Id, req.params.id, 'source id');
    const source = adminSource(db, id, running(id));
    if (!source) throw notFound('That job source');
    res.json(source);
  });

  router.patch('/:id', (req, res) => {
    const id = parseInput(Id, req.params.id, 'source id');
    const source = getSourceRecord(db, id);
    if (!source) throw notFound('That job source');
    const patch = parseInput(PatchSourceBody, req.body ?? {}, 'change');
    let config = source.config;
    if (patch.config) {
      const merged = { ...source.config, ...patch.config };
      if (source.kind === 'greenhouse') {
        const parsed = parseInput(GreenhouseConfig, merged, 'source settings');
        config = { ...merged, token: greenhouseToken(parsed.token) };
      } else if (source.kind === 'lever') {
        const parsed = parseInput(LeverConfig, merged, 'source settings');
        config = { ...merged, site: leverSite(parsed.site) };
      } else if (source.kind === 'ashby') {
        const parsed = parseInput(AshbyConfig, merged, 'source settings');
        config = { ...merged, board: ashbyBoard(parsed.board) };
      } else if (source.kind === 'ft_lake') {
        parseInput(LakeConfig, merged, 'source settings');
        config = merged;
      } else {
        throw validationFailed(`The settings of a ${SOURCE_KIND_LABEL[source.kind]} source cannot be changed here.`);
      }
    }
    const nextName = patch.name ?? source.name;
    if (nextName !== source.name && findSourceRecord(db, source.kind, nextName)) {
      throw conflict(`A ${SOURCE_KIND_LABEL[source.kind]} source named "${nextName}" already exists.`);
    }
    db.prepare('UPDATE job_sources SET name = ?, enabled = ?, deactivate_missing = ?, config = ?, updated_at = ? WHERE id = ?').run(
      nextName,
      (patch.enabled ?? source.enabled) ? 1 : 0,
      (patch.deactivateMissing ?? source.deactivateMissing) ? 1 : 0,
      JSON.stringify(config),
      nowIso(deps),
      id,
    );
    res.json(adminSource(db, id, running(id)));
  });

  /** Deletes the source and its run history; jobs only it listed are closed (they stay for applications that link them). */
  router.delete('/:id', (req, res) => {
    const id = parseInput(Id, req.params.id, 'source id');
    const source = getSourceRecord(db, id);
    if (!source) throw notFound('That job source');
    if (running(id)) throw conflict('This source is running. Wait for the run to finish, then delete it.');
    const now = nowIso(deps);
    transaction(db, () => {
      db.prepare(
        'UPDATE jobs SET active = 0, closed_at = COALESCE(closed_at, ?), updated_at = ? WHERE active = 1 ' +
          'AND id IN (SELECT job_id FROM job_source_links WHERE source_id = ?) ' +
          'AND NOT EXISTS (SELECT 1 FROM job_source_links l WHERE l.job_id = jobs.id AND l.source_id <> ? AND l.missing_since IS NULL)',
      ).run(now, now, id, id);
      db.prepare('DELETE FROM job_sources WHERE id = ?').run(id);
    });
    if (source.kind === 'csv' || source.kind === 'json') {
      try {
        rmSync(dirname(importFilePath(deps, source)), { recursive: true, force: true });
      } catch {
        /* no stored file */
      }
    }
    res.status(204).end();
  });

  router.post('/:id/run', (req, res) => {
    const id = parseInput(Id, req.params.id, 'source id');
    const source = getSourceRecord(db, id);
    if (!source) throw notFound('That job source');
    const quick = source.kind === 'seed' || source.kind === 'csv' || source.kind === 'json';
    const { runId } = requireIngest(deps).run(id, 'manual', { bypassSlots: quick });
    res.status(202).json({ runId, sourceId: id });
  });

  return router;
}

/** Mounted at /api/admin/runs. */
export function createRunsRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAdmin);

  router.get('/', (req, res) => {
    const query = parseInput(RunsQuery, req.query, 'query');
    res.json(adminRuns(deps.db, { sourceId: query.sourceId, limit: query.limit, before: query.cursor }));
  });

  router.get('/:id', (req, res) => {
    const run = adminRun(deps.db, parseInput(Id, req.params.id, 'run id'));
    if (!run) throw notFound('That run');
    res.json(run);
  });

  return router;
}

/** Mounted at /api/admin/import. */
export function createImportRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAdmin);
  // multipart/form-data with a `file` field (the console), or JSON { fileName, content } (scripts and tests).
  const upload: RequestHandler = (req, res, next) => getFileStore(deps).uploadSingle('file', { required: false })(req, res, next);

  /** POST /api/admin/import/jobs/preview: the columns, a guessed mapping and the first rows. Saves nothing. */
  router.post('/jobs/preview', upload, (req, res) => {
    const { fileName, text, mapping } = importText(req);
    const table = readImport(fileName, text);
    const guessed = guessMapping(table.columns);
    const chosen = mapping ? cleanMapping({ ...guessed, ...mapping }, table.columns) : guessed;
    const check = tablePostings(fileName, text, chosen);
    res.json({
      fileName,
      format: table.format,
      columns: table.columns,
      mapping: chosen,
      fields: IMPORT_FIELDS.map((field) => ({ field, label: IMPORT_FIELD_LABEL[field], required: REQUIRED_IMPORT_FIELDS.includes(field) })),
      rowCount: table.rows.length,
      jobCount: check.postings.length,
      sample: table.rows.slice(0, 5).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value.slice(0, 300)]))),
      missingRequired: REQUIRED_IMPORT_FIELDS.filter((field) => !chosen[field]),
      problems: check.failures.slice(0, 20).map((failure) => failure.message),
    });
  });

  /**
   * POST /api/admin/import/jobs: stores the file as a csv/json source and imports it. 201 { source, run, runId } once
   * the import finished; a file of more than BACKGROUND_IMPORT_ROWS rows answers 202 { source, run: null, runId } at
   * once and imports in the background (the console follows it under Runs).
   */
  router.post(
    '/jobs',
    upload,
    asyncHandler(async (req, res) => {
      const { fileName, text, mapping, name: label } = importText(req);
      const table = readImport(fileName, text);
      const chosen = cleanMapping(mapping ?? guessMapping(table.columns), table.columns);
      const missing = REQUIRED_IMPORT_FIELDS.filter((field) => !chosen[field]);
      if (missing.length) {
        throw validationFailed(`Choose the column for ${missing.map((field) => IMPORT_FIELD_LABEL[field].toLowerCase()).join(', ')}.`);
      }
      const kind: SourceKind = table.format;
      const sourceName = label || fileName;
      const now = nowIso(deps);
      const service = requireIngest(deps);
      let source = findSourceRecord(deps.db, kind, sourceName);
      if (source && service.isRunning(source.id)) throw conflict('This import is running. Wait for it to finish.');
      source ??= insertSource(deps.db, { kind, name: sourceName, config: {} }, now);
      // One stored file per source: a new upload replaces the previous one.
      const folder = join(importsRoot(deps), String(source.id));
      rmSync(folder, { recursive: true, force: true });
      mkdirSync(folder, { recursive: true });
      const relative = `${source.id}/${now.replace(/[:.]/g, '-')}-${safeFileName(fileName)}`;
      writeFileSync(join(importsRoot(deps), relative), text, 'utf8');
      deps.db
        .prepare('UPDATE job_sources SET config = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify({ file: relative, fileName, format: kind, mapping: chosen }), now, source.id);
      const started = service.run(source.id, 'upload', { bypassSlots: true });
      if (table.rows.length > BACKGROUND_IMPORT_ROWS) {
        res.status(202).json({ source: adminSource(deps.db, source.id, true), run: null, runId: started.runId });
        return;
      }
      const run = await started.done;
      res.status(201).json({ source: adminSource(deps.db, source.id, false), run, runId: started.runId });
    }),
  );

  return router;
}

interface ReportRow {
  id: number;
  status: 'open' | 'resolved' | 'dismissed';
  reason: AdminReport['reason'];
  details: string;
  created_at: string;
  resolved_at: string | null;
  resolver_email: string | null;
  resolved_by: string | null;
  user_id: string;
  email: string;
  user_name: string;
  job_id: number;
  title: string;
  active: number;
  apply_url: string;
  company_name: string;
}

const REPORT_SELECT =
  'SELECT r.id, r.status, r.reason, r.details, r.created_at, r.resolved_at, r.resolved_by, rb.email AS resolver_email, ' +
  'r.user_id, u.email, u.name AS user_name, r.job_id, j.title, j.active, j.apply_url, c.name AS company_name ' +
  'FROM job_reports r JOIN users u ON u.id = r.user_id JOIN jobs j ON j.id = r.job_id JOIN companies c ON c.id = j.company_id ' +
  'LEFT JOIN users rb ON rb.id = r.resolved_by';

function toAdminReport(row: ReportRow): AdminReport {
  return {
    id: row.id,
    status: row.status,
    reason: row.reason,
    reasonLabel: JOB_REPORT_REASON_LABEL[row.reason] ?? row.reason,
    details: row.details,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolver_email ?? row.resolved_by,
    reporter: { id: row.user_id, email: row.email, name: row.user_name },
    job: { id: row.job_id, title: row.title, companyName: row.company_name, active: row.active === 1, applyUrl: row.apply_url },
  };
}

/** Mounted at /api/admin/reports. */
export function createReportsRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAdmin);
  const { db } = deps;

  router.get('/', (req, res) => {
    const { status } = parseInput(ReportsQuery, req.query, 'query');
    const rows = db
      .prepare<string[], ReportRow>(`${REPORT_SELECT} ${status === 'all' ? '' : 'WHERE r.status = ? '}ORDER BY r.created_at DESC, r.id DESC LIMIT 500`)
      .all(...(status === 'all' ? [] : [status]));
    const counts = Object.fromEntries(
      db
        .prepare<[], { status: string; n: number }>('SELECT status, count(*) AS n FROM job_reports GROUP BY status')
        .all()
        .map((row) => [row.status, row.n]),
    );
    res.json({
      items: rows.map(toAdminReport),
      total: rows.length,
      counts: { open: counts.open ?? 0, resolved: counts.resolved ?? 0, dismissed: counts.dismissed ?? 0 },
    });
  });

  router.patch('/:id', (req, res) => {
    const id = parseInput(Id, req.params.id, 'report id');
    const body = parseInput(PatchReportBody, req.body ?? {}, 'change');
    const report = db.prepare<[number], { job_id: number }>('SELECT job_id FROM job_reports WHERE id = ?').get(id);
    if (!report) throw notFound('That report');
    const now = nowIso(deps);
    const admin = userOf(req);
    transaction(db, () => {
      if (body.status === 'open') {
        db.prepare("UPDATE job_reports SET status = 'open', resolved_at = NULL, resolved_by = NULL WHERE id = ?").run(id);
      } else {
        db.prepare('UPDATE job_reports SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?').run(body.status, now, admin.id, id);
      }
      if (body.closeJob) {
        db.prepare('UPDATE jobs SET active = 0, closed_at = COALESCE(closed_at, ?), updated_at = ? WHERE id = ?').run(now, now, report.job_id);
      }
    });
    const row = db.prepare<[number], ReportRow>(`${REPORT_SELECT} WHERE r.id = ?`).get(id);
    res.json(toAdminReport(row!));
  });

  return router;
}
