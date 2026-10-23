import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AI_TASK_KINDS, type AiHealth, type AiTaskKind, type AiTaskStatus, type AiTaskView } from '@tailorit/shared';
import type { AppConfig } from '../config/env';
import type { AppDeps } from '../core/context';
import { transaction } from '../core/db/connection';
import { AppError } from '../core/http/errors';
import { AI_ERROR_MESSAGES, AI_MESSAGES, AiError, aboutMinutes, holdError } from './errors';
import { createClaudeCliProvider } from './provider/claudeCli';
import { isSubscriptionSignIn, type CliStatus } from './provider/health';
import type { AiProvider, ProviderHold } from './provider/types';
import { buildSystemText, completeJson, createRunPrompt, type RunPrompt } from './runPrompt';
import { PrioritySemaphore, type AiPriority } from './semaphore';

// The AI task queue. Every AI endpoint answers 202 {taskId} and the page polls GET /api/ai/tasks/:id, because a CLI
// call can take minutes. Tasks live in `ai_tasks` (input and result as JSON); the worker runs in this process.

export interface AiTaskContext {
  /** Aborted when the owner cancels the task or the server stops. ctx.runPrompt already listens to it. */
  signal: AbortSignal;
  /** runPrompt bound to this task: its CLI calls are recorded on the task and stop when the task is cancelled. */
  runPrompt: RunPrompt;
  userId: string | null;
  taskId: string;
}

/** Turns a task's input into its result (any JSON value). Throw AppError for failures a person can act on. */
export type AiTaskHandler = (input: unknown, ctx: AiTaskContext) => Promise<unknown>;

export interface EnqueueOptions {
  kind: AiTaskKind;
  /** The owner. Null = system work (e.g. lazy job analysis): only internal callers (getTask(id, null)) can read it. */
  userId: string | null;
  /** Stored as JSON; the handler receives it parsed back from JSON (the same after a restart). */
  input: unknown;
  priority?: AiPriority;
  /** While a task with this key and the same owner is queued or running, enqueue returns it instead. */
  dedupeKey?: string;
}

export interface AiTestResult {
  ok: boolean;
  model: string;
  ms: number;
  answer: string | null;
  error?: { code: string; message: string; detail: string };
}

export interface AiService {
  /** One handler per kind, registered by the owning feature in its `services` hook. */
  registerHandler(kind: AiTaskKind, handler: AiTaskHandler): void;
  /** Throws AppError: `ai_unavailable` (off, paused, no handler), `ai_busy` (2 of this kind already queued/running). */
  enqueue(options: EnqueueOptions): { taskId: string; deduped: boolean };
  /** Owner-only: null when the task does not exist or belongs to someone else. `userId` null reads any task. */
  getTask(taskId: string, userId: string | null): AiTaskView | null;
  /** Resolves when the task has finished (tests and internal callers). Rejects after `timeoutMs`. */
  waitFor(taskId: string, timeoutMs?: number): Promise<AiTaskView>;
  /** True when a queued/running task of this owner (`null`: anyone's) was cancelled; its CLI child is stopped. */
  cancel(taskId: string, userId: string | null): boolean;
  /** CLI version and sign-in, cached for 60 s unless `force`. */
  health(force?: boolean): Promise<AiHealth>;
  /** The admin connectivity test: one tiny JSON echo, outside the queue but inside the concurrency limit. */
  test(options?: { model?: string }): Promise<AiTestResult>;
  /** Marks tasks a previous run left running as interrupted and resumes queued ones. Returns the stop function. */
  start(): () => Promise<void>;
  readonly provider: AiProvider;
}

declare module '../core/context' {
  interface AppServices {
    /** The AI task queue (work package F4), created by the ai-tasks feature before any feature that uses it. */
    ai?: AiService;
  }
}

const PRIORITY: Record<AiPriority, number> = { interactive: 1, background: 0 };
const MAX_ACTIVE_PER_USER_KIND = 2;
const KEEP_FINISHED_MS = 30 * 24 * 60 * 60_000;
const PRUNE_EVERY_MS = 6 * 60 * 60_000;
const TEST_TIMEOUT_MS = 90_000;
const TEST_SLOT_WAIT_MS = 30_000;
const TERMINAL: ReadonlySet<AiTaskStatus> = new Set(['succeeded', 'failed', 'cancelled']);

