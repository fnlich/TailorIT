import { describe, expect, it } from 'vitest';
import { STATUS, type ApplicationDetail, type ResumeMatchItem, type ResumeMatchList } from '@tailorit/shared';
import {
  BEST_MATCH,
  CHOSEN_BY_YOU,
  MATCH_PENDING_POLL_FOR_MS,
  MATCH_PENDING_POLL_MS,
  autoMatchedText,
  bestMatchId,
  createMatchPendingPoll,
  keywordNumbers,
  linkedResumeBadges,
  offersAutoMatch,
  pickerHint,
  plainOptions,
  rankedOptions,
  readResumeMatches,
  type ResumeMatchView,
} from './resumeMatches';

// The Documents tab's matched resume: who chose the linked resume, and the picker ranked by fit with the Jobs card's
// numbers. The fit only orders the list; what people read is "{matched} of {total} keywords · {percentage}%".

function item(resumeId: string, overrides: Partial<ResumeMatchItem> = {}): ResumeMatchItem {
  return {
    resumeId,
    label: `Resume ${resumeId}`,
    kind: 'built',
    isDefault: false,
    fit: 50,
    matchedCount: 3,
    total: 4,
    percentage: 75,
    softMatched: 0,
    softTotal: 0,
    yearsExperience: null,
    parts: { hard: 0.75, title: null, years: null, soft: null, keywords: null },
    readable: true,
    refining: false,
    ...overrides,
  };
}

function list(items: ResumeMatchItem[], overrides: Partial<ResumeMatchList> = {}): ResumeMatchList {
  return {
    applicationId: 'app-1',
    basis: 'job',
    scored: true,
    requiredYears: null,
    refining: false,
    chosen: { resumeId: null, origin: null, matchedAt: null },
    items,
    ...overrides,
  };
}

const view = (items: ResumeMatchItem[], overrides: Partial<ResumeMatchList> = {}): ResumeMatchView =>
  readResumeMatches(list(items, overrides))!;

type AutoMatchFields = Pick<
  ApplicationDetail,
  'jobId' | 'currentStatus' | 'archivedAt' | 'resumeId' | 'resumeOrigin' | 'resumeMatchPending'
>;

const savedJob = (overrides: Partial<AutoMatchFields> = {}): AutoMatchFields => ({
  jobId: 7,
  currentStatus: STATUS.saved,
  archivedAt: null,
  resumeId: null,
  resumeOrigin: null,
  resumeMatchPending: false,
  ...overrides,
});

describe('readResumeMatches', () => {
  it("reads the contract's answer in the server's order, each resume once", () => {
    const read = readResumeMatches(
      list(
        [
          item('backend', { label: '  Backend  ', fit: 81.4, matchedCount: 9, total: 12, percentage: 75 }),
          item('pastry', { label: '', isDefault: true, kind: 'uploaded', fit: 12, matchedCount: 0, total: 12, percentage: 0 }),
          item('backend', { label: 'Again', fit: 1 }),
        ],
        { basis: 'description' },
      ),
    );
    expect(read).toEqual({
      basis: 'description',
      scored: true,
      items: [
        { resumeId: 'backend', label: 'Backend', kind: 'built', isDefault: false, fit: 81.4, matchedCount: 9, total: 12, percentage: 75 },
        { resumeId: 'pastry', label: 'Untitled resume', kind: 'uploaded', isDefault: true, fit: 12, matchedCount: 0, total: 12, percentage: 0 },
      ],
    });
  });

  it('picks out what it can from an answer that differs from the contract', () => {
    const read = readResumeMatches({
      items: [
        { resumeId: 'a', label: 'Alpha', fit: 140, matchedCount: 7, total: 4, kind: 'pdf', extra: true },
        { id: 'b', title: 'Beta', matchedCount: 1, total: 3, isDefault: true, kind: 'uploaded' },
        { resumeId: 'c', fit: 'high', matchedCount: -2, total: 2.9, percentage: 101.6 },
        { label: 'no id' },
        'junk',
      ],
    });
    expect(read).toEqual({
      basis: 'job',
      scored: true,
      items: [
        { resumeId: 'a', label: 'Alpha', kind: 'built', isDefault: false, fit: 100, matchedCount: 4, total: 4, percentage: 100 },
        { resumeId: 'b', label: 'Beta', kind: 'uploaded', isDefault: true, fit: 0, matchedCount: 1, total: 3, percentage: 33 },
        { resumeId: 'c', label: 'Untitled resume', kind: 'built', isDefault: false, fit: 0, matchedCount: 0, total: 2, percentage: 100 },
      ],
    });
    // Without `scored`, a job that names keywords is one whose resumes have something to count.
    expect(readResumeMatches({ items: [{ resumeId: 'a', total: 0 }] })?.scored).toBe(false);
    expect(readResumeMatches({ items: [], scored: true, basis: 'description' })).toEqual({ basis: 'description', scored: true, items: [] });
  });

  it('gives null when there is no ranking to read', () => {
    for (const raw of [null, undefined, 'text', 42, [], {}, { items: 'none' }]) expect(readResumeMatches(raw)).toBeNull();
  });
});

