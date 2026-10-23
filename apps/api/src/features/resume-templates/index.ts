import type { Feature } from '../../core/feature';
import { createResumeTemplatesRouter } from './router';

// Resume templates (free_tailor template files as data). Owned by work package R1.
export const resumeTemplatesFeature: Feature = {
  name: 'resume-templates',
  routes: [
    { path: '/api/resume-templates', router: createResumeTemplatesRouter },
  ],
};
