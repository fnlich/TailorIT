import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASHBY_API, ashbyAdapter, ashbyBoard } from '../src/features/ingest/adapters/ashby';
import { GREENHOUSE_API, greenhouseAdapter, greenhouseToken, payRangeOf } from '../src/features/ingest/adapters/greenhouse';
import { leverAdapter, leverSite } from '../src/features/ingest/adapters/lever';
import { createIngestHttp, IngestHttpError, type HttpAnswer, type IngestHttp } from '../src/features/ingest/http';
import { normalizePosting } from '../src/features/ingest/normalize';
import type { AdapterContext, SourceKind, SourceRecord } from '../src/features/ingest/types';
import { repoRoot } from '../src/core/paths';
import type { AppDeps } from '../src/core/context';

const FIXTURES = join(repoRoot(), 'tools', 'ats-fixtures');
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as unknown;

type Route = unknown | ((url: string) => HttpAnswer | Promise<HttpAnswer>);

/** An IngestHttp answering from a URL table; unknown URLs answer 404 (or throw when 404 is not allowed). */
function fakeHttp(routes: Record<string, Route>): IngestHttp & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getJson(url, options = {}) {
      calls.push(url);
      const route = routes[url];
      if (route === undefined) {
        if (options.allow?.includes(404)) return { status: 404, data: { ok: false } };
        throw new IngestHttpError(`${url} answered HTTP 404.`, 404, url);
      }
      return typeof route === 'function' ? (route as (u: string) => HttpAnswer)(url) : { status: 200, data: route };
    },
  };
}

function source(kind: SourceKind, config: Record<string, unknown>): SourceRecord {
  return {
    id: 1,
    kind,
    name: 'test',
    config,
    companyId: null,
    enabled: true,
    schedule: 'daily',
    deactivateMissing: true,
    lastRunAt: null,
    lastSuccessAt: null,
    lastStatus: null,
    createdAt: null,
    updatedAt: null,
  };
}

function context(http: IngestHttp, needsPayCheck: (id: string) => boolean = () => false): AdapterContext & { lines: string[] } {
  const lines: string[] = [];
  return {
    deps: { now: () => new Date('2026-10-22T12:00:00Z') } as AppDeps,
    http,
    signal: new AbortController().signal,
    log: (line) => lines.push(line),
    needsPayCheck,
    lines,
  };
}

