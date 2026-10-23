import { Router } from 'express';
import type { AppDeps } from '../../core/context';

// Administrator: Claude CLI health and a test prompt. Owned by work package F4 (see docs/ARCHITECTURE.md).

/** Mounted at /api/admin/ai. */
export function createAdminAiRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
