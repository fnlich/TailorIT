import { describe, expect, it } from 'vitest';
import {
  bestKnownYears,
  chooseResume,
  compareResumeFits,
  prepareFitJob,
  prepareFitResume,
  rankResumeFits,
  roleWords,
  scoreResumeFit,
  type FitJob,
  type FitResumeInput,
} from './fit';
import { matchKeywords } from './keywords';

const BACKEND_JOB: FitJob = {
  title: 'Backend Engineer',
  keywords: {
    high: [
      { term: 'Go', synonyms: ['Golang'] },
      { term: 'PostgreSQL', synonyms: [] },
      { term: 'Kubernetes', synonyms: [] },
    ],
    low: [{ term: 'Kafka', synonyms: [] }],
  },
  softSkills: ['Communication'],
  terms: { certifications: ['CKA'], domains: ['finance'] },
  requiredYears: 5,
};

function resume(id: string, overrides: Partial<FitResumeInput> = {}): FitResumeInput {
  return {
    id,
    isDefault: false,
    editedAt: '2026-10-01T00:00:00.000Z',
    evidenceText: 'A resume with enough words in it to be read, about fifty characters or more.',
    readable: true,
    hardSkills: [],
    softSkills: [],
    roles: [],
    certifications: [],
    domains: [],
    years: null,
    yearsBasis: null,
    ...overrides,
  };
}

const BACKEND = resume('backend', {
  evidenceText: 'Backend Engineer\nGo, PostgreSQL and Kubernetes services; clear communication with partners.',
  roles: ['Backend Engineer'],
  hardSkills: ['Go', 'PostgreSQL', 'Kubernetes'],
  softSkills: ['Communication'],
  certifications: ['CKA'],
  domains: ['finance'],
  years: 6,
  yearsBasis: 'dates',
});
const FRONTEND = resume('frontend', {
  evidenceText: 'Frontend Engineer\nReact, TypeScript and CSS for web apps; design systems and accessibility.',
  roles: ['Frontend Engineer'],
  hardSkills: ['React', 'TypeScript', 'CSS'],
  years: 6,
  yearsBasis: 'dates',
});

describe('roleWords', () => {
  it('reads the kind of role, weighting the head 2 ("engineer" 1) and other words 2 ("software" 1)', () => {
    expect(roleWords('Product Manager')).toEqual([
      { word: 'product', weight: 2 },
      { word: 'manager', weight: 2 },
    ]);
    expect(roleWords('Senior Software Engineer, Backend')).toEqual([
      { word: 'software', weight: 1 },
      { word: 'engineer', weight: 1 },
      { word: 'backend', weight: 2 },
    ]);
  });

  it('folds spellings, maps developers to engineers and drops level and noise words', () => {
    expect(roleWords('Sr. Front End Developer (Remote)')).toEqual([
      { word: 'frontend', weight: 2 },
      { word: 'engineer', weight: 1 },
    ]);
    expect(roleWords('Remote - Senior Machine Learning Engineer II')).toEqual([
      { word: 'ml', weight: 2 },
      { word: 'engineer', weight: 1 },
    ]);
    expect(roleWords('Staff Engineer, Payments Platform (Hybrid) at Acme')).toEqual([
      { word: 'engineer', weight: 1 },
      { word: 'payments', weight: 2 },
      { word: 'platform', weight: 2 },
    ]);
    expect(roleWords('')).toEqual([]);
  });
});

