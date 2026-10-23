import type { RequestHandler } from 'express';
import type { AppDeps } from '../context';

/** Name of the httpOnly session cookie. */
export const SESSION_COOKIE = 'ti_session';

/**
 * Reads the session cookie and sets `req.user` (or leaves it undefined). Never refuses a request by itself; the
 * route guards in guards.ts do. Implemented by work package F3 (API core: auth).
 */
export function attachUser(_deps: AppDeps): RequestHandler {
  return (_req, _res, next) => next();
}
