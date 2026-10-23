import { Router } from 'express';
import type { AppDeps } from '../../core/context';

// Job tracker applications. Owned by work package T (see docs/ARCHITECTURE.md).

/** Mounted at /api/applications. */
export function createApplicationsRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
