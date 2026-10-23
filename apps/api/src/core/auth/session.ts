import { createHash, randomBytes } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { Role } from '@tailorit/shared';
import type { AppDeps, SessionUser } from '../context';

// A session is an opaque random token in an httpOnly cookie. The database keeps only the token's SHA-256, so a copy of
// the database holds no usable session. Plain SHA-256 is enough: the input is 32 random bytes, not a password, so a
// slow hash would defend nothing and cost time on every request.

/** Name of the httpOnly session cookie. */
export const SESSION_COOKIE = 'ti_session';

/** 32 random bytes in base64url are 43 characters; anything far off that is not one of ours. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;
/** `last_seen_at` is written at most this often per session, so ordinary reads do not all become writes. */
const LAST_SEEN_EVERY_MS = 60_000;
const DAY_MS = 86_400_000;

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** SESSION_TTL_DAYS in milliseconds: the row's lifetime and the cookie's Max-Age, so the two end together. */
export function sessionTtlMs(deps: Pick<AppDeps, 'config'>): number {
  return deps.config.auth.sessionTtlDays * DAY_MS;
}

export interface CreatedSession {
  /** The raw token: goes into the cookie and nowhere else. */
  token: string;
  tokenHash: string;
  expiresAt: string;
}

/** Opens a session for `userId`. The expiry is fixed here and never extended (not sliding). */
export function createSession(deps: AppDeps, userId: string, req?: Request): CreatedSession {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashSessionToken(token);
  const now = deps.now();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + sessionTtlMs(deps)).toISOString();
  const userAgent = req?.get('user-agent')?.slice(0, 500) ?? null;
  deps.db
    .prepare(
      `INSERT INTO user_sessions(token_hash, user_id, created_at, expires_at, last_seen_at, user_agent, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(tokenHash, userId, createdAt, expiresAt, createdAt, userAgent, req?.ip ?? null);
  return { token, tokenHash, expiresAt };
}

/**
 * Sets the session cookie. SameSite=Lax (not Strict) so following a link into the app keeps the person signed in;
 * Secure follows the request, because a Secure cookie is never sent back over plain http (a LAN install).
 */
export function setSessionCookie(req: Request, res: Response, deps: Pick<AppDeps, 'config'>, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: sessionTtlMs(deps),
  });
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
}

/** The session token a request carries, or null (cookie-parser has run; a `j:` value parses to a non-string). */
export function readSessionToken(req: Request): string | null {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE];
  return typeof value === 'string' && TOKEN_PATTERN.test(value) ? value : null;
}

export function destroySession(deps: Pick<AppDeps, 'db'>, tokenHash: string): void {
  deps.db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(tokenHash);
}

/** Ends every session of an account (disabling it). Returns how many there were. */
export function destroySessionsForUser(deps: Pick<AppDeps, 'db'>, userId: string): number {
  return deps.db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId).changes;
}

export function pruneExpiredSessions(deps: Pick<AppDeps, 'db' | 'now'>): number {
  return deps.db.prepare('DELETE FROM user_sessions WHERE expires_at <= ?').run(deps.now().toISOString()).changes;
}

interface SessionRow {
  user_id: string;
  expires_at: string;
  last_seen_at: string | null;
  email: string;
  name: string;
  role: Role;
  disabled_at: string | null;
}

/**
 * The account behind a session token, or null. An expired session is deleted on sight; a disabled account resolves to
 * null even with a live session, so disabling takes effect on the next request.
 */
export function resolveSession(deps: AppDeps, token: string): { user: SessionUser; tokenHash: string } | null {
  const tokenHash = hashSessionToken(token);
  const row = deps.db
    .prepare(
      `SELECT s.user_id, s.expires_at, s.last_seen_at, u.email, u.name, u.role, u.disabled_at
       FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as SessionRow | undefined;
  if (!row) return null;

  const now = deps.now();
  if (Date.parse(row.expires_at) <= now.getTime()) {
    destroySession(deps, tokenHash);
    return null;
  }
  if (row.disabled_at) return null;

  const lastSeen = row.last_seen_at ? Date.parse(row.last_seen_at) : Number.NaN;
  if (Number.isNaN(lastSeen) || now.getTime() - lastSeen >= LAST_SEEN_EVERY_MS) {
    deps.db.prepare('UPDATE user_sessions SET last_seen_at = ? WHERE token_hash = ?').run(now.toISOString(), tokenHash);
  }
  return { user: { id: row.user_id, email: row.email, name: row.name, role: row.role }, tokenHash };
}

/**
 * Reads the session cookie and sets `req.user` (or leaves it undefined). Never refuses a request by itself; the route
 * guards in guards.ts do.
 *
 * A cookie that no longer works is left alone rather than cleared here: a request still in flight with an old token
 * would otherwise answer with a clearing Set-Cookie after a fresh sign-in had set the new one, and sign the person out.
 * It is replaced at the next sign-in and cleared by logout.
 */
export function attachUser(deps: AppDeps): RequestHandler {
  return (req, _res, next) => {
    const token = readSessionToken(req);
    if (!token) return next();
    try {
      const session = resolveSession(deps, token);
      if (session) {
        req.user = session.user;
        req.sessionTokenHash = session.tokenHash;
      }
    } catch (error) {
      // An unreadable database is not this request's to report; it arrives signed out and the route says so.
      deps.log.error('[auth] could not read a session', error);
    }
    next();
  };
}
