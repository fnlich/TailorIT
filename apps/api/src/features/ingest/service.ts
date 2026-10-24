import { nowIso, type AppDeps } from '../../core/context';
import { transaction } from '../../core/db/connection';
import { AppError, conflict, notFound } from '../../core/http/errors';
import { ADAPTERS } from './adapters/index';
import { createIngestHttp, IngestHttpError, type IngestHttp } from './http';
import { readLake } from './lake';
import { sourceHashOf } from './normalize';
import { adminRun, getSourceRecord, kindLabelOf, listSourceRecords, type AdminRunDetail } from './sources';
import { BATCH_SIZE, createIngestStore, emptyCounts, type BatchItem, type IngestStore, type UpsertCounts } from './store';
import {
  IngestError,
  SCHEDULED_KINDS,
  type RawPosting,
  type RunStatus,
  type RunTrigger,
  type SourceAdapter,
  type SourceKind,
  type SourceRecord,
} from './types';

// Runs sources: one run per source at a time, at most two sources at once (each board host is also limited to one
// request a second by the shared HTTP client). Every run is an ingest_runs row with its counts and a log. Missing
// postings are closed only after a successful, complete listing.

export const PARALLEL_RUNS = 2;
const MAX_LOG_LINES = 2000;
export const LOG_RETENTION_DAYS = 90;
const MAX_FAILURE_LINES = 200;

export interface SourceTestResult {
  ok: boolean;
  message: string;
  count: number;
  samples: string[];
  companyName: string | null;
}

export interface StartedRun {
  runId: number;
  /** Resolves with the finished run; never rejects. */
  done: Promise<AdminRunDetail>;
}

export interface IngestService {
  readonly http: IngestHttp;
  readonly store: IngestStore;
  /**
   * Starts a run of one source and answers at once with its id. Throws 404 for an unknown source and 409 when it is
   * already running. `bypassSlots` skips the two-at-a-time limit (uploads and the seed: no network, quick).
   */
  run(sourceId: number, trigger: RunTrigger, options?: { bypassSlots?: boolean }): StartedRun;
  /** Every enabled daily source, two at a time (the schedule, or an admin's "Run all"). */
  runScheduled(trigger?: RunTrigger): Promise<AdminRunDetail[]>;
  isRunning(sourceId: number): boolean;
  /** Reads a source without saving anything (the admin's Test button). */
  test(kind: SourceKind, config: Record<string, unknown>): Promise<SourceTestResult>;
  /** Marks runs a previous process left running as failed (and trims run logs past their retention). */
  recoverInterrupted(): number;
  /** Stops every run (shutdown). */
  stop(): Promise<void>;
}

declare module '../../core/context' {
  interface AppServices {
    /** Job ingestion (work package J1). */
    ingest?: IngestService;
  }
}

/** The ingest service, or a 503 a person can read. */
export function requireIngest(deps: Pick<AppDeps, 'services'>): IngestService {
  const service = deps.services.ingest;
  if (!service) throw new AppError('internal', 'Job ingestion is not set up on this server.');
  return service;
}

