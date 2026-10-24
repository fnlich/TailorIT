import { z } from 'zod';
import { EXPERIENCE_LEVELS, type ExperienceLevel, type JobAnalysisView } from '@tailorit/shared';
import type { AiService, AiTaskHandler } from '../../ai/index';
import { nowIso, type AppDeps } from '../../core/context';
import { transaction } from '../../core/db/connection';
import { AppError } from '../../core/http/errors';
import { finishAiAnalysis, type FinishedAiAnalysis } from './ai';
import { analyzeDeterministic, DETERMINISTIC_VERSION, jobFacetsOf, type AnalysisDraft, type JobFacetsDraft } from './deterministic';
import { JOB_ANALYSIS_PROMPT_HASH, JOB_ANALYSIS_PROMPT_VERSION, jobAnalysisPrompt } from './prompt';
import {
  AI_OUTAGE_WAIT_MS,
  analysesFor,
  applyAiFacts,
  bestOf,
  clearAiAttempts,
  deferAiAttempt,
  facetsOf,
  fillFacets,
  recordAiFailure,
  refreshAnalysisLinks,
  saveAnalysis,
  type AnalysisRecord,
  type ViewFacets,
} from './store';
import type { EnsuredAnalysis, JobAnalysisService } from './types';

// The analysis a job shows (docs/ARCHITECTURE.md §9): the best one stored for its text (AI > free_tailor lake >
// deterministic), with the posting's facets (soft skills, certifications and industries, required years).
//
// When Claude reads a job is AI_JOB_ANALYSIS's to say:
//   - `ingest` (the default) and `saved`: the add-time backlog (./backlog.ts) has Claude read each added job (or each
//     saved one) once. Opening, saving or "Save all" never queues anything: a view shows the best analysis so far,
//     with "Refining..." while the backlog's task for that text runs;
//   - `lazy`: the first view of a job without an AI analysis queues one, system-owned and deduplicated by the text's
//     hash, on the background slot; each account starts at most AI_ANALYSES_PER_USER_PER_HOUR new ones;
//   - `off`: never.
// `get` and `ensure` complete what is missing as they read (a current deterministic analysis, the facets of one
// stored before they were read); `peek` answers the same and writes nothing.

/** A failed AI analysis of one text is not asked for again from a view (lazy mode) for this long. */
export const RETRY_AFTER_FAILURE_MS = 30 * 60_000;

/** Postings shorter than this are not worth a model call (the deterministic reading is all there is). */
export const MIN_TEXT_FOR_AI = 80;

/** Whether a posting's text is long enough to ask Claude about. */
export function readableForAi(text: string): boolean {
  return text.trim().length >= MIN_TEXT_FOR_AI;
}

/**
 * AI job analyses queued or running at once. Past this many nothing new is queued (a lazy view shows the
 * deterministic analysis and a later view asks again), so people's own AI requests (imports, letters) never wait
 * behind a pile of system work on the CLI's few slots.
 */
export const MAX_PENDING_ANALYSES = 3;

/**
 * New AI analyses one account can start per hour by opening jobs (lazy mode; a sliding window, in memory). Past it,
 * that account sees the current best analysis without "Refining..." until the hour has moved on; jobs that already
 * have an AI analysis, or one under way, are not limited. Without it, one script sweeping job ids would keep the CLI
 * busy with system work, on the owner's subscription, for as long as it ran.
 */
export const AI_ANALYSES_PER_USER_PER_HOUR = 20;
const BUDGET_WINDOW_MS = 60 * 60_000;

export const JobAnalysisTaskInputSchema = z.object({
  jobId: z.number().int().positive(),
  contentHash: z.string().min(16).max(128),
  version: z.number().int().positive(),
});
export type JobAnalysisTaskInput = z.infer<typeof JobAnalysisTaskInputSchema>;

export interface JobAnalysisTaskResult {
  analysisId: number | null;
  skipped?: string;
}

