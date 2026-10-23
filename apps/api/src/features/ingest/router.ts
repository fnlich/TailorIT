import { Router } from 'express';
import type { AppDeps } from '../../core/context';

// Job ingestion: sources, runs, scheduler, CSV/JSON import, reports. Owned by work package J1 (see docs/ARCHITECTURE.md).

/** Mounted at /api/admin/sources. */
export function createIngestRouter1(_deps: AppDeps): Router {
  const router = Router();
  return router;
}

/** Mounted at /api/admin/runs. */
export function createIngestRouter2(_deps: AppDeps): Router {
  const router = Router();
  return router;
}

/** Mounted at /api/admin/import. */
export function createIngestRouter3(_deps: AppDeps): Router {
  const router = Router();
  return router;
}

/** Mounted at /api/admin/reports. */
export function createIngestRouter4(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
