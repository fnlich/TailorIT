import type { Request, RequestHandler } from 'express';
import { rateLimit, type RateLimitInfo } from 'express-rate-limit';
import type { AppDeps } from './context';
import { AppError } from './http/errors';

// Rate limits keyed by something the request itself names (an email address), not by IP. The browser reaches the API
// through Next's /api rewrite, which neither sets nor strips X-Forwarded-For: every browser would look like 127.0.0.1
// (one person could lock everyone out), and a forged X-Forwarded-For would pass straight through (and bypass a per-IP
// limit). Counters live in memory, per process; a restart forgets them, which is fine for a single-server install.

export interface KeyedLimit {
  windowMs: number;
  /** Requests allowed per window and key. */
  limit: number;
  /** The counter's key for a request. */
  key: (req: Request) => string;
  /** The sentence a refused request gets, given how long until it may try again. */
  message: (retryAfterSeconds: number) => string;
  /** Decided once the response is sent: false leaves the request off the count. Default: every request counts. */
  counts?: (req: Request, statusCode: number) => boolean;
  /** True lets a request through without counting it. */
  skip?: (req: Request) => boolean;
}

/** A limiter answering 429 `rate_limited` with the standard error body, `retryAfterSeconds` and Retry-After. */
export function keyedRateLimit(options: KeyedLimit): RequestHandler {
  const { counts, skip } = options;
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Keys never involve req.ip, so express-rate-limit's IP/proxy configuration checks do not apply.
    validate: false,
    keyGenerator: (req) => options.key(req),
    ...(counts
      ? { skipSuccessfulRequests: true, requestWasSuccessful: (req, res) => !counts(req, res.statusCode) }
      : {}),
    ...(skip ? { skip: (req) => skip(req) } : {}),
    handler: (req, _res, next) => {
      const info = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit;
      const untilReset = info?.resetTime ? info.resetTime.getTime() - Date.now() : options.windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil(untilReset / 1000));
      next(new AppError('rate_limited', options.message(retryAfterSeconds), { retryAfterSeconds }));
    },
  });
}

export const SIGN_IN_WINDOW_MS = 10 * 60_000;
/** Attempts per address per 10 minutes (code requests + failed verifications). */
export const SIGN_IN_ADDRESS_LIMIT = 10;
/** Attempts per address per day: caps slow guessing that stays under the 10-minute limit. */
export const SIGN_IN_ADDRESS_DAILY_LIMIT = 30;
/** Code emails sent per 10 minutes, all addresses together: protects the SMTP account from mailing many addresses. */
export const SIGN_IN_GLOBAL_LIMIT = 300;

const DAY_MS = 24 * 60 * 60_000;

function waitSentence(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes >= 90) {
    const hours = Math.ceil(minutes / 60);
    return `Please wait ${hours} hour${hours === 1 ? '' : 's'} and try again.`;
  }
  return `Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`;
}

/** The address a sign-in request names ('' for Google, which names none). */
function addressOf(req: Request): string {
  const value = (req.body as Record<string, unknown> | undefined)?.email;
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** POST /auth/email/request, the one sign-in route that sends an email. */
function isCodeRequest(req: Request): boolean {
  return req.originalUrl.split('?')[0]!.endsWith('/email/request');
}

/**
 * The backstop on code emails, all addresses together: SIGN_IN_GLOBAL_LIMIT per SIGN_IN_WINDOW_MS (a sliding window).
 * A code request counts when it ends, answered or abandoned by its client, unless it was refused (status >= 400 by
 * then): an abandoned request may still be sending its email, while refusals send nothing. Requests still running hold
 * a place, so a burst cannot overshoot. (express-rate-limit cannot say this: it either keeps abandoned requests on the
 * count, junk included, or drops them, emails included.)
 */
function codeEmailBackstop(deps: Pick<AppDeps, 'now'>, skip: () => boolean): RequestHandler {
  let sent: number[] = [];
  let running = 0;
  return (req, res, next) => {
    if (skip() || !isCodeRequest(req)) return next();
    const now = deps.now().getTime();
    sent = sent.filter((at) => now - at < SIGN_IN_WINDOW_MS);
    if (sent.length + running >= SIGN_IN_GLOBAL_LIMIT) {
      const oldest = sent[0] ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + SIGN_IN_WINDOW_MS - now) / 1000));
      const message = `There have been too many sign-in attempts. ${waitSentence(retryAfterSeconds)}`;
      return next(new AppError('rate_limited', message, { retryAfterSeconds }));
    }
    running += 1;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      running -= 1;
      if (res.statusCode < 400) sent.push(deps.now().getTime());
    };
    res.once('finish', end);
    res.once('close', end);
    next();
  };
}

/**
 * The sign-in limits, shared by POST /auth/email/request, /auth/email/verify and /auth/google.
 *
 * - Per address: 10 per 10 minutes and 30 per day. Every code request counts (each one sends an email) and so does
 *   every refusal; a sign-in that worked does not. On top of the per-code rules (60 s resend cooldown, 5 attempts per
 *   code) this caps guessing against one account however many networks the guesses come from.
 * - Everything together: 300 code emails per 10 minutes, a backstop against using the server to mail many addresses.
 *   Only code requests that send an email count, and only code requests are held back: if refusals counted, a few
 *   hundred junk requests (no address, wrong codes) would lock everyone out of signing in, renewably.
 * Google sign-ins name no address; Google's own token verification is what stops guessing there.
 */
export function signInRateLimit(deps: AppDeps): RequestHandler[] {
  const counts = (req: Request, status: number) => status >= 400 || isCodeRequest(req);
  // AUTH_DEV_FIXED_CODE (development and tests only) lets anyone sign in as anyone, so limiting attempts protects
  // nothing there, while automated tests sign in many times.
  const skip = () => deps.config.auth.devFixedCode !== null;
  const perAddress = (windowMs: number, limit: number) =>
    keyedRateLimit({
      windowMs,
      limit,
      key: (req) => `address:${addressOf(req)}`,
      message: (seconds) => `There have been too many sign-in attempts for this address. ${waitSentence(seconds)}`,
      counts,
      // A request without an address (Google, or no body at all) has nothing to key on.
      skip: (req) => skip() || addressOf(req) === '',
    });

  return [
    codeEmailBackstop(deps, skip),
    perAddress(SIGN_IN_WINDOW_MS, SIGN_IN_ADDRESS_LIMIT),
    perAddress(DAY_MS, SIGN_IN_ADDRESS_DAILY_LIMIT),
  ];
}
