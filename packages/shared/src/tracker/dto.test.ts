import { describe, expect, it } from 'vitest';
import {
  ApplicationListQuerySchema,
  BoardQuerySchema,
  BulkApplicationsBodySchema,
  CreateApplicationBodySchema,
  PatchApplicationBodySchema,
  StatusChangeBodySchema,
  TrackerImportBodySchema,
  addedLabel,
  normalizeUrlInput,
  trackerFilterChips,
} from './dto';

const issues = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) =>
  result.error?.issues.map((issue) => [issue.path.join('.'), issue.message]) ?? [];

describe('tracker queries', () => {
  it('reads the list query from Express-style values', () => {
    expect(
      ApplicationListQuerySchema.parse({
        q: ' acme ',
        statuses: '2,12,99',
        jobType: 'internship',
        favorites: '1',
        from: '2026-10-01',
        until: 'yesterday',
        sort: 'title',
      }),
    ).toEqual({
      q: 'acme',
      statuses: [2, 12],
      jobType: 'internship',
      favorites: true,
      from: '2026-10-01',
      until: undefined,
      sort: 'title',
      order: 'desc',
      tab: 'active',
      cursor: undefined,
      limit: 25,
    });
  });

  it('defaults the board query and reads a column', () => {
    const query = BoardQuerySchema.parse({ status: '13', statuses: ['2', '11'] });
    expect(query.status).toBe(13);
    expect(query.statuses).toEqual([2, 11]);
    expect(query.sort).toBe('tracked');
    expect(BoardQuerySchema.parse({ status: '7' }).status).toBeUndefined();
  });
});

describe('application bodies', () => {
  it('requires title, company and job type without a job', () => {
    const result = CreateApplicationBodySchema.safeParse({ title: '  ' });
    expect(result.success).toBe(false);
    expect(issues(result)).toEqual([
      ['title', 'Required'],
      ['companyName', 'Required'],
      ['employmentType', 'Required'],
    ]);
  });

  it('accepts a job id alone, and normalizes the link', () => {
    expect(CreateApplicationBodySchema.parse({ jobId: 7, status: 1 })).toEqual({ jobId: 7, status: 1 });
    expect(
      CreateApplicationBodySchema.parse({
        title: 'Engineer',
        companyName: 'Acme',
        employmentType: 'full_time',
        postingUrl: 'acme.com/jobs/1',
      }).postingUrl,
    ).toBe('https://acme.com/jobs/1');
    expect(issues(CreateApplicationBodySchema.safeParse({ jobId: 7, postingUrl: 'not a url' }))).toEqual([
      ['postingUrl', 'Must be a valid url'],
    ]);
  });

  it('validates the salary pair and period', () => {
    expect(issues(PatchApplicationBodySchema.safeParse({ salaryMin: 100, salaryMax: 50 }))).toEqual([
      ['salaryMax', 'Max salary must be greater than min salary'],
    ]);
    expect(issues(PatchApplicationBodySchema.safeParse({ salaryMin: 100, salaryPeriod: null }))).toEqual([
      ['salaryPeriod', 'Please select a salary period'],
    ]);
    expect(PatchApplicationBodySchema.parse({ salaryCurrency: 'usd', favorite: true })).toEqual({
      salaryCurrency: 'USD',
      favorite: true,
    });
    expect(issues(PatchApplicationBodySchema.safeParse({ title: ' ' }))).toEqual([['title', 'Required']]);
  });

  it('checks status and bulk bodies', () => {
    expect(StatusChangeBodySchema.safeParse({ status: 3 }).success).toBe(false);
    expect(issues(BulkApplicationsBodySchema.safeParse({ ids: ['a'], action: 'status' }))).toEqual([
      ['status', 'Choose a status'],
    ]);
    expect(BulkApplicationsBodySchema.safeParse({ ids: [], action: 'archive' }).success).toBe(false);
    expect(TrackerImportBodySchema.parse({ rows: [{ title: 'x', companyName: 'y' }] }).statusMap).toEqual({});
  });

  it('normalizes url input', () => {
    expect(normalizeUrlInput('')).toBe('');
    expect(normalizeUrlInput('https://jobs.lever.co/acme/1')).toBe('https://jobs.lever.co/acme/1');
    expect(normalizeUrlInput('ftp://x.y')).toBeNull();
    expect(normalizeUrlInput('hello')).toBeNull();
  });
});

describe('labels', () => {
  it('prints the card footer', () => {
    expect(addedLabel('2026-10-22')).toBe('Added Oct 22');
  });

  it('lists active filter chips', () => {
    expect(
      trackerFilterChips({
        from: '2026-10-01',
        until: '2026-10-22',
        jobType: 'full_time',
        statuses: [2, 12],
        favorites: true,
        sort: 'tracked',
        order: 'desc',
      }).map((chip) => chip.label),
    ).toEqual(['From Oct 1', 'Until Oct 22', 'Full-Time', 'Applied', 'Interviewing', 'Favorites']);
    expect(trackerFilterChips({ sort: 'title', order: 'asc' }).map((chip) => chip.label)).toEqual([
      'Sort: title (asc)',
    ]);
  });
});
