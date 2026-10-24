import { describe, expect, it } from 'vitest';
import { extractJobFacets, facetText, type SkillLists } from './facets';

const LISTS: SkillLists = {
  hard: ['Kubernetes', 'Go', 'Change Management', 'Sprint Planning'],
  soft: ['Communication', 'Strong communication skills', 'Collaboration', 'Belonging', 'Planning', 'Mentoring', 'Change Management'],
};

const POSTING = [
  'About us: a fintech where belonging matters. We offer visa sponsorship.',
  'Requirements',
  '- 5+ years of backend experience in Go and Kubernetes',
  '- Strong communication skills',
  '- CKA certification preferred',
  'Benefits: medical, dental and vision; we celebrate belonging.',
].join('\n');

describe('extractJobFacets', () => {
  it("reads the posting's sections when it has them, so about-us and benefits text stays out", () => {
    const facets = extractJobFacets(
      {
        text: POSTING,
        title: 'Backend Engineer, Healthcare Platform',
        sections: {
          requirements: ['5+ years of backend experience in Go and Kubernetes', 'Strong communication skills', 'CKA certification preferred'],
          responsibilities: ['Mentoring engineers across teams', 'Planning'],
          desired: [],
        },
      },
      LISTS,
    );
    expect(facets.softSkills).toEqual(['Communication', 'Mentoring', 'Planning']);
    expect(facets.terms.certifications).toEqual(['Certified Kubernetes Administrator (CKA)']);
    // The title's industry counts; the about-us "fintech" is outside the sections.
    expect(facets.terms.domains).toEqual(['healthcare']);
  });

  it('reads the whole text when there are no sections', () => {
    const facets = extractJobFacets({ text: POSTING, sections: { requirements: [], responsibilities: [], desired: [] } }, LISTS);
    expect(facets.softSkills).toEqual(['Communication']);
    expect(facets.terms.certifications).toEqual(['Certified Kubernetes Administrator (CKA)']);
    expect(facets.terms.domains).toEqual(['finance']);
  });

  it('never reports a hard/soft overlap as soft', () => {
    const facets = extractJobFacets({ text: 'Lead change management and collaboration.' }, LISTS);
    expect(facets.softSkills).toEqual(['Collaboration']);
  });

  it('caps soft skills at 15, certifications at 8 and industries at 4', () => {
    const many = Array.from({ length: 30 }, (_, index) => `Skill${index}`);
    const facets = extractJobFacets(
      { text: `${many.join(', ')}\nCKA CKAD CKS CISSP CISM CEH OSCP CCSP CRISC GSEC\nfintech healthcare retail telecom logistics` },
      { hard: [], soft: many },
    );
    expect(facets.softSkills).toHaveLength(15);
    expect(facets.terms.certifications).toHaveLength(8);
    expect(facets.terms.domains).toHaveLength(4);
  });

  it('joins the section items one a line', () => {
    expect(facetText({ text: 'ignored', sections: { requirements: ['  Go  '], desired: ['Rust'] } })).toBe('Go\nRust');
    expect(facetText({ text: 'whole text', sections: null })).toBe('whole text');
  });
});
