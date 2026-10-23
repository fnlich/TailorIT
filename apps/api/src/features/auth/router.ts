import { Router } from 'express';
import type { AppDeps } from '../../core/context';

// Passwordless sign-in (Google + email code) and sessions. Owned by work package F3 (see docs/ARCHITECTURE.md).

/** Mounted at /api/auth. */
export function createAuthRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
