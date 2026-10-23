import type { Feature } from '../../core/feature';
import { createFileStore } from '../../core/files/index';
import { createPdfService } from '../../core/pdf/index';
import { createFilesRouter } from './router';

// Uploaded file storage, downloads and thumbnails, plus the shared PDF/screenshot pool. Owned by work package F3.
// Services: deps.services.files (FileStore) and deps.services.pdf (PdfService); the browser closes on shutdown.
export const filesFeature: Feature = {
  name: 'files',
  services: (deps) => {
    deps.services.files = createFileStore(deps);
    deps.services.pdf = createPdfService(deps);
  },
  routes: [{ path: '/api/files', router: createFilesRouter }],
  start: (deps) => async () => {
    await deps.services.pdf?.close();
  },
};
