import { RESUME_ANALYSIS_VERSION } from '@tailorit/shared';
import { createBackgroundGate, createHourlyBudget } from '../../ai/background';
import { nowIso, type AppDeps } from '../../core/context';
import { JOB_ANALYSIS_PROMPT_VERSION } from './prompt';
import { MAX_PENDING_ANALYSES, MIN_TEXT_FOR_AI, readableForAi, type JobAnalysisServiceInternals } from './service';
import { AI_OUTAGE_WAIT_MS } from './store';

// The add-time job AI backlog (AI_JOB_ANALYSIS=ingest, the default): every added job gets the rule-based analysis at
// once (ingest), then Claude reads it, once per posting text, through this durable queue. `saved` mode runs the same
// backlog over the jobs someone has saved; `lazy` and `off` leave it off, as do AI_ENABLED=false and
// AI_CLI_BACKGROUND_SLOTS=0.
//
// - Candidates: live jobs with enough text whose text has no Claude analysis of the current prompt version (a
//   free_tailor lake analysis does not count) and is not backing off in job_ai_attempts. Each text once: jobs that
//   share a text share its analysis, and the task is deduplicated by it.
// - Order: newest first_seen_at first; jobs first seen before this release (app_settings job_ai_backlog_since,
//   recorded on first start) after every newer one. Opening, saving or "Save all" never queue a job or move it up.
// - At most one task of its own in flight (system-owned, background priority, charged to no one), and never more
//   than MAX_PENDING_ANALYSES job analyses pending in all.
// - It yields to resume readings (resume refines go first) while one is queued or running, or one is due (read from
//   resume_analysis_backlog and ai_tasks, as the resume backlog keeps them, while that backlog is on and under its
//   hourly cap); waits while the background gate is shut (any AI hold, a usage warning) and past
//   AI_JOB_ANALYSIS_PER_HOUR (0 = no cap).
// - Failures (job_ai_attempts, written by the service's task handler): only Claude failing on the text counts, with
//   a 30 then 60 minute wait, and after the third a day; Claude being unavailable only waits for the outage to pass.
//   The backlog itself also rests: AI_OUTAGE_WAIT_MS after its task found Claude unavailable (signed out, no CLI: no
//   hold shuts the gate then), and half an hour after FAILURE_STREAK failures in a row, so neither an outage nor a
//   failure on every text runs through the whole backlog.
// - Restarts lose nothing: the AI queue resumes its queued tasks, the memory of failures is in the database, and the
//   order is read from it at every step. No timers before `start`; every timer body logs and carries on.

/** app_settings key: when this release first started (an ISO time as JSON). Jobs first seen before it go last. */
export const BACKLOG_SINCE_KEY = 'job_ai_backlog_since';

/** How often the backlog looks for work when nothing nudges it (its own task finishing does). */
export const BACKLOG_TICK_MS = 30_000;
/** A nudge runs the next step this soon. */
const NUDGE_MS = 500;
/** After the AI queue turned its task away (stopping, paused), the backlog asks again this much later. */
const REFUSED_WAIT_MS = 60_000;
/** Its tasks failing on this many texts in a row (ai_failed) rest the backlog for FAILURE_STREAK_WAIT_MS. */
export const FAILURE_STREAK = 5;
const FAILURE_STREAK_WAIT_MS = 30 * 60_000;
/** Candidates read per step: a few spare for a text that turns out too short once trimmed. */
const CANDIDATES_PER_STEP = 25;
const HOUR_MS = 60 * 60_000;

/** Why a step started nothing. */
export type BacklogWait =
  /** Its own task is queued or running (one at a time). */
  | 'in_flight'
  /** MAX_PENDING_ANALYSES job analyses are queued or running. */
  | 'pending_limit'
  /** The background gate is shut: an AI hold, or the usage window is nearly used up. */
  | 'paused'
  /** Its last task found Claude unavailable, or its tasks failed FAILURE_STREAK times in a row: it rests. */
  | 'unavailable'
  /** AI_JOB_ANALYSIS_PER_HOUR tasks were started in the last hour. */
  | 'hourly_cap'
  /** The AI queue turned the last task away; it asks again a minute later. */
  | 'refused'
  /** A resume reading is queued, running or due: those go first. */
  | 'resume_first'
  /** Every candidate is analysed or backing off. */
  | 'none'
  /** The step itself failed (logged); the next one tries again. */
  | 'error';

