import { Router } from 'express';
import type { AppDeps } from '../../core/context';

// Cover letters: CRUD, generation, import, preview, export. Owned by work package C (see docs/ARCHITECTURE.md).

/** Mounted at /api/cover-letters. */
export function createCoverLettersRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
