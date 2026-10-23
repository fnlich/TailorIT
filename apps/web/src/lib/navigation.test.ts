import { describe, expect, it } from 'vitest';
import { DEFAULT_AFTER_SIGN_IN, loginHref, safeNextPath } from './navigation';

describe('safeNextPath', () => {
  it('keeps same-origin paths with their query and hash', () => {
    expect(safeNextPath('/documents?tab=templates')).toBe('/documents?tab=templates');
    expect(safeNextPath('/tracker?view=list#top')).toBe('/tracker?view=list#top');
    expect(safeNextPath('  /jobs  ')).toBe('/jobs');
  });

  it('falls back for anything that could leave the site', () => {
    for (const value of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      'jobs',
      '/jobs\nSet-Cookie: x',
      '/a\\b',
      '',
      null,
      undefined,
    ]) {
      expect(safeNextPath(value)).toBe(DEFAULT_AFTER_SIGN_IN);
    }
  });

  it('never sends sign-in back to the sign-in page', () => {
    expect(safeNextPath('/login')).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNextPath('/login?next=/jobs')).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNextPath('/logins')).toBe('/logins');
  });

  it('uses the given fallback', () => {
    expect(safeNextPath('//x', '/documents')).toBe('/documents');
  });
});

describe('loginHref', () => {
  it('encodes the page to come back to', () => {
    expect(loginHref('/documents?tab=cover-letters')).toBe('/login?next=%2Fdocuments%3Ftab%3Dcover-letters');
  });

  it('drops an unusable page', () => {
    expect(loginHref('https://evil.example')).toBe('/login');
    expect(loginHref(null)).toBe('/login');
  });
});
