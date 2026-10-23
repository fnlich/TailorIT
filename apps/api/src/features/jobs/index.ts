import type { Feature } from '../../core/feature';
import { createJobsRouter1, createJobsRouter2, createJobsRouter3 } from './router';

// Job browse/search, detail, match, hide/report, saved searches. Owned by work package J2.
export const jobsFeature: Feature = {
  name: 'jobs',
  routes: [
    { path: '/api/jobs', router: createJobsRouter1 },
    { path: '/api/companies', router: createJobsRouter2 },
    { path: '/api/saved-searches', router: createJobsRouter3 },
  ],
};
