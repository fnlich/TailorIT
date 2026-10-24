import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analysisNote,
  analysisPending,
  analysisPollDelay,
  basisText,
  createPollClock,
  experienceText,
  fetchResumeAnalysis,
  industryNames,
  readResumeAnalysis,
} from './analysis';
import { readResumeList, resumeKeys, uploadResume } from './api';

const view = {
  resumeId: 'r1',
  source: 'ai' as const,
  refining: false,
  aiWaiting: false,
  aiFailed: false,
  hardSkills: ['React', 'TypeScript'],
  softSkills: ['Communication'],
  keywords: { roles: ['Senior Frontend Engineer'], certifications: ['AWS Certified Developer'], domains: ['finance'] },
  yearsExperience: 8.2,
  yearsBasis: 'dates' as const,
  analyzedAt: '2026-10-24T12:00:00.000Z',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('reading the answer', () => {
  it('takes an answer that follows the contract as it is', () => {
    expect(readResumeAnalysis(view)).toEqual(view);
  });

  it('picks out what it can from an answer that differs, and gives up without a resume id', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(
      readResumeAnalysis({ resumeId: 'r2', source: 'rules', refining: 'yes', hardSkills: ['Go', 3, ''], yearsExperience: 120, keywords: null }),
    ).toEqual({
      resumeId: 'r2',
      source: 'deterministic',
      refining: false,
      aiWaiting: false,
      aiFailed: false,
      hardSkills: ['Go'],
      softSkills: [],
      keywords: { roles: [], certifications: [], domains: [] },
      yearsExperience: null,
      yearsBasis: null,
      analyzedAt: '',
    });
    expect(readResumeAnalysis({ hardSkills: ['Go'] })).toBeNull();
  });

  it('treats a missing reading (404) as none, and lets other failures through', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'not_found', message: 'That resume was not found.' } }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchResumeAnalysis('r1')).resolves.toBeNull();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/api/resumes/r1/analysis');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'internal', message: 'It broke.' } }), { status: 500 })));
    await expect(fetchResumeAnalysis('r1')).rejects.toMatchObject({ status: 500, message: 'It broke.' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(view), { status: 200 })));
    await expect(fetchResumeAnalysis('r1')).resolves.toEqual(view);
  });

  it('keeps its query under the resumes, so a refresh of the resumes reads it again', () => {
    expect(resumeKeys.analysis('r1')).toEqual(['resumes', 'analysis', 'r1']);
    expect(resumeKeys.analysis('r1').slice(0, 1)).toEqual([...resumeKeys.all]);
  });

  it("reads the list's line leniently: kept when the answer has one, absent when it has none", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const row = { id: 'r1', kind: 'uploaded', label: 'CV', createdAt: '2026-10-20T00:00:00Z' };
    const [withReading, notRead, without] = readResumeList({
      items: [
        { ...row, analysis: { yearsExperience: 'x', hardSkills: ['Go', 1], softSkillCount: -2, refining: true } },
        { ...row, id: 'r2', analysis: null },
        { ...row, id: 'r3' },
      ],
    });
    expect(withReading?.analysis).toEqual({ yearsExperience: null, hardSkills: ['Go'], softSkillCount: 0, refining: true, aiWaiting: false });
    expect(notRead?.analysis).toBeNull();
    expect(without && 'analysis' in without).toBe(false);
  });

  it('hands on why an editable copy could not start, with the upload kept', async () => {
    const resume = { id: 'r9', kind: 'uploaded', label: 'CV', title: null, templateId: null, isDefault: false, fileKind: 'pdf', nameOnResume: '', createdAt: '2026-10-24T12:00:00.000Z', updatedAt: '2026-10-24T12:00:00.000Z', lastEditedAt: null };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ resume, taskId: null, copyError: 'The AI is busy.' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const answer = await uploadResume(new File(['%PDF'], 'CV.pdf', { type: 'application/pdf' }), { title: 'CV', parse: true });
    expect(answer).toMatchObject({ taskId: null, copyError: 'The AI is busy.', resume: { id: 'r9' } });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/api/resumes/upload?parse=1');
  });
});