describe('Greenhouse adapter (fixture: gitlab)', () => {
  const listing = fixture('greenhouse-gitlab.json') as { jobs: Array<{ id: number; title: string }> };
  const pay = fixture('greenhouse-gitlab-pay.json') as { id: number; pay_input_ranges: Array<{ min_cents: number; max_cents: number }> };
  const routes = {
    [`${GREENHOUSE_API}/gitlab/jobs?content=true`]: listing,
    [`${GREENHOUSE_API}/gitlab`]: fixture('greenhouse-gitlab-board.json'),
    [`${GREENHOUSE_API}/gitlab/jobs/${pay.id}?pay_transparency=true`]: pay,
  };

  it('reads every listed job with decoded HTML, places, dates and the board name', async () => {
    const http = fakeHttp(routes);
    const result = await greenhouseAdapter.fetch(source('greenhouse', { token: 'gitlab' }), context(http));
    expect(result.complete).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.postings).toHaveLength(listing.jobs.length);
    const first = result.postings[0]!;
    expect(first.sourceJobId).toBe(String(listing.jobs[0]!.id));
    expect(first.company.name).toBe('GitLab');
    expect(first.descriptionHtml).toMatch(/<h2>/);
    expect(first.descriptionHtml).not.toMatch(/&lt;/);
    expect(first.url).toMatch(/^https:\/\/job-boards\.greenhouse\.io\/gitlab\/jobs\/\d+$/);
    expect(first.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(first.salaryPending).toBe(true);
    // No pay requests when nothing needs a check.
    expect(http.calls.filter((url) => url.includes('pay_transparency'))).toEqual([]);
  });

  it('asks for pay ranges of postings never checked, at most one request each', async () => {
    const http = fakeHttp(routes);
    const result = await greenhouseAdapter.fetch(source('greenhouse', { token: 'gitlab' }), context(http, () => true));
    const priced = result.postings.find((posting) => posting.sourceJobId === String(pay.id))!;
    const range = pay.pay_input_ranges[0]!;
    expect(priced.supplement?.salary).toMatchObject({ min: range.min_cents / 100, max: range.max_cents / 100, currency: 'USD', period: 'year' });
    expect(http.calls.filter((url) => url.includes('pay_transparency'))).toHaveLength(listing.jobs.length);
    // A job whose detail answers 404 keeps no supplement (it is asked again next run).
    const others = result.postings.filter((posting) => posting.sourceJobId !== String(pay.id));
    expect(others.every((posting) => posting.supplement === undefined)).toBe(true);
  });

  it('normalises the fixture postings: sections, places, arrangement and category', async () => {
    const result = await greenhouseAdapter.fetch(source('greenhouse', { token: 'gitlab' }), context(fakeHttp(routes)));
    const backend = result.postings.find((posting) => /Backend Engineer/.test(posting.title))!;
    const normalized = normalizePosting(backend);
    expect(normalized.deterministic.responsibilities.length).toBeGreaterThanOrEqual(5);
    expect(normalized.deterministic.requirements[0]).toMatch(/Ruby and GraphQL/);
    expect(normalized.workArrangement).toBe('remote');
    expect(normalized.locations[0]).toMatchObject({ countryCode: 'CA', isRemote: true });
    expect(normalized.categoryId).toBe('software-engineering');
    expect(normalized.subcategoryIds).toContain('backend');
    const keywords = [...normalized.deterministic.keywords.high, ...normalized.deterministic.keywords.low].map((group) => group.term);
    expect(keywords).toEqual(expect.arrayContaining(['Ruby', 'GraphQL']));
    for (const posting of result.postings) expect(() => normalizePosting(posting)).not.toThrow();
    const multi = normalizePosting(result.postings.find((posting) => posting.locations?.[0]?.includes(';'))!);
    expect(multi.locationCount).toBeGreaterThan(1);
  });

  it('turns a board URL into a token and an unknown board into a readable error', async () => {
    expect(greenhouseToken('https://boards.greenhouse.io/gitlab')).toBe('gitlab');
    expect(greenhouseToken('job-boards.greenhouse.io/acme/jobs/123')).toBe('acme');
    await expect(greenhouseAdapter.fetch(source('greenhouse', { token: 'nope' }), context(fakeHttp({})))).rejects.toThrow(
      /Greenhouse has no job board "nope"/,
    );
    await expect(greenhouseAdapter.fetch(source('greenhouse', {}), context(fakeHttp({})))).rejects.toThrow(/board token/);
  });

  it('reads pay ranges in cents, hourly when the range is small', () => {
    expect(payRangeOf({ pay_input_ranges: [{ min_cents: 4500, max_cents: 6000, currency_type: 'USD', blurb: '' }] })).toMatchObject({
      min: 45,
      max: 60,
      period: 'hour',
    });
    expect(payRangeOf({ pay_input_ranges: [] })).toBeNull();
  });
});

