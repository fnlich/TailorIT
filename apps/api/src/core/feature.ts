import type { Router } from 'express';
import type { AppDeps } from './context';

/**
 * A feature registers everything it contributes through its own `features/<name>/index.ts`. The central list
 * (features/index.ts) and app.ts never change when a feature grows, so work packages own disjoint files.
 *
 * Order of use: `services` of every feature (list order) -> routers are built and mounted -> server listens ->
 * `start` of every feature (schedulers, workers). `stop` functions run on shutdown in reverse order.
 */
export interface Feature {
  name: string;
  /** Create shared services and put them on `deps.services` (typed by module augmentation of AppServices). */
  services?: (deps: AppDeps) => void;
  /** Routers to mount; several features may share a prefix (e.g. /api/admin/...). */
  routes?: Array<{ path: string; router: (deps: AppDeps) => Router }>;
  /** Background work after listen. Return a stop function. */
  start?: (deps: AppDeps) => void | (() => void | Promise<void>);
  /** Maintenance commands for `npm run <name>` / `tsx src/cli.ts <name> [...args]` (e.g. seed:demo). */
  commands?: Record<string, (deps: AppDeps, args: string[]) => Promise<void> | void>;
}
