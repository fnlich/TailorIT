import type { JobAnalysisView } from '@tailorit/shared';

// The job analysis service contract (work package J1 implements it; J2's Jobs API calls it). Registered on
// `deps.services.jobAnalysis` by the job-analysis feature's `services` hook.

export interface EnsuredAnalysis {
  /** The best analysis available now: AI > free_tailor lake > deterministic. */
  analysis: JobAnalysisView;
  /** True while an AI analysis for this posting is queued or running (the page shows "Refining…"). */
  refining: boolean;
}

export interface EnsureOptions {
  /** Queue at interactive priority instead of on the background slot. */
  interactive?: boolean;
  /**
   * The account whose request this is. A new AI analysis it starts counts against that account's hourly budget
   * (AI_ANALYSES_PER_USER_PER_HOUR); past it, the current best analysis is shown and nothing is queued.
   */
  requestedBy?: string;
}

export interface JobAnalysisService {
  /**
   * The analysis to show for a job. With AI_JOB_ANALYSIS=lazy and no AI analysis yet, queues one (deduplicated by the
   * posting's content hash; background priority unless `interactive`) and answers the current best meanwhile.
   * Null when the job does not exist.
   */
  ensure(jobId: number, options?: EnsureOptions): EnsuredAnalysis | null;
  /** The current best analysis without queueing anything. */
  get(jobId: number): EnsuredAnalysis | null;
}

declare module '../../core/context' {
  interface AppServices {
    /** Job analysis (work package J1). Optional: J2 falls back to a deterministic analysis when it is missing. */
    jobAnalysis?: JobAnalysisService;
  }
}
