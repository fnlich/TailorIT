import { Router } from 'express';
import type { AppDeps } from '../../core/context';

// Administrator: list accounts, change role, disable. Owned by work package F3 (see docs/ARCHITECTURE.md).

/** Mounted at /api/admin/users. */
export function createAdminUsersRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