interface JobRow {
  id: number;
  title: string;
  content_hash: string;
  description_html: string;
  description_text: string;
  locations_text: string;
  experience_levels: string;
  category_id: string | null;
  subcategory_ids: string;
  analysis_id: number | null;
  company_name: string;
}

const JOB_SELECT =
  'SELECT j.id, j.title, j.content_hash, j.description_html, j.description_text, j.locations_text, j.experience_levels, ' +
  'j.category_id, j.subcategory_ids, j.analysis_id, c.name AS company_name FROM jobs j JOIN companies c ON c.id = j.company_id';

function parseList(text: string): string[] {
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function dedupeKeyOf(contentHash: string, version = JOB_ANALYSIS_PROMPT_VERSION): string {
  return `job_analysis:${contentHash}:${version}`;
}

/**
 * The view J2's endpoints answer: the analysis, with the job's own facts where the source of the analysis is weaker,
 * and the facets of the text's analyses (`facetsOf`).
 */
export function analysisView(
  record: AnalysisRecord,
  job: Pick<JobRow, 'experience_levels' | 'category_id' | 'subcategory_ids'>,
  refining: boolean,
  facets: ViewFacets,
): JobAnalysisView {
  const jobLevels = parseList(job.experience_levels).filter((level): level is ExperienceLevel =>
    (EXPERIENCE_LEVELS as readonly string[]).includes(level),
  );
  const fromAi = record.source === 'ai';
  const experienceLevels = fromAi && record.experienceLevels.length ? record.experienceLevels : jobLevels.length ? jobLevels : record.experienceLevels;
  const aiCategory = fromAi && record.categoryId && record.categoryId !== 'other';
  const categoryId = aiCategory ? record.categoryId : (job.category_id ?? record.categoryId);
  const jobSubcategories = parseList(job.subcategory_ids);
  const subcategoryIds = aiCategory ? record.subcategoryIds : jobSubcategories.length ? jobSubcategories : record.subcategoryIds;
  return {
    source: record.source,
    refining,
    requirements: record.requirements,
    responsibilities: record.responsibilities,
    desired: record.desired,
    keywords: record.keywords,
    experienceLevels,
    categoryId,
    subcategoryIds,
    softSkills: facets.softSkills,
    terms: facets.terms,
    requiredYears: facets.requiredYears,
  };
}

export interface JobAnalysisServiceInternals extends JobAnalysisService {
  /** The AI task handler (registered on the AI queue by the feature's services hook). */
  readonly handler: AiTaskHandler;
  peek(jobId: number): EnsuredAnalysis | null;
  /**
   * Queues Claude's analysis of a job: system-owned, deduplicated by the posting's text, charged to no one. Answers
   * the task (also one already queued or running for that text); null when none can be queued: no such job, an AI
   * analysis of the current version already, too little text, AI off or unavailable, MAX_PENDING_ANALYSES pending.
   */
  enqueueTask(jobId: number, priority: 'interactive' | 'background'): { taskId: string; deduped: boolean } | null;
  /**
   * `enqueueTask` as the lazy warm-up asks it: true when an analysis is queued or running now; false also while the
   * text's last AI analysis failed less than RETRY_AFTER_FAILURE_MS ago.
   */
  enqueue(jobId: number, priority: 'interactive' | 'background'): boolean;
  /** Whether an AI analysis of this text is queued or running. */
  isRefining(contentHash: string): boolean;
}

export function createJobAnalysisService(deps: AppDeps): JobAnalysisServiceInternals {
  const { db, log } = deps;
  /** contentHash -> when its last AI analysis failed (this process only; the lazy views' memory). */
  const failedAt = new Map<string, number>();
  /** userId -> when the AI analyses that account started began, within the budget window (this process only). */
  const startedBy = new Map<string, number[]>();

  const sql = {
    job: db.prepare<[number], JobRow>(`${JOB_SELECT} WHERE j.id = ?`),
    jobByHash: db.prepare<[string], JobRow>(`${JOB_SELECT} WHERE j.content_hash = ? ORDER BY j.active DESC, j.id DESC LIMIT 1`),
    setAnalysis: db.prepare('UPDATE jobs SET analysis_id = ? WHERE id = ?'),
    refining: db.prepare<[string], { id: string }>(
      "SELECT id FROM ai_tasks WHERE kind = 'job_analysis' AND status IN ('queued', 'running') AND json_extract(input, '$.contentHash') = ? LIMIT 1",
    ),
    pending: db.prepare<[], { n: number }>("SELECT count(*) AS n FROM ai_tasks WHERE kind = 'job_analysis' AND status IN ('queued', 'running')"),
    hasCurrentAi: db.prepare<[string, number], { found: number }>(
      "SELECT 1 AS found FROM job_analyses WHERE content_hash = ? AND source = 'ai' AND version = ?",
    ),
  };

  const ai = (): AiService | undefined => deps.services.ai;

  const hasCurrentAiIn = (list: readonly AnalysisRecord[]) =>
    list.some((record) => record.source === 'ai' && record.version === JOB_ANALYSIS_PROMPT_VERSION);

  function facetsFor(job: JobRow, record: AnalysisRecord): JobFacetsDraft {
    return jobFacetsOf({
      title: job.title,
      text: job.description_text,
      requirements: record.requirements,
      responsibilities: record.responsibilities,
      desired: record.desired,
    });
  }

  /**
   * The analyses of a job's text, completed in memory: a current deterministic analysis when none is stored (made
   * from the job's title and text), and the facets of one stored before they were read. Also says what it added, so
   * `analysesOf` can store it; `peek` does not.
   */
  function completed(job: JobRow): {
    list: AnalysisRecord[];
    draft: AnalysisDraft | null;
    facets: { id: number; facets: JobFacetsDraft } | null;
  } {
    const stored = analysesFor(db, job.content_hash);
    const deterministic = stored.find((record) => record.source === 'deterministic' && record.version === DETERMINISTIC_VERSION);
    if (!deterministic) {
      const draft = analyzeDeterministic({ title: job.title, html: job.description_html, text: job.description_text });
      const record: AnalysisRecord = {
        ...draft,
        id: 0,
        contentHash: job.content_hash,
        source: 'deterministic',
        version: DETERMINISTIC_VERSION,
        model: null,
        promptHash: null,
        createdAt: nowIso(deps),
        softSkills: draft.softSkills ?? null,
        terms: draft.terms ?? null,
        requiredYears: draft.requiredYears ?? null,
      };
      return { list: [...stored, record], draft, facets: null };
    }
    if (deterministic.softSkills === null) {
      const facets = facetsFor(job, deterministic);
      const list = stored.map((record) => (record === deterministic ? { ...record, ...facets } : record));
      return { list, draft: null, facets: { id: deterministic.id, facets } };
    }
    return { list: stored, draft: null, facets: null };
  }

  /** Every analysis of the job's text, with what `completed` added stored. */
  function analysesOf(job: JobRow): AnalysisRecord[] {
    const { list, draft, facets } = completed(job);
    if (draft) {
      saveAnalysis(db, { ...draft, contentHash: job.content_hash, source: 'deterministic', version: DETERMINISTIC_VERSION }, nowIso(deps));
      return analysesFor(db, job.content_hash);
    }
    if (facets) fillFacets(db, facets.id, facets.facets);
    return list;
  }

  function current(job: JobRow): { best: AnalysisRecord; list: AnalysisRecord[]; hasCurrentAi: boolean } {
    const list = analysesOf(job);
    const best = bestOf(list)!;
    if (job.analysis_id !== best.id) sql.setAnalysis.run(best.id, job.id);
    return { best, list, hasCurrentAi: hasCurrentAiIn(list) };
  }

  function answer(job: JobRow, best: AnalysisRecord, list: readonly AnalysisRecord[], refining: boolean): EnsuredAnalysis {
    return { analysis: analysisView(best, job, refining, facetsOf(list)), refining };
  }

  function isRefining(contentHash: string): boolean {
    return Boolean(sql.refining.get(contentHash));
  }

  function recentlyFailed(job: JobRow): boolean {
    const failed = failedAt.get(job.content_hash);
    return failed !== undefined && deps.now().getTime() - failed < RETRY_AFTER_FAILURE_MS;
  }

  /** An account's analyses started within the window (and the map forgets accounts whose window is empty). */
  function recentStarts(userId: string, nowMs: number): number[] {
    const recent = (startedBy.get(userId) ?? []).filter((at) => nowMs - at < BUDGET_WINDOW_MS);
    if (recent.length > 0) startedBy.set(userId, recent);
    else startedBy.delete(userId);
    return recent;
  }

  function withinBudget(userId: string): boolean {
    return recentStarts(userId, deps.now().getTime()).length < AI_ANALYSES_PER_USER_PER_HOUR;
  }

  function spendBudget(userId: string): void {
    const nowMs = deps.now().getTime();
    startedBy.set(userId, [...recentStarts(userId, nowMs), nowMs]);
    if (startedBy.size > 1000) for (const id of [...startedBy.keys()]) recentStarts(id, nowMs);
  }

  /** Queues the AI analysis of a job's text; `requestedBy` pays from its hourly budget (lazy views only). */
  function startTask(job: JobRow, priority: 'interactive' | 'background', requestedBy?: string): { taskId: string; deduped: boolean } | null {
    const service = ai();
    if (!service || deps.config.ai.jobAnalysis === 'off' || !readableForAi(job.description_text)) return null;
    if ((sql.pending.get()?.n ?? 0) >= MAX_PENDING_ANALYSES) return null;
    if (requestedBy !== undefined && !withinBudget(requestedBy)) return null;
    try {
      // System-owned: the result serves everyone who opens the job.
      const accepted = service.enqueue({
        kind: 'job_analysis',
        userId: null,
        input: { jobId: job.id, contentHash: job.content_hash, version: JOB_ANALYSIS_PROMPT_VERSION } satisfies JobAnalysisTaskInput,
        priority,
        dedupeKey: dedupeKeyOf(job.content_hash),
      });
      if (requestedBy !== undefined && !accepted.deduped) spendBudget(requestedBy);
      return accepted;
    } catch (error) {
      // Paused, turned off, no background slot: the deterministic analysis stands.
      log.debug(`[job-analysis] no AI analysis queued for job ${job.id}: ${(error as Error).message}`);
      return null;
    }
  }

  function enqueueTask(jobId: number, priority: 'interactive' | 'background'): { taskId: string; deduped: boolean } | null {
    const job = sql.job.get(jobId);
    if (!job || sql.hasCurrentAi.get(job.content_hash, JOB_ANALYSIS_PROMPT_VERSION)) return null;
    const running = sql.refining.get(job.content_hash);
    if (running) return { taskId: running.id, deduped: true };
    return startTask(job, priority);
  }

  /**
   * What a failed analysis means for the add-time backlog (job_ai_attempts): Claude failing on the text (`ai_failed`)
   * counts as an attempt and backs it off; Claude being unavailable (signed out, a usage limit, a stall) is not the
   * text's fault, so it only waits for the outage to pass, AI_OUTAGE_WAIT_MS at least.
   */
  function noteFailure(contentHash: string, error: unknown): void {
    try {
      const code = error instanceof AppError ? error.code : 'ai_failed';
      const message = error instanceof Error ? error.message : String(error);
      const now = deps.now();
      if (code === 'ai_failed') {
        const memory = recordAiFailure(db, { contentHash, version: JOB_ANALYSIS_PROMPT_VERSION, message, now });
        log.info(`[job-analysis] Claude's analysis of text ${contentHash.slice(0, 12)} failed (${memory.attempts}); next try ${memory.nextAttemptAt}`);
        return;
      }
      const retryAfterMs = error instanceof AppError && error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : 0;
      const holdsEnd = Math.max(0, ...(ai()?.provider.activeHolds().map((hold) => hold.until) ?? []));
      const until = Math.max(now.getTime() + Math.max(AI_OUTAGE_WAIT_MS, retryAfterMs), holdsEnd);
      deferAiAttempt(db, { contentHash, version: JOB_ANALYSIS_PROMPT_VERSION, message, until: new Date(until), now });
    } catch (recordError) {
      log.warn(`[job-analysis] could not record the AI failure of text ${contentHash.slice(0, 12)}`, recordError);
    }
  }

  function storeAi(job: JobRow, finished: FinishedAiAnalysis): number {
    return transaction(db, () => {
      // Inserting the AI row marks the Saved applications of jobs with this text for a re-match (migration 0301).
      const id = saveAnalysis(
        db,
        {
          ...finished,
          contentHash: job.content_hash,
          source: 'ai',
          version: JOB_ANALYSIS_PROMPT_VERSION,
          model: deps.config.ai.features.job_analysis.model,
          promptHash: JOB_ANALYSIS_PROMPT_HASH,
        },
        nowIso(deps),
      );
      refreshAnalysisLinks(db, job.content_hash);
      applyAiFacts(db, job.content_hash);
      clearAiAttempts(db, job.content_hash, JOB_ANALYSIS_PROMPT_VERSION);
      return id;
    });
  }

  const handler: AiTaskHandler = async (input, ctx) => {
    const task = JobAnalysisTaskInputSchema.parse(input);
    const job = sql.job.get(task.jobId);
    const target = job && job.content_hash === task.contentHash ? job : sql.jobByHash.get(task.contentHash);
    if (!target) return { analysisId: null, skipped: 'The job is gone.' } satisfies JobAnalysisTaskResult;
    const existing = analysesFor(db, target.content_hash).find((record) => record.source === 'ai' && record.version === task.version);
    if (existing) return { analysisId: existing.id } satisfies JobAnalysisTaskResult;
    try {
      const output = await ctx.runPrompt(jobAnalysisPrompt, {
        title: target.title,
        company: target.company_name,
        locations: target.locations_text,
        description: target.description_text,
      });
      const deterministic = analysesOf(target).find((record) => record.source === 'deterministic' && record.version === DETERMINISTIC_VERSION);
      const finished = finishAiAnalysis(
        output,
        { title: target.title, text: target.description_text, locations: target.locations_text },
        deterministic ?? { requirements: [], responsibilities: [], desired: [] },
      );
      const analysisId = storeAi(target, finished);
      failedAt.delete(target.content_hash);
      return { analysisId } satisfies JobAnalysisTaskResult;
    } catch (error) {
      failedAt.set(target.content_hash, deps.now().getTime());
      // Cancelled, or the server is stopping (the task reads "interrupted"): neither says anything about the text.
      if (!ctx.signal.aborted) noteFailure(target.content_hash, error);
      throw error;
    }
  };

  return {
    handler,
    isRefining,
    enqueueTask,

    ensure(jobId, options = {}) {
      const job = sql.job.get(jobId);
      if (!job) return null;
      const { best, list, hasCurrentAi } = current(job);
      let refining = false;
      if (!hasCurrentAi) {
        // Only lazy mode queues from a view; in the other modes "Refining..." means the backlog is reading it now.
        refining =
          isRefining(job.content_hash) ||
          (deps.config.ai.jobAnalysis === 'lazy' &&
            !recentlyFailed(job) &&
            startTask(job, options.interactive ? 'interactive' : 'background', options.requestedBy) !== null);
      }
      return answer(job, best, list, refining);
    },

    get(jobId) {
      const job = sql.job.get(jobId);
      if (!job) return null;
      const { best, list } = current(job);
      return answer(job, best, list, isRefining(job.content_hash));
    },

    peek(jobId) {
      const job = sql.job.get(jobId);
      if (!job) return null;
      const { list } = completed(job);
      return answer(job, bestOf(list)!, list, isRefining(job.content_hash));
    },

    enqueue(jobId, priority) {
      const job = sql.job.get(jobId);
      if (!job) return false;
      if (!isRefining(job.content_hash) && recentlyFailed(job)) return false;
      return enqueueTask(jobId, priority) !== null;
    },
  };
}
