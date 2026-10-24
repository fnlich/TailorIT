import { Router, type Request } from 'express';
import { SaveAllBodySchema, searchParamsToJobsQuery, type JobsQuery } from '@tailorit/shared';
import { requireUser, userOf } from '../../core/auth/guards';
import type { AppDeps } from '../../core/context';
import { asyncHandler } from '../../core/http/errors';
import { parseInput } from '../../core/http/validate';
import { keyedRateLimit } from '../../core/rate-limit';
import { createSaveAll } from './save-all';

// Save all (work package WP7), mounted at /api/jobs/save-all ahead of the jobs router, so the jobs router's /:id
// routes never see these paths. Both read the list's filters from the query string exactly as GET /api/jobs does
// (the list's own query string; a cursor is ignored). Every route needs a signed-in account; the POST also needs the
// app's Origin, like every mutating request (the app-wide check).
//   GET  /preview   { matched, saveable, willSave }: the numbers of the "Save N jobs?" confirm
//   POST /          body { occurredOn? }: saves up to 100 jobs, in the list's order (SaveAllResponse)
// One run per account at a time (409), and SAVE_ALL_RUNS_PER_HOUR runs per account per hour (429).

/** Save all runs per account per hour: each one may create up to 100 applications. */
export const SAVE_ALL_RUNS_PER_HOUR = 20;
const HOUR_MS = 60 * 60_000;

function limitMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Save all can run ${SAVE_ALL_RUNS_PER_HOUR} times an hour. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`;
}

/** The list's filters, read as GET /api/jobs reads them, without a cursor (Save all always starts at the top). */
function listQueryOf(req: Request): JobsQuery {
  return { ...searchParamsToJobsQuery(req.query as Record<string, unknown>), cursor: undefined };
}

export function createSaveAllRouter(deps: AppDeps): Router {
  const router = Router();
  const saveAll = createSaveAll(deps);
  const runLimit = keyedRateLimit({
    windowMs: HOUR_MS,
    limit: SAVE_ALL_RUNS_PER_HOUR,
    key: (req) => `save-all:${userOf(req).id}`,
    message: limitMessage,
    // A run counts, finished or failed on our side; a refusal (a bad day, another run going, the limit) does not.
    counts: (_req, status) => status < 400 || status >= 500,
  });
  router.use(requireUser);

  router.get('/preview', (req, res) => {
    res.json(saveAll.preview(userOf(req).id, listQueryOf(req)));
  });

  router.post(
    '/',
    runLimit,
    asyncHandler(async (req, res) => {
      const user = userOf(req);
      const { occurredOn } = parseInput(SaveAllBodySchema, req.body ?? {}, 'request');
      res.json(await saveAll.run(user.id, listQueryOf(req), occurredOn));
    }),
  );

  return router;
}
