import { describe, expect, it } from 'vitest';
import { JobsQuerySchema } from './query';
import {
  EMPTY_JOBS_QUERY,
  emptyJobsQuery,
  normalizeJobsQuery,
  hasJobFilters,
  jobFilterCounts,
  jobsQueryToQueryString,
  jobsQueryToSearchParams,
  preferredJobType,
  searchParamsToJobsQuery,
  type JobsQueryInput,
} from './query';

const FULL: JobsQueryInput = {
  q: 'platform engineer',
  locations: ['San Francisco, CA', 'Remote'],
  remote: 'US',
  jobTypes: ['full_time', 'contract'],
  levels: ['senior', 'expert'],
  categories: ['devops-infrastructure'],
  subcategories: ['site-reliability-engineering'],
  leadership: ['ic'],
  arrangements: ['remote', 'hybrid'],
  minSalary: 150000,
  payPeriod: 'year',
  h1b: true,
  industries: ['technology', 'finance'],
  companySizes: ['201-500'],
  companies: ['12', '40'],
  clearance: 'not_required',
  hideApplied: true,
  updatedWithin: 7,
  sort: 'salary',
  cursor: 'abc123',
};

// A tiny URLSearchParams stand-in, so the round trip runs without DOM types.
function reader(entries: Array<[string, string]>) {
  return { getAll: (name: string) => entries.filter(([key]) => key === name).map(([, value]) => value) };
}

describe('jobs query round trip', () => {
  it('survives entries -> query', () => {
    const query = JobsQuerySchema.parse(FULL);
    expect(searchParamsToJobsQuery(reader(jobsQueryToSearchParams(query)))).toEqual(query);
  });

  it('survives a query string and Express-style records', () => {
    const query = JobsQuerySchema.parse(FULL);
    expect(searchParamsToJobsQuery(`?${jobsQueryToQueryString(query)}`)).toEqual(query);
    const record: Record<string, string | string[]> = {};
    for (const [key, value] of jobsQueryToSearchParams(query)) {
      const held = record[key];
      record[key] = held === undefined ? value : Array.isArray(held) ? [...held, value] : [held, value];
    }
    expect(searchParamsToJobsQuery(record)).toEqual(query);
  });

  it('writes nothing for the defaults and keeps a fixed key order', () => {
    expect(jobsQueryToSearchParams({})).toEqual([]);
    expect(jobsQueryToSearchParams({ sort: 'relevant', jobTypes: [], h1b: false })).toEqual([]);
    expect(jobsQueryToSearchParams({ sort: 'posted', q: 'x', levels: ['mid'] })).toEqual([
      ['q', 'x'],
      ['level', 'mid'],
      ['sort', 'posted'],
    ]);
  });

  it('form-encodes the query string like URLSearchParams', () => {
    expect(jobsQueryToQueryString({ q: "C++ dev (it's fun)", locations: ['San Francisco, CA'] })).toBe(
      'q=C%2B%2B+dev+%28it%27s+fun%29&location=San+Francisco%2C+CA',
    );
  });

  it('reads leniently: comma lists, unknown values dropped, bad numbers ignored', () => {
    const query = searchParamsToJobsQuery(
      'type=full_time,bogus&type=internship&level=senior&updated=5&minSalary=abc&sort=weird&category=nope&h1b=1&location=Austin%2C+TX',
    );
    expect(query).toEqual({
      ...EMPTY_JOBS_QUERY,
      jobTypes: ['full_time', 'internship'],
      levels: ['senior'],
      h1b: true,
      locations: ['Austin, TX'],
    });
  });

  it('drops bad values from an object one by one instead of wiping the query', () => {
    expect(
      jobsQueryToSearchParams({
        q: '  go  ',
        categories: ['nope', 'design'] as never,
        jobTypes: ['full_time'],
        updatedWithin: 5 as never,
        h1b: false,
      }),
    ).toEqual([
      ['q', 'go'],
      ['type', 'full_time'],
      ['category', 'design'],
    ]);
    expect(normalizeJobsQuery('junk')).toEqual(EMPTY_JOBS_QUERY);
    expect(Object.isFrozen(EMPTY_JOBS_QUERY.jobTypes)).toBe(true);
    const fresh = emptyJobsQuery();
    fresh.jobTypes.push('internship');
    expect(EMPTY_JOBS_QUERY.jobTypes).toEqual([]);
  });

  it('round-trips every schema-valid query exactly, in canonical form', () => {
    const cases: JobsQueryInput[] = [
      { locations: ['A', 'A', ' Austin '], cursor: ' abc ', minSalary: 0, h1b: false, hideApplied: false },
      { cursor: '', q: '', remote: ' us ' },
      { q: `${'a'.repeat(199)}\u{1F600}` },
      { q: `${'a'.repeat(150)}${'\u{1F600}'.repeat(30)}` },
    ];
    for (const input of cases) {
      const query = JobsQuerySchema.parse(input);
      expect(searchParamsToJobsQuery(reader(jobsQueryToSearchParams(query)))).toEqual(query);
      expect(searchParamsToJobsQuery(jobsQueryToQueryString(query))).toEqual(query);
    }
    expect(JobsQuerySchema.parse(cases[0]!)).toMatchObject({ locations: ['A', 'Austin'], cursor: 'abc' });
    expect(JobsQuerySchema.parse(cases[0]!).h1b).toBeUndefined();
    expect(JobsQuerySchema.parse(cases[1]!).remote).toBe('US');
  });

  it('never throws on garbage', () => {
    expect(searchParamsToJobsQuery(null)).toEqual(EMPTY_JOBS_QUERY);
    expect(searchParamsToJobsQuery(undefined)).toEqual(EMPTY_JOBS_QUERY);
    expect(searchParamsToJobsQuery('%E0%A4%A&q=%')).toMatchObject({ q: '%' });
    expect(jobsQueryToQueryString({ q: `a${String.fromCharCode(0xd83d)}b` })).toBe('q=ab');
  });

  it('never splits a location on its comma', () => {
    expect(searchParamsToJobsQuery(reader([['location', 'Toronto, ON, Canada']])).locations).toEqual([
      'Toronto, ON, Canada',
    ]);
  });
});

describe('filter counts', () => {
  it('counts the pills and all filters', () => {
    const query = JobsQuerySchema.parse(FULL);
    expect(jobFilterCounts(query)).toEqual({ location: 5, jobType: 2, experience: 2, category: 2, total: 22 });
    expect(hasJobFilters(EMPTY_JOBS_QUERY)).toBe(false);
    expect(hasJobFilters({ ...EMPTY_JOBS_QUERY, q: 'go' })).toBe(true);
  });

  it('picks the default job type from preferences', () => {
    expect(preferredJobType(['internship'])).toBe('internship');
    expect(preferredJobType(['internship', 'full_time'])).toBe('full_time');
    expect(preferredJobType([])).toBe('full_time');
  });
});
