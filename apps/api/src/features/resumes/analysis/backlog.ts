import { RESUME_ANALYSIS_VERSION, type AiTaskView } from '@tailorit/shared';
import { createBackgroundGate, createHourlyBudget } from '../../../ai/background';
import type { AiService } from '../../../ai/queue';
import type { AppDeps } from '../../../core/context';
import { AppError } from '../../../core/http/errors';
import type { ResumeAnalysisBackfill } from './backfill';
import { resumeAnalysisEnabled, reuseAiReading } from './store';
import type { ResumeAnalysisTaskInput, ResumeAnalysisTaskResult } from './task';

// Claude's reading of uploads (the `resume_analysis` task), from the durable backlog in resume_analysis_backlog. The
// worker keeps ONE task in flight server-wide, on the background slot and owned by the uploader (dedupe key
// resume_analysis:<resumeId>:<hash>:<version>), so uploads never wait on Claude and never fail with "AI busy".
//   - Order: the account served least recently first (fairness across people), then the oldest upload.
//   - Reuse: when the account already has Claude's reading of the same text (a duplicate, a re-upload), it is copied.
//   - Pauses: the background gate (any AI hold, a usage warning) and the hourly budget (AI_RESUME_ANALYSIS_PER_HOUR);
//     disabled accounts wait.
//   - Attempts: only a failed reading counts (3, with 30 and 60 minutes between, then 'failed', tried again after
//     24 h). An outage (ai_unavailable) waits for the hold to end, at least 5 minutes, without counting; a restart
//     (interrupted) or a cancel does not count either.
// Off when AI is off, AI_RESUME_ANALYSIS=off or AI_CLI_BACKGROUND_SLOTS=0; uploads then keep the rules' reading. The
// task handler stays registered either way. No timer runs before start().

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Failed readings before an upload is marked 'failed'. */
export const RESUME_ANALYSIS_ATTEMPTS = 3;
/** The wait after the first and second failed reading. */
const RETRY_AFTER_MS = [30 * MINUTE, 60 * MINUTE];
/** A 'failed' upload is tried once more after this long. */
export const FAILED_RETRY_MS = 24 * HOUR;
/** An outage waits at least this long (or until the hold ends). */
export const UNAVAILABLE_WAIT_MS = 5 * MINUTE;
const BUSY_WAIT_MS = MINUTE;
const CANCELLED_WAIT_MS = 5 * MINUTE;
const OTHER_WAIT_MS = 5 * MINUTE;
const CANDIDATES = 25;
const FIRST_TICK_MS = 2_000;
const POLL_MS = 15_000;
const NUDGE_MS = 500;

export interface ResumeAnalysisBacklog {
  /** Whether this server has Claude read uploads (see the header). */
  readonly enabled: boolean;
  /**
   * One step now (the timer calls it; tests too): settles finished tasks, then starts the next reading when nothing
   * is in flight and the gate and the budget allow. Returns the task started, or null.
   */
  tick(): string | null;
  /**
   * Whether a reading is in flight, or one could start now (an upload is due and the hourly budget has room). Other
   * background AI work (the job backlog) yields while it is true: resume readings go first.
   */
  pending(): boolean;
  /** A step soon (after an upload, or when a reading finished). Only once started. */
  nudge(): void;
  /** Starts the timer; returns the stop function. */
  start(): () => Promise<void>;
}

/** Both resume-reading workers (work package WP3): the rules' backfill and Claude's backlog. */
export interface ResumeAnalysisService {
  readonly backlog: ResumeAnalysisBacklog;
  readonly backfill: ResumeAnalysisBackfill;
}

declare module '../../../core/context' {
  interface AppServices {
    /** What TailorIT reads from resumes: the backfill of rule-based readings and Claude's backlog for uploads. */
    resumeAnalysis?: ResumeAnalysisService;
  }
}

interface QueuedRow {
  resume_id: string;
  content_hash: string;
  version: number;
  attempts: number;
  task_id: string | null;
}

