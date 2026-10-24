import { Router } from 'express';
import { z } from 'zod';
import type { AiBackgroundWork } from '@tailorit/shared';
import { createBackgroundGate, type BackgroundGate } from '../../ai/background';
import { requireAi } from '../../ai/index';
import { requireAdmin } from '../../core/auth/guards';
import { nowIso, type AppDeps } from '../../core/context';
import { asyncHandler } from '../../core/http/errors';
import { parseInput } from '../../core/http/validate';
import { JOB_ANALYSIS_PROMPT_VERSION } from '../job-analysis/prompt';
import { MIN_TEXT_FOR_AI } from '../job-analysis/service';
import { AI_FAILURES_BEFORE_GIVING_UP } from '../job-analysis/store';

// Administrator: Claude CLI health, a test prompt, and the background AI work still to do. Owned by work package F4
// (see docs/ARCHITECTURE.md §9).

const TestBody = z.object({
  model: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/, 'Use a Claude model name such as claude-sonnet-5-5.')
    .optional(),
});

/**
 * The jobs the add-time backlog (job-analysis/backlog.ts, its `candidates`) has left, counted with its rules: a live job
 * with at least MIN_TEXT_FOR_AI bytes of text (octet_length reads no text) whose text has no Claude analysis of the
 * current prompt version and, in `saved` mode, that someone has saved. It is `waiting` unless its text rests in
 * job_ai_attempts: `backingOff`, or `gaveUp` from the third failure on. Jobs are counted, not texts (jobs that share a
 * text count each). Exported so a test can check its query plan.
 *
 * Shaped to stay fast with 50,000 jobs. A job row keeps `content_hash` and `active` after its two description
 * columns, so reading them from the row walks the posting's overflow pages (the backlog's own query does). Here
 * `content_hash` comes from idx_jobs_hash (a covering scan), `active` from an index on it (the IN list), and a row is
 * opened only for the length of a text Claude has not read, which its record header holds.
 */
export function jobBacklogSql(savedOnly: boolean): string {
  return (
    'SELECT coalesce(sum(t.content_hash IS NULL), 0) AS waiting, coalesce(sum(t.attempts < @givenUpAt), 0) AS backingOff, ' +
    'coalesce(sum(t.attempts >= @givenUpAt), 0) AS gaveUp ' +
    'FROM jobs j INDEXED BY idx_jobs_hash ' +
    'LEFT JOIN job_ai_attempts t ON t.content_hash = j.content_hash AND t.version = @version AND t.next_attempt_at > @now ' +
    'WHERE j.id IN (SELECT id FROM jobs WHERE active = 1) ' +
    (savedOnly
      ? 'AND EXISTS (SELECT 1 FROM applications p WHERE p.job_id = j.id AND p.current_status = 1 AND p.archived_at IS NULL) '
      : '') +
    "AND NOT EXISTS (SELECT 1 FROM job_analyses a WHERE a.content_hash = j.content_hash AND a.source = 'ai' AND a.version = @version) " +
    'AND (SELECT octet_length(d.description_text) FROM jobs d WHERE d.id = j.id) >= @minText'
  );
}

/** The background gate as Background work shows it: first the settings that keep background work off altogether. */
function gateState(deps: AppDeps, gate: BackgroundGate): AiBackgroundWork['gate'] {
  const off = (reason: string): AiBackgroundWork['gate'] => ({ open: false, reason, retryAt: null });
  if (!deps.config.ai.enabled) return off('AI is turned off (AI_ENABLED=false)');
  if (deps.config.ai.backgroundSlots <= 0) return off('background AI work is turned off (AI_CLI_BACKGROUND_SLOTS=0)');
  if (!deps.services.ai) return off('AI is not set up on this server');
  const answer = gate.allowed();
  if (answer.ok) return { open: true, reason: null, retryAt: null };
  return { open: false, reason: answer.reason, retryAt: new Date(answer.retryAtMs).toISOString() };
}