describe('the numbers', () => {
  it("are the Jobs card's: matched of total keywords and the percentage", () => {
    expect(keywordNumbers({ matchedCount: 9, total: 12, percentage: 75 })).toBe('9 of 12 keywords · 75%');
    expect(keywordNumbers({ matchedCount: 0, total: 12, percentage: 0 })).toBe('0 of 12 keywords · 0%');
    expect(keywordNumbers({ matchedCount: 1, total: 1, percentage: 100 })).toBe('1 of 1 keyword · 100%');
    expect(keywordNumbers({ matchedCount: 0, total: 0, percentage: 0 })).toBeNull();
  });
});

describe('the ranked picker', () => {
  it('lists the resumes best first with their numbers, the top one tagged "Best match"', () => {
    const ranked = view([
      item('backend', { label: 'Backend', fit: 82, matchedCount: 9, total: 12, percentage: 75 }),
      item('pastry', { label: 'Pastry', isDefault: true, fit: 31, matchedCount: 0, total: 12, percentage: 0 }),
      item('copy', { label: 'Backend (AI copy)', fit: 90, matchedCount: 10, total: 12, percentage: 83 }),
    ]);
    // The server's order stands (an unedited AI copy comes last whatever its fit).
    expect(rankedOptions(ranked)).toEqual([
      { id: 'backend', label: 'Backend', isDefault: false, kind: 'built', best: true, numbers: '9 of 12 keywords · 75%' },
      { id: 'pastry', label: 'Pastry', isDefault: true, kind: 'built', best: false, numbers: '0 of 12 keywords · 0%' },
      { id: 'copy', label: 'Backend (AI copy)', isDefault: false, kind: 'built', best: false, numbers: '10 of 12 keywords · 83%' },
    ]);
    expect(bestMatchId(ranked)).toBe('backend');
  });

  it('tags no "Best match" when even the top resume fits the job not at all', () => {
    const nothing = view([
      item('a', { fit: 0, matchedCount: 0, total: 5, percentage: 0 }),
      item('b', { fit: 0, matchedCount: 0, total: 5, percentage: 0 }),
    ]);
    expect(bestMatchId(nothing)).toBeNull();
    expect(rankedOptions(nothing).map((option) => [option.best, option.numbers])).toEqual([
      [false, '0 of 5 keywords · 0%'],
      [false, '0 of 5 keywords · 0%'],
    ]);
  });

  it('is the plain list, with a hint, when the job names no keywords', () => {
    const unscored = view([item('a', { fit: 40, matchedCount: 0, total: 0, percentage: 0 }), item('b', { fit: 10, total: 0, matchedCount: 0, percentage: 0 })], {
      scored: false,
    });
    expect(rankedOptions(unscored).map((option) => [option.id, option.best, option.numbers])).toEqual([
      ['a', false, null],
      ['b', false, null],
    ]);
    expect(bestMatchId(unscored)).toBeNull();
    expect(pickerHint(unscored)).toBe("This job's posting names no keywords to compare your resumes with.");
    expect(pickerHint(view([item('a', { total: 0, matchedCount: 0, percentage: 0 })], { scored: false, basis: 'description' }))).toBe(
      'Add a job description in Overview to compare your resumes with this job.',
    );
  });

  it('gives no hint when the resumes carry numbers, or there is no ranking or no resume', () => {
    expect(pickerHint(view([item('a')]))).toBeNull();
    expect(pickerHint(null)).toBeNull();
    expect(pickerHint(view([], { scored: false }))).toBeNull();
  });

  it('falls back to the plain resume list as it is', () => {
    expect(
      plainOptions([
        { id: 'r1', label: 'One', isDefault: true, kind: 'built' },
        { id: 'r2', label: 'Two', isDefault: false, kind: 'uploaded' },
      ]),
    ).toEqual([
      { id: 'r1', label: 'One', isDefault: true, kind: 'built', best: false, numbers: null },
      { id: 'r2', label: 'Two', isDefault: false, kind: 'uploaded', best: false, numbers: null },
    ]);
  });
});

