import type { Role } from '@tailorit/shared';
import type { AppConfig } from '../config/env';
import type { Db } from './db/connection';
import type { Logger } from './log';

/** Everything a feature router needs, passed in explicitly (no module-level singletons), so tests can build an app
 *  over a temporary database and a fake clock. */
export interface AppDeps {
  db: Db;
  config: AppConfig;
  log: Logger;
  /** The clock. Tests freeze it. */
  now: () => Date;
  /** Services registered by work packages (AI queue, PDF pool, analysis...). Filled in by createServices(). */
  services: AppServices;
}

/**
 * Cross-feature services. Each is owned by one work package and created once at startup (see services.ts).
 * Everything is optional at the type level only until its package lands; features must handle a missing service
 * by answering 503 with a clear message.
 */
export interface AppServices {
  [name: string]: unknown;
}

/** The signed-in account attached to a request by the session middleware (work package F3). */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    user?: SessionUser;
    /** sha256 of the session token that authenticated this request (for sign-out). */
    sessionTokenHash?: string;
  }
}

export const nowIso = (deps: Pick<AppDeps, 'now'>) => deps.now().toISOString();
/** Calendar date in UTC, "YYYY-MM-DD". */
export const todayIso = (deps: Pick<AppDeps, 'now'>) => deps.now().toISOString().slice(0, 10);
