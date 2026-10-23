import type { ErrorCode } from '@tailorit/shared';
import { AppError } from '../core/http/errors';

/**
 * What went wrong with an AI call, so callers react in the right direction: a signed-out CLI is not fixed by retrying,
 * a spent usage window is not fixed by another prompt. Each kind maps to `ai_unavailable` (503: the server cannot do
 * AI right now) or `ai_failed` (502: this one request went wrong; trying again may work).
 */
export const AI_ERROR_KINDS = [
  'auth',
  'rateLimited',
  'modelUnavailable',
  'unavailable',
  'failed',
  'timeout',
  'stalled',
  'truncated',
  'malformed',
  'cancelled',
] as const;
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number];

const UNAVAILABLE: ReadonlySet<AiErrorKind> = new Set([
  'auth',
  'rateLimited',
  'modelUnavailable',
  'unavailable',
  'stalled',
]);

/** The sentence a person sees for each kind (the technical reason goes in `detail`, for logs and the admin test). */
export const AI_ERROR_MESSAGES: Record<AiErrorKind, string> = {
  auth:
    'AI is unavailable because the Claude sign-in on this server is missing or has expired. ' +
    'Ask your administrator to sign the Claude CLI in again.',
  rateLimited: 'The AI usage limit has been reached for now. Please try again later.',
  modelUnavailable:
    'The AI model configured on this server is not available. Ask your administrator to check the model setting.',
  unavailable: 'AI is not available on this server right now. Please try again later.',
  failed: 'The AI request failed. Please try again.',
  timeout: 'The AI took too long to answer. Please try again.',
  stalled: 'AI is temporarily unavailable. Please try again in a few minutes.',
  truncated: 'The AI answer was cut off before it finished. Please try again with less text.',
  malformed: 'The AI reply could not be understood. Please try again.',
  cancelled: 'The AI request was cancelled.',
};

/** Specific sentences for cases that share a kind. */
export const AI_MESSAGES = {
  apiKey:
    'AI was stopped because the Claude CLI on this server is using an API key, which is billed per request. ' +
    'Ask your administrator to sign it in with a Claude subscription instead.',
  binaryMissing:
    'AI is not available because the Claude CLI is not installed on this server. Ask your administrator to install it.',
  disabled: 'AI features are turned off on this server.',
} as const;

export function aiErrorCode(kind: AiErrorKind): ErrorCode {
  return UNAVAILABLE.has(kind) ? 'ai_unavailable' : 'ai_failed';
}

/** An AppError (so routes and the task queue handle it like any other) that also says which kind of AI failure. */
export class AiError extends AppError {
  readonly kind: AiErrorKind;
  /** Technical reason (CLI output, exit code...). Logged and shown to administrators, never to end users. */
  readonly detail: string;

  constructor(
    kind: AiErrorKind,
    options: { message?: string; detail?: string; retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(aiErrorCode(kind), options.message ?? AI_ERROR_MESSAGES[kind], {
      retryAfterSeconds: options.retryAfterSeconds,
      cause: options.cause,
    });
    this.name = 'AiError';
    this.kind = kind;
    this.detail = options.detail ?? '';
  }
}

/** "about 1 minute" / "about 7 minutes" for hold messages. */
export function aboutMinutes(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** The fail-fast error for a call turned away by an active hold (see ProviderHold). */
export function holdError(hold: { until: number; kind: AiErrorKind; reason: string }, nowMs: number): AiError {
  const left = Math.max(0, hold.until - nowMs);
  const message =
    hold.kind === 'auth'
      ? AI_MESSAGES.apiKey
      : hold.kind === 'rateLimited'
        ? `The AI usage limit has been reached. Please try again in ${aboutMinutes(left)}.`
        : `AI is temporarily unavailable. Please try again in ${aboutMinutes(left)}.`;
  return new AiError(hold.kind, {
    message,
    detail: `Paused for ${aboutMinutes(left)}: ${hold.reason}.`,
    retryAfterSeconds: Math.max(1, Math.ceil(left / 1000)),
  });
}
