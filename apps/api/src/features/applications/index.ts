import type { Feature } from '../../core/feature';
import { createApplicationsRouter } from './router';

// Job tracker applications. Owned by work package T.
export const applicationsFeature: Feature = {
  name: 'applications',
  routes: [
    { path: '/api/applications', router: createApplicationsRouter },
  ],
};
