/*
 * Where sign-in sends people. Shared by proxy.ts (server) and the pages (browser), so it must stay free of React,
 * DOM and Node APIs.
 */

/** The first page after signing in when no (usable) `next` was given. */
export const DEFAULT_AFTER_SIGN_IN = '/jobs';

/**
 * A same-origin path to continue to after signing in, or `fallback`. Rejects anything that could leave the site
 * ("//evil.com", "/\\evil.com", "https://…", control characters) and the sign-in page itself.
 */
export function safeNextPath(raw: string | null | undefined, fallback: string = DEFAULT_AFTER_SIGN_IN): string {
  if (typeof raw !== 'string') return fallback;
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // Control characters and backslashes have no place in an app path.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, 'http://tailorit.invalid');
  } catch {
    return fallback;
  }
  if (url.origin !== 'http://tailorit.invalid') return fallback;
  if (url.pathname === '/login' || url.pathname.startsWith('/login/')) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** "/login?next=<path>" for the page someone was on. */
export function loginHref(currentPath?: string | null): string {
  const next = currentPath ? safeNextPath(currentPath, '') : '';
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
}

/** Full-page move to the sign-in page, remembering where the person was. A no-op on the sign-in page itself. */
export function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  if (pathname === '/login' || pathname.startsWith('/login/')) return;
  // A full page load: the stale session's data must not survive in memory.
  window.location.assign(new URL(loginHref(`${pathname}${search}`), window.location.origin).href);
}
