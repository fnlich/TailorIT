import { describe, expect, it } from 'vitest';
import {
  LINKED_RESUME_NOTE,
  industryLabels,
  jobFacetGroups,
  requiredExperienceText,
  scoredWithLine,
  scoredWithText,
} from './detail/facets';

// Work package WP8: what the job page shows of a job's analysis (facts grid, "Skills and keywords") and which resume
// the keyword card scored.

describe('required experience', () => {
  it('reads "Experience: N+ years" for the facts grid', () => {
    expect(requiredExperienceText(7)).toBe('Experience: 7+ years');
    expect(requiredExperienceText(1)).toBe('Experience: 1+ years');
    expect(requiredExperienceText(30)).toBe('Experience: 30+ years');
  });

  it('is hidden when the posting asks for no minimum', () => {
    expect(requiredExperienceText(null)).toBe('');
    expect(requiredExperienceText(undefined)).toBe('');
    // "0-2 years of experience": a minimum of nothing.
    expect(requiredExperienceText(0)).toBe('');
    expect(requiredExperienceText(Number.NaN)).toBe('');
    expect(requiredExperienceText(-3)).toBe('');
  });
});

describe('industries', () => {
  it('labels INDUSTRIES ids with the shared taxonomy, in order, once each', () => {
    expect(industryLabels(['finance', 'retail_ecommerce', 'finance', 'healthcare'])).toEqual([
      'Finance',
      'Retail & E-commerce',
      'Healthcare',
    ]);
  });

  it('leaves out unknown ids and the ones that say nothing about a posting', () => {
    expect(industryLabels(['technology', 'other', 'not_specified', 'fintech', '', 'insurance'])).toEqual(['Insurance']);
    expect(industryLabels(null)).toEqual([]);
    expect(industryLabels(undefined)).toEqual([]);
  });
});

describe('Skills and keywords', () => {
  it('lists soft skills, certifications and industries, in that order', () => {
    expect(
      jobFacetGroups({
        softSkills: ['Communication', 'Ownership'],
        terms: { certifications: ['AWS Certified Solutions Architect', 'CISSP'], domains: ['healthcare', 'insurance'] },
      }),
    ).toEqual([
      { key: 'softSkills', label: 'Soft skills', items: ['Communication', 'Ownership'] },
      { key: 'certifications', label: 'Certifications', items: ['AWS Certified Solutions Architect', 'CISSP'] },
      { key: 'industries', label: 'Industries', items: ['Healthcare', 'Insurance'] },
    ]);
  });

  it('shows only the groups that have something, each name once', () => {
    expect(
      jobFacetGroups({
        softSkills: [' Mentoring ', 'mentoring', '', 'Collaboration'],
        terms: { certifications: [], domains: ['technology'] },
      }),
    ).toEqual([{ key: 'softSkills', label: 'Soft skills', items: ['Mentoring', 'Collaboration'] }]);
    expect(jobFacetGroups({ softSkills: [], terms: { certifications: ['PMP'], domains: [] } })).toEqual([
      { key: 'certifications', label: 'Certifications', items: ['PMP'] },
    ]);
  });

  it('is empty when the analysis names none, is still loading, or is from before they were read', () => {
    expect(jobFacetGroups({ softSkills: [], terms: { certifications: [], domains: [] } })).toEqual([]);
    expect(jobFacetGroups({})).toEqual([]);
    expect(jobFacetGroups(undefined)).toEqual([]);
    expect(jobFacetGroups(null)).toEqual([]);
  });
});

describe('the resume the keyword card scored', () => {
  const match = { state: 'ok' as const, resumeLabel: 'Backend Resume' };

  it('names the default resume', () => {
    const line = scoredWithLine({ ...match, resumeBasis: 'default' });
    expect(line).toEqual({ lead: 'Scored with', label: 'Backend Resume', note: '' });
    expect(scoredWithText(line!)).toBe('Scored with Backend Resume');
    // An answer that does not say which of the two it scored reads as the default.
    expect(scoredWithText(scoredWithLine(match)!)).toBe('Scored with Backend Resume');
  });

  it('says when it is the resume linked to the saved job', () => {
    const line = scoredWithLine({ ...match, resumeLabel: ' Backend Resume ', resumeBasis: 'linked' });
    expect(line).toEqual({ lead: 'Scored with', label: 'Backend Resume', note: LINKED_RESUME_NOTE });
    expect(scoredWithText(line!)).toBe('Scored with Backend Resume (linked to this saved job)');
  });

  it('names nothing without a resume, or when the answer does not say which', () => {
    expect(scoredWithLine({ state: 'no_resume' })).toBeNull();
    expect(scoredWithLine({ state: 'no_resume', resumeLabel: 'Backend Resume', resumeBasis: 'default' })).toBeNull();
    expect(scoredWithLine({ state: 'ok' })).toBeNull();
    expect(scoredWithLine({ state: 'ok', resumeLabel: '  ', resumeBasis: 'linked' })).toBeNull();
    expect(scoredWithLine(null)).toBeNull();
    expect(scoredWithLine(undefined)).toBeNull();
  });

  it('keeps the copy free of em dashes', () => {
    const lines = [
      scoredWithText({ lead: 'Scored with', label: 'Backend Resume', note: LINKED_RESUME_NOTE }),
      requiredExperienceText(5),
      ...jobFacetGroups({ softSkills: ['Ownership'], terms: { certifications: ['PMP'], domains: ['finance'] } }).map(
        (group) => group.label,
      ),
    ];
    for (const line of lines) expect(line).not.toMatch(/—/);
  });
});