export type BacklogStep =
  | { status: 'off' }
  | { status: 'waiting'; reason: BacklogWait; retryAtMs?: number; detail?: string }
  | { status: 'queued'; jobId: number; taskId: string; deduped: boolean };

export interface JobAnalysisBacklog {
  /** False when the mode, AI_ENABLED or AI_CLI_BACKGROUND_SLOTS rule it out: every step is `off`. */
  readonly enabled: boolean;
  /** The release time (ISO) before which jobs were first seen that go after every newer one. */
  readonly since: string;
  /** One step now: at most one task started. Never throws. The timers call it; so do tests. */
  tick(): BacklogStep;
  /** Ends the timers (an async stop, as features' `start` returns). */
  stop(): Promise<void>;
}

/** The release time, recorded the first time this release starts and kept from then on. */
function backlogSince(deps: Pick<AppDeps, 'db' | 'now'>): string {
  const now = nowIso(deps);
  deps.db
    .prepare('INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING')
    .run(BACKLOG_SINCE_KEY, JSON.stringify(now), now);
  const row = deps.db.prepare<[string], { value: string }>('SELECT value FROM app_settings WHERE key = ?').get(BACKLOG_SINCE_KEY);
  try {
    const value: unknown = JSON.parse(row?.value ?? 'null');
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  } catch {
    /* unreadable: read as now (and leave the stored value alone) */
  }
  return now;
}

/** The backlog without timers: `tick` runs one step. `startJobAnalysisBacklog` is the one the server runs. */
export function createJobAnalysisBacklog(
  deps: AppDeps,
  service: Pick<JobAnalysisServiceInternals, 'enqueueTask'>,
): JobAnalysisBacklog {
  return backlog(deps, service, false);
}

/** The backlog with its timers (the feature's `start`); returns at once when it is off. */
export function startJobAnalysisBacklog(
  deps: AppDeps,
  service: Pick<JobAnalysisServiceInternals, 'enqueueTask'>,
): JobAnalysisBacklog {
  return backlog(deps, service, true);
}