describe('scoreResumeFit', () => {
  it("weighs the parts the job makes applicable; the hard part is exactly the Jobs card's match", () => {
    const fit = scoreResumeFit(BACKEND_JOB, prepareFitResume(BACKEND));
    expect(fit.keywordMatch).toEqual(matchKeywords(BACKEND.evidenceText, BACKEND_JOB.keywords));
    expect(fit.keywordMatch).toMatchObject({ matchedCount: 3, total: 4, percentage: 75 });
    expect(fit.parts).toEqual({ hard: 0.75, title: 1, years: 1, soft: 1, keywords: 1 });
    expect(fit.fit).toBeCloseTo(87.5, 10);
    expect(fit.softMatched).toEqual(['Communication']);
  });

  it('leaves out a part the job gives nothing to compare, so it never counts', () => {
    const keywordsOnly: FitJob = { title: 'Sr.', keywords: BACKEND_JOB.keywords };
    const fit = scoreResumeFit(keywordsOnly, prepareFitResume(BACKEND));
    expect(fit.parts).toEqual({ hard: 0.75, title: null, years: null, soft: null, keywords: null });
    expect(fit.fit).toBeCloseTo(75, 10);
    const nothing = scoreResumeFit({ title: '', keywords: { high: [], low: [] } }, prepareFitResume(BACKEND));
    expect(nothing.fit).toBe(0);
    expect(nothing.keywordMatch).toEqual({ matched: [], missing: [], matchedCount: 0, total: 0, percentage: 0 });
  });

  it("scores unknown years with the person's best known years", () => {
    const unknown = prepareFitResume(resume('unknown', { roles: ['Backend Engineer'] }));
    const withBest = scoreResumeFit(BACKEND_JOB, unknown, { bestKnownYears: 6 });
    expect(withBest.parts.years).toBe(1);
    expect(withBest.years).toBeNull();
    expect(scoreResumeFit(BACKEND_JOB, unknown, { bestKnownYears: 2.5 }).parts.years).toBeCloseTo(0.5, 10);
    expect(scoreResumeFit(BACKEND_JOB, unknown).parts.years).toBe(0.5);
    const ranked = rankResumeFits(BACKEND_JOB, [unknown, prepareFitResume(BACKEND)]);
    expect(ranked.find((fit) => fit.resumeId === 'unknown')?.parts.years).toBe(1);
  });

  it('counts only dates and the editor field as known years', () => {
    expect(bestKnownYears([{ readable: true, years: 12, yearsBasis: 'stated' }])).toBeNull();
    expect(
      bestKnownYears([
        { readable: true, years: 4, yearsBasis: 'dates' },
        { readable: true, years: 9, yearsBasis: 'field' },
        { readable: false, years: 20, yearsBasis: 'dates' },
      ]),
    ).toBe(9);
  });

  it('reads role words from the first lines when a resume lists no roles, never below 0.25', () => {
    const derived = prepareFitResume(resume('derived', { evidenceText: 'Jane Doe\nSenior Backend Engineer\nGo and PostgreSQL services' }));
    expect(derived.derivedRoles).toBe(true);
    expect(scoreResumeFit(BACKEND_JOB, derived).parts.title).toBe(1);
    const unknown = prepareFitResume(resume('unknown', { evidenceText: 'Jane Doe\nPastry chef with a love of sourdough baking.' }));
    expect(scoreResumeFit(BACKEND_JOB, unknown).parts.title).toBe(0.25);
    const otherField = prepareFitResume(resume('chef', { roles: ['Pastry Chef'] }));
    expect(scoreResumeFit(BACKEND_JOB, otherField).parts.title).toBe(0);
  });

  it('weighs the headline over older roles, with category floors', () => {
    const headlineMatch = prepareFitResume(resume('a', { roles: ['Backend Engineer', 'Data Analyst'] }));
    const oldRoleMatch = prepareFitResume(resume('b', { roles: ['Data Analyst', 'Backend Engineer'] }));
    expect(scoreResumeFit(BACKEND_JOB, headlineMatch).parts.title).toBe(1);
    // 0.6 x 0 + 0.4 x 1 = 0.4, raised to 0.8 because a role shares the job's subcategory (backend).
    expect(scoreResumeFit(BACKEND_JOB, oldRoleMatch).parts.title).toBe(0.8);
    const sameCategory = prepareFitResume(resume('c', { roles: ['Frontend Engineer'] }));
    expect(scoreResumeFit(BACKEND_JOB, sameCategory).parts.title).toBe(0.5);
  });

  it('counts certifications by key or in the text, and industries by id (the company industry included)', () => {
    const job: FitJob = {
      title: 'Solutions Engineer',
      keywords: { high: [], low: [] },
      terms: { certifications: ['AWS Certified Solutions Architect', 'PMP'], domains: ['healthcare'] },
      industry: 'FinTech',
    };
    const holder = prepareFitResume(
      resume('holder', { evidenceText: 'AWS Solutions Architect Professional since 2021, building payment systems', domains: ['finance'] }),
    );
    expect(scoreResumeFit(job, holder).parts.keywords).toBeCloseTo(2 / 4, 10);
    expect(prepareFitJob(job).domains).toEqual(['healthcare', 'finance']);
  });

  it('matches soft skills by name or in the text', () => {
    const job: FitJob = { title: 'x', keywords: { high: [], low: [] }, softSkills: ['Communication', 'Mentoring', 'Negotiation'] };
    const fit = scoreResumeFit(job, prepareFitResume(resume('r', { softSkills: ['communication'], evidenceText: 'Mentoring new hires every quarter, and much more.' })));
    expect(fit.softMatched).toEqual(['Communication', 'Mentoring']);
    expect(fit.softMissing).toEqual(['Negotiation']);
    expect(fit.parts.soft).toBeCloseTo(2 / 3, 10);
  });
});

