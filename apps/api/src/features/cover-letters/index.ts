import type { Feature } from '../../core/feature';
import { createCoverLettersRouter } from './router';

// Cover letters: CRUD, generation, import, preview, export. Owned by work package C.
export const coverLettersFeature: Feature = {
  name: 'cover-letters',
  routes: [
    { path: '/api/cover-letters', router: createCoverLettersRouter },
  ],
};
