import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, UNREACHABLE_MESSAGE, apiFetch, userMessage } from './api';

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return vi.fn(async () => new Response(status === 204 ? null : text, { status, headers }));
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('sends JSON same-origin and returns the parsed answer', async () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiFetch('/api/me', { method: 'PATCH', body: { name: 'Ada' }, query: { a: 1, b: null, c: ['x', 'y'] } })).resolves.toEqual({
      ok: true,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/me?a=1&c=x&c=y');
    expect(init.credentials).toBe('same-origin');
    expect(init.body).toBe('{"name":"Ada"}');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('reads the shared error body', async () => {
    vi.stubGlobal(
      'fetch',
      respond(429, { error: { code: 'cooldown', message: 'Wait 30 more seconds.', retryAfterSeconds: 30, fields: { email: 'x' } } }),
    );
    const error = await failure(apiFetch('/api/auth/email/request', { method: 'POST', body: {} }));
    expect(error).toMatchObject({ status: 429, code: 'cooldown', message: 'Wait 30 more seconds.', retryAfterSeconds: 30 });
    expect(error.fields).toEqual({ email: 'x' });
    expect(error.path).toBe('/api/auth/email/request');
  });

  it('turns a network failure into the unreachable sentence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const error = await failure(apiFetch('/api/auth/options'));
    expect(error).toMatchObject({ status: 0, code: 'internal', message: UNREACHABLE_MESSAGE });
    expect(error.isUnreachable).toBe(true);
  });

  it('treats the proxy\'s HTML 500 as unreachable', async () => {
    vi.stubGlobal('fetch', respond(500, '<!doctype html><title>Internal Server Error</title>'));
    const error = await failure(apiFetch('/api/auth/options'));
    expect(error.message).toBe(UNREACHABLE_MESSAGE);
    expect(error.isUnreachable).toBe(true);
  });

  it('keeps a sentence from an unknown body and maps the status to a code', async () => {
    vi.stubGlobal('fetch', respond(404, { error: 'Resume not found' }));
    const error = await failure(apiFetch('/api/resumes/x'));
    expect(error).toMatchObject({ status: 404, code: 'not_found', message: 'Resume not found' });
  });

  it('returns undefined for 204', async () => {
    vi.stubGlobal('fetch', respond(204, null));
    await expect(apiFetch('/api/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('validates with a schema', async () => {
    vi.stubGlobal('fetch', respond(200, { account: 'nope' }));
    const error = await failure(apiFetch('/api/auth/me', { schema: z.object({ account: z.null() }) }));
    expect(error.code).toBe('internal');
  });

  it('rethrows aborts untouched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new DOMException('aborted', 'AbortError'))));
    await expect(apiFetch('/api/jobs')).rejects.toBeInstanceOf(DOMException);
  });
});

describe('ApiError.isSessionExpired', () => {
  it('is true only for not_signed_in outside /api/auth/*', () => {
    expect(new ApiError({ status: 401, code: 'not_signed_in', message: 'x', path: '/api/resumes' }).isSessionExpired).toBe(true);
    expect(new ApiError({ status: 401, code: 'not_signed_in', message: 'x', path: '/api/auth/me' }).isSessionExpired).toBe(false);
    expect(
      new ApiError({ status: 401, code: 'validation_failed', message: 'That code is not right.', path: '/api/auth/email/verify' })
        .isSessionExpired,
    ).toBe(false);
    expect(new ApiError({ status: 401, code: 'validation_failed', message: 'x', path: '/api/resumes' }).isSessionExpired).toBe(false);
  });
});

describe('userMessage', () => {
  it('prefers the server sentence', () => {
    expect(userMessage(new ApiError({ status: 400, code: 'validation_failed', message: 'Bad name.' }), 'fallback')).toBe('Bad name.');
    expect(userMessage(new Error('boom'), 'fallback')).toBe('fallback');
  });
});