interface CandidateRow {
  resume_id: string;
  user_id: string;
  content_hash: string;
  version: number;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** The dedupe key of an upload's reading (the queue scopes it by owner). */
export function resumeAnalysisDedupeKey(input: ResumeAnalysisTaskInput): string {
  return `resume_analysis:${input.resumeId}:${input.contentHash}:${input.version}`;
}

export function createResumeAnalysisBacklog(deps: AppDeps): ResumeAnalysisBacklog {
  const { db, log } = deps;
  const enabled = resumeAnalysisEnabled(deps);
  const gate = createBackgroundGate(deps);
  const budget = createHourlyBudget(deps.config.ai.resumeAnalysisPerHour, () => deps.now().getTime());
  let schedule: ((delayMs: number) => void) | null = null;
  let pausedFor = '';

  const sql = {
    queued: db.prepare<[], QueuedRow>(
      "SELECT resume_id, content_hash, version, attempts, task_id FROM resume_analysis_backlog WHERE state = 'queued'",
    ),
    active: db.prepare<[], { n: number }>(
      "SELECT count(*) AS n FROM ai_tasks WHERE kind = 'resume_analysis' AND status IN ('queued', 'running')",
    ),
    // The account served least recently first (never served: first), then the oldest upload.
    candidates: db.prepare<[string, number], CandidateRow>(
      `SELECT b.resume_id, b.user_id, b.content_hash, b.version
       FROM resume_analysis_backlog b
       JOIN users u ON u.id = b.user_id
       LEFT JOIN (SELECT user_id, max(started_at) AS served FROM resume_analysis_backlog GROUP BY user_id) s
         ON s.user_id = b.user_id
       WHERE b.state IN ('waiting', 'failed') AND b.next_attempt_at <= ? AND b.version = ? AND u.disabled_at IS NULL
       ORDER BY s.served IS NOT NULL, s.served, b.created_at, b.resume_id
       LIMIT ${CANDIDATES}`,
    ),
    anyDue: db.prepare<[string, number], { ok: number }>(
      `SELECT 1 AS ok FROM resume_analysis_backlog b JOIN users u ON u.id = b.user_id
       WHERE b.state IN ('waiting', 'failed') AND b.next_attempt_at <= ? AND b.version = ? AND u.disabled_at IS NULL
       LIMIT 1`,
    ),
    hasReading: db.prepare<[string, string, number], { ok: number }>(
      "SELECT 1 AS ok FROM resume_analyses WHERE resume_id = ? AND source = 'ai' AND content_hash = ? AND version = ?",
    ),
    settle: db.prepare(
      `UPDATE resume_analysis_backlog SET state = @state, attempts = @attempts, next_attempt_at = @next,
         last_error = @error, updated_at = @now
       WHERE resume_id = @resumeId AND state = 'queued' AND task_id IS @taskId`,
    ),
    defer: db.prepare(
      `UPDATE resume_analysis_backlog SET next_attempt_at = ?, last_error = ?, updated_at = ?
       WHERE resume_id = ? AND state IN ('waiting', 'failed')`,
    ),
    started: db.prepare(
      `UPDATE resume_analysis_backlog SET state = 'queued', task_id = ?, started_at = ?, updated_at = ?
       WHERE resume_id = ? AND content_hash = ? AND version = ?`,
    ),
  };

  /** Until when an outage keeps an upload waiting: the end of the hold that turns its call away, at least 5 minutes. */
  function outageUntil(ai: AiService, nowMs: number, retryAfterSeconds?: number): number {
    const hold = ai.provider.holdFor('resume_analysis');
    return Math.max(nowMs + UNAVAILABLE_WAIT_MS, hold?.until ?? 0, retryAfterSeconds ? nowMs + retryAfterSeconds * 1000 : 0);
  }

  /** What a finished task means for its upload's row. */
  function settle(ai: AiService, row: QueuedRow, task: AiTaskView | null, nowMs: number): void {
    const base = { resumeId: row.resume_id, taskId: row.task_id, attempts: row.attempts, now: iso(nowMs) };
    const update = (state: string, next: number, error: string | null, attempts = row.attempts) =>
      sql.settle.run({ ...base, state, attempts, next: iso(next), error });
    if (!task) {
      update('waiting', nowMs, 'Its AI task was not found; it is read again.');
      return;
    }
    if (task.status === 'succeeded') {
      if (sql.hasReading.get(row.resume_id, row.content_hash, row.version)) {
        update('done', nowMs, null);
        return;
      }
      const skipped = (task.result as ResumeAnalysisTaskResult | null)?.skipped;
      // A reading of another version (the server was updated meanwhile) is asked for again; anything else that
      // stored nothing (text that cannot be read) is not, so a reading never loops.
      if (skipped === 'outdated' || skipped === 'changed') update('waiting', nowMs, null);
      else update('skipped', nowMs, skipped === 'unreadable' ? 'Its text could not be read.' : 'Nothing was read.');
      return;
    }
    if (task.status === 'cancelled') {
      update('waiting', nowMs + CANCELLED_WAIT_MS, task.error?.message ?? 'The reading was cancelled.');
      return;
    }
    const code = task.error?.code;
    const message = task.error?.message ?? 'The AI reading failed.';
    if (code === 'interrupted') {
      update('waiting', nowMs, message);
    } else if (code === 'ai_unavailable') {
      update('waiting', outageUntil(ai, nowMs), message);
    } else {
      // A failed reading (ai_failed; an unexpected error is recorded as that too).
      const attempts = row.attempts + 1;
      if (attempts >= RESUME_ANALYSIS_ATTEMPTS) update('failed', nowMs + FAILED_RETRY_MS, message, attempts);
      else update('waiting', nowMs + RETRY_AFTER_MS[Math.min(attempts, RETRY_AFTER_MS.length) - 1]!, message, attempts);
    }
  }

  /** Settles every finished task; true while one is still queued or running. */
  function reconcile(ai: AiService, nowMs: number): boolean {
    let inFlight = false;
    for (const row of sql.queued.all()) {
      try {
        const task = row.task_id ? ai.getTask(row.task_id, null) : null;
        if (task && (task.status === 'queued' || task.status === 'running')) {
          inFlight = true;
          continue;
        }
        settle(ai, row, task, nowMs);
      } catch (error) {
        log.warn(`[resume-analysis] could not settle the reading of resume ${row.resume_id}`, error);
      }
    }
    return inFlight;
  }

  function pause(reason: string): null {
    if (reason !== pausedFor) log.info(`[resume-analysis] AI readings of uploads wait: ${reason}`);
    pausedFor = reason;
    return null;
  }

  /** Starts one upload's reading: its task id, null to try the next upload, 'stop' when no upload can start now. */
  function begin(ai: AiService, row: CandidateRow, nowMs: number): string | null | 'stop' {
    const input: ResumeAnalysisTaskInput = { resumeId: row.resume_id, contentHash: row.content_hash, version: row.version };
    const now = iso(nowMs);
    try {
      const accepted = ai.enqueue({
        kind: 'resume_analysis',
        userId: row.user_id,
        input,
        priority: 'background',
        dedupeKey: resumeAnalysisDedupeKey(input),
      });
      if (!accepted.deduped) budget.take();
      sql.started.run(accepted.taskId, now, now, row.resume_id, row.content_hash, row.version);
      return accepted.taskId;
    } catch (error) {
      const app = error instanceof AppError ? error : null;
      const message = app?.message ?? 'The AI reading could not be started.';
      if (app?.code === 'ai_busy') {
        sql.defer.run(iso(nowMs + BUSY_WAIT_MS), message, now, row.resume_id);
        return null;
      }
      if (app?.code === 'ai_unavailable') {
        sql.defer.run(iso(outageUntil(ai, nowMs, app.retryAfterSeconds)), message, now, row.resume_id);
        return 'stop';
      }
      log.warn(`[resume-analysis] could not start the reading of resume ${row.resume_id}`, error);
      sql.defer.run(iso(nowMs + OTHER_WAIT_MS), message, now, row.resume_id);
      return null;
    }
  }

  const tick = (): string | null => {
    if (!enabled) return null;
    const ai = deps.services.ai;
    if (!ai) return null;
    const nowMs = deps.now().getTime();
    if (reconcile(ai, nowMs) || (sql.active.get()?.n ?? 0) > 0) return null;
    const gateAnswer = gate.allowed();
    if (!gateAnswer.ok) return pause(gateAnswer.reason);
    if (budget.nextAtMs() > nowMs) return pause('the hourly limit (AI_RESUME_ANALYSIS_PER_HOUR) is reached');
    pausedFor = '';
    for (const row of sql.candidates.all(iso(nowMs), RESUME_ANALYSIS_VERSION)) {
      // Claude read this text for this account already: copied, nothing asked.
      if (reuseAiReading(deps, { resumeId: row.resume_id, userId: row.user_id, contentHash: row.content_hash })) continue;
      const started = begin(ai, row, nowMs);
      if (started === 'stop') return null;
      if (started) return started;
    }
    return null;
  };

  return {
    enabled,
    tick,
    pending() {
      if (!enabled) return false;
      try {
        if ((sql.active.get()?.n ?? 0) > 0) return true;
        const nowMs = deps.now().getTime();
        if (budget.nextAtMs() > nowMs) return false;
        return Boolean(sql.anyDue.get(iso(nowMs), RESUME_ANALYSIS_VERSION));
      } catch (error) {
        log.warn('[resume-analysis] could not tell whether a reading is due', error);
        return false;
      }
    },
    nudge() {
      schedule?.(NUDGE_MS);
    },
    start() {
      if (!enabled) return async () => {};
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let dueAt = Number.POSITIVE_INFINITY;
      const run = () => {
        timer = null;
        dueAt = Number.POSITIVE_INFINITY;
        if (stopped) return;
        try {
          tick();
        } catch (error) {
          log.warn('[resume-analysis] a step of the AI reading backlog failed', error);
        }
        schedule?.(POLL_MS);
      };
      // Timers use the wall clock (the app's clock is frozen in tests); the logic reads deps.now().
      schedule = (delayMs) => {
        if (stopped) return;
        const at = Date.now() + delayMs;
        if (timer && dueAt <= at) return;
        if (timer) clearTimeout(timer);
        dueAt = at;
        timer = setTimeout(run, delayMs);
        timer.unref?.();
      };
      schedule(FIRST_TICK_MS);
      const perHour = deps.config.ai.resumeAnalysisPerHour;
      log.info(`[resume-analysis] Claude reads each upload, one at a time${perHour > 0 ? `, at most ${perHour} an hour` : ''}`);
      return async () => {
        stopped = true;
        schedule = null;
        if (timer) clearTimeout(timer);
        timer = null;
      };
    },
  };
}