class Slots {
  private free: number;
  private readonly waiting: Array<() => void> = [];
  constructor(size: number) {
    this.free = size;
  }
  acquire(signal: AbortSignal): Promise<() => void> {
    const release = () => {
      const next = this.waiting.shift();
      if (next) next();
      else this.free += 1;
    };
    if (this.free > 0) {
      this.free -= 1;
      return Promise.resolve(release);
    }
    return new Promise((resolve, reject) => {
      const grant = () => {
        signal.removeEventListener('abort', onAbort);
        resolve(release);
      };
      const onAbort = () => {
        const index = this.waiting.indexOf(grant);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new Error('stopped'));
      };
      this.waiting.push(grant);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

/** A run's log: one line per event, "HH:MM:SS text". */
class RunLog {
  readonly lines: string[] = [];
  constructor(private readonly now: () => Date) {}
  add(text: string): void {
    if (this.lines.length >= MAX_LOG_LINES) return;
    const time = this.now().toISOString().slice(11, 19);
    this.lines.push(`${time} ${text.replace(/\s+/g, ' ').trim()}`);
  }
  text(): string {
    return this.lines.join('\n');
  }
}

function messageOf(error: unknown): string {
  if (error instanceof IngestError || error instanceof IngestHttpError || error instanceof AppError) return error.message;
  return 'Something went wrong while reading this source. The details are in the server log.';
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export interface IngestServiceOptions {
  http?: IngestHttp;
  adapters?: Partial<Record<SourceKind, SourceAdapter>>;
}

export function createIngestService(deps: AppDeps, options: IngestServiceOptions = {}): IngestService {
  const { db, log } = deps;
  const http =
    options.http ??
    createIngestHttp({ userAgent: deps.config.ingest.userAgent, timeoutMs: deps.config.ingest.httpTimeoutMs });
  const store = createIngestStore(db);
  const adapters = { ...ADAPTERS, ...options.adapters };
  const slots = new Slots(PARALLEL_RUNS);
  const running = new Map<number, { runId: number; controller: AbortController; done: Promise<AdminRunDetail> }>();

  const sql = {
    insertRun: db.prepare("INSERT INTO ingest_runs(source_id, trigger, status, started_at) VALUES (?, ?, 'running', ?)"),
    startSource: db.prepare("UPDATE job_sources SET last_run_at = ?, last_status = 'running' WHERE id = ?"),
    finishRun: db.prepare(
      'UPDATE ingest_runs SET status = ?, finished_at = ?, fetched = ?, created = ?, updated = ?, unchanged = ?, deactivated = ?, ' +
        'failed = ?, error = ?, log = ? WHERE id = ?',
    ),
    finishSource: db.prepare(
      'UPDATE job_sources SET last_status = ?, last_success_at = CASE WHEN ? = 1 THEN ? ELSE last_success_at END WHERE id = ?',
    ),
    staleRuns: db.prepare(
      "UPDATE ingest_runs SET status = 'failed', finished_at = ?, error = ? WHERE status = 'running'",
    ),
    staleSources: db.prepare("UPDATE job_sources SET last_status = 'failed' WHERE last_status = 'running'"),
    trimLogs: db.prepare('UPDATE ingest_runs SET log = NULL WHERE started_at < ? AND log IS NOT NULL'),
  };

  /** Run logs are kept for LOG_RETENTION_DAYS; the runs and their counts stay. */
  const trimOldLogs = () => {
    try {
      sql.trimLogs.run(new Date(deps.now().getTime() - LOG_RETENTION_DAYS * 86_400_000).toISOString());
    } catch (error) {
      log.warn('[ingest] could not trim old run logs', error);
    }
  };

  function finish(source: SourceRecord, runId: number, status: RunStatus, fetched: number, counts: UpsertCounts, error: string | null, runLog: RunLog) {
    const now = nowIso(deps);
    sql.finishRun.run(
      status,
      now,
      fetched,
      counts.created,
      counts.updated,
      counts.unchanged,
      counts.deactivated,
      counts.failed,
      error,
      runLog.text(),
      runId,
    );
    sql.finishSource.run(status, status === 'failed' ? 0 : 1, now, source.id);
  }

  async function execute(source: SourceRecord, runId: number, trigger: RunTrigger, signal: AbortSignal): Promise<AdminRunDetail> {
    const runLog = new RunLog(deps.now);
    const counts = emptyCounts();
    let fetched = 0;
    let status: RunStatus = 'succeeded';
    let error: string | null = null;
    let failureLines = 0;
    const noteFailure = (text: string) => {
      failureLines += 1;
      if (failureLines <= MAX_FAILURE_LINES) runLog.add(text);
      else if (failureLines === MAX_FAILURE_LINES + 1) runLog.add('More failures were not logged.');
    };
    try {
      const adapter = adapters[source.kind];
      if (!adapter) throw new IngestError(`There is no reader for "${source.kind}" sources.`);
      runLog.add(`Run ${runId} of ${source.name} started (${trigger}).`);
      const result = await adapter.fetch(source, {
        deps,
        http,
        signal,
        log: (line) => runLog.add(line),
        needsPayCheck: (sourceJobId) => store.needsPayCheck(source.id, sourceJobId),
      });

      const unique = new Map<string, RawPosting>();
      for (const posting of result.postings) {
        const id = String(posting.sourceJobId);
        if (unique.has(id)) noteFailure(`Posting ${id} is listed twice; the first one was kept.`);
        else unique.set(id, posting);
      }
      fetched = unique.size + result.failures.length;
      counts.failed += result.failures.length;
      for (const failure of result.failures) noteFailure(failure.message);

      const items: BatchItem[] = [...unique.values()].map((raw) => ({ raw, sourceHash: sourceHashOf(raw) }));
      for (let start = 0; start < items.length; start += BATCH_SIZE) {
        if (signal.aborted) throw new IngestError('The run was stopped before it finished.');
        const batch = items.slice(start, start + BATCH_SIZE);
        const outcome = transaction(db, () => store.upsertBatch(source, batch, nowIso(deps)));
        for (const key of Object.keys(counts) as Array<keyof UpsertCounts>) counts[key] += outcome.counts[key];
        for (const failure of outcome.failures) noteFailure(`"${failure.title}" (${failure.sourceJobId}) was not saved: ${failure.message}`);
        await yieldToEventLoop();
      }
      runLog.add(
        `Saved: ${counts.created} new, ${counts.updated} updated, ${counts.unchanged} unchanged${counts.reactivated ? `, ${counts.reactivated} reopened` : ''}${counts.failed ? `, ${counts.failed} failed` : ''}.`,
      );

      if (!result.complete) {
        status = 'partial';
        runLog.add('The listing was incomplete, so no posting was marked missing.');
      } else if (source.deactivateMissing) {
        const seen = [
          ...unique.keys(),
          ...(result.skippedIds ?? []),
          ...result.failures.map((failure) => failure.sourceJobId).filter((id): id is string => Boolean(id)),
        ];
        const closed = transaction(db, () => store.markMissing(source.id, seen, nowIso(deps)));
        counts.deactivated += closed.deactivated;
        if (closed.missing || closed.deactivated) {
          runLog.add(`${closed.missing} postings are no longer listed; ${closed.deactivated} jobs closed.`);
        }
      }
      if (counts.deactivated) runLog.add(`${counts.deactivated} jobs closed in all.`);
      if (status === 'succeeded' && counts.failed > 0) status = 'partial';
    } catch (caught) {
      status = 'failed';
      error = messageOf(caught);
      if (!(caught instanceof IngestError || caught instanceof IngestHttpError || caught instanceof AppError)) {
        log.error(`[ingest] run ${runId} of source ${source.id} failed`, caught);
      }
      runLog.add(`Failed: ${error} Nothing was closed.`);
    }
    runLog.add(`Finished: ${status}.`);
    finish(source, runId, status, fetched, counts, error, runLog);
    log.info(
      `[ingest] ${source.kind} "${source.name}" run ${runId}: ${status} (fetched ${fetched}, new ${counts.created}, ` +
        `updated ${counts.updated}, unchanged ${counts.unchanged}, closed ${counts.deactivated}, failed ${counts.failed})`,
    );
    return adminRun(db, runId)!;
  }

  const service: IngestService = {
    http,
    store,

    run(sourceId, trigger, { bypassSlots = false } = {}) {
      if (running.has(sourceId)) throw conflict('This source is already running. Wait for that run to finish.');
      const source = getSourceRecord(db, sourceId);
      if (!source) throw notFound('That job source');
      const startedAt = nowIso(deps);
      const runId = Number(sql.insertRun.run(source.id, trigger, startedAt).lastInsertRowid);
      sql.startSource.run(startedAt, source.id);
      const controller = new AbortController();
      /** The run as stored, or (the database closing under a shutdown) what is known of it. */
      const recorded = (error: string): AdminRunDetail => {
        try {
          const stored = adminRun(db, runId);
          if (stored) return stored;
        } catch {
          /* the database is closing */
        }
        return {
          id: runId,
          sourceId: source.id,
          sourceKind: source.kind,
          sourceKindLabel: kindLabelOf(source.kind, source.config),
          sourceName: source.name,
          status: 'failed',
          trigger,
          startedAt,
          finishedAt: null,
          fetched: 0,
          created: 0,
          updated: 0,
          unchanged: 0,
          deactivated: 0,
          failed: 0,
          error,
          log: [],
        };
      };
      const done = (async (): Promise<AdminRunDetail> => {
        let release = () => {};
        try {
          if (!bypassSlots) release = await slots.acquire(controller.signal);
        } catch {
          const message = 'The server stopped before this run started.';
          const runLog = new RunLog(deps.now);
          runLog.add(message);
          try {
            finish(source, runId, 'failed', 0, emptyCounts(), message, runLog);
          } catch {
            /* the database is closing */
          }
          running.delete(sourceId);
          return recorded(message);
        }
        try {
          return await execute(source, runId, trigger, controller.signal);
        } catch (caught) {
          log.error(`[ingest] could not record run ${runId}`, caught);
          return recorded('The run could not be recorded.');
        } finally {
          release();
          running.delete(sourceId);
        }
      })();
      running.set(sourceId, { runId, controller, done });
      return { runId, done };
    },

    async runScheduled(trigger = 'schedule') {
      trimOldLogs();
      const due = listSourceRecords(db).filter(
        (source) => source.enabled && source.schedule === 'daily' && SCHEDULED_KINDS.includes(source.kind) && !running.has(source.id),
      );
      if (due.length === 0) return [];
      log.info(`[ingest] ${trigger} run of ${due.length} source(s)`);
      const started = due.map((source) => service.run(source.id, trigger));
      return Promise.all(started.map((run) => run.done));
    },

    isRunning(sourceId) {
      return running.has(sourceId);
    },

    async test(kind, config) {
      const fail = (message: string): SourceTestResult => ({ ok: false, message, count: 0, samples: [], companyName: null });
      if (kind === 'ft_lake') {
        const path = typeof config.path === 'string' && config.path.trim() ? config.path.trim() : deps.config.ingest.ftLakeDbPath;
        try {
          const snapshot = readLake(path, { limit: 3 });
          return {
            ok: true,
            message: `${snapshot.total} jobs in the lake, ${snapshot.withAnalysis} with an analysis.`,
            count: snapshot.total,
            samples: snapshot.rows.map((row) => `${row.title} at ${row.company}`),
            companyName: null,
          };
        } catch (caught) {
          return fail(messageOf(caught));
        }
      }
      const adapter = adapters[kind];
      if (!adapter || !['greenhouse', 'lever', 'ashby'].includes(kind)) return fail('Only job boards and the free_tailor lake can be tested.');
      const source: SourceRecord = {
        id: -1,
        kind,
        name: 'test',
        config,
        companyId: null,
        enabled: true,
        schedule: 'manual',
        deactivateMissing: false,
        lastRunAt: null,
        lastSuccessAt: null,
        lastStatus: null,
        createdAt: null,
        updatedAt: null,
      };
      const limitMs = Math.max(deps.config.ingest.httpTimeoutMs * 2, 30_000);
      const signal = AbortSignal.timeout(limitMs);
      try {
        const lines: string[] = [];
        const result = await adapter.fetch(source, {
          deps,
          http,
          signal,
          log: (line) => lines.push(line),
          needsPayCheck: () => false,
        });
        const count = result.postings.length;
        return {
          ok: true,
          message: count ? `Found ${count} open ${count === 1 ? 'job' : 'jobs'}.` : 'The board answered, but it lists no open jobs.',
          count,
          samples: result.postings.slice(0, 3).map((posting) => posting.title),
          companyName: result.postings[0]?.company.name ?? null,
        };
      } catch (caught) {
        if (signal.aborted) return fail(`The board did not answer within ${Math.round(limitMs / 1000)} s. Try again in a minute.`);
        return fail(messageOf(caught));
      }
    },

    recoverInterrupted() {
      trimOldLogs();
      const changed = sql.staleRuns.run(nowIso(deps), 'The server stopped during this run.').changes;
      sql.staleSources.run();
      if (changed) log.warn(`[ingest] marked ${changed} run(s) a previous server left running as failed`);
      return changed;
    },

    async stop() {
      const runs = [...running.values()];
      for (const run of runs) run.controller.abort();
      await Promise.race([
        Promise.allSettled(runs.map((run) => run.done)),
        new Promise((resolve) => setTimeout(resolve, 10_000).unref?.()),
      ]);
    },
  };
  return service;
}

