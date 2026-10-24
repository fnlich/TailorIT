import type { Feature } from '../../core/feature';
import { createCompaniesRouter } from './companies-router';
import { createJobsRouter } from './jobs-router';
import { createSaveAllRouter } from './save-all-router';
import { createSavedSearchesRouter } from './saved-searches-router';

// Job browse/search, detail, analysis and match, hide/report, saved searches. Owned by work package J2; Save all by
// WP7.
//   /api/jobs/save-all    Save all: the confirm's numbers (/preview) and the save itself (POST), over the list's filters
//   /api/jobs             list (FTS5 + filters + keyset pages), count, facets, detail, analysis, match, hide, report
//   /api/companies        hide / unhide a company's jobs
//   /api/saved-searches   the toolbar bookmark's saved searches
// Save all is mounted first: Express tries routers in this order, so the jobs router's /:id routes never see its paths.
export const jobsFeature: Feature = {
  name: 'jobs',
  routes: [
    { path: '/api/jobs/save-all', router: createSaveAllRouter },
    { path: '/api/jobs', router: createJobsRouter },
    { path: '/api/companies', router: createCompaniesRouter },
    { path: '/api/saved-searches', router: createSavedSearchesRouter },
  ],
};