describe("the linked resume's badges", () => {
  const ranking = view([item('backend'), item('pastry', { fit: 10 })]);

  it('say who chose it, then what it is', () => {
    expect(linkedResumeBadges('auto', { isDefault: true, kind: 'built' }, ranking)).toEqual([
      { label: BEST_MATCH, tone: 'tint' },
      { label: 'Default', tone: 'outline' },
    ]);
    expect(linkedResumeBadges('user', { isDefault: false, kind: 'uploaded' }, ranking)).toEqual([
      { label: CHOSEN_BY_YOU, tone: 'outline' },
      { label: 'Uploaded', tone: 'outline' },
    ]);
    expect(linkedResumeBadges('user', { isDefault: false, kind: 'built' }, null)).toEqual([{ label: CHOSEN_BY_YOU, tone: 'outline' }]);
  });

  it('claim no choice for a link nobody chose (added by hand without touching the resume, or imported)', () => {
    expect(linkedResumeBadges(null, { isDefault: true, kind: 'built' }, ranking)).toEqual([{ label: 'Default', tone: 'outline' }]);
    expect(linkedResumeBadges(undefined, { isDefault: false, kind: 'built' }, ranking)).toEqual([]);
  });

  it('show "Best match" before the ranking is read, and not once it shows that nothing fits', () => {
    expect(linkedResumeBadges('auto', undefined, null)).toEqual([{ label: BEST_MATCH, tone: 'tint' }]);
    const nothing = view([item('a', { fit: 0 }), item('b', { fit: 0 })]);
    expect(linkedResumeBadges('auto', { isDefault: true, kind: 'built' }, nothing)).toEqual([{ label: 'Default', tone: 'outline' }]);
    // A job that names no keywords can still be fitted on its title: TailorIT's pick is still its best match.
    const unscored = view([item('a', { fit: 20, total: 0, matchedCount: 0, percentage: 0 })], { scored: false });
    expect(linkedResumeBadges('auto', undefined, unscored)).toEqual([{ label: BEST_MATCH, tone: 'tint' }]);
  });
});

describe('"Let TailorIT choose"', () => {
  it("is offered for a Saved job's application whose resume TailorIT did not choose", () => {
    expect(offersAutoMatch(savedJob(), 2)).toBe(true);
    expect(offersAutoMatch(savedJob({ resumeId: 'r1', resumeOrigin: 'user' }), 2)).toBe(true);
    expect(offersAutoMatch(savedJob({ resumeOrigin: 'user' }), 1)).toBe(true);
    expect(offersAutoMatch(savedJob({ resumeOrigin: 'auto' }), 1)).toBe(true);
  });

  it('is not offered when TailorIT chose, is choosing, or may not choose', () => {
    expect(offersAutoMatch(savedJob({ resumeId: 'r1', resumeOrigin: 'auto' }), 2)).toBe(false);
    expect(offersAutoMatch(savedJob({ resumeMatchPending: true }), 2)).toBe(false);
    expect(offersAutoMatch(savedJob(), 0)).toBe(false);
    expect(offersAutoMatch(savedJob({ jobId: null }), 2)).toBe(false);
    expect(offersAutoMatch(savedJob({ currentStatus: STATUS.applied, resumeOrigin: 'user', resumeId: 'r1' }), 2)).toBe(false);
    expect(offersAutoMatch(savedJob({ archivedAt: '2026-10-20T10:00:00.000Z' }), 2)).toBe(false);
  });

  it('says what it linked', () => {
    expect(autoMatchedText('r1', 'Backend Resume')).toBe('Best match linked: Backend Resume.');
    expect(autoMatchedText('r1', undefined)).toBe('Best match linked to this application.');
    expect(autoMatchedText(null, undefined)).toBe('Add a resume first, then TailorIT can pick one.');
  });
});

describe('reading the detail again while TailorIT is choosing', () => {
  it('polls while the choice is pending, for a minute at most, and starts over for another application', () => {
    const poll = createMatchPendingPoll();
    expect(poll.next('a', true, 1_000)).toBe(MATCH_PENDING_POLL_MS);
    expect(poll.next('a', true, 1_000 + MATCH_PENDING_POLL_FOR_MS - 1)).toBe(MATCH_PENDING_POLL_MS);
    expect(poll.next('a', true, 1_000 + MATCH_PENDING_POLL_FOR_MS)).toBe(false);
    expect(poll.next('b', true, 70_000)).toBe(MATCH_PENDING_POLL_MS);
    expect(poll.next('b', false, 71_000)).toBe(false);
    // A new wait after the choice landed is a new minute.
    expect(poll.next('b', true, 200_000)).toBe(MATCH_PENDING_POLL_MS);
    expect(poll.next('b', true, 200_000 + MATCH_PENDING_POLL_FOR_MS - 1)).toBe(MATCH_PENDING_POLL_MS);
  });
});

describe('copy', () => {
  it('never uses an em dash', () => {
    const ranking = view([item('a'), item('b', { fit: 0 })]);
    const texts = [
      BEST_MATCH,
      CHOSEN_BY_YOU,
      ...rankedOptions(ranking).flatMap((option) => [option.label, option.numbers ?? '']),
      pickerHint(view([item('a', { total: 0, matchedCount: 0, percentage: 0 })], { scored: false })) ?? '',
      pickerHint(view([item('a', { total: 0, matchedCount: 0, percentage: 0 })], { scored: false, basis: 'description' })) ?? '',
      autoMatchedText('a', 'Label'),
      autoMatchedText('a', undefined),
      autoMatchedText(null, undefined),
    ];
    for (const text of texts) expect(text).not.toMatch(/—/);
  });
});