const MESSAGES = {
  busy: 'An AI request of this kind is already running for your account. Wait for it to finish, then try again.',
  noHandler: 'This AI feature is not available on this server.',
  noBackground: 'Background AI work is turned off on this server (AI_CLI_BACKGROUND_SLOTS=0).',
  stopping: 'The server is restarting. Please try again in a moment.',
  interrupted: 'The server restarted while this AI request was running. Please try again.',
  cancelled: 'This AI request was cancelled.',
  slotsBusy: 'Every AI slot is busy right now. Try the test again in a minute.',
};

const ECHO_SYSTEM = 'You are a connectivity check. Put the single word the message asks for in the "answer" field.';
const ECHO_USER = 'Reply with the word pong.';
const EchoOutput = z.object({ answer: z.string().max(200) });

interface TaskRow {
  id: string;
  user_id: string | null;
  kind: AiTaskKind;
  status: AiTaskStatus;
  priority: number;
  input: string;
  result: string | null;
  error_code: string | null;
  error_message: string | null;
  model: string | null;
  attempts: number;
  dedupe_key: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function toView(row: TaskRow): AiTaskView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    result: row.status === 'succeeded' && row.result !== null ? JSON.parse(row.result) : null,
    error: row.error_code ? { code: row.error_code, message: row.error_message ?? '' } : null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

const plan = (type: string | null) =>
  type ? `a Claude ${type[0]!.toUpperCase()}${type.slice(1)} subscription` : 'a Claude subscription';

/** AiHealth from the CLI status and the active holds. Pure. */
export function describeHealth(status: CliStatus, holds: ProviderHold[], ai: AppConfig['ai'], nowMs: number): AiHealth {
  let available = false;
  let message: string;
  if (status.problem || !status.found) {
    message = status.problem ?? 'The Claude CLI could not be found.';
  } else if (!status.loggedIn) {
    message = 'The Claude CLI is installed but not signed in. Run "claude auth login" as the user this server runs as.';
  } else if (!isSubscriptionSignIn(status)) {
    const keyed = status.apiKeySource && status.apiKeySource !== 'none';
    const key = keyed ? ` and apiKeySource "${status.apiKeySource}"` : '';
    message =
      `The Claude CLI is signed in with authMethod "${status.authMethod ?? 'unknown'}"${key}, which is billed per ` +
      'request. TailorIT only runs on a Claude subscription: run "claude auth login" and sign in with your Claude ' +
      'account.';
  } else {
    available = true;
    message = `Claude CLI ${status.version ?? '(unknown version)'} is signed in on ${plan(status.subscriptionType)}.`;
  }
  for (const hold of holds) {
    const what = hold.scope === '*' ? 'All AI requests are' : `AI requests for "${hold.scope}" are`;
    message += ` ${what} paused for ${aboutMinutes(hold.until - nowMs)}: ${hold.reason}.`;
    if (hold.scope === '*') available = false;
  }
  return {
    enabled: true,
    available,
    cliVersion: status.version,
    loggedIn: status.loggedIn,
    authMethod: status.authMethod,
    subscriptionType: status.subscriptionType,
    defaultModel: ai.model,
    models: Object.fromEntries(AI_TASK_KINDS.map((kind) => [kind, ai.features[kind].model])),
    message,
    checkedAt: status.checkedAt,
  };
}

export function createAiService(deps: AppDeps, options: { provider?: AiProvider } = {}): AiService {
  const { db, log } = deps;
  const ai = deps.config.ai;
  const provider =
    options.provider ?? createClaudeCliProvider({ ai, dataDir: deps.config.dataDir, log, now: deps.now });
  const backgroundSlots = Math.min(ai.backgroundSlots, ai.concurrency);
  const semaphore = new PrioritySemaphore(ai.concurrency, backgroundSlots);
  const handlers = new Map<AiTaskKind, AiTaskHandler>();
  /** Tasks this process has dispatched: waiting for a slot or running. */
  const live = new Map<string, AbortController>();
  const waiters = new Map<string, Set<(view: AiTaskView) => void>>();
  let stopping = false;
  const nowIso = () => deps.now().toISOString();

  const sql = {
    get: db.prepare<[string], TaskRow>('SELECT * FROM ai_tasks WHERE id = ?'),
    findDedupe: db.prepare<[string], { id: string }>(
      "SELECT id FROM ai_tasks WHERE dedupe_key = ? AND status IN ('queued', 'running')",
    ),
    countActive: db.prepare<[string, string], { n: number }>(
      "SELECT count(*) AS n FROM ai_tasks WHERE user_id = ? AND kind = ? AND status IN ('queued', 'running')",
    ),
    insert: db.prepare(
      'INSERT INTO ai_tasks(id, user_id, kind, status, priority, input, dedupe_key, created_at) ' +
        "VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)",
    ),
    markRunning: db.prepare(
      "UPDATE ai_tasks SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'",
    ),
    succeed: db.prepare(
      "UPDATE ai_tasks SET status = 'succeeded', result = ?, finished_at = ? WHERE id = ? AND status = 'running'",
    ),
    fail: db.prepare(
      "UPDATE ai_tasks SET status = 'failed', error_code = ?, error_message = ?, finished_at = ? " +
        "WHERE id = ? AND status IN ('queued', 'running')",
    ),
    cancel: db.prepare(
      "UPDATE ai_tasks SET status = 'cancelled', error_code = 'cancelled', error_message = ?, finished_at = ? " +
        "WHERE id = ? AND status IN ('queued', 'running')",
    ),
    record: db.prepare('UPDATE ai_tasks SET model = ?, attempts = attempts + ? WHERE id = ?'),
    running: db.prepare<[], { id: string }>("SELECT id FROM ai_tasks WHERE status = 'running'"),
    queued: db.prepare<[], { id: string; kind: AiTaskKind; priority: number }>(
      "SELECT id, kind, priority FROM ai_tasks WHERE status = 'queued' ORDER BY priority DESC, created_at, rowid",
    ),
    prune: db.prepare(
      "DELETE FROM ai_tasks WHERE status IN ('succeeded', 'failed', 'cancelled') AND finished_at < ?",
    ),
  };

  function notify(taskId: string): void {
    const listeners = waiters.get(taskId);
    if (!listeners) return;
    const row = sql.get.get(taskId);
    if (row && !TERMINAL.has(row.status)) return;
    waiters.delete(taskId);
    if (!row) return;
    const view = toView(row);
    for (const listener of listeners) listener(view);
  }

  function fail(taskId: string, error: unknown): void {
    const row = sql.get.get(taskId);
    // Cancelled by its owner, or marked interrupted by stop(): that status stands.
    if (!row || TERMINAL.has(row.status)) return;
    if (error instanceof AppError) {
      const detail = error instanceof AiError && error.detail ? ` (${error.detail})` : '';
      log.info(`[ai] task ${taskId} (${row.kind}) failed: ${error.code}: ${error.message}${detail}`);
      sql.fail.run(error.code, error.message, nowIso(), taskId);
    } else {
      log.error(`[ai] task ${taskId} (${row.kind}) failed`, error);
      sql.fail.run('ai_failed', AI_ERROR_MESSAGES.failed, nowIso(), taskId);
    }
  }

  async function runTask(taskId: string, controller: AbortController): Promise<void> {
    if (controller.signal.aborted || sql.markRunning.run(nowIso(), taskId).changes === 0) return;
    const row = sql.get.get(taskId)!;
    const handler = handlers.get(row.kind);
    if (!handler) throw new AppError('ai_unavailable', MESSAGES.noHandler);
    const hold = provider.holdFor(row.kind);
    if (hold) throw holdError(hold, deps.now().getTime());
    const bound = createRunPrompt(provider, ai, (info) => sql.record.run(info.model, info.calls, taskId));
    const ctx: AiTaskContext = {
      signal: controller.signal,
      userId: row.user_id,
      taskId,
      runPrompt: (module, input, opts = {}) =>
        bound(module, input, {
          ...opts,
          signal: opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal,
        }),
    };
    const result = await handler(JSON.parse(row.input), ctx);
    sql.succeed.run(JSON.stringify(result ?? null), nowIso(), taskId);
  }

  /** Never rejects: a failure is recorded on the task (or logged, when even that fails, e.g. at shutdown). */
  async function execute(taskId: string, controller: AbortController, release: () => void): Promise<void> {
    try {
      await runTask(taskId, controller);
    } catch (error) {
      try {
        fail(taskId, error);
      } catch (recordError) {
        log.error(`[ai] could not record the failure of AI task ${taskId}`, recordError);
      }
    } finally {
      release();
      settle(taskId);
    }
  }

  /** The task left this process's hands: wake waitFor() callers. */
  function settle(taskId: string): void {
    live.delete(taskId);
    try {
      notify(taskId);
    } catch {
      /* the database is closed (shutdown): nobody is left waiting */
    }
  }

  /** Takes a slot in priority/FIFO order (dispatch order is enqueue order), then runs the task. */
  function dispatch(taskId: string, priority: AiPriority): void {
    if (live.has(taskId)) return;
    const controller = new AbortController();
    live.set(taskId, controller);
    semaphore.acquire(priority, controller.signal).then(
      (release) => void execute(taskId, controller, release),
      // Cancelled or stopped while waiting: the row says which (a stop leaves it queued for the next start).
      () => settle(taskId),
    );
  }

  const service: AiService = {
    provider,

    registerHandler(kind, handler) {
      if (!AI_TASK_KINDS.includes(kind)) throw new Error(`Unknown AI task kind "${kind}".`);
      if (handlers.has(kind)) throw new Error(`An AI handler for "${kind}" is already registered.`);
      handlers.set(kind, handler);
    },

    enqueue({ kind, userId, input, priority = 'interactive', dedupeKey }) {
      if (!ai.enabled) throw new AppError('ai_unavailable', AI_MESSAGES.disabled);
      if (stopping) throw new AppError('ai_unavailable', MESSAGES.stopping);
      if (!handlers.has(kind)) throw new AppError('ai_unavailable', MESSAGES.noHandler);
      if (priority === 'background' && backgroundSlots === 0) {
        throw new AppError('ai_unavailable', MESSAGES.noBackground);
      }
      // Scoped by owner, so one account's key never hands it another account's task.
      const key = dedupeKey ? `${userId ?? '-'}:${dedupeKey}` : null;
      const json = JSON.stringify(input ?? null);
      const accepted = transaction(db, () => {
        const existing = key ? sql.findDedupe.get(key) : undefined;
        if (existing) return { taskId: existing.id, deduped: true };
        const hold = provider.holdFor(kind);
        if (hold) throw holdError(hold, deps.now().getTime());
        if (userId !== null && (sql.countActive.get(userId, kind)?.n ?? 0) >= MAX_ACTIVE_PER_USER_KIND) {
          throw new AppError('ai_busy', MESSAGES.busy);
        }
        const taskId = randomUUID();
        sql.insert.run(taskId, userId, kind, PRIORITY[priority], json, key, nowIso());
        return { taskId, deduped: false };
      });
      if (!accepted.deduped) dispatch(accepted.taskId, priority);
      return accepted;
    },

    getTask(taskId, userId) {
      const row = sql.get.get(taskId);
      if (!row || (userId !== null && row.user_id !== userId)) return null;
      return toView(row);
    },

    waitFor(taskId, timeoutMs = 2 * ai.timeoutMs + 60_000) {
      const row = sql.get.get(taskId);
      if (!row) return Promise.reject(new Error(`AI task ${taskId} does not exist.`));
      if (TERMINAL.has(row.status)) return Promise.resolve(toView(row));
      return new Promise((resolve, reject) => {
        const listeners = waiters.get(taskId) ?? new Set();
        waiters.set(taskId, listeners);
        const timer = setTimeout(() => {
          listeners.delete(done);
          reject(new Error(`AI task ${taskId} did not finish within ${timeoutMs} ms.`));
        }, timeoutMs);
        timer.unref?.();
        function done(view: AiTaskView) {
          clearTimeout(timer);
          resolve(view);
        }
        listeners.add(done);
      });
    },

    cancel(taskId, userId) {
      const row = sql.get.get(taskId);
      if (!row || (userId !== null && row.user_id !== userId)) return false;
      if (sql.cancel.run(MESSAGES.cancelled, nowIso(), taskId).changes === 0) return false;
      live.get(taskId)?.abort();
      notify(taskId);
      return true;
    },

    async health(force = false) {
      if (!ai.enabled) {
        return {
          enabled: false,
          available: false,
          cliVersion: null,
          loggedIn: false,
          authMethod: null,
          subscriptionType: null,
          defaultModel: ai.model,
          models: Object.fromEntries(AI_TASK_KINDS.map((kind) => [kind, ai.features[kind].model])),
          message: 'AI features are turned off on this server (AI_ENABLED=false).',
          checkedAt: nowIso(),
        };
      }
      const status = await provider.status(force);
      return describeHealth(status, provider.activeHolds(), ai, deps.now().getTime());
    },

    async test({ model } = {}) {
      const useModel = model?.trim() || ai.model;
      const startedAt = Date.now();
      const failure = (error: unknown): AiTestResult => {
        const app = error instanceof AppError ? error : new AiError('failed', { detail: String(error) });
        const detail = app instanceof AiError ? app.detail : '';
        const ms = Date.now() - startedAt;
        const { code, message } = app;
        return { ok: false, model: useModel, ms, answer: null, error: { code, message, detail } };
      };
      if (!ai.enabled) return failure(new AppError('ai_unavailable', AI_MESSAGES.disabled));
      let release: () => void;
      try {
        release = await semaphore.acquire('interactive', AbortSignal.timeout(TEST_SLOT_WAIT_MS));
      } catch {
        const detail = 'No free AI slot within 30 s.';
        return failure(new AiError('unavailable', { message: MESSAGES.slotsBusy, detail }));
      }
      try {
        const { value, info } = await completeJson(provider, {
          tag: 'echo',
          system: buildSystemText(ECHO_SYSTEM, 'echo'),
          user: ECHO_USER,
          output: EchoOutput,
          model: useModel,
          effort: ai.effort,
          timeoutMs: TEST_TIMEOUT_MS,
          ignoreHolds: true,
        });
        // A working call is the operator's proof that whatever caused a pause is fixed.
        provider.clearHolds();
        return { ok: true, model: info.model, ms: Date.now() - startedAt, answer: value.answer };
      } catch (error) {
        return failure(error);
      } finally {
        release();
      }
    },

    start() {
      // A previous process's CLI children died with it; their tasks cannot be resumed.
      let interrupted = 0;
      for (const { id } of sql.running.all()) {
        if (live.has(id)) continue;
        interrupted += sql.fail.run('interrupted', MESSAGES.interrupted, nowIso(), id).changes;
      }
      if (interrupted) log.warn(`[ai] marked ${interrupted} AI task(s) the previous run left running as interrupted`);
      // Finished tasks (inputs can be whole resumes) are kept for 30 days.
      const prune = () => {
        try {
          sql.prune.run(new Date(deps.now().getTime() - KEEP_FINISHED_MS).toISOString());
        } catch (error) {
          log.warn('[ai] could not delete old AI tasks', error);
        }
      };
      prune();
      const pruneTimer = setInterval(prune, PRUNE_EVERY_MS);
      pruneTimer.unref?.();
      for (const row of sql.queued.all()) {
        if (live.has(row.id)) continue;
        const priority: AiPriority = row.priority > 0 ? 'interactive' : 'background';
        if (!ai.enabled) fail(row.id, new AppError('ai_unavailable', AI_MESSAGES.disabled));
        else if (!handlers.has(row.kind)) fail(row.id, new AppError('ai_unavailable', MESSAGES.noHandler));
        else if (priority === 'background' && backgroundSlots === 0) {
          fail(row.id, new AppError('ai_unavailable', MESSAGES.noBackground));
        } else dispatch(row.id, priority);
      }
      return async () => {
        stopping = true;
        clearInterval(pruneTimer);
        for (const [id, controller] of live) {
          if (sql.get.get(id)?.status === 'running') sql.fail.run('interrupted', MESSAGES.interrupted, nowIso(), id);
          controller.abort();
        }
      };
    },
  };
  return service;
}
