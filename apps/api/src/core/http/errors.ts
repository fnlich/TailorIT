import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ERROR_STATUS, type ApiErrorBody, type ErrorCode } from '@tailorit/shared';
import type { Logger } from '../log';

/**
 * The one error type routes throw. The error middleware turns it into `{ error: { code, message, fields?,
 * retryAfterSeconds?, requestId } }` with the status for `code`. `message` must be a sentence a person can act on.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    message: string,
    options: { fields?: Record<string, string>; retryAfterSeconds?: number; status?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? ERROR_STATUS[code];
    this.fields = options.fields;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export const notSignedIn = () => new AppError('not_signed_in', 'Sign in to do that.');
export const forbidden = (message = 'That is not available for your account.') => new AppError('forbidden', message);
export const adminOnly = () => new AppError('forbidden', 'That is an administrator-only part of TailorIT.');
/** Also used for other people's rows: never reveal that something exists. */
export const notFound = (what = 'That item') => new AppError('not_found', `${what} was not found.`);
export const validationFailed = (message: string, fields?: Record<string, string>) =>
  new AppError('validation_failed', message, { fields });
export const conflict = (message: string) => new AppError('conflict', message);

/** Wraps an async handler so a rejected promise reaches the error middleware (Express 4 does not). */
export function asyncHandler<T extends RequestHandler>(handler: T): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function sendError(res: Parameters<RequestHandler>[1], error: AppError, requestId?: string): void {
  const body: ApiErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
      ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      ...(requestId ? { requestId } : {}),
    },
  };
  if (error.retryAfterSeconds !== undefined) res.setHeader('Retry-After', String(error.retryAfterSeconds));
  res.status(error.status).json(body);
}

export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(res, new AppError('not_found', 'There is no such API endpoint.'), req.requestId);
};

export function errorHandler(log: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (res.headersSent) return;
    if (err instanceof AppError) {
      if (err.status >= 500) log.error(`[${req.requestId}] ${req.method} ${req.originalUrl}: ${err.message}`, err.cause);
      sendError(res, err, req.requestId);
      return;
    }
    // Body parser errors (malformed JSON, too large).
    const status = typeof err?.status === 'number' ? err.status : typeof err?.statusCode === 'number' ? err.statusCode : 500;
    if (err?.type === 'entity.parse.failed') {
      sendError(res, new AppError('validation_failed', 'The request body is not valid JSON.'), req.requestId);
      return;
    }
    if (err?.type === 'entity.too.large' || status === 413) {
      sendError(res, new AppError('file_too_large', 'That request is too large.'), req.requestId);
      return;
    }
    // Any other client error a library raised (a path parameter that does not decode, a charset body-parser cannot
    // read...) stays a client error. Its own message is not shown: it can quote the request or name internals.
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      log.debug(`[${req.requestId}] ${req.method} ${req.originalUrl}: ${status} ${err?.message ?? String(err)}`);
      const answer =
        status === 404 ? notFound() : new AppError('validation_failed', 'The request is not valid.', { status });
      sendError(res, answer, req.requestId);
      return;
    }
    log.error(`[${req.requestId}] ${req.method} ${req.originalUrl} failed`, err);
    sendError(res, new AppError('internal', 'Something went wrong on our side. Please try again.'), req.requestId);
  };
}
