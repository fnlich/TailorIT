import { Router } from 'express';
import type { AppDeps } from '../../core/context';

// AI task queue over the local Claude CLI; task polling. Owned by work package F4 (see docs/ARCHITECTURE.md).

/** Mounted at /api/ai/tasks. */
export function createAiTasksRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
