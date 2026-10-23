import { ApiErrorBodySchema, ERROR_CODES, type ErrorCode } from '@tailorit/shared';
import type { ZodType } from 'zod';

/*
 * The browser only talks to its own origin: Next rewrites /api/* to the Express API (next.config.ts), so the
 * httpOnly session cookie is first-party and rides along with `credentials: 'same-origin'`.
 */

/** Shown whenever the API cannot be reached at all (network down, API stopped, proxy refused). */
export const UNREACHABLE_MESSAGE = "We can't reach the server right now. Please try again in a moment.";

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

export interface ApiErrorInit {
  status: number;
  code: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  retryAfterSeconds?: number;
  requestId?: string;
  /** The path that was called, e.g. "/api/auth/email/verify". */
  path?: string;
}

/** Every failed call surfaces as this: the shared error body, plus the HTTP status (0 = never reached the API). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields: Record<string, string> | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly requestId: string | undefined;
  readonly path: string;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.fields = init.fields;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.requestId = init.requestId;
    this.path = init.path ?? '';
  }

  /**
   * The session is gone: the API said `not_signed_in` on a call outside /api/auth/* (sign-in calls answer 401
   * `validation_failed` for a wrong code, which must not bounce the sign-in page onto itself).
   */
  get isSessionExpired(): boolean {
    return this.code === 'not_signed_in' && !this.path.startsWith('/api/auth/');
  }

  /** True when the request never got an answer from the API (offline, API down, proxy gave up). */
  get isUnreachable(): boolean {
    return this.status === 0 || (this.code === 'internal' && this.message === UNREACHABLE_MESSAGE);
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** The sentence to show for a failure: the server's own when there is one, else `fallback`. */
export function userMessage(error: unknown, fallback = GENERIC_MESSAGE): string {
  if (error instanceof ApiError && error.message.trim()) return error.message;
  return fallback;
}

type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];

export interface ApiRequestInit extends Omit<RequestInit, 'body'> {
  /** Plain objects and arrays are sent as JSON; FormData, Blob, URLSearchParams and strings as they are. */
  body?: unknown;
  /** Appended as the query string; null/undefined values are skipped, arrays repeat the key. */
  query?: Record<string, QueryValue>;
  /** Validates (and strips) the JSON answer. A mismatch is reported as an `internal` ApiError. */
  schema?: ZodType;
}

const STATUS_CODE: Record<number, ErrorCode> = {
  400: 'validation_failed',
  401: 'not_signed_in',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'file_too_large',
  415: 'unsupported_file',
  429: 'rate_limited',
};

const STATUS_MESSAGE: Record<number, string> = {
  401: 'Sign in to do that.',
  403: "You don't have access to that.",
  404: 'That could not be found. It may have been deleted.',
  413: 'That file is too large.',
  429: 'Too many requests. Please wait a moment and try again.',
};

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const base = path.startsWith('/') ? path : `/${path}`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, String(entry));
    } else {
      params.append(key, String(value));
    }
  }
  const search = params.toString();
  if (!search) return base;
  return `${base}${base.includes('?') ? '&' : '?'}${search}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function retryAfter(response: Response): number | undefined {
  const header = response.headers.get('Retry-After');
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : undefined;
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/** Turns a non-2xx answer into an ApiError, whatever shape (or none) its body has. */
function toApiError(response: Response, data: unknown, path: string): ApiError {
  const parsed = ApiErrorBodySchema.safeParse(data);
  if (parsed.success) {
    const { code, message, fields, retryAfterSeconds, requestId } = parsed.data.error;
    return new ApiError({
      status: response.status,
      code,
      message: message || STATUS_MESSAGE[response.status] || GENERIC_MESSAGE,
      fields,
      retryAfterSeconds: retryAfterSeconds ?? retryAfter(response),
      requestId,
      path,
    });
  }
  // The Next rewrite answers 5xx with an HTML/text page when the API is not running: that is "unreachable".
  if (data === undefined && response.status >= 500) {
    return new ApiError({ status: response.status, code: 'internal', message: UNREACHABLE_MESSAGE, path });
  }
  // A body this client does not know: keep any sentence it carries.
  let message: string | undefined;
  let code: ErrorCode | undefined;
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.error === 'string') message = record.error;
    if (typeof record.message === 'string') message ??= record.message;
    if (isErrorCode(record.code)) code = record.code;
  }
  return new ApiError({
    status: response.status,
    code: code ?? STATUS_CODE[response.status] ?? 'internal',
    message: message || STATUS_MESSAGE[response.status] || GENERIC_MESSAGE,
    retryAfterSeconds: retryAfter(response),
    path,
  });
}

/**
 * Calls the API at `path` (e.g. "/api/auth/me") and returns its JSON answer. Throws ApiError for any failure;
 * an aborted request rethrows the AbortError untouched so React Query can tell it apart.
 */
export async function apiFetch<T = unknown>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { body, query, schema, headers: rawHeaders, ...rest } = init;
  const headers = new Headers(rawHeaders);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (
      body instanceof FormData ||
      body instanceof Blob ||
      body instanceof URLSearchParams ||
      body instanceof ArrayBuffer ||
      typeof body === 'string'
    ) {
      payload = body as BodyInit;
    } else {
      headers.set('Content-Type', 'application/json');
      payload = JSON.stringify(body);
    }
  }

  const url = buildUrl(path, query);
  const pathname = url.split('?')[0] ?? url;
  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers,
      body: payload,
      credentials: 'same-origin',
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError({ status: 0, code: 'internal', message: UNREACHABLE_MESSAGE, path: pathname });
  }

  if (response.status === 204 || response.status === 205) return undefined as T;

  const text = await response.text();
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!response.ok) throw toApiError(response, data, pathname);

  if (schema) {
    const checked = schema.safeParse(data);
    if (!checked.success) {
      throw new ApiError({
        status: response.status,
        code: 'internal',
        message: 'The server sent an answer this page does not understand. Please reload and try again.',
        path: pathname,
      });
    }
    return checked.data as T;
  }
  return data as T;
}

type BodyInitOptions = Omit<ApiRequestInit, 'body' | 'method'>;

/** Shorthands for the common verbs. */
export const api = {
  get: <T = unknown>(path: string, init?: Omit<ApiRequestInit, 'body' | 'method'>) =>
    apiFetch<T>(path, { ...init, method: 'GET' }),
  post: <T = unknown>(path: string, body?: unknown, init?: BodyInitOptions) =>
    apiFetch<T>(path, { ...init, method: 'POST', body }),
  put: <T = unknown>(path: string, body?: unknown, init?: BodyInitOptions) =>
    apiFetch<T>(path, { ...init, method: 'PUT', body }),
  patch: <T = unknown>(path: string, body?: unknown, init?: BodyInitOptions) =>
    apiFetch<T>(path, { ...init, method: 'PATCH', body }),
  delete: <T = unknown>(path: string, init?: BodyInitOptions) => apiFetch<T>(path, { ...init, method: 'DELETE' }),
};
