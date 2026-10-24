import { Router, type Request } from 'express';
import { IdParam } from '@tailorit/shared';
import { requireUser, userOf } from '../../core/auth/guards';
import type { AppDeps } from '../../core/context';
import { AppError, asyncHandler } from '../../core/http/errors';
import { parseInput } from '../../core/http/validate';
import { keyedRateLimit } from '../../core/rate-limit';
import type { ResumeMatchService } from './types';

// The tracker's resume picker (work package WP5), mounted at /api/applications beside the tracker's own router (whose
// paths never collide with these). Every route needs a signed-in account; another account's application is 404 "That
// application was not found."; the POST also needs the app's Origin, like every mutating request (app-wide check).
//   GET  /:id/resume-matches   every resume of the account ranked for the application (ResumeMatchList)
//   POST /:id/resume-match     "Let TailorIT choose" (ApplicationDetail)
// Both are limited per account: ranking reads every resume, so a script cannot keep the server busy with it.

const WINDOW_MS = 60_000;
/** Rankings per account per minute: the picker asks again after each change, a person never needs more. */
export const RANK_LIMIT = 30;
/** "Let TailorIT choose" per account per minute. */
export const AUTO_MATCH_LIMIT = 20;

function waitSentence(seconds: number): string {
  return `There have been too many resume match requests. Please wait ${seconds} second${seconds === 1 ? '' : 's'} and try again.`;
}

function idOf(req: Request): string {
  return parseInput(IdParam, req.params.id, 'link');
}

function serviceOf(deps: AppDeps): ResumeMatchService {
  const service = deps.services.resumeMatch;
  if (!service) throw new AppError('internal', 'Resume matching is not set up on this server.');
  return service;
}

export function createResumeMatchRouter(deps: AppDeps): Router {
  const router = Router();
  const perAccount = (name: string, limit: number) =>
    keyedRateLimit({
      windowMs: WINDOW_MS,
      limit,
      key: (req) => `${name}:${userOf(req).id}`,
      message: waitSentence,
    });
  const rankLimit = perAccount('resume-matches', RANK_LIMIT);
  const autoMatchLimit = perAccount('resume-match', AUTO_MATCH_LIMIT);

  router.get(
    '/:id/resume-matches',
    requireUser,
    rankLimit,
    asyncHandler(async (req, res) => {
      res.json(await serviceOf(deps).rank(userOf(req).id, idOf(req)));
    }),
  );

  router.post(
    '/:id/resume-match',
    requireUser,
    autoMatchLimit,
    asyncHandler(async (req, res) => {
      res.json(await serviceOf(deps).autoMatch(userOf(req).id, idOf(req)));
    }),
  );

  return router;
}
