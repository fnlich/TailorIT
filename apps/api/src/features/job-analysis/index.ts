import type { AppDeps } from '../../core/context';
import type { Feature } from '../../core/feature';
import { startJobAnalysisBacklog } from './backlog';
import { createJobAnalysisService, type JobAnalysisServiceInternals } from './service';
import { startJobAnalysisWarmup } from './warmup';

// Job analysis (deterministic at ingest; then Claude, as AI_JOB_ANALYSIS says: each added job once through the
// add-time backlog by default). Work package J1 (docs/ARCHITECTURE.md §9). Registers `deps.services.jobAnalysis` (the
// contract in ./types.ts) and the `job_analysis` AI handler; `start` runs the backlog and the optional warm-up.

const internals = new WeakMap<AppDeps, JobAnalysisServiceInternals>();

export const jobAnalysisFeature: Feature = {
  name: 'job-analysis',
  services(deps) {
    const service = createJobAnalysisService(deps);
    internals.set(deps, service);
    deps.services.jobAnalysis = service;
    deps.services.ai?.registerHandler('job_analysis', service.handler);
  },
  start(deps) {
    const service = internals.get(deps);
    if (!service) return;
    const warmup = startJobAnalysisWarmup(deps, service);
    const backlog = startJobAnalysisBacklog(deps, service);
    return async () => {
      warmup.stop();
      await backlog.stop();
    };
  },
};
