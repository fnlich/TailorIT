import { AI_MESSAGES, AiError, type AiErrorKind } from '../errors';
import { billedToKey, turnText, type RateLimitInfo, type TurnState } from './events';
import type { CliRunOutcome } from './spawn';
import { lastLines } from './stream';

// What a finished CLI turn means: an answer, or an AiError of the right kind, plus whether to hold further calls.

const AUTH_MARKS = [
  'not logged in',
  'please run /login',
  'invalid authentication',
  'authentication_error',
  'authentication_failed',
  'oauth token',
  'invalid api key',
  'unauthorized',
];
const LIMIT_MARKS = ['rate limit', 'rate_limit', 'usage limit', 'limit reached', 'out of extra usage'];
const MODEL_MARKS = ['issue with the selected model', 'may not exist', 'not_found_error', 'model_not_found'];
const SERVER_MARKS = [
  'overloaded',
  'internal server error',
  'api_error',
  'fetch failed',
  'econnreset',
  'econnrefused',
  'etimedout',
  'socket hang up',
  'network error',
  'service unavailable',
  'bad gateway',
];
/** A 3-digit number is a status only next to a word that makes it one ("API Error: 529", "status 429"); a bare one
 *  matches stack-frame columns, durations and ports. */
const STATUS_WORD = /(?:status|error|http|code)\W{0,4}(\d{3})(?![\d:.])/g;

function kindForStatus(status: number): AiErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rateLimited';
  if (status === 404) return 'modelUnavailable';
  if (status >= 500) return 'unavailable';
  return 'failed';
}

export interface FailureEvidence {
  apiErrorStatus: number | null;
  isError: boolean;
  exitCode: number | null;
  stderr: string;
  resultText: string;
  errors: readonly string[];
}

/** The failure kind, or null when nothing says the turn failed. Never reads `result.subtype`: a hard model 404
 *  arrives as subtype "success" with is_error true. */
export function classifyFailure(input: FailureEvidence): AiErrorKind | null {
  if (input.apiErrorStatus !== null) return kindForStatus(input.apiErrorStatus);
  const haystack = [input.stderr, input.isError ? input.resultText : '', ...input.errors].join(' ').toLowerCase();
  if (haystack.trim()) {
    if (AUTH_MARKS.some((mark) => haystack.includes(mark))) return 'auth';
    if (LIMIT_MARKS.some((mark) => haystack.includes(mark))) return 'rateLimited';
    if (MODEL_MARKS.some((mark) => haystack.includes(mark))) return 'modelUnavailable';
    if (SERVER_MARKS.some((mark) => haystack.includes(mark))) return 'unavailable';
    const codes = [...haystack.matchAll(STATUS_WORD)].map((m) => Number(m[1]));
    if (codes.includes(401) || codes.includes(403)) return 'auth';
    if (codes.includes(429)) return 'rateLimited';
    if (codes.includes(404)) return 'modelUnavailable';
    if (codes.some((code) => code >= 500)) return 'unavailable';
  }
  if (input.isError) return 'failed';
  if (input.exitCode !== null && input.exitCode !== 0) return 'failed';
  return null;
}

/** A spent subscription window (or paid overage, which this app never accepts) per the CLI's rate_limit_event. */
export function rateLimited(info: RateLimitInfo | null): boolean {
  if (!info) return false;
  if (info.isUsingOverage === true) return true;
  return typeof info.status === 'string' && info.status !== '' && !['allowed', 'allowed_warning'].includes(info.status);
}

export const STALL_HOLD_MS = 10 * 60_000;
export const API_KEY_HOLD_MS = 10 * 60_000;
const MIN_LIMIT_HOLD_MS = 60_000;
const DEFAULT_LIMIT_HOLD_MS = 5 * 60_000;
const MAX_LIMIT_HOLD_MS = 30 * 60_000;

/** Stop further calls for a while: '*' is the whole seat, 'tag' only this feature. */
export interface HoldRequest {
  scope: '*' | 'tag';
  ms: number;
  kind: AiErrorKind;
  reason: string;
}

export type TurnVerdict =
  | { ok: true; text: string; model: string | null; hold?: HoldRequest }
  | { ok: false; error: AiError; hold?: HoldRequest };

