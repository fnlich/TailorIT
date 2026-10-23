import { describe, expect, it } from 'vitest';
import { linkKey, normalizeCompanyName, normalizeJobText, normalizeJobTitle } from './identity';

describe('linkKey', () => {
  it('folds the scheme, host case, default port, fragment, tracking and order', () => {
    expect(linkKey('http://Boards.Greenhouse.io:443/acme/jobs/42/?utm_source=x&b=2&a=1#apply')).toBe(
      'https://boards.greenhouse.io/acme/jobs/42?a=1&b=2',
    );
    expect(linkKey('https://jobs.lever.co/acme/ABC-123?lever-source=linkedin&gclid=1')).toBe(
      'https://jobs.lever.co/acme/ABC-123',
    );
  });

  it('keeps board job ids and the path case', () => {
    expect(linkKey('https://acme.com/careers?gh_jid=123&ref=abc')).toBe('https://acme.com/careers?gh_jid=123');
    expect(linkKey('https://acme.com/Jobs/AbC')).toBe('https://acme.com/Jobs/AbC');
  });

  it('keeps a non-default port and the root path', () => {
    expect(linkKey('https://acme.com:8443/')).toBe('https://acme.com:8443/');
  });

  it('refuses non-http links', () => {
    expect(linkKey('mailto:jobs@acme.com')).toBeNull();
    expect(linkKey('not a url')).toBeNull();
    expect(linkKey('')).toBeNull();
    expect(linkKey(null)).toBeNull();
  });
});

describe('normalizeCompanyName', () => {
  it.each([
    ['Acme, Inc.', 'acme'],
    ['ACME Corporation', 'acme'],
    ['Open AI', 'openai'],
    ['AT&T', 'att'],
    ["Macy's", 'macys'],
    ['Stripe™', 'stripe'],
    ['Siemens AG', 'siemens'],
    ['Atlassian Pty Ltd', 'atlassian'],
    ['Company', 'company'],
    ['  ', ''],
  ])('%s -> %s', (name, expected) => {
    expect(normalizeCompanyName(name)).toBe(expected);
  });
});

describe('title and text keys', () => {
  it('normalizes titles for the dedupe', () => {
    expect(normalizeJobTitle('Senior  Software Engineer - Backend (Remote)')).toBe(
      'senior software engineer backend remote',
    );
  });

  it('collapses whitespace for the content hash', () => {
    expect(normalizeJobText('  A\n\nB\tC ')).toBe('A B C');
  });
});
