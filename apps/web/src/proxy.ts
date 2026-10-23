import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_AFTER_SIGN_IN, safeNextPath } from '@/lib/navigation';

/*
 * Optimistic sign-in gate (Next 16's "proxy", formerly middleware). It only looks for the session cookie; the API
 * decides whether the session is real, and a 401 from any call sends the browser back here.
 *
 * - "/"                → /jobs (signed in) or /login
 * - app pages          → /login?next=<page> when there is no session cookie
 * - /login             → `next` (or /jobs) when the cookie belongs to a live session; a dead cookie is cleared
 * - /dev/*             → open without a session outside production (the kit page)
 * - /api/*, assets     → never reach this function (matcher below)
 */

/** Must match apps/api/src/core/auth/session.ts SESSION_COOKIE. */
const SESSION_COOKIE = 'ti_session';

function apiOrigin(): string {
  return process.env.API_INTERNAL_URL || `http://127.0.0.1:${process.env.API_PORT || '4100'}`;
}

type SessionVerdict = 'valid' | 'invalid' | 'unknown';

/** Asks the API whether the cookie is a live session. Anything but a clear answer is "unknown". */
async function sessionVerdict(request: NextRequest): Promise<SessionVerdict> {
  try {
    const response = await fetch(`${apiOrigin()}/api/auth/me`, {
      headers: { cookie: request.headers.get('cookie') ?? '', accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return 'unknown';
    const body = (await response.json()) as { account?: unknown };
    if (!body || typeof body !== 'object' || !('account' in body)) return 'unknown';
    return body.account ? 'valid' : 'invalid';
  } catch {
    return 'unknown';
  }
}

function isLoginPath(pathname: string): boolean {
  return pathname === '/login' || pathname.startsWith('/login/');
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === '/') {
    return NextResponse.redirect(new URL(hasSession ? DEFAULT_AFTER_SIGN_IN : '/login', request.url));
  }

  if (isLoginPath(pathname)) {
    if (!hasSession) return NextResponse.next();
    const verdict = await sessionVerdict(request);
    if (verdict === 'valid') {
      const next = safeNextPath(request.nextUrl.searchParams.get('next'));
      return NextResponse.redirect(new URL(next, request.url));
    }
    const response = NextResponse.next();
    // A cookie the API no longer knows would otherwise bounce between /login and the app.
    if (verdict === 'invalid') response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  if ((pathname === '/dev' || pathname.startsWith('/dev/')) && process.env.NODE_ENV !== 'production') {
    return NextResponse.next();
  }

  if (!hasSession) {
    // Client navigations carry Next's internal `_rsc` parameter; it does not belong in the page to come back to.
    const params = new URLSearchParams(search);
    params.delete('_rsc');
    const query = params.toString();
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${pathname}${query ? `?${query}` : ''}`);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except the API rewrite, Next internals and files with an extension (favicon, logo, fonts…).
  matcher: ['/((?!api|_next/|.*\\.[A-Za-z0-9]+$).*)'],
};
