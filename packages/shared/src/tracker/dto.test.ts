import { describe, expect, it } from 'vitest';
import {
  ApplicationDetailSchema,
  ApplicationListQuerySchema,
  BoardQuerySchema,
  BulkApplicationsBodySchema,
  CreateApplicationBodySchema,
  PatchApplicationBodySchema,
  RESUME_ZIP_MAX_APPLICATIONS,
  ResumeZipAcceptedSchema,
  ResumeZipBodySchema,
  ResumeZipBuildSchema,
  StatusChangeBodySchema,
  TrackerImportBodySchema,
  addedLabel,
  normalizeUrlInput,
  resumeZipFileName,
  trackerFilterChips,
} from './dto';
import { ResumeMatchListSchema } from './resumeMatch';

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

  it('keeps a left-out resumeId apart from an explicit none', () => {
    // Left out: TailorIT may link the best match. null or '': the person chose no resume.
    expect('resumeId' in CreateApplicationBodySchema.parse({ jobId: 7, status: 1 })).toBe(false);
    expect(CreateApplicationBodySchema.parse({ jobId: 7, status: 1, resumeId: null }).resumeId).toBeNull();
    expect(CreateApplicationBodySchema.parse({ jobId: 7, status: 1, resumeId: '' }).resumeId).toBe('');
    expect(CreateApplicationBodySchema.parse({ jobId: 7, resumeId: 'r1' }).resumeId).toBe('r1');
  });

  it('limits archiving to Saved applications only on request, and only for archiving', () => {
    expect(BulkApplicationsBodySchema.parse({ ids: ['a'], action: 'archive', onlySaved: true }).onlySaved).toBe(true);
    expect(BulkApplicationsBodySchema.parse({ ids: ['a'], action: 'archive' }).onlySaved).toBeUndefined();
    expect(issues(BulkApplicationsBodySchema.safeParse({ ids: ['a'], action: 'delete', onlySaved: true }))).toEqual([
      ['onlySaved', 'Only archiving can be limited to Saved jobs'],
    ]);
    const unarchive = { ids: ['a'], action: 'unarchive', onlySaved: false };
    expect(BulkApplicationsBodySchema.safeParse(unarchive).success).toBe(true);
  });
});

describe('the matched resume', () => {
  const detail = {
    id: 'a1',
    title: 'Backend Engineer',
    companyName: 'Acme',
    companyId: 3,
    logoUrl: null,
    location: 'Remote',
    employmentType: 'full_time',
    currentStatus: 1,
    events: [{ status: 1, occurredOn: '2026-10-22' }],
    favorite: false,
    archivedAt: null,
    trackedOn: '2026-10-22',
    jobId: 9,
    postingUrl: '',
    createdAt: '2026-10-22T12:00:00.000Z',
    updatedAt: '2026-10-22T12:00:00.000Z',
    descriptionHtml: '',
    salary: { min: null, max: null, currency: null, period: null },
    resumeId: 'r1',
    coverLetterId: null,
    notesHtml: '',
    questions: [],
  };

  it('says who chose an application resume, and whether TailorIT is still choosing', () => {
    expect(ApplicationDetailSchema.parse(detail)).toEqual(detail);
    const auto = ApplicationDetailSchema.parse({
      ...detail,
      resumeOrigin: 'auto',
      resumeMatchedAt: '2026-10-22T12:00:05.000Z',
      resumeMatchPending: false,
    });
    expect(auto).toMatchObject({ resumeOrigin: 'auto', resumeMatchedAt: '2026-10-22T12:00:05.000Z' });
    expect(ApplicationDetailSchema.parse({ ...detail, resumeId: null, resumeOrigin: null, resumeMatchPending: true }))
      .toMatchObject({ resumeOrigin: null, resumeMatchPending: true });
    expect(ApplicationDetailSchema.safeParse({ ...detail, resumeOrigin: 'match' }).success).toBe(false);
  });

  it('ranks the resumes with the Jobs card numbers beside an unrounded fit', () => {
    const item = {
      resumeId: 'r1',
      label: 'Backend',
      kind: 'uploaded',
      isDefault: false,
      fit: 72.4,
      matchedCount: 6,
      total: 10,
      percentage: 60,
      softMatched: 1,
      softTotal: 2,
      yearsExperience: 8,
      parts: { hard: 0.6, title: 1, years: 1, soft: 0.5, keywords: null },
      readable: true,
      refining: false,
    };
    const list = {
      applicationId: 'a1',
      basis: 'job',
      scored: true,
      requiredYears: 5,
      refining: false,
      chosen: { resumeId: 'r1', origin: 'auto', matchedAt: '2026-10-22T12:00:05.000Z' },
      items: [item],
    };
    expect(ResumeMatchListSchema.parse(list)).toEqual(list);
    const unchosen = { ...list, requiredYears: null, chosen: { resumeId: null, origin: null, matchedAt: null } };
    expect(ResumeMatchListSchema.parse(unchosen)).toMatchObject({ requiredYears: null });
    expect(ResumeMatchListSchema.safeParse({ ...list, items: [{ ...item, fit: 101 }] }).success).toBe(false);
    expect(ResumeMatchListSchema.safeParse({ ...list, items: [{ ...item, percentage: 60.5 }] }).success).toBe(false);
    // No stored score: the choice carries none.
    const scored = ResumeMatchListSchema.parse({ ...list, chosen: { ...list.chosen, score: 72 } });
    expect('score' in scored.chosen).toBe(false);
  });
});

