import { emptyJobsQuery, normalizeJobsQuery, type JobsQuery } from '@tailorit/shared';
import { describe, expect, it } from 'vitest';
import { activeFilters, clearedQuery, minSalaryLabel, suggestedSearchName, toggled } from './filters';
import { cardAge, cardLocationLine, cardMetaLine, foundJobsLabel, jobLevelsOf, levelsLabel, placesOf, showMoreLabel } from './format';
import { jobHrefBuilder, jobShareUrl, jobsHref, queryKeyOf, readJobId, readJobsUrl } from './url';

// Work package J2: the Jobs page's pure helpers (address state, wording, filter chips).

const query = (input: Record<string, unknown> = {}): JobsQuery => normalizeJobsQuery(input);
const NOW = Date.parse('2026-10-22T12:00:00.000Z');

describe('address state', () => {
  it('reads the filters and the job from the URL, never the cursor', () => {
    const params = new URLSearchParams('jobId=42&q=engineer&type=full_time&type=internship&level=senior&sort=salary&cursor=abc');
    const state = readJobsUrl(params);
    expect(state.jobId).toBe(42);
    expect(state.query).toMatchObject({ q: 'engineer', jobTypes: ['full_time', 'internship'], levels: ['senior'], sort: 'salary' });
    expect(state.query.cursor).toBeUndefined();
    expect(readJobsUrl(null)).toEqual({ query: { ...emptyJobsQuery(), cursor: undefined }, jobId: null });
  });

  it('ignores unreadable job ids', () => {
    expect(readJobId('12')).toBe(12);
    for (const value of [null, '', '0', '-3', '1.5', 'abc', '9999999999999']) expect(readJobId(value)).toBeNull();
  });

  it('writes canonical addresses: equal states make equal URLs', () => {
    expect(jobsHref(query())).toBe('/jobs');
    expect(jobsHref(query({ q: ' sre ', jobTypes: ['full_time'] }), 7)).toBe('/jobs?jobId=7&q=sre&type=full_time');
    const a = jobsHref(query({ levels: ['senior', 'mid'], locations: ['Fremont, CA, USA'], remote: 'us', sort: 'posted' }));
    expect(a).toBe('/jobs?location=Fremont%2C+CA%2C+USA&remote=US&level=senior&level=mid&sort=posted');
    expect(readJobsUrl(new URL(a, 'http://x').searchParams).query).toEqual(
      query({ levels: ['senior', 'mid'], locations: ['Fremont, CA, USA'], remote: 'US', sort: 'posted' }),
    );
    expect(queryKeyOf(query({ jobTypes: ['contract'], cursor: 'x' }))).toBe('type=contract');
    const hrefOf = jobHrefBuilder(query({ q: 'sre', jobTypes: ['contract'] }));
    expect(hrefOf(9)).toBe(jobsHref(query({ q: 'sre', jobTypes: ['contract'] }), 9));
    expect(jobHrefBuilder(query())(3)).toBe('/jobs?jobId=3');
  });

  it('shares a link to one job', () => {
    expect(jobShareUrl('http://localhost:3100/', 5)).toBe('http://localhost:3100/jobs?jobId=5');
  });
});

describe('wording', () => {
  it('counts jobs like Simplify', () => {
    expect(foundJobsLabel(17480)).toBe('Found 17,480 jobs');
    expect(foundJobsLabel(1)).toBe('Found 1 job');
    expect(foundJobsLabel(0)).toBe('Found 0 jobs');
  });

  it('writes the card lines', () => {
    const job = {
      primaryLocation: 'Fremont, CA, USA',
      locationCount: 3,
      workArrangement: 'onsite' as const,
      salary: { min: 325000, max: 390000, currency: 'GBP', period: 'year' as const },
      postedAt: '2026-08-20T12:00:00.000Z',
      updatedAt: '2026-10-19T12:00:00.000Z',
    };
    expect(cardLocationLine(job)).toBe('Fremont, CA, USA + 2 more · In Person');
    expect(cardMetaLine(job, 'relevant', NOW)).toBe('£325k - £390k/yr · 2 months ago');
    expect(cardAge(job, 'updated', NOW)).toBe('Updated 3 days ago');
    expect(cardMetaLine({ ...job, salary: null }, 'posted', NOW)).toBe('2 months ago');
  });

  it('labels levels and places for the facts grid', () => {
    expect(levelsLabel(['senior', 'mid'])).toBe('Mid, Senior');
    expect(levelsLabel([])).toBe('');
    expect(jobLevelsOf([], { experienceLevels: ['junior'] })).toEqual(['junior']);
    expect(jobLevelsOf(['senior'], { experienceLevels: ['junior'] })).toEqual(['senior']);
    expect(
      placesOf('Fremont, CA, USA', [
        { raw: 'Fremont, CA', city: 'Fremont', region: 'CA', countryCode: 'US', isRemote: false },
        { raw: 'Remote - US', city: null, region: null, countryCode: 'US', isRemote: true },
        { raw: 'London', city: 'London', region: null, countryCode: 'GB', isRemote: false },
      ]),
    ).toEqual({ first: 'Fremont, CA, USA', others: ['Remote in USA', 'London, UK'] });
    expect(showMoreLabel(8, false)).toBe('Show 8 more');
    expect(showMoreLabel(8, true)).toBe('Show less');
  });
});

describe('filter chips', () => {
  it('lists every active filter with the change that removes it', () => {
    const current = query({
      q: 'sre',
      locations: ['Austin'],
      remote: 'CA',
      arrangements: ['remote'],
      jobTypes: ['full_time', 'contract'],
      levels: ['senior'],
      categories: ['devops-infrastructure'],
      subcategories: ['frontend'],
      minSalary: 120000,
      h1b: true,
      companySizes: ['11-50'],
      companies: ['9'],
      clearance: 'required',
      hideApplied: true,
      updatedWithin: 7,
    });
    const chips = activeFilters(current, new Map([['9', 'Voltaic']]));
    expect(chips.map((chip) => chip.label)).toEqual([
      '"sre"',
      'Austin',
      'Remote in Canada',
      'Remote',
      'Full-Time',
      'Contract',
      'Senior',
      'DevOps & Infrastructure',
      'Frontend',
      'Min $120k+/yr',
      'Sponsors H1B',
      '11-50 employees',
      'Voltaic',
      'Requires security clearance',
      'Hiding applied jobs',
      'Updated in the past week',
    ]);
    expect(chips.find((chip) => chip.label === 'Contract')?.remove).toEqual({ jobTypes: ['full_time'] });
    expect(chips.find((chip) => chip.key === 'minSalary')?.remove).toEqual({ minSalary: undefined, payPeriod: undefined });
    expect(activeFilters(query())).toEqual([]);
  });

  it('clears everything but the sort, toggles list values and names a saved search', () => {
    const cleared = clearedQuery(query({ q: 'x', jobTypes: ['contract'], sort: 'salary', hideApplied: true }));
    expect(normalizeJobsQuery(cleared)).toEqual(query({ sort: 'salary' }));
    expect(toggled(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(toggled(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggled(['a'], 'a', true)).toEqual(['a']);
    expect(minSalaryLabel(50, 'hour')).toBe('$50+/hr');
    expect(suggestedSearchName(query({ q: 'sre', jobTypes: ['full_time'], remote: 'US', levels: ['senior', 'expert'] }))).toBe(
      'sre, Remote in USA, Full-Time +2',
    );
    expect(suggestedSearchName(query())).toBe('My search');
  });
});