/**
 * Reads Admin › AI › Background work from the database: no AI call, no write. A mode without a backlog (jobs `lazy` or
 * `off`, resumes `off`) counts nothing. Rows of disabled accounts are left out, as the resume backlog and the match
 * worker skip them.
 */
function createBackgroundWork(deps: AppDeps): () => AiBackgroundWork {
  const { db, config } = deps;
  const jobMode = config.ai.jobAnalysis;
  const gate = createBackgroundGate(deps);
  const sql = {
    jobs:
      jobMode === 'ingest' || jobMode === 'saved'
        ? db.prepare<
            { minText: number; version: number; now: string; givenUpAt: number },
            { waiting: number; backingOff: number; gaveUp: number }
          >(jobBacklogSql(jobMode === 'saved'))
        : null,
    resumes:
      config.ai.resumeAnalysis === 'auto'
        ? db.prepare<[], { waiting: number; queued: number; failed: number }>(
            "SELECT coalesce(sum(b.state = 'waiting'), 0) AS waiting, coalesce(sum(b.state = 'queued'), 0) AS queued, " +
              "coalesce(sum(b.state = 'failed'), 0) AS failed FROM resume_analysis_backlog b JOIN users u ON u.id = b.user_id " +
              "WHERE b.state IN ('waiting', 'queued', 'failed') AND u.disabled_at IS NULL",
          )
        : null,
    // Literally `resume_match_due = 1`, so SQLite reads the partial index idx_app_match_due.
    matches: db.prepare<[], { due: number }>(
      'SELECT count(*) AS due FROM applications a JOIN users u ON u.id = a.user_id ' +
        'WHERE a.resume_match_due = 1 AND u.disabled_at IS NULL',
    ),
  };

  return () => {
    const jobs = sql.jobs?.get({
      minText: MIN_TEXT_FOR_AI,
      version: JOB_ANALYSIS_PROMPT_VERSION,
      now: nowIso(deps),
      givenUpAt: AI_FAILURES_BEFORE_GIVING_UP,
    });
    const resumes = sql.resumes?.get();
    return {
      jobs: {
        mode: jobMode,
        waiting: jobs?.waiting ?? 0,
        backingOff: jobs?.backingOff ?? 0,
        gaveUp: jobs?.gaveUp ?? 0,
        perHourCap: config.ai.jobAnalysisPerHour,
      },
      resumes: {
        mode: config.ai.resumeAnalysis,
        waiting: resumes?.waiting ?? 0,
        queued: resumes?.queued ?? 0,
        failed: resumes?.failed ?? 0,
        perHourCap: config.ai.resumeAnalysisPerHour,
      },
      matches: { due: sql.matches.get()?.due ?? 0 },
      gate: gateState(deps, gate),
    };
  };
}

/** Mounted at /api/admin/ai. */
export function createAdminAiRouter(deps: AppDeps): Router {
  const router = Router();
  const backgroundWork = createBackgroundWork(deps);
  router.use(requireAdmin);

  /** GET /api/admin/ai/health[?force=1] → AiHealth (`claude --version` + `claude auth status`, cached 60 s). */
  router.get(
    '/health',
    asyncHandler(async (req, res) => {
      const force = /^(1|true|yes)$/i.test(String(req.query.force ?? ''));
      res.json(await requireAi(deps).health(force));
    }),
  );

  /** POST /api/admin/ai/test {model?} → {ok, model, ms, answer, error?}: one tiny JSON echo through the CLI. */
  router.post(
    '/test',
    asyncHandler(async (req, res) => {
      const body = parseInput(TestBody, req.body ?? {}, 'test request');
      res.json(await requireAi(deps).test({ model: body.model }));
    }),
  );

  /**
   * GET /api/admin/ai/background → AiBackgroundWork: what Claude still has to read in the background (added jobs,
   * uploaded resumes), the resume matches TailorIT is to choose again, and whether background work may start a task now.
   */
  router.get('/background', (_req, res) => {
    res.json(backgroundWork());
  });

  return router;
}
