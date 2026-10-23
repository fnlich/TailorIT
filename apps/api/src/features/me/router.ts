import { Router } from 'express';
import type { AppDeps } from '../../core/context';

// The signed-in account: name, preferences, default resume. Owned by work package F3 (see docs/ARCHITECTURE.md).

/** Mounted at /api/me. */
export function createMeRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
