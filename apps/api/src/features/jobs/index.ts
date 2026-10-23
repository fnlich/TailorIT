import type { Feature } from '../../core/feature';
import { createCompaniesRouter } from './companies-router';
import { createJobsRouter } from './jobs-router';
import { createSavedSearchesRouter } from './saved-searches-router';

// Job browse/search, detail, analysis and match, hide/report, saved searches. Owned by work package J2.
//   /api/jobs             list (FTS5 + filters + keyset pages), count, facets, detail, analysis, match, hide, report
//   /api/companies        hide / unhide a company's jobs
//   /api/saved-searches   the toolbar bookmark's saved searches
export const jobsFeature: Feature = {
  name: 'jobs',
  routes: [
    { path: '/api/jobs', router: createJobsRouter },
    { path: '/api/companies', router: createCompaniesRouter },
    { path: '/api/saved-searches', router: createSavedSearchesRouter },
  ],
};
