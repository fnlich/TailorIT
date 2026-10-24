import { describe, expect, it } from 'vitest';
import {
  JobAnalysisViewSchema,
  JobMatchResponseSchema,
  SAVE_ALL_LIMIT,
  SaveAllBodySchema,
  SaveAllPreviewSchema,
  SaveAllResponseSchema,
} from './dto';

const savedRef = (jobId: number) => ({ jobId, applicationId: `app-${jobId}`, resumeId: null, created: true });
const response = (count: number) => ({
  items: Array.from({ length: count }, (_, index) => savedRef(index + 1)),
  alreadyTracked: 2,
  remaining: 0,
  pendingMatches: 0,
  incomplete: false,
});

describe('Save all', () => {
  it('saves at most 100 jobs per click', () => {
    expect(SAVE_ALL_LIMIT).toBe(100);
    expect(SaveAllResponseSchema.safeParse(response(100)).success).toBe(true);
    expect(SaveAllResponseSchema.safeParse(response(101)).success).toBe(false);
    expect(SaveAllPreviewSchema.parse({ matched: 340, saveable: 250, willSave: 100 })).toEqual({
      matched: 340,
      saveable: 250,
      willSave: 100,
    });
    expect(SaveAllPreviewSchema.safeParse({ matched: 340, saveable: 250, willSave: 101 }).success).toBe(false);
  });

  it('reports the saved jobs with their resume, and how many matches are still being chosen', () => {
    const parsed = SaveAllResponseSchema.parse({
      ...response(0),
      items: [{ jobId: 7, applicationId: 'a7', resumeId: 'r1', created: false }, savedRef(8)],
      pendingMatches: 1,
    });
    expect(parsed.items.map((item) => item.resumeId)).toEqual(['r1', null]);
    expect(parsed.pendingMatches).toBe(1);
    const { pendingMatches: _missing, ...withoutPending } = response(1);
    expect(SaveAllResponseSchema.safeParse(withoutPending).success).toBe(false);
  });

  it("takes the browser's day as YYYY-MM-DD, or nothing", () => {
    expect(SaveAllBodySchema.parse({})).toEqual({});
    expect(SaveAllBodySchema.parse({ occurredOn: '2026-10-24' })).toEqual({ occurredOn: '2026-10-24' });
    const bad = SaveAllBodySchema.safeParse({ occurredOn: '2026-1-1' });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe('Use the format YYYY-MM-DD');
  });
});

describe('job analysis view', () => {
  const view = {
    source: 'ai',
    refining: false,
    requirements: ['5+ years of Go'],
    responsibilities: [],
    desired: [],
    keywords: { high: [{ term: 'Go', synonyms: ['Golang'] }], low: [] },
    experienceLevels: ['senior'],
    categoryId: null,
    subcategoryIds: [],
  };

  it('still reads answers without soft skills, terms and required years', () => {
    const parsed = JobAnalysisViewSchema.parse(view);
    expect(parsed).toEqual(view);
    expect('softSkills' in parsed).toBe(false);
  });

  it('reads soft skills, terms and the required years', () => {
    const parsed = JobAnalysisViewSchema.parse({
      ...view,
      softSkills: ['Communication', 'Ownership'],
      terms: { certifications: ['Certified Kubernetes Administrator'], domains: ['finance'] },
      requiredYears: 5,
    });
    expect(parsed).toMatchObject({ softSkills: ['Communication', 'Ownership'], requiredYears: 5 });
    expect(JobAnalysisViewSchema.parse({ ...view, requiredYears: null }).requiredYears).toBeNull();
    expect(JobAnalysisViewSchema.safeParse({ ...view, requiredYears: 31 }).success).toBe(false);
    expect(JobAnalysisViewSchema.safeParse({ ...view, requiredYears: 2.5 }).success).toBe(false);
    const tooManyDomains = { certifications: [], domains: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] };
    expect(JobAnalysisViewSchema.safeParse({ ...view, terms: tooManyDomains }).success).toBe(false);
  });
});

describe('job match', () => {
  const match = { state: 'ok', resumeId: 'r1', matched: [], missing: [], matchedCount: 0, total: 0, percentage: 0 };

  it('may say which resume it scored, and why that one', () => {
    expect(JobMatchResponseSchema.parse(match)).toEqual(match);
    expect(JobMatchResponseSchema.parse({ ...match, resumeLabel: 'Backend', resumeBasis: 'linked' })).toMatchObject({
      resumeLabel: 'Backend',
      resumeBasis: 'linked',
    });
    expect(JobMatchResponseSchema.parse({ ...match, resumeBasis: 'default' }).resumeBasis).toBe('default');
    expect(JobMatchResponseSchema.safeParse({ ...match, resumeBasis: 'best' }).success).toBe(false);
  });
});
