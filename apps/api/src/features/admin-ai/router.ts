import { Router } from 'express';
import { z } from 'zod';
import { requireAi } from '../../ai/index';
import { requireAdmin } from '../../core/auth/guards';
import type { AppDeps } from '../../core/context';
import { asyncHandler } from '../../core/http/errors';
import { parseInput } from '../../core/http/validate';

// Administrator: Claude CLI health and a test prompt. Owned by work package F4 (see docs/ARCHITECTURE.md §9).

const TestBody = z.object({
  model: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/, 'Use a Claude model name such as claude-sonnet-5-5.')
    .optional(),
});

/** Mounted at /api/admin/ai. */
export function createAdminAiRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAdmin);

  /** GET /api/admin/ai/health[?force=1] → AiHealth (`claude --version` + `claude auth status`, cached 60 s). */
  router.get(
    '/health',
    asyncHandler(async (req, res) => {
      const force = /^(1|true|yes)$/i.test(String(req.query.force ?? ''));
      res.json(await requireAi(deps).health(force));
    }),
  );

  /** POST /api/admin/ai/test {model?} → {ok, model, ms, answer, error?}: one tiny JSON echo through the CLI. */
  router.post(
    '/test',
    asyncHandler(async (req, res) => {
      const body = parseInput(TestBody, req.body ?? {}, 'test request');
      res.json(await requireAi(deps).test({ model: body.model }));
    }),
  );

  return router;
}