describe('rankResumeFits', () => {
  it('picks the backend resume for a backend job', () => {
    const ranked = rankResumeFits(BACKEND_JOB, [prepareFitResume(FRONTEND), prepareFitResume(BACKEND)]);
    expect(ranked.map((fit) => fit.resumeId)).toEqual(['backend', 'frontend']);
    expect(ranked[1]!.fit).toBeCloseTo(25, 10);
    expect(chooseResume(ranked)).toEqual({ resumeId: 'backend', fit: ranked[0]!.fit, reason: 'best' });
  });

  it('ranks on the unrounded fit', () => {
    const job: FitJob = {
      title: 'x',
      keywords: { high: Array.from({ length: 300 }, (_, index) => ({ term: `term${index}`, synonyms: [] })), low: [] },
    };
    const words = (count: number) => Array.from({ length: count }, (_, index) => `term${index}`).join(' ');
    // 151 and 152 of 300 both round to 50%: the fit still tells them apart.
    const a = prepareFitResume(resume('a', { evidenceText: words(151), isDefault: true }));
    const b = prepareFitResume(resume('b', { evidenceText: words(152) }));
    const ranked = rankResumeFits(job, [a, b]);
    expect(ranked.map((fit) => fit.keywordMatch.percentage)).toEqual([51, 50]);
    expect(ranked[0]!.resumeId).toBe('b');
  });

  it('breaks ties by the default resume, then precision, then the newer edit, then the id', () => {
    const base = { evidenceText: BACKEND.evidenceText, roles: ['Backend Engineer'], years: 6, yearsBasis: 'dates' as const };
    const inputs = [
      resume('z-old', { ...base, editedAt: '2026-01-01T00:00:00.000Z', hardSkills: ['Go'] }),
      resume('y-new', { ...base, editedAt: '2026-09-01T00:00:00.000Z', hardSkills: ['Go'] }),
      resume('a-same', { ...base, editedAt: '2026-01-01T00:00:00.000Z', hardSkills: ['Go'] }),
      resume('broad', { ...base, editedAt: '2026-10-20T00:00:00.000Z', hardSkills: ['Go', 'Java', 'PHP', 'Ruby'] }),
      resume('default', { ...base, editedAt: '2020-01-01T00:00:00.000Z', isDefault: true, hardSkills: ['Java'] }),
    ];
    const expected = ['default', 'y-new', 'a-same', 'z-old', 'broad'];
    const prepared = inputs.map((input) => prepareFitResume(input));
    expect(rankResumeFits(BACKEND_JOB, prepared).map((fit) => fit.resumeId)).toEqual(expected);
    // The order never depends on the order the resumes come in.
    for (const order of [[4, 3, 2, 1, 0], [2, 0, 4, 1, 3], [1, 4, 0, 3, 2]]) {
      const shuffled = order.map((index) => prepared[index]!);
      expect(rankResumeFits(BACKEND_JOB, shuffled).map((fit) => fit.resumeId)).toEqual(expected);
    }
    const ranked = rankResumeFits(BACKEND_JOB, prepared);
    expect(ranked[0]!.fit).toBe(ranked[1]!.fit);
    expect(ranked.find((fit) => fit.resumeId === 'broad')!.precision).toBeCloseTo(1 / 4, 10);
    expect(chooseResume(ranked).reason).toBe('tie');
  });

  it('puts unreadable resumes last whatever their fit', () => {
    const unreadable = prepareFitResume({ ...BACKEND, id: 'unreadable', readable: false, isDefault: true });
    const ranked = rankResumeFits(BACKEND_JOB, [unreadable, prepareFitResume(FRONTEND)]);
    expect(ranked.map((fit) => fit.resumeId)).toEqual(['frontend', 'unreadable']);
    expect(ranked[1]!.fit).toBeGreaterThan(ranked[0]!.fit);
    expect(compareResumeFits(ranked[0]!, ranked[1]!)).toBeLessThan(0);
  });

  it('names why it chose', () => {
    expect(chooseResume([])).toEqual({ resumeId: null, fit: null, reason: 'none' });
    const only = rankResumeFits(BACKEND_JOB, [prepareFitResume(BACKEND)]);
    expect(chooseResume(only).reason).toBe('only');
  });
});
