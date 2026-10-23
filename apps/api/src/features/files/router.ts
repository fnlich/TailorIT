import { Router } from 'express';
import type { AppDeps } from '../../core/context';

// Uploaded file storage, downloads and thumbnails. Owned by work package F3 (see docs/ARCHITECTURE.md).

/** Mounted at /api/files. */
export function createFilesRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
