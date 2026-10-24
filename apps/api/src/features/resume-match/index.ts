import type { AppDeps } from '../../core/context';
import type { Feature } from '../../core/feature';
import { createResumeMatchRouter } from './router';
import { createResumeMatchService } from './service';

// Resume matching (work package WP5): the best resume for each saved job, chosen by local computation only (never AI),
// kept current by a worker that drains the applications marked due, and the tracker picker's routes. Registers
// `deps.services.resumeMatch` (the contract in ./types.ts); the tracker's save paths call `chooseForJobs`, the resume
// ZIP `ensureChoices`. The worker starts only in `start` (never in tests or CLI commands, which call `runDue`).

const workers = new WeakMap<AppDeps, { start(): () => Promise<void> }>();

export const resumeMatchFeature: Feature = {
  name: 'resume-match',
  services(deps) {
    const service = createResumeMatchService(deps);
    workers.set(deps, service);
    deps.services.resumeMatch = service;
  },
  routes: [{ path: '/api/applications', router: createResumeMatchRouter }],
  start(deps) {
    return workers.get(deps)?.start();
  },
};