describe('the resume ZIP', () => {
  it('builds the selected applications, or every Saved one', () => {
    expect(ResumeZipBodySchema.parse({})).toEqual({});
    expect(ResumeZipBodySchema.parse({ ids: ['a', 'b'], tzOffsetMinutes: -300 })).toEqual({
      ids: ['a', 'b'],
      tzOffsetMinutes: -300,
    });
    expect(issues(ResumeZipBodySchema.safeParse({ ids: [] }))).toEqual([
      ['ids', 'Choose at least one application, or send no ids for every Saved application.'],
    ]);
    const tooMany = Array.from({ length: RESUME_ZIP_MAX_APPLICATIONS + 1 }, (_, index) => `a${index}`);
    expect(issues(ResumeZipBodySchema.safeParse({ ids: tooMany }))).toEqual([
      ['ids', 'Choose at most 500 applications.'],
    ]);
    expect(ResumeZipBodySchema.safeParse({ ids: [7] }).success).toBe(false);
    expect(ResumeZipBodySchema.safeParse({ tzOffsetMinutes: 840 }).success).toBe(true);
    expect(ResumeZipBodySchema.safeParse({ tzOffsetMinutes: 841 }).success).toBe(false);
    expect(ResumeZipBodySchema.safeParse({ tzOffsetMinutes: 330.5 }).success).toBe(false);
  });

  it('reports a build as the page polls it', () => {
    expect(ResumeZipAcceptedSchema.parse({ buildId: 'b1' })).toEqual({ buildId: 'b1' });
    const counts = { included: 12, skipped: 2, word: 1, leftOut: 0, usedDefault: 3 };
    const building = {
      buildId: 'b1',
      status: 'building',
      done: 4,
      total: 14,
      counts,
      fileName: resumeZipFileName('2026-10-24'),
      error: null,
      expiresAt: null,
    };
    expect(ResumeZipBuildSchema.parse(building)).toEqual(building);
    expect(
      ResumeZipBuildSchema.parse({ ...building, status: 'failed', error: { code: 'internal', message: 'Try again.' } })
        .error,
    ).toEqual({ code: 'internal', message: 'Try again.' });
    expect(ResumeZipBuildSchema.safeParse({ ...building, status: 'queued' }).success).toBe(false);
    const { usedDefault: _usedDefault, ...withoutDefault } = counts;
    expect(ResumeZipBuildSchema.safeParse({ ...building, counts: withoutDefault }).success).toBe(false);
    expect(resumeZipFileName('2026-10-24')).toBe('TailorIT_Resumes_2026-10-24.zip');
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
