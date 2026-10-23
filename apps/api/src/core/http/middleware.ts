import { randomBytes } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError, sendError } from './errors';

/** Gives every request a short id, echoed in error bodies and the X-Request-Id header. */
export const requestId: RequestHandler = (req, res, next) => {
  req.requestId = `r_${randomBytes(6).toString('base64url')}`;
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF guard on top of the SameSite=Lax cookie: a browser sending a state-changing request must send the app's own
 * Origin. Requests without an Origin header (curl, server-to-server) carry no ambient browser cookies and pass.
 */
export function originCheck(appOrigin: string): RequestHandler {
  const allowed = new Set([appOrigin]);
  try {
    const url = new URL(appOrigin);
    // localhost and 127.0.0.1 are the same machine in development.
    if (url.hostname === 'localhost') allowed.add(`${url.protocol}//127.0.0.1${url.port ? `:${url.port}` : ''}`);
    if (url.hostname === '127.0.0.1') allowed.add(`${url.protocol}//localhost${url.port ? `:${url.port}` : ''}`);
  } catch {
    /* config validated elsewhere */
  }
  return (req, res, next) => {
    if (!MUTATING.has(req.method)) return next();
    const origin = req.get('origin');
    if (!origin || allowed.has(origin)) return next();
    sendError(res, new AppError('bad_origin', 'Request not allowed.'), req.requestId);
  };
}

/** Never cache API answers in the browser or a proxy: they are per-account. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};
