import type { Request, RequestHandler } from 'express';
import type { SessionUser } from '../context';
import { adminOnly, notSignedIn } from '../http/errors';

/** Route guard: 401 unless a session cookie identified an account (see session.ts). */
export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(notSignedIn());
  next();
};

/** Route guard: 401 when signed out, 403 when signed in without the admin role. */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(notSignedIn());
  if (req.user.role !== 'admin') return next(adminOnly());
  next();
};

/** The signed-in account of a request already behind `requireUser`. */
export function userOf(req: Request): SessionUser {
  if (!req.user) throw notSignedIn();
  return req.user;
}
