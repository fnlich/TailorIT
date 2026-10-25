import {
  ResumeImportTaskResultSchema,
  type AiTaskView,
  type ResumeCopiesPause,
  type ResumeCopyState,
} from '@tailorit/shared';
import { createBackgroundGate, WARNING_PAUSE_MS } from '../../../ai/background';
import { AI_ERROR_MESSAGES, MAX_ACTIVE_PER_USER_KIND, type AiService } from '../../../ai/index';
import type { RateLimitReading } from '../../../ai/provider/types';
import type { AppDeps } from '../../../core/context';
import { transaction } from '../../../core/db/connection';
import { AppError } from '../../../core/http/errors';
import { assertRoomForResumes } from '../repository';
import { copiesOffMessage, type CopyErrorCode } from './store';

// The copy line: the editable copies asked for with several uploads at once (the Upload dialog's "Make an editable
// copy with AI" for many files), from the durable rows of resume_copy_backlog (./store.ts writes one with each upload).
// Each copy is the `resume_import` task a copy asked for alone runs too (interactive priority, owned by the uploader,
// dedupe key resume_import:<uploadId>), started under these rules:
//   - One at a time per account: a copy starts only while the account has no `resume_import` task queued or running,
//     so of its MAX_ACTIVE_PER_USER_KIND places, a copy asked for alone always finds one.
//   - At most half the AI slots server-wide (AI_CLI_CONCURRENCY / 2, at least one), counted from the line's own tasks
//     (their input is marked copyLine), so a copy whose upload is deleted while it is made holds its slot until its
//     task ends. The account served least recently first (its last `resume_import` task, which neither Dismiss nor a
//     deleted upload removes), then the oldest copy; disabled accounts wait.
//   - Only while the background gate is open (any AI hold, or a usage warning, shuts it), so a run of copies never
//     spends the shared seat's last room. "Make editable copy" on an upload makes that one at once; its row follows it.
//   - An AI pause only holds a copy until it ends, uncounted. A restart (interrupted) puts it back in line, and so does
//     an outage with no pause (5 minutes later); the third time, it fails with the reason and can be tried again.
//   - A copy the account has no room to keep fails before any AI call.
// Off when AI is off or the server has no AI service: the rows then wait (GET /api/resumes/copies says why). While AI
// is off, the timer still settles the copies a previous run left being made: made, or failed with the AI-off sentence
// (Try again once AI is on). No timer runs before start().

const MINUTE = 60_000;
/** A restart or an outage with no AI pause puts a copy back in line; the third time, it fails. */
export const COPY_TRIES = 3;
/** A restart cut off the third try. The tries before it may have met an outage instead, so it names only this one. */
export const COPY_INTERRUPTED = 'The server restarted while this copy was being made, on its third try. Try again.';
/** An outage with no AI pause: the copy is tried again this much later. */
const OUTAGE_WAIT_MS = 5 * MINUTE;
/** The AI queue turned the copy away (the server is stopping, say): it asks again at least this much later. */
const REFUSED_WAIT_MS = MINUTE;
const OTHER_WAIT_MS = 5 * MINUTE;
const CANDIDATES = 25;
const FIRST_TICK_MS = 2_000;
const POLL_MS = 15_000;
const NUDGE_MS = 500;

export interface ResumeCopyBacklog {
  /** Whether this server makes the copies: AI on, with an AI service. */
  readonly enabled: boolean;
  /**
   * One step now (the timer calls it; tests too): settles the copies whose task finished, then starts what the rules
   * allow (nothing while the line is off: it only settles). Returns the tasks started.
   */
  tick(): string[];
  /** Why the copies in line wait now (AI off, an AI pause, a usage warning), and until when; null when they do not. */
  waitReason(): ResumeCopiesPause | null;
  /** A step soon (a copy put in line or tried again, a copy finished). Only once started. */
  nudge(): void;
  /** Starts the timer (while AI is off, one that only settles); returns the stop function. */
  start(): () => Promise<void>;
}

declare module '../../../core/context' {
  interface AppServices {
    /** The line of editable copies of several uploads (resume_copy_backlog). */
    resumeCopies?: ResumeCopyBacklog;
  }
}

