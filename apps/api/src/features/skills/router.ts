import { Router } from 'express';
import type { AppDeps } from '../../core/context';

// Skill library (skills.json) + per-user skills. Owned by work package R1 (see docs/ARCHITECTURE.md).

/** Mounted at /api/skills. */
export function createSkillsRouter(_deps: AppDeps): Router {
  const router = Router();
  return router;
}
