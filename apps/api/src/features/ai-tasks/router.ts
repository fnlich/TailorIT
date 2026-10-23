import { Router } from 'express';
import { requireAi } from '../../ai/index';
import { requireUser, userOf } from '../../core/auth/guards';
import type { AppDeps } from '../../core/context';
import { notFound } from '../../core/http/errors';

// AI task polling. Owned by work package F4 (see docs/ARCHITECTURE.md §9). A task is visible to its owner only;
// anyone else gets the same 404 as for a task that does not exist.

/** Mounted at /api/ai/tasks. */
export function createAiTasksRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireUser);

  /** GET /api/ai/tasks/:id → AiTaskView. */
  router.get('/:id', (req, res) => {
    const task = requireAi(deps).getTask(req.params.id, userOf(req).id);
    if (!task) throw notFound('That AI task');
    res.json(task);
  });

  /** DELETE /api/ai/tasks/:id → AiTaskView after cancelling (a finished task is returned unchanged). */
  router.delete('/:id', (req, res) => {
    const ai = requireAi(deps);
    const userId = userOf(req).id;
    ai.cancel(req.params.id, userId);
    const task = ai.getTask(req.params.id, userId);
    if (!task) throw notFound('That AI task');
    res.json(task);
  });

  return router;
}
