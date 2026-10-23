import { z } from 'zod';
import { EXPERIENCE_LEVELS, toAnnualUsd, type ExperienceLevel, type JobAnalysisView } from '@tailorit/shared';
import type { AiService, AiTaskHandler } from '../../ai/index';
import { nowIso, type AppDeps } from '../../core/context';
import { transaction } from '../../core/db/connection';
import { finishAiAnalysis, type FinishedAiAnalysis } from './ai';
import { analyzeDeterministic, DETERMINISTIC_VERSION } from './deterministic';
import { JOB_ANALYSIS_PROMPT_HASH, JOB_ANALYSIS_PROMPT_VERSION, jobAnalysisPrompt } from './prompt';
import { analysesFor, bestOf, refreshAnalysisLinks, saveAnalysis, type AnalysisRecord } from './store';
import type { EnsuredAnalysis, JobAnalysisService } from './types';

// The analysis a job shows (docs/ARCHITECTURE.md §9): the best one stored for its text (AI > free_tailor lake >
// deterministic). With AI_JOB_ANALYSIS=lazy, the first view of a job without an AI analysis queues one, system-owned
// and deduplicated by the text's hash; the page shows the current best with "Refining..." until it lands. Views queue
// on the background slot, and each account starts at most AI_ANALYSES_PER_USER_PER_HOUR new ones.

/** A failed AI analysis of one text is not asked for again for this long. */
export const RETRY_AFTER_FAILURE_MS = 30 * 60_000;

/** Postings shorter than this are not worth a model call (the deterministic reading is all there is). */
const MIN_TEXT_FOR_AI = 80;

/**
 * AI job analyses queued or running at once. Browsing queues one per newly opened job; past this many, a view shows the
 * deterministic analysis and a later view asks again, so people's own AI requests (imports, letters) never wait
 * behind a pile of system work on the CLI's few slots.
 */
export const MAX_PENDING_ANALYSES = 3;

/**
 * New AI analyses one account can start per hour by opening jobs (a sliding window, in memory). Past it, that account
 * sees the current best analysis without "Refining..." until the hour has moved on; jobs that already have an AI
 * analysis, or one under way, are not limited. Without it, one script sweeping job ids would keep the CLI busy with
 * system work, on the owner's subscription, for as long as it ran.
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

/** The view J2's endpoints answer: the analysis, with the job's own facts where the source of the analysis is weaker. */
export function analysisView(record: AnalysisRecord, job: Pick<JobRow, 'experience_levels' | 'category_id' | 'subcategory_ids'>, refining: boolean): JobAnalysisView {
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
  };
}

export interface JobAnalysisServiceInternals extends JobAnalysisService {
  /** The AI task handler (registered on the AI queue by the feature's services hook). */
  readonly handler: AiTaskHandler;
  /** Queues an AI analysis for a job; true when one is queued or running now. */
  enqueue(jobId: number, priority: 'interactive' | 'background'): boolean;
  /** Whether an AI analysis of this text is queued or running. */
  isRefining(contentHash: string): boolean;
}

