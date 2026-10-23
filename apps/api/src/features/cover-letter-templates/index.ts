import type { Feature } from '../../core/feature';
import { createCoverLetterTemplatesRouter } from './router';

// Cover letter templates (system + user). Owned by work package C.
export const coverLetterTemplatesFeature: Feature = {
  name: 'cover-letter-templates',
  routes: [
    { path: '/api/cover-letter-templates', router: createCoverLetterTemplatesRouter },
  ],
};
