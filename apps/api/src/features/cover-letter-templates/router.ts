import { Router } from 'express';
import type { AppDeps } from '../../core/context';

// Cover letter templates (system + user). Owned by work package C (see docs/ARCHITECTURE.md).

/** Mounted at /api/cover-letter-templates. */
export function createCoverLetterTemplatesRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
