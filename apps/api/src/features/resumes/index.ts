import type { Feature } from '../../core/feature';
import { createResumesRouter } from './router';

// Resumes: CRUD, upload/import, preview, export, AI bullets. Owned by work package R1.
export const resumesFeature: Feature = {
  name: 'resumes',
  routes: [
    { path: '/api/resumes', router: createResumesRouter },
  ],
};