function limitHold(info: RateLimitInfo | null, nowMs: number): HoldRequest {
  const resetsAt = typeof info?.resetsAt === 'number' ? info.resetsAt * 1000 - nowMs : DEFAULT_LIMIT_HOLD_MS;
  const ms = Math.min(MAX_LIMIT_HOLD_MS, Math.max(MIN_LIMIT_HOLD_MS, resetsAt));
  return { scope: '*', ms, kind: 'rateLimited', reason: 'the Claude usage limit was reached' };
}

export function interpretTurn(
  outcome: CliRunOutcome,
  state: TurnState,
  context: { nowMs: number; firstEventMs: number; timeoutMs: number },
): TurnVerdict {
  const stderr = lastLines(outcome.stderr, 2000);
  // First: the turn was stopped at system/init, which otherwise reads as a cancellation.
  if (billedToKey(state)) {
    return {
      ok: false,
      error: new AiError('auth', {
        message: AI_MESSAGES.apiKey,
        detail:
          `The CLI reported apiKeySource "${state.apiKeySource}", so this call would have been billed per request; ` +
          'it was stopped at its first event.',
      }),
      hold: { scope: '*', ms: API_KEY_HOLD_MS, kind: 'auth', reason: `the CLI is using ${state.apiKeySource}` },
    };
  }
  if (outcome.spawnError) {
    const missing = outcome.spawnError.code === 'ENOENT';
    return {
      ok: false,
      error: new AiError(missing ? 'unavailable' : 'failed', {
        message: missing ? AI_MESSAGES.binaryMissing : undefined,
        detail: `Could not start the Claude CLI: ${outcome.spawnError.message}`,
      }),
    };
  }
  if (outcome.aborted) return { ok: false, error: new AiError('cancelled', { detail: 'Cancelled while running.' }) };
  if (outcome.stalled) {
    const seconds = Math.round(context.firstEventMs / 1000);
    return {
      ok: false,
      error: new AiError('stalled', {
        detail: `The CLI produced no output within ${seconds} s (what a spent usage window looks like).`,
        retryAfterSeconds: Math.ceil(STALL_HOLD_MS / 1000),
      }),
      hold: { scope: 'tag', ms: STALL_HOLD_MS, kind: 'stalled', reason: `the CLI gave no output within ${seconds} s` },
    };
  }
  if (outcome.overflow) {
    return { ok: false, error: new AiError('failed', { detail: 'The CLI wrote more output than allowed.' }) };
  }

  const text = turnText(state).trim();
  const limited = rateLimited(state.rateLimit);
  const hold = limited ? limitHold(state.rateLimit, context.nowMs) : undefined;
  if (limited && (!text || state.isError)) {
    return {
      ok: false,
      error: new AiError('rateLimited', {
        detail: `rate_limit_event status "${state.rateLimit?.status ?? ''}"`,
        retryAfterSeconds: hold ? Math.ceil(hold.ms / 1000) : undefined,
      }),
      hold,
    };
  }

  // Only consulted when something says the turn failed: a successful call's stderr may hold harmless warnings.
  if (state.isError || (outcome.exitCode !== null && outcome.exitCode !== 0) || !text) {
    const kind = classifyFailure({
      apiErrorStatus: state.apiErrorStatus,
      isError: state.isError,
      exitCode: outcome.exitCode,
      stderr,
      resultText: state.resultText ?? '',
      errors: state.errors,
    });
    if (kind) {
      const detail =
        (state.isError ? state.resultText?.trim() : '') ||
        lastLines(outcome.stderr) ||
        `The CLI exited with code ${outcome.exitCode}.`;
      return {
        ok: false,
        error: new AiError(kind, { detail }),
        hold: kind === 'rateLimited' ? limitHold(state.rateLimit, context.nowMs) : undefined,
      };
    }
  }
  if (outcome.timedOut) {
    const seconds = Math.round(context.timeoutMs / 1000);
    return { ok: false, error: new AiError('timeout', { detail: `No complete answer within ${seconds} s.` }) };
  }
  if (state.stopReason === 'max_tokens') {
    return { ok: false, error: new AiError('truncated', { detail: 'The model reached its output limit.' }) };
  }
  if (!text) {
    const detail = state.sawResult
      ? 'The model returned an empty reply.'
      : `The CLI ended without a result (exit code ${outcome.exitCode}). ${lastLines(outcome.stderr)}`;
    return { ok: false, error: new AiError('malformed', { detail: detail.trim() }) };
  }
  return { ok: true, text, model: state.model, hold };
}
