import { ApiError } from '../../lib/api';

/*
 * Asking for a sign-in code again within the minute (say, after "Use a different address" and back): the API answers
 * 429 `cooldown`, but the code it sent a moment ago still works, so the page goes on to the code step and says so.
 */

/**
 * The seconds left of a 429 `cooldown` (a code went to this address less than a minute ago), or null for any other
 * failure. Other 429s (`rate_limited`: too many attempts) stay errors.
 */
export function cooldownSeconds(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.code !== 'cooldown') return null;
  return Math.max(1, Math.ceil(error.retryAfterSeconds ?? 60));
}

/** The code step's notice when the code asked for again is the one already on its way. */
export function codeAlreadySentNotice(email: string, seconds: number): string {
  return `A code was already sent to ${email}. Enter it below, or wait ${seconds} ${seconds === 1 ? 'second' : 'seconds'} to ask for another.`;
}
