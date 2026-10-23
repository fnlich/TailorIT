import { z } from 'zod';

/**
 * Every non-2xx API response has this body. `code` is machine-readable and stable; `message` is a sentence a person
 * can act on, shown as-is in the UI.
 */
export const ERROR_CODES = [
  'not_signed_in',
  'forbidden',
  'not_found',
  'validation_failed',
  'conflict',
  'cooldown',
  'rate_limited',
  'file_too_large',
  'unsupported_file',
  'ai_unavailable',
  'ai_busy',
  'ai_failed',
  'render_failed',
  'browser_unavailable',
  'system_template_read_only',
  'sign_in_unavailable',
  'account_disabled',
  'bad_origin',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_STATUS: Record<ErrorCode, number> = {
  not_signed_in: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  conflict: 409,
  cooldown: 429,
  rate_limited: 429,
  file_too_large: 413,
  unsupported_file: 415,
  ai_unavailable: 503,
  ai_busy: 409,
  ai_failed: 502,
  render_failed: 500,
  browser_unavailable: 503,
  system_template_read_only: 403,
  sign_in_unavailable: 503,
  account_disabled: 403,
  bad_origin: 403,
  internal: 500,
};

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    /** Per-field messages for form validation, keyed by the request field path (e.g. "name", "salary.min"). */
    fields: z.record(z.string(), z.string()).optional(),
    retryAfterSeconds: z.number().int().nonnegative().optional(),
    requestId: z.string().optional(),
  }),
});

export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