export function createJobAnalysisService(deps: AppDeps): JobAnalysisServiceInternals {
  const { db, log } = deps;
  /** contentHash -> when its last AI analysis failed (this process only). */
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
    fillFacts: db.prepare(
      "UPDATE jobs SET experience_levels = CASE WHEN experience_levels = '[]' THEN ? ELSE experience_levels END, " +
        "category_id = CASE WHEN ? IS NOT NULL AND (category_id IS NULL OR category_id = 'other') THEN ? ELSE category_id END, " +
        "subcategory_ids = CASE WHEN ? IS NOT NULL AND (category_id IS NULL OR category_id = 'other' OR (category_id = ? AND subcategory_ids = '[]')) THEN ? ELSE subcategory_ids END, " +
        'leadership = COALESCE(leadership, ?), work_arrangement = COALESCE(work_arrangement, ?), ' +
        'sponsors_h1b = COALESCE(sponsors_h1b, ?), requires_clearance = COALESCE(requires_clearance, ?), degree = COALESCE(degree, ?) ' +
        'WHERE content_hash = ?',
    ),
    fillSalary: db.prepare(
      'UPDATE jobs SET salary_min = ?, salary_max = ?, salary_currency = ?, salary_period = ?, salary_annual_usd_min = ?, ' +
        'salary_annual_usd_max = ? WHERE content_hash = ? AND salary_min IS NULL AND salary_max IS NULL',
    ),
  };

  const ai = (): AiService | undefined => deps.services.ai;

  /** Every analysis of the job's text, with a deterministic one of the current version made when it is missing. */
  function analysesOf(job: JobRow): AnalysisRecord[] {
    let list = analysesFor(db, job.content_hash);
    if (!list.some((record) => record.source === 'deterministic' && record.version === DETERMINISTIC_VERSION)) {
      const draft = analyzeDeterministic({ title: job.title, html: job.description_html, text: job.description_text });
      saveAnalysis(db, { ...draft, contentHash: job.content_hash, source: 'deterministic', version: DETERMINISTIC_VERSION }, nowIso(deps));
      list = analysesFor(db, job.content_hash);
    }
    return list;
  }

  function current(job: JobRow): { best: AnalysisRecord; hasCurrentAi: boolean } {
    const list = analysesOf(job);
    const best = bestOf(list)!;
    if (job.analysis_id !== best.id) sql.setAnalysis.run(best.id, job.id);
    return { best, hasCurrentAi: list.some((record) => record.source === 'ai' && record.version === JOB_ANALYSIS_PROMPT_VERSION) };
  }

  function isRefining(contentHash: string): boolean {
    return Boolean(sql.refining.get(contentHash));
  }

  function canAsk(job: JobRow): boolean {
    if (deps.config.ai.jobAnalysis !== 'lazy' || !ai()) return false;
    if (job.description_text.trim().length < MIN_TEXT_FOR_AI) return false;
    const failed = failedAt.get(job.content_hash);
    return !(failed !== undefined && Date.now() - failed < RETRY_AFTER_FAILURE_MS);
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

  function queue(job: JobRow, priority: 'interactive' | 'background', requestedBy?: string): boolean {
    const service = ai();
    if (!service || !canAsk(job)) return false;
    if ((sql.pending.get()?.n ?? 0) >= MAX_PENDING_ANALYSES) return false;
    if (requestedBy !== undefined && !withinBudget(requestedBy)) return false;
    try {
      // System-owned (the result serves everyone who opens the job); the account that asked pays from its budget.
      const accepted = service.enqueue({
        kind: 'job_analysis',
        userId: null,
        input: { jobId: job.id, contentHash: job.content_hash, version: JOB_ANALYSIS_PROMPT_VERSION } satisfies JobAnalysisTaskInput,
        priority,
        dedupeKey: dedupeKeyOf(job.content_hash),
      });
      if (requestedBy !== undefined && !accepted.deduped) spendBudget(requestedBy);
      return true;
    } catch (error) {
      // Paused, turned off, no background slot: the deterministic analysis stands.
      log.debug(`[job-analysis] no AI analysis queued for job ${job.id}: ${(error as Error).message}`);
      return false;
    }
  }

  function storeAi(job: JobRow, finished: FinishedAiAnalysis): number {
    const now = nowIso(deps);
    return transaction(db, () => {
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
        now,
      );
      refreshAnalysisLinks(db, job.content_hash);
      const levels = finished.experienceLevels.length ? JSON.stringify(finished.experienceLevels) : '[]';
      const subcategories = finished.categoryId ? JSON.stringify(finished.subcategoryIds) : null;
      const facts = finished.facts;
      const flag = (value: boolean | null) => (value === null ? null : value ? 1 : 0);
      sql.fillFacts.run(
        levels,
        finished.categoryId,
        finished.categoryId,
        subcategories,
        finished.categoryId,
        subcategories,
        finished.leadership,
        facts.workArrangement,
        flag(facts.sponsorsH1b),
        flag(facts.requiresClearance),
        facts.degree,
        job.content_hash,
      );
      if (facts.salary) {
        const { min, max, currency, period } = facts.salary;
        const annual = toAnnualUsd(min, max, currency, period);
        sql.fillSalary.run(min, max, currency, period, annual?.min ?? null, annual?.max ?? null, job.content_hash);
      }
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
        { title: target.title, text: target.description_text },
        deterministic ?? { requirements: [], responsibilities: [], desired: [] },
      );
      const analysisId = storeAi(target, finished);
      failedAt.delete(target.content_hash);
      return { analysisId } satisfies JobAnalysisTaskResult;
    } catch (error) {
      failedAt.set(target.content_hash, Date.now());
      throw error;
    }
  };

  function ensured(job: JobRow, refining: boolean): EnsuredAnalysis {
    const { best } = current(job);
    return { analysis: analysisView(best, job, refining), refining };
  }

  return {
    handler,
    isRefining,

    ensure(jobId, options = {}) {
      const job = sql.job.get(jobId);
      if (!job) return null;
      const { best, hasCurrentAi } = current(job);
      let refining = false;
      if (!hasCurrentAi) {
        refining =
          isRefining(job.content_hash) ||
          queue(job, options.interactive ? 'interactive' : 'background', options.requestedBy);
      }
      return { analysis: analysisView(best, job, refining), refining };
    },

    get(jobId) {
      const job = sql.job.get(jobId);
      if (!job) return null;
      return ensured(job, isRefining(job.content_hash));
    },

    enqueue(jobId, priority) {
      const job = sql.job.get(jobId);
      if (!job) return false;
      if (current(job).hasCurrentAi) return false;
      return isRefining(job.content_hash) || queue(job, priority);
    },
  };
}