function backlog(deps: AppDeps, service: Pick<JobAnalysisServiceInternals, 'enqueueTask'>, timers: boolean): JobAnalysisBacklog {
  const { db, log, config } = deps;
  const mode = config.ai.jobAnalysis;
  const offBecause =
    mode !== 'ingest' && mode !== 'saved'
      ? null
      : !config.ai.enabled
        ? 'AI is turned off (AI_ENABLED=false)'
        : config.ai.backgroundSlots <= 0
          ? 'background AI work is turned off (AI_CLI_BACKGROUND_SLOTS=0)'
          : !deps.services.ai
            ? 'AI is not set up on this server'
            : '';
  const enabled = offBecause === '';
  const since = backlogSince(deps);
  const gate = createBackgroundGate(deps);
  const budget = createHourlyBudget(config.ai.jobAnalysisPerHour, () => deps.now().getTime());
  let refusedUntil = 0;
  /** Its last task (until its outcome is read), and the rest that outcome calls for. */
  let lastTaskId: string | null = null;
  let restUntil = 0;
  let restReason = '';
  let failuresInARow = 0;
  let stopped = false;
  let lastState = '';

  const sql = {
    tasks: db.prepare<[], { pending: number; own: number }>(
      "SELECT count(*) AS pending, coalesce(sum(CASE WHEN user_id IS NULL AND priority = 0 THEN 1 ELSE 0 END), 0) AS own " +
        "FROM ai_tasks WHERE kind = 'job_analysis' AND status IN ('queued', 'running')",
    ),
    resumeTasks: db.prepare<[], { found: number }>(
      "SELECT 1 AS found FROM ai_tasks WHERE kind = 'resume_analysis' AND status IN ('queued', 'running') LIMIT 1",
    ),
    // A row the resume backlog has queued whose task has not finished (or is unknown: it is about to reconcile it).
    resumeQueued: db.prepare<[], { found: number }>(
      "SELECT 1 AS found FROM resume_analysis_backlog b JOIN users u ON u.id = b.user_id WHERE b.state = 'queued' " +
        'AND u.disabled_at IS NULL AND NOT EXISTS (SELECT 1 FROM ai_tasks t WHERE t.id = b.task_id ' +
        "AND t.status IN ('succeeded', 'failed', 'cancelled')) LIMIT 1",
    ),
    // A row the resume backlog would start now: waiting (or failed, and its day's wait over), of the current reading
    // version, of an account that is not disabled (it skips those).
    resumeDue: db.prepare<[string, number], { found: number }>(
      "SELECT 1 AS found FROM resume_analysis_backlog b JOIN users u ON u.id = b.user_id WHERE b.state IN ('waiting', 'failed') " +
        'AND b.next_attempt_at <= ? AND b.version = ? AND u.disabled_at IS NULL LIMIT 1',
    ),
    resumeStarted: db.prepare<[string], { n: number }>(
      "SELECT count(*) AS n FROM ai_tasks WHERE kind = 'resume_analysis' AND created_at > ?",
    ),
    // octet_length reads no text (and a text has at least as many bytes as characters); readableForAi decides.
    candidates: db.prepare<
      { minText: number; version: number; now: string; since: string; limit: number },
      { id: number }
    >(
      'SELECT j.id FROM jobs j WHERE j.active = 1 AND octet_length(j.description_text) >= @minText ' +
        "AND NOT EXISTS (SELECT 1 FROM job_analyses a WHERE a.content_hash = j.content_hash AND a.source = 'ai' AND a.version = @version) " +
        'AND NOT EXISTS (SELECT 1 FROM job_ai_attempts t WHERE t.content_hash = j.content_hash AND t.version = @version ' +
        'AND t.next_attempt_at > @now) ' +
        (mode === 'saved'
          ? 'AND EXISTS (SELECT 1 FROM applications p WHERE p.job_id = j.id AND p.current_status = 1 AND p.archived_at IS NULL) '
          : '') +
        'ORDER BY (j.first_seen_at >= @since) DESC, j.first_seen_at DESC, j.id DESC LIMIT @limit',
    ),
    text: db.prepare<[number], { description_text: string }>('SELECT description_text FROM jobs WHERE id = ?'),
  };

  const waiting = (reason: BacklogWait, retryAtMs?: number, detail?: string): BacklogStep => ({
    status: 'waiting',
    reason,
    ...(retryAtMs !== undefined ? { retryAtMs } : {}),
    ...(detail ? { detail } : {}),
  });

  /** Whether a resume reading should have the background slot first: one is queued, running, or due to start. */
  function resumeReadingFirst(nowMs: number): boolean {
    if (sql.resumeTasks.get()) return true;
    // With resume reading off, its backlog rows wait for nothing the background slot could do.
    if (config.ai.resumeAnalysis !== 'auto') return false;
    if (sql.resumeQueued.get()) return true;
    if (!sql.resumeDue.get(new Date(nowMs).toISOString(), RESUME_ANALYSIS_VERSION)) return false;
    // A due row counts while the resume backlog may start one: not past AI_RESUME_ANALYSIS_PER_HOUR.
    const perHour = config.ai.resumeAnalysisPerHour;
    if (perHour <= 0) return true;
    return (sql.resumeStarted.get(new Date(nowMs - HOUR_MS).toISOString())?.n ?? 0) < perHour;
  }

  /**
   * Reads how its last task ended, once it has: Claude unavailable rests the backlog AI_OUTAGE_WAIT_MS (the outage is
   * the seat's, not the text's), FAILURE_STREAK failures in a row rest it half an hour, a success ends a streak.
   */
  function readLastTask(nowMs: number): void {
    if (lastTaskId === null) return;
    const task = deps.services.ai?.getTask(lastTaskId, null) ?? null;
    if (task && (task.status === 'queued' || task.status === 'running')) return;
    lastTaskId = null;
    if (!task) return;
    const endedMs = task.finishedAt ? Date.parse(task.finishedAt) : nowMs;
    const rest = (until: number, reason: string) => {
      if (until <= restUntil) return;
      restUntil = until;
      restReason = reason;
    };
    if (task.status === 'succeeded') failuresInARow = 0;
    else if (task.error?.code === 'ai_unavailable') {
      rest(endedMs + AI_OUTAGE_WAIT_MS, `Claude was unavailable: ${task.error.message}`);
    } else if (task.error?.code === 'ai_failed') {
      failuresInARow += 1;
      if (failuresInARow >= FAILURE_STREAK) {
        failuresInARow = 0;
        const reason = `Claude's analysis failed for ${FAILURE_STREAK} jobs in a row`;
        rest(endedMs + FAILURE_STREAK_WAIT_MS, reason);
        log.warn(`[job-analysis] AI backlog: ${reason}; resting for 30 minutes`);
      }
    }
  }

  function step(): BacklogStep {
    const nowMs = deps.now().getTime();
    const tasks = sql.tasks.get() ?? { pending: 0, own: 0 };
    if (tasks.own > 0) return waiting('in_flight');
    if (tasks.pending >= MAX_PENDING_ANALYSES) return waiting('pending_limit');
    readLastTask(nowMs);
    const gateAnswer = gate.allowed();
    if (!gateAnswer.ok) return waiting('paused', gateAnswer.retryAtMs, gateAnswer.reason);
    if (restUntil > nowMs) return waiting('unavailable', restUntil, restReason);
    const nextAt = budget.nextAtMs();
    if (nextAt > nowMs) return waiting('hourly_cap', nextAt);
    if (refusedUntil > nowMs) return waiting('refused', refusedUntil);
    if (resumeReadingFirst(nowMs)) return waiting('resume_first');

    const candidates = sql.candidates.all({
      minText: MIN_TEXT_FOR_AI,
      version: JOB_ANALYSIS_PROMPT_VERSION,
      now: new Date(nowMs).toISOString(),
      since,
      limit: CANDIDATES_PER_STEP,
    });
    for (const { id } of candidates) {
      if (!readableForAi(sql.text.get(id)?.description_text ?? '')) continue;
      const accepted = service.enqueueTask(id, 'background');
      if (!accepted) {
        refusedUntil = nowMs + REFUSED_WAIT_MS;
        return waiting('refused', refusedUntil);
      }
      if (!accepted.deduped) budget.take();
      lastTaskId = accepted.taskId;
      return { status: 'queued', jobId: id, ...accepted };
    }
    return waiting('none');
  }

  /** Logs what changed: a pause or a cap at info level, routine steps at debug. */
  function report(result: BacklogStep): void {
    const state = result.status === 'waiting' ? result.reason : result.status;
    if (result.status === 'queued') {
      log.debug(`[job-analysis] AI backlog: queued job ${result.jobId}${result.deduped ? ' (already queued)' : ''}`);
    } else if (state !== lastState && result.status === 'waiting') {
      if (result.reason === 'paused' || result.reason === 'unavailable') {
        log.info(`[job-analysis] AI backlog paused: ${result.detail ?? 'AI is resting'}`);
      } else if (result.reason === 'hourly_cap') {
        log.info(`[job-analysis] AI backlog: ${config.ai.jobAnalysisPerHour} job(s) this hour (AI_JOB_ANALYSIS_PER_HOUR); waiting`);
      } else log.debug(`[job-analysis] AI backlog waiting: ${result.reason}`);
    }
    lastState = state;
  }

  const tick = (): BacklogStep => {
    if (!enabled || stopped) return { status: 'off' };
    try {
      const result = step();
      report(result);
      return result;
    } catch (error) {
      log.warn('[job-analysis] an AI backlog step failed; the next one tries again', error);
      return waiting('error');
    }
  };

  if (!timers) return { enabled, since, tick, stop: async () => void (stopped = true) };
  if (!enabled) {
    if (offBecause) log.info(`[job-analysis] AI backlog is off: ${offBecause}`);
    return { enabled, since, tick, stop: async () => void (stopped = true) };
  }

  let soon: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    try {
      const result = tick();
      // Its task finishing is what starts the next one, at once, so the background slot is not left idle.
      if (result.status === 'queued') void deps.services.ai?.waitFor(result.taskId).then(nudge, nudge);
    } catch (error) {
      log.warn('[job-analysis] the AI backlog timer failed; it carries on', error);
    }
  };
  const nudge = () => {
    if (stopped || soon) return;
    soon = setTimeout(() => {
      soon = null;
      run();
    }, NUDGE_MS);
    soon.unref?.();
  };
  const interval = setInterval(run, BACKLOG_TICK_MS);
  interval.unref?.();
  nudge();
  log.info(
    `[job-analysis] AI backlog: Claude reads each ${mode === 'saved' ? 'saved' : 'added'} job once, newest first` +
      (config.ai.jobAnalysisPerHour > 0 ? `, at most ${config.ai.jobAnalysisPerHour} an hour` : ''),
  );
  return {
    enabled,
    since,
    tick,
    async stop() {
      stopped = true;
      clearInterval(interval);
      if (soon) clearTimeout(soon);
      soon = null;
    },
  };
}
