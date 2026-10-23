import type { AppDeps } from '../../core/context';
import { JOB_ANALYSIS_PROMPT_VERSION } from './prompt';
import type { JobAnalysisServiceInternals } from './service';

// Optional AI warm-up (AI_JOB_ANALYSIS_WARMUP_PER_HOUR, off by default): every 60/N minutes, the most-viewed live job
// without an AI analysis gets one, on the background slot, and only when no other job analysis is waiting.

export interface Warmup {
  /** One warm-up step now (tests; the timer calls it). Returns the job queued, or null. */
  tick(): number | null;
  stop(): void;
}

export function startJobAnalysisWarmup(
  deps: AppDeps,
  service: Pick<JobAnalysisServiceInternals, 'enqueue'>,
  options: { timers?: boolean } = {},
): Warmup {
  const perHour = deps.config.ai.warmupPerHour;
  const enabled = perHour > 0 && deps.config.ai.jobAnalysis === 'lazy' && deps.config.ai.enabled && deps.config.ai.backgroundSlots > 0;
  const busy = deps.db.prepare<[], { n: number }>(
    "SELECT count(*) AS n FROM ai_tasks WHERE kind = 'job_analysis' AND status IN ('queued', 'running')",
  );
  const candidates = deps.db.prepare<[number], { id: number }>(
    'SELECT j.id FROM jobs j WHERE j.active = 1 AND length(j.description_text) >= 200 AND NOT EXISTS ' +
      "(SELECT 1 FROM job_analyses a WHERE a.content_hash = j.content_hash AND a.source = 'ai' AND a.version = ?) " +
      'ORDER BY j.view_count DESC, j.posted_at DESC, j.id DESC LIMIT 25',
  );

  const tick = (): number | null => {
    if (!enabled) return null;
    try {
      if ((busy.get()?.n ?? 0) > 0) return null;
      for (const { id } of candidates.all(JOB_ANALYSIS_PROMPT_VERSION)) {
        if (service.enqueue(id, 'background')) return id;
      }
    } catch (error) {
      deps.log.warn('[job-analysis] warm-up step failed', error);
    }
    return null;
  };

  if (!enabled || options.timers === false) return { tick, stop: () => {} };
  const everyMs = Math.max(60_000, Math.round(3_600_000 / perHour));
  const timer = setInterval(tick, everyMs);
  timer.unref?.();
  deps.log.info(`[job-analysis] AI warm-up: ${perHour} job(s) an hour, most viewed first`);
  return { tick, stop: () => clearInterval(timer) };
}
