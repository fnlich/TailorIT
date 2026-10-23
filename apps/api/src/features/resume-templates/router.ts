import { Router } from 'express';
import type { AppDeps } from '../../core/context';

// Resume templates (free_tailor template files as data). Owned by work package R1 (see docs/ARCHITECTURE.md).

/** Mounted at /api/resume-templates. */
export function createResumeTemplatesRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