describe('reading again while the AI reading is to come', () => {
  it('backs off from every 10 s to every 30 s and every minute, and stops after ten minutes', () => {
    expect(analysisPollDelay(0)).toBe(10_000);
    expect(analysisPollDelay(59_999)).toBe(10_000);
    expect(analysisPollDelay(60_000)).toBe(30_000);
    expect(analysisPollDelay(179_999)).toBe(30_000);
    expect(analysisPollDelay(180_000)).toBe(60_000);
    expect(analysisPollDelay(599_999)).toBe(60_000);
    expect(analysisPollDelay(600_000)).toBe(false);
  });

  it('counts from when the wait began, starts over once nothing is awaited or on reset', () => {
    const clock = createPollClock();
    expect(clock.next(false, 0)).toBe(false);
    expect(clock.next(true, 1_000)).toBe(10_000);
    expect(clock.next(true, 70_000)).toBe(30_000);
    expect(clock.next(true, 700_000)).toBe(false);
    expect(clock.next(true, 800_000)).toBe(false);
    clock.reset();
    expect(clock.next(true, 900_000)).toBe(10_000);
    expect(clock.next(false, 901_000)).toBe(false);
    expect(clock.next(true, 2_000_000)).toBe(10_000);
  });

  it('waits only while the AI reads it or it waits its turn', () => {
    expect(analysisPending(view)).toBe(false);
    expect(analysisPending({ ...view, refining: true })).toBe(true);
    expect(analysisPending({ ...view, aiWaiting: true })).toBe(true);
    expect(analysisPending(null)).toBe(false);
    expect(analysisPending(undefined)).toBe(false);
  });
});

describe('the words', () => {
  it('says the experience and where it comes from', () => {
    expect(experienceText(null)).toBe('Not found on this resume');
    expect(experienceText(0.4)).toBe('Less than a year');
    expect(experienceText(1.2)).toBe('About 1 year');
    expect(experienceText(1.5)).toBe('About 2 years');
    expect(experienceText(8.2)).toBe('About 8 years');
    expect(basisText('dates')).toBe('Added up from the dates of your roles.');
    expect(basisText('field')).toBe('From the years of experience you entered.');
    expect(basisText('stated')).toBe('From your summary.');
    expect(basisText(null)).toBeNull();
  });

  it('names industries and leaves out what it does not know', () => {
    expect(industryNames(['finance', 'retail_ecommerce', 'nope'])).toEqual(['Finance', 'Retail & E-commerce']);
  });

  it('says what the AI is doing, or how the reading was made', () => {
    expect(analysisNote({ ...view, refining: true, aiFailed: true })).toEqual({ kind: 'reading', text: 'Reading it with AI for a closer look...' });
    expect(analysisNote({ ...view, source: 'deterministic', aiWaiting: true }).text).toMatch(/^Waiting for the AI reading\./);
    expect(analysisNote({ ...view, source: 'deterministic', aiFailed: true }).text).toBe(
      'The AI reading did not work, so this is the quick reading.',
    );
    expect(analysisNote(view).kind).toBe('ai');
    expect(analysisNote({ ...view, source: 'deterministic' }).kind).toBe('quick');
  });

  it('never uses an em dash', () => {
    const texts = [
      analysisNote({ ...view, refining: true }).text,
      analysisNote({ ...view, aiWaiting: true }).text,
      analysisNote({ ...view, aiFailed: true }).text,
      analysisNote(view).text,
      analysisNote({ ...view, source: 'deterministic' }).text,
    ];
    const emDash = String.fromCharCode(0x2014);
    for (const text of texts) expect(text).not.toContain(emDash);
  });
});
