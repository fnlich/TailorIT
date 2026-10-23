import type { AppDeps } from '../../core/context';
import type { Feature } from '../../core/feature';
import { createJobAnalysisService, type JobAnalysisServiceInternals } from './service';
import { startJobAnalysisWarmup } from './warmup';

// Job analysis (deterministic at ingest, AI lazily on the first view). Work package J1 (docs/ARCHITECTURE.md §9).
// Registers `deps.services.jobAnalysis` (the contract in ./types.ts) and the `job_analysis` AI handler.

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
    return () => warmup.stop();
  },
};