describe('Lever adapter (fixture: palantir)', () => {
  const postings = fixture('lever-palantir.json') as Array<{ id: string; text: string }>;
  const page = (skip: number) => `https://api.lever.co/v0/postings/palantir?mode=json&skip=${skip}&limit=100`;

  it('reads postings with list sections, places, arrangement and type', async () => {
    const result = await leverAdapter.fetch(source('lever', { site: 'palantir' }), context(fakeHttp({ [page(0)]: postings })));
    expect(result.complete).toBe(true);
    expect(result.postings).toHaveLength(postings.length);
    const admin = result.postings.find((posting) => posting.sourceJobId === '6ed76ce8-4156-4b60-b120-403538bd66cd')!;
    expect(admin.company.name).toBe('Palantir');
    expect(admin.workArrangement).toBe('hybrid');
    expect(admin.locations).toEqual(['Singapore, Singapore']);
    expect(admin.countryHint).toBe('SG');
    expect(admin.employmentText).toBe('Full-time');
    expect(admin.sections?.responsibilities?.[0]).toMatch(/^Provide administrative support/);
    expect(admin.sections?.requirements?.length).toBeGreaterThan(0);
    expect(admin.sections?.desired?.length).toBeGreaterThan(0);

    const backend = result.postings.find((posting) => posting.sourceJobId === 'ab7e3425-81d5-4705-a7b5-cd60c8a45cdb')!;
    const normalized = normalizePosting(backend);
    expect(normalized.deterministic.responsibilities[0]).toMatch(/backend services/);
    expect(normalized.salary).toMatchObject({ min: 135000, max: 200000, currency: 'USD', period: 'year' });
    expect(normalized.primaryLocation).toBe('New York, NY, USA');
    expect(normalized.employmentType).toBe('full_time');
    expect(normalized.postedAt).toMatch(/^\d{4}-/);
  });

  it('pages through long listings and marks a listing that stopped part-way as incomplete', async () => {
    const many = Array.from({ length: 100 }, (_, index) => ({ ...postings[0], id: `p${index}` }));
    const full = await leverAdapter.fetch(
      source('lever', { site: 'palantir' }),
      context(fakeHttp({ [page(0)]: many, [page(100)]: postings })),
    );
    expect(full.postings).toHaveLength(103);
    expect(full.complete).toBe(true);
    const broken = await leverAdapter.fetch(
      source('lever', { site: 'palantir' }),
      context(fakeHttp({ [page(0)]: many, [page(100)]: () => Promise.reject(new IngestHttpError('boom', 500, page(100))) })),
    );
    expect(broken.postings).toHaveLength(100);
    expect(broken.complete).toBe(false);
    expect(broken.failures[0]!.message).toMatch(/Page 2/);
  });

  it('uses the EU host and explains an unknown site', async () => {
    const http = fakeHttp({});
    await expect(leverAdapter.fetch(source('lever', { site: 'acme', region: 'eu' }), context(http))).rejects.toThrow(
      /Lever has no job site "acme" in the EU region/,
    );
    expect(http.calls[0]).toMatch(/^https:\/\/api\.eu\.lever\.co\/v0\/postings\/acme\?/);
    expect(leverSite('https://jobs.lever.co/palantir/123')).toBe('palantir');
  });
});

describe('Ashby adapter (fixtures: linear, ramp)', () => {
  const linear = fixture('ashby-linear.json') as { jobs: Array<Record<string, unknown>> };
  const ramp = fixture('ashby-ramp.json') as { jobs: Array<Record<string, unknown>> };

  it('reads listed postings; remote areas become remote places with the address country', async () => {
    const http = fakeHttp({ [`${ASHBY_API}/linear?includeCompensation=true`]: linear });
    const result = await ashbyAdapter.fetch(source('ashby', { board: 'linear' }), context(http));
    expect(result.postings).toHaveLength(linear.jobs.length);
    const northAmerica = result.postings.find((posting) => posting.locations?.[0] === 'Remote - North America')!;
    expect(northAmerica.workArrangement).toBe('remote');
    expect(northAmerica.countryHint).toBe('US');
    expect(northAmerica.employmentType).toBe('full_time');
    expect(northAmerica.company.name).toBe('Linear');
    const normalized = normalizePosting(northAmerica);
    expect(normalized.primaryLocation).toBe('Remote in USA');
    expect(normalized.workArrangement).toBe('remote');
  });

  it('reads the Salary component of the compensation tiers and the secondary locations', async () => {
    const http = fakeHttp({ [`${ASHBY_API}/ramp?includeCompensation=true`]: ramp });
    const result = await ashbyAdapter.fetch(source('ashby', { board: 'ramp' }), context(http));
    const first = result.postings[0]!;
    expect(first.salary).toMatchObject({ currency: 'USD', period: 'year' });
    expect(first.salary!.min).toBeGreaterThan(50_000);
    expect(first.salary!.max).toBeGreaterThan(first.salary!.min!);
    expect(first.locations!.length).toBeGreaterThan(1);
    const normalized = normalizePosting(first);
    expect(normalized.salary?.annualUsdMin).toBe(first.salary!.min);
  });

  it('skips unlisted postings and explains an unknown board', async () => {
    const jobs = linear.jobs.map((job, index) => (index === 0 ? { ...job, isListed: false } : job));
    const http = fakeHttp({ [`${ASHBY_API}/linear?includeCompensation=true`]: { jobs, apiVersion: '1' } });
    const ctx = context(http);
    const result = await ashbyAdapter.fetch(source('ashby', { board: 'linear' }), ctx);
    expect(result.postings).toHaveLength(linear.jobs.length - 1);
    expect(ctx.lines.join(' ')).toMatch(/1 unlisted skipped/);
    await expect(ashbyAdapter.fetch(source('ashby', { board: 'nobody' }), context(fakeHttp({})))).rejects.toThrow(
      /Ashby has no job board "nobody"/,
    );
    expect(ashbyBoard('https://jobs.ashbyhq.com/linear')).toBe('linear');
  });
});

