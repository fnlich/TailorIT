import type { Feature } from '../../core/feature';
import { createFilesRouter } from './router';

// Uploaded file storage, downloads and thumbnails. Owned by work package F3.
export const filesFeature: Feature = {
  name: 'files',
  routes: [
    { path: '/api/files', router: createFilesRouter },
  ],
};
