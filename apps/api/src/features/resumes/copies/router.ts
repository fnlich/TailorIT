import { Router, type Request } from 'express';
import { ResumeCopyBatchIdSchema } from '@tailorit/shared';
import { requireUser, userOf } from '../../../core/auth/guards';
import type { AppDeps } from '../../../core/context';
import { AppError } from '../../../core/http/errors';
import { parseInput } from '../../../core/http/validate';
import { AI_NOT_SET_UP, copiesOffMessage, dismissCopies, listCopies, retryCopies, stopCopies } from './store';

// The Resumes tab's view of the copy line (GET /api/resumes/copies, polled while a copy waits or is being made) and
// the buttons of its notices: Stop the rest, Try again and Dismiss, each for one batch of the account's own (another
// account's batch id changes nothing). Each answers the view again.

function batchOf(req: Request): string {
  return parseInput(ResumeCopyBatchIdSchema, req.params.batchId, 'batch id');
}

/** Mounted at /api/resumes/copies. */
export function createResumeCopiesRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireUser);

  /** GET /api/resumes/copies → ResumeCopiesResponse. */
  router.get('/', (req, res) => {
    res.json(listCopies(deps, userOf(req).id));
  });

  /** Stop the rest: the batch's copies still waiting are stopped; one being made finishes. */
  router.post('/:batchId/stop', (req, res) => {
    const userId = userOf(req).id;
    stopCopies(deps, userId, batchOf(req));
    res.json(listCopies(deps, userId));
  });

  /** Try again: the batch's stopped copies and those that may work now wait in line again (503 while AI is off). */
  router.post('/:batchId/retry', (req, res) => {
    const userId = userOf(req).id;
    const batchId = batchOf(req);
    const line = deps.services.resumeCopies;
    if (!line?.enabled) throw new AppError('ai_unavailable', copiesOffMessage(deps) ?? AI_NOT_SET_UP);
    if (retryCopies(deps, userId, batchId) > 0) line.nudge();
    res.json(listCopies(deps, userId));
  });

  /** Dismiss: the batch's finished copies leave the view; the resumes made stay. */
  router.post('/:batchId/dismiss', (req, res) => {
    const userId = userOf(req).id;
    dismissCopies(deps, userId, batchOf(req));
    res.json(listCopies(deps, userId));
  });

  return router;
}
