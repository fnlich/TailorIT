import {
  emptyJobsQuery,
  normalizeJobsQuery,
  type JobsQuery,
  type SaveAllPreview,
  type SaveAllResponse,
} from '@tailorit/shared';
import { describe, expect, it } from 'vitest';
import { activeFilters, clearedQuery, minSalaryLabel, suggestedSearchName, toggled } from './filters';
import {
  SAVE_ALL_FAILED,
  SAVE_ALL_HINT,
  UNDO_SAVE_ALL_FAILED,
  cardAge,
  cardLocationLine,
  cardMetaLine,
  foundJobsLabel,
  jobLevelsOf,
  levelsLabel,
  nothingToSaveCopy,
  placesOf,
  saveAllConfirmCopy,
  saveAllResultCopy,
  saveAllUndoneCopy,
  showMoreLabel,
} from './format';
import { jobHrefBuilder, jobShareUrl, jobsHref, queryKeyOf, readJobId, readJobsUrl } from './url';

// Work package J2: the Jobs page's pure helpers (address state, wording, filter chips). WP7: Save all's wording.

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

describe('Save all wording', () => {
  const preview = (matched: number, saveable: number, willSave = Math.min(saveable, 100)): SaveAllPreview => ({ matched, saveable, willSave });
  const result = (saved: number, rest: Partial<Pick<SaveAllResponse, 'remaining' | 'incomplete'>> = {}) => ({
    items: Array.from({ length: saved }, (_, index) => ({ jobId: index + 1, applicationId: `a${index}`, resumeId: null, created: true })),
    remaining: rest.remaining ?? 0,
    incomplete: rest.incomplete ?? false,
  });

  it('asks "Save N jobs?" with where they go, the cap, and the matches that keep their status', () => {
    expect(saveAllConfirmCopy(preview(1, 1))).toEqual({
      title: 'Save 1 job?',
      description: 'It goes to your Job Tracker under Saved.',
      note: null,
      confirmLabel: 'Save 1 job',
      busyLabel: 'Saving...',
    });
    expect(saveAllConfirmCopy(preview(12, 12))).toEqual({
      title: 'Save 12 jobs?',
      description: 'They go to your Job Tracker under Saved.',
      note: null,
      confirmLabel: 'Save 12 jobs',
      busyLabel: 'Saving...',
    });
    // Matches already in the Job Tracker keep their status.
    expect(saveAllConfirmCopy(preview(5, 4)).note).toBe('1 matching job is already in your Job Tracker and keeps its status.');
    expect(saveAllConfirmCopy(preview(6, 4)).note).toBe('2 matching jobs are already in your Job Tracker and keep their status.');
    expect(saveAllConfirmCopy(preview(2101, 1)).note).toBe('2,100 matching jobs are already in your Job Tracker and keep their status.');
    // Over the cap: the first 100 of the jobs not saved yet, in the list's order.
    expect(saveAllConfirmCopy(preview(1480, 1250))).toEqual({
      title: 'Save 100 jobs?',
      description:
        "You can save up to 100 jobs at a time. These are the first 100 of 1,250 jobs you haven't saved, in the order the list shows them.",
      note: '230 matching jobs are already in your Job Tracker and keep their status.',
      confirmLabel: 'Save 100 jobs',
      busyLabel: 'Saving...',
    });
    // Exactly 100 is not over the cap.
    expect(saveAllConfirmCopy(preview(100, 100)).description).toBe('They go to your Job Tracker under Saved.');
    expect(saveAllConfirmCopy(preview(101, 101)).description).toBe(
      "You can save up to 100 jobs at a time. These are the first 100 of 101 jobs you haven't saved, in the order the list shows them.",
    );
  });

  it('says when there is nothing new to save', () => {
    expect(nothingToSaveCopy(0)).toEqual({ title: 'Nothing new to save', description: 'No jobs match these filters any more.' });
    expect(nothingToSaveCopy(1)).toEqual({ title: 'Nothing new to save', description: 'This job is already in your Job Tracker.' });
    expect(nothingToSaveCopy(1250)).toEqual({ title: 'Nothing new to save', description: 'All 1,250 jobs are already in your Job Tracker.' });
  });

  it('reports what one click saved, what is left, and a run that stopped part-way', () => {
    expect(saveAllResultCopy(result(1))).toEqual({ title: 'Saved 1 job', description: 'Find it in your Job Tracker under Saved.' });
    expect(saveAllResultCopy(result(12))).toEqual({ title: 'Saved 12 jobs', description: 'Find them in your Job Tracker under Saved.' });
    expect(saveAllResultCopy(result(100, { remaining: 1150 }))).toEqual({
      title: 'Saved 100 jobs',
      description: 'Find them in your Job Tracker under Saved. 1,150 more can be saved with Save all.',
    });
    expect(saveAllResultCopy(result(1, { remaining: 1 })).description).toBe(
      'Find it in your Job Tracker under Saved. 1 more can be saved with Save all.',
    );
    // Stopped part-way: trying again is what to do (it says so instead of the count left).
    expect(saveAllResultCopy(result(25, { remaining: 75, incomplete: true }))).toEqual({
      title: 'Saved 25 jobs',
      description: 'Find them in your Job Tracker under Saved. Some jobs could not be saved. Click Save all to try the rest.',
    });
    // Saved meanwhile (another tab): nothing new.
    expect(saveAllResultCopy(result(0, { remaining: 2 }))).toEqual({
      title: 'Nothing new to save',
      description: 'These jobs are already in your Job Tracker.',
    });
  });

  it('confirms an Undo', () => {
    expect(saveAllUndoneCopy(1)).toEqual({ title: 'Removed 1 job from saved jobs', description: 'It is archived in your Job Tracker.' });
    expect(saveAllUndoneCopy(1250)).toEqual({
      title: 'Removed 1,250 jobs from saved jobs',
      description: 'They are archived in your Job Tracker.',
    });
    expect(saveAllUndoneCopy(0)).toEqual({
      title: 'Nothing was removed from saved jobs',
      description: 'These jobs have moved past Saved in your Job Tracker.',
    });
  });

  it('names the button and its failures, and never uses an em dash', () => {
    expect(SAVE_ALL_HINT).toBe('Save the jobs that match your filters, up to 100 at a time');
    expect(SAVE_ALL_FAILED).toBe('The jobs could not be saved');
    expect(UNDO_SAVE_ALL_FAILED).toBe('The jobs could not be removed from saved jobs');
    const counts = [0, 1, 2, 99, 100, 101, 1250];
    const texts = [
      SAVE_ALL_HINT,
      SAVE_ALL_FAILED,
      UNDO_SAVE_ALL_FAILED,
      ...counts.flatMap((n) => Object.values(nothingToSaveCopy(n))),
      ...counts.flatMap((n) => Object.values(saveAllUndoneCopy(n))),
      ...counts.flatMap((n) => Object.values(saveAllConfirmCopy(preview(n + 3, n)))),
      ...counts.flatMap((n) => [false, true].flatMap((incomplete) => Object.values(saveAllResultCopy(result(n, { remaining: n, incomplete }))))),
    ].filter((text): text is string => typeof text === 'string');
    expect(texts.length).toBeGreaterThan(50);
    for (const text of texts) expect(text, text).not.toMatch(/[–—]/);
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
