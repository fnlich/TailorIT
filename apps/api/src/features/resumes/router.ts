import { Router } from 'express';
import type { AppDeps } from '../../core/context';

// Resumes: CRUD, upload/import, preview, export, AI bullets. Owned by work package R1 (see docs/ARCHITECTURE.md).

/** Mounted at /api/resumes. */
export function createResumesRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
