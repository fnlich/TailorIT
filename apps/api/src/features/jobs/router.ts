import { Router } from 'express';
import type { AppDeps } from '../../core/context';

// Job browse/search, detail, match, hide/report, saved searches. Owned by work package J2 (see docs/ARCHITECTURE.md).

/** Mounted at /api/jobs. */
export function createJobsRouter1(_deps: AppDeps): Router {
  const router = Router();
  return router;
}

/** Mounted at /api/companies. */
export function createJobsRouter2(_deps: AppDeps): Router {
  const router = Router();
  return router;
}

/** Mounted at /api/saved-searches. */
export function createJobsRouter3(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