describe('ingest HTTP client', () => {
  function clock() {
    let now = 1_000_000;
    const sleeps: number[] = [];
    return {
      now: () => now,
      sleeps,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += Math.max(0, ms);
      },
    };
  }

  it('sends the User-Agent, waits a second between requests to one host, not across hosts', async () => {
    const time = clock();
    const seen: Array<{ url: string; agent: string | null }> = [];
    const http = createIngestHttp({
      userAgent: 'TailorIT test (contact: a@b.c)',
      timeoutMs: 5000,
      now: time.now,
      sleep: time.sleep,
      fetch: async (url, init) => {
        seen.push({ url: String(url), agent: new Headers(init?.headers).get('User-Agent') });
        return new Response('{"ok":true}', { status: 200 });
      },
    });
    await http.getJson('https://a.example/1');
    await http.getJson('https://a.example/2');
    await http.getJson('https://b.example/1');
    expect(seen.map((entry) => entry.agent)).toEqual(Array(3).fill('TailorIT test (contact: a@b.c)'));
    expect(time.sleeps).toEqual([0, 1000, 0]);
  });

  it('honours Retry-After on 429, then succeeds; gives up past the retry limit', async () => {
    const time = clock();
    let calls = 0;
    const http = createIngestHttp({
      userAgent: 'ua',
      timeoutMs: 5000,
      now: time.now,
      sleep: time.sleep,
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? new Response('slow down', { status: 429, headers: { 'Retry-After': '7' } })
          : new Response('{"jobs":[]}', { status: 200 });
      },
    });
    await expect(http.getJson('https://c.example/jobs')).resolves.toEqual({ status: 200, data: { jobs: [] } });
    expect(time.sleeps).toContain(7000);

    const always = createIngestHttp({
      userAgent: 'ua',
      timeoutMs: 5000,
      maxRetries: 2,
      now: time.now,
      sleep: time.sleep,
      fetch: async () => new Response('no', { status: 429, headers: { 'Retry-After': '1' } }),
    });
    await expect(always.getJson('https://d.example/jobs')).rejects.toThrow(/rate limiting/);
  });

  it('answers allowed statuses, throws others, and retries then gives up on slow hosts', async () => {
    let slowCalls = 0;
    const http = createIngestHttp({
      userAgent: 'ua',
      timeoutMs: 50,
      minIntervalMs: 0,
      maxRetries: 2,
      sleep: async () => {},
      fetch: async (url, init) => {
        if (String(url).endsWith('/missing')) return new Response('{"ok":false}', { status: 404 });
        slowCalls += 1;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      },
    });
    await expect(http.getJson('https://e.example/missing', { allow: [404] })).resolves.toEqual({ status: 404, data: { ok: false } });
    await expect(http.getJson('https://e.example/missing')).rejects.toBeInstanceOf(IngestHttpError);
    await expect(http.getJson('https://e.example/slow')).rejects.toThrow(/did not answer within/);
    expect(slowCalls).toBe(3);
  });

  it('retries a network failure and succeeds when the host answers again', async () => {
    let calls = 0;
    const http = createIngestHttp({
      userAgent: 'ua',
      timeoutMs: 5000,
      sleep: async () => {},
      fetch: async () => {
        calls += 1;
        if (calls === 1) throw new TypeError('fetch failed');
        return new Response('[]', { status: 200 });
      },
    });
    await expect(http.getJson('https://f.example/jobs')).resolves.toEqual({ status: 200, data: [] });
    expect(calls).toBe(2);
  });
});