interface MakingRow {
  id: string;
  user_id: string;
  task_id: string | null;
  retries: number;
}

interface CandidateRow {
  id: string;
  user_id: string;
  source_resume_id: string;
  template_id: string | null;
}

/** How a settled copy's row is written (the rest of it is left as it was). */
interface Outcome {
  next?: number;
  retries?: number;
  code?: CopyErrorCode;
  message?: string;
  resumeId?: string | null;
}

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * What the seat's last usage reading says while it still shuts the background gate (the rule of ai/background.ts):
 * 'reached' for a spent window or paid overage, which outlasts the provider's own hold on it (at most 30 minutes),
 * 'warning' for a window nearly used up; null when it does not shut the gate.
 */
function readingNow(reading: RateLimitReading | null, nowMs: number): 'reached' | 'warning' | null {
  if (!reading || (!reading.usingOverage && (reading.status === '' || reading.status === 'allowed'))) return null;
  if ((reading.resetsAtMs ?? reading.seenAtMs + WARNING_PAUSE_MS) <= nowMs) return null;
  return !reading.usingOverage && reading.status === 'allowed_warning' ? 'warning' : 'reached';
}

export function createResumeCopyBacklog(deps: AppDeps): ResumeCopyBacklog {
  const { db, log } = deps;
  const offMessage = copiesOffMessage(deps);
  const enabled = offMessage === null;
  const batchSlots = Math.max(1, Math.floor(deps.config.ai.concurrency / 2));
  const gate = createBackgroundGate(deps);
  let schedule: ((delayMs: number) => void) | null = null;
  let pausedFor = '';
  const nudge = () => schedule?.(NUDGE_MS);

  const sql = {
    making: db.prepare<[], MakingRow>(
      "SELECT id, user_id, task_id, retries FROM resume_copy_backlog WHERE state = 'making'",
    ),
    // The line's copies queued or running, from their tasks: one whose upload (and so its row) was deleted meanwhile
    // still runs, and still holds its slot.
    inFlight: db.prepare<[], { n: number }>(
      "SELECT count(*) AS n FROM ai_tasks WHERE status IN ('queued', 'running') AND kind = 'resume_import' " +
        "AND json_extract(input, '$.copyLine') = 1",
    ),
    // Each account's oldest copy due; the account served least recently first (its last editable copy, from ai_tasks,
    // which the account cannot remove; never served: first), then the oldest copy.
    candidates: db.prepare<[string], CandidateRow>(
      `SELECT d.id, d.user_id, d.source_resume_id, d.template_id,
              (SELECT max(t.created_at) FROM ai_tasks t WHERE t.user_id = d.user_id AND t.kind = 'resume_import')
                AS served
       FROM (
         SELECT b.id, b.user_id, b.source_resume_id, b.template_id, b.created_at,
                row_number() OVER (PARTITION BY b.user_id ORDER BY b.created_at, b.rowid) AS place
         FROM resume_copy_backlog b WHERE b.state = 'waiting' AND b.next_attempt_at <= ?) d
       JOIN users u ON u.id = d.user_id
       WHERE d.place = 1 AND u.disabled_at IS NULL
       ORDER BY served NULLS FIRST, d.created_at, d.id
       LIMIT ${CANDIDATES}`,
    ),
    // The account's editable copies queued or running: asked for alone, or from this line.
    userTasks: db.prepare<[string], { n: number }>(
      "SELECT count(*) AS n FROM ai_tasks WHERE user_id = ? AND kind = 'resume_import' " +
        "AND status IN ('queued', 'running')",
    ),
    owned: db.prepare<[string, string], { ok: number }>('SELECT 1 AS ok FROM resumes WHERE id = ? AND user_id = ?'),
    settle: db.prepare(
      `UPDATE resume_copy_backlog SET state = @state, retries = @retries, next_attempt_at = @next,
         resume_id = @resumeId, error_code = @code, error_message = @message, finished_at = @finished, updated_at = @now
       WHERE id = @id AND state = 'making' AND task_id IS @taskId`,
    ),
    started: db.prepare(
      `UPDATE resume_copy_backlog SET state = 'making', task_id = ?, started_at = ?, updated_at = ?
       WHERE id = ? AND state = 'waiting'`,
    ),
    noRoom: db.prepare(
      `UPDATE resume_copy_backlog SET state = 'failed', error_code = 'no_room', error_message = ?, finished_at = ?,
         updated_at = ?
       WHERE id = ? AND state = 'waiting'`,
    ),
    defer: db.prepare(
      "UPDATE resume_copy_backlog SET next_attempt_at = ?, updated_at = ? WHERE id = ? AND state = 'waiting'",
    ),
  };

  /** What a finished task (or one that is gone) means for its copy's row. */
  function settle(ai: AiService, row: MakingRow, task: AiTaskView | null, nowMs: number): void {
    const update = (state: ResumeCopyState, outcome: Outcome = {}) =>
      sql.settle.run({
        id: row.id,
        taskId: row.task_id,
        state,
        retries: outcome.retries ?? row.retries,
        next: iso(outcome.next ?? nowMs),
        resumeId: outcome.resumeId ?? null,
        code: outcome.code ?? null,
        message: outcome.message ?? null,
        finished: state === 'waiting' ? null : iso(nowMs),
        now: iso(nowMs),
      });
    if (!task) {
      update('waiting');
      return;
    }
    if (task.status === 'succeeded') {
      const result = ResumeImportTaskResultSchema.safeParse(task.result);
      // Linked while it is still the account's resume (it may have been deleted already).
      const resumeId = result.success && sql.owned.get(result.data.resumeId, row.user_id) ? result.data.resumeId : null;
      update('ready', { resumeId });
      return;
    }
    if (task.status === 'cancelled') {
      update('stopped');
      return;
    }
    const code = task.error?.code;
    const message = task.error?.message || AI_ERROR_MESSAGES.failed;
    // AI was turned off since the copy started (the restart cut off or turned away its task): it is not made while AI
    // is off, and Try again makes it once AI is on.
    if (offMessage && (code === 'interrupted' || code === 'ai_unavailable')) {
      update('failed', { code: 'ai_off', message: offMessage });
      return;
    }
    const retries = row.retries + 1;
    switch (code) {
      case 'interrupted':
        if (retries >= COPY_TRIES) update('failed', { retries, code: 'ai', message: COPY_INTERRUPTED });
        else update('waiting', { retries, message });
        return;
      case 'ai_unavailable': {
        // An AI pause holds the copy until it ends, uncounted; an outage with no pause counts.
        const hold = ai.provider.holdFor('resume_import');
        if (hold) update('waiting', { next: hold.until, message });
        else if (retries >= COPY_TRIES) update('failed', { retries, code: 'ai', message });
        else update('waiting', { retries, next: nowMs + OUTAGE_WAIT_MS, message });
        return;
      }
      case 'conflict':
        update('failed', { code: 'no_room', message });
        return;
      case 'validation_failed':
        update('failed', { code: 'unreadable', message });
        return;
      case 'not_found':
        update('failed', { code: 'gone', message });
        return;
      default:
        update('failed', { code: 'ai', message });
    }
  }

  /** Settles every copy whose task finished (or is gone); one that cannot be settled is logged and left for later. */
  function reconcile(ai: AiService, nowMs: number): void {
    for (const row of sql.making.all()) {
      try {
        const task = row.task_id ? ai.getTask(row.task_id, null) : null;
        if (task && (task.status === 'queued' || task.status === 'running')) continue;
        settle(ai, row, task, nowMs);
      } catch (error) {
        log.warn(`[resume-copies] could not settle the copy ${row.id}`, error);
      }
    }
  }

  /** Starts one copy: its task id, null to try the next account's, 'stop' when no copy can start now. */
  function begin(ai: AiService, row: CandidateRow, nowMs: number): string | null | 'stop' {
    const now = iso(nowMs);
    try {
      // No AI call for a copy the account has no room to keep.
      assertRoomForResumes(deps, row.user_id, 1);
      // The task and the row's move to 'making' commit together; the task runs only once they have.
      const taskId = transaction(db, () => {
        const accepted = ai.enqueue({
          kind: 'resume_import',
          userId: row.user_id,
          // copyLine: the mark the line counts its copies in flight by (the handler ignores it).
          input: {
            sourceResumeId: row.source_resume_id,
            ...(row.template_id ? { templateId: row.template_id } : {}),
            copyLine: true,
          },
          dedupeKey: `resume_import:${row.source_resume_id}`,
        });
        sql.started.run(accepted.taskId, now, now, row.id);
        return accepted.taskId;
      });
      // Its end starts the account's next copy at once.
      if (schedule) void ai.waitFor(taskId).then(nudge, nudge);
      return taskId;
    } catch (error) {
      const app = error instanceof AppError ? error : null;
      if (app?.code === 'conflict') {
        sql.noRoom.run(app.message, now, now, row.id);
        return null;
      }
      if (app?.code === 'ai_busy') return null;
      if (app?.code === 'ai_unavailable') {
        sql.defer.run(iso(nowMs + Math.max(REFUSED_WAIT_MS, (app.retryAfterSeconds ?? 0) * 1000)), now, row.id);
        return 'stop';
      }
      log.warn(`[resume-copies] could not start the copy ${row.id}`, error);
      sql.defer.run(iso(nowMs + OTHER_WAIT_MS), now, row.id);
      return null;
    }
  }

  const tick = (): string[] => {
    const ai = deps.services.ai;
    if (!ai) return [];
    const nowMs = deps.now().getTime();
    // Settled even while the line is off, so a copy a previous run left being made never looks made forever.
    reconcile(ai, nowMs);
    if (!enabled) return [];
    const gateAnswer = gate.allowed();
    if (!gateAnswer.ok) {
      if (gateAnswer.reason !== pausedFor) log.info(`[resume-copies] editable copies wait: ${gateAnswer.reason}`);
      pausedFor = gateAnswer.reason;
      return [];
    }
    pausedFor = '';
    const started: string[] = [];
    let free = batchSlots - (sql.inFlight.get()?.n ?? 0);
    if (free <= 0) return started;
    for (const row of sql.candidates.all(iso(nowMs))) {
      // One at a time per account: its other place is left to a copy asked for alone.
      if ((sql.userTasks.get(row.user_id)?.n ?? 0) >= MAX_ACTIVE_PER_USER_KIND - 1) continue;
      const taskId = begin(ai, row, nowMs);
      if (taskId === 'stop') break;
      if (!taskId) continue;
      started.push(taskId);
      free -= 1;
      if (free <= 0) break;
    }
    return started;
  };

  return {
    enabled,
    tick,
    waitReason() {
      if (!enabled) return { reason: 'off', until: null };
      const answer = gate.allowed();
      if (answer.ok) return null;
      // The gate shuts on any hold, and on a usage reading that is not plain "allowed" until its window resets. A
      // spent window (or paid overage) is the limit after the provider's own hold on it has ended too; only a reading
      // of a window nearly used up, with no hold, is a warning.
      const provider = deps.services.ai?.provider;
      const holds = provider?.activeHolds() ?? [];
      const reading = readingNow(provider?.lastRateLimit?.() ?? null, deps.now().getTime());
      let reason: ResumeCopiesPause['reason'] = 'hold';
      if (reading === 'reached' || holds.some((hold) => hold.kind === 'rateLimited')) reason = 'limit';
      else if (holds.length === 0 && reading === 'warning') reason = 'warning';
      return { reason, until: iso(answer.retryAtMs) };
    },
    nudge,
    start() {
      // While AI is off, the timer only settles; with no AI service, there are no tasks to read.
      if (!deps.services.ai) return async () => {};
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
          log.warn('[resume-copies] a step of the copy line failed', error);
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
      if (enabled) {
        log.info(
          '[resume-copies] editable copies of several uploads are made one at a time per account, ' +
            `at most ${batchSlots} at once`,
        );
      }
      return async () => {
        stopped = true;
        schedule = null;
        if (timer) clearTimeout(timer);
        timer = null;
      };
    },
  };
}
