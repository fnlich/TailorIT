import { describe, expect, it } from 'vitest';
import type { SkillLists } from '../match/facets';
import { ResumeAnalysisDataSchema, type ResumeAnalysisData } from './analysis';
import {
  analyzeBuiltResume,
  analyzeResumeText,
  fitResumeInput,
  mergeResumeAnalyses,
  resumeAnalysisInput,
} from './analyze';
import type { ResumeDocument } from './document';
import { normalizeResumeDocument } from './normalize';
import { monthIndex } from './years';

const LISTS: SkillLists = {
  hard: ['Go', 'Postgres', 'PostgreSQL', 'Kubernetes', 'Kafka', 'Python', 'React', 'Change Management', 'gRPC', 'AWS'],
  soft: [
    'Communication', 'Strong communication skills', 'Collaboration', 'Mentoring', 'Leadership', 'Change Management',
    'Calm change management', 'Planning', 'Teamwork',
  ],
};
const NOW = new Date('2026-10-22T12:00:00Z');

function built(overrides: Record<string, unknown> = {}): ResumeDocument {
  return normalizeResumeDocument({
    name: 'Jane Doe',
    title: 'Senior Backend Engineer',
    summary: 'Backend engineer with 12+ years of experience; mentoring and clear communication.',
    skills: ['postgres', 'Kubernetes', 'Rust'],
    softSkills: ['Strong communication skills', 'Change Management'],
    experience: [
      {
        title: 'Senior Backend Engineer',
        company: 'Northwind Payments',
        startDate: '02/2021',
        endDate: '',
        location: '',
        description: 'Go services on Kafka; led change management for the platform.',
        achievements: ['Cut p99 latency by 35% with gRPC'],
        skills: ['Go'],
      },
      {
        title: 'Software Engineer',
        company: 'Acme',
        startDate: '06/2016',
        endDate: '01/2021',
        location: '',
        description: 'Python APIs.',
        achievements: [],
        skills: [],
      },
    ],
    certifications: [{ name: 'CKA', issuer: 'CNCF', date: '2022' }],
    ...overrides,
  });
}

describe('analyzeBuiltResume', () => {
  const reading = analyzeBuiltResume(built(), LISTS);

  it('reads declared skills first (library spelling), then the skills its text names', () => {
    expect(reading.hardSkills).toEqual(['PostgreSQL', 'Kubernetes', 'Rust', 'Go', 'Kafka', 'gRPC', 'Python']);
  });

  it("keeps a skill the person filed as soft out of the hard skills, and lets the person's lists win", () => {
    expect(reading.hardSkills).not.toContain('Change Management');
    expect(reading.softSkills).toEqual(['Communication', 'Change Management', 'Mentoring']);
  });

  it('reads the headline first, then each role, and the certifications and industries', () => {
    expect(reading.keywords.roles).toEqual(['Senior Backend Engineer', 'Software Engineer']);
    expect(reading.keywords.certifications).toEqual(['Certified Kubernetes Administrator (CKA)']);
    expect(reading.keywords.domains).toEqual(['finance']);
  });

  it('reads the dates as written, an empty end on the most recent role as Present', () => {
    expect(reading.experience).toEqual([
      [monthIndex(2021, 2), null],
      [monthIndex(2016, 6), monthIndex(2021, 1)],
    ]);
    expect(reading.yearsStated).toBe(12);
    expect(reading.yearsStatedBasis).toBe('stated');
    expect(reading.personName).toBe('Jane Doe');
    expect(ResumeAnalysisDataSchema.safeParse(reading).success).toBe(true);
  });

  it("lets the editor's years field win", () => {
    const typed = analyzeBuiltResume(built({ totalYearsExperience: 7 }), LISTS);
    expect(typed).toMatchObject({ yearsStated: 7, yearsStatedBasis: 'field' });
  });

  it('gives no name or headline role when the resume has none', () => {
    const empty = analyzeBuiltResume(normalizeResumeDocument({ title: 'Professional' }), LISTS);
    expect(empty).toMatchObject({ personName: null, keywords: { roles: [] }, experience: [] });
    expect(ResumeAnalysisDataSchema.safeParse(empty).success).toBe(true);
  });
});

describe('resumeAnalysisInput', () => {
  it('never includes the custom title, so a rename keeps the hash', () => {
    const document = built();
    const named = { kind: 'built' as const, document, title: 'My resume' };
    const renamed = { kind: 'built' as const, document, title: 'Renamed for Stripe' };
    expect(resumeAnalysisInput(named)).toBe(resumeAnalysisInput(renamed));
    const upload = { kind: 'uploaded' as const, text: 'Jane Doe\nEngineer', title: 'a.pdf' };
    const renamedUpload = { ...upload, title: 'b.pdf' };
    expect(resumeAnalysisInput(upload)).toBe(resumeAnalysisInput(renamedUpload));
    expect(resumeAnalysisInput(upload)).toBe('Jane Doe\nEngineer');
  });

  it('changes with anything the reading uses', () => {
    const base = resumeAnalysisInput({ kind: 'built', document: built() });
    expect(resumeAnalysisInput({ kind: 'built', document: built({ name: 'Jane Q. Doe' }) })).not.toBe(base);
    expect(resumeAnalysisInput({ kind: 'built', document: built({ skills: ['Go'] }) })).not.toBe(base);
    expect(resumeAnalysisInput({ kind: 'built', document: built({ totalYearsExperience: 3 }) })).not.toBe(base);
    const moved = built();
    moved.experience[1]!.company = 'Globex';
    expect(resumeAnalysisInput({ kind: 'built', document: moved })).not.toBe(base);
  });
});

const UPLOAD = `JANE Q. DOE
Senior Backend Engineer
jane@example.com | (555) 123-4567 | Seattle, WA

SUMMARY
Backend engineer with 9+ years of experience building payments systems at fintech companies.

PROFESSIONAL EXPERIENCE
Senior Backend Engineer | Northwind Payments | Jan 2020 – Present
- Led migration of 40 services to Kubernetes and Go, working with the product manager
- Built inter-service communication with gRPC
Software Engineer
Acme Developer Tools
03/2016 - 12/2019
- Developed Python and PostgreSQL APIs; strong communication with product partners

EDUCATION
B.S. Computer Science, Cascadia Institute of Technology, 2012 – 2016

CERTIFICATIONS
CKA, AWS Certified Solutions Architect – Associate, CSM

SKILLS
Go, Python, Kubernetes, PostgreSQL, Leadership, Mentoring`;

describe('analyzeResumeText', () => {
  const reading = analyzeResumeText(UPLOAD, LISTS);

  it('reads the skills the text names', () => {
    expect(reading.hardSkills).toEqual(['Kubernetes', 'Go', 'Python', 'PostgreSQL', 'gRPC', 'AWS']);
    // "inter-service communication" is technical; "strong communication with product partners" is not.
    expect(reading.softSkills).toEqual(['Communication', 'Leadership', 'Mentoring']);
  });

  it('reads the headline, then the title by each date range, skipping bullets and company lines', () => {
    expect(reading.keywords.roles).toEqual(['Senior Backend Engineer', 'Software Engineer']);
  });

  it('reads certifications (ambiguous ones under their heading) and industries', () => {
    expect(reading.keywords.certifications).toEqual([
      'Certified Kubernetes Administrator (CKA)',
      'AWS Certified Solutions Architect',
      'Certified ScrumMaster (CSM)',
    ]);
    expect(reading.keywords.domains).toEqual(['finance']);
  });

  it('reads work dates under Experience, education left out, and the total its opening states', () => {
    expect(reading.experience).toEqual([
      [monthIndex(2020, 1), null],
      [monthIndex(2016, 3), monthIndex(2019, 12)],
    ]);
    expect(reading).toMatchObject({ yearsStated: 9, yearsStatedBasis: 'stated' });
    expect(ResumeAnalysisDataSchema.safeParse(reading).success).toBe(true);
  });

  it('reads the name an upload opens with, in title case when written in capitals', () => {
    expect(reading.personName).toBe('Jane Q. Doe');
    const name = (text: string) => analyzeResumeText(text, LISTS).personName;
    expect(name('Resume\nJane Doe\nEngineer')).toBe('Jane Doe');
    expect(name("JANE O'NEIL-SMITH\nEngineer")).toBe("Jane O'Neil-Smith");
    expect(name('Jane Doe, PMP | jane@example.com')).toBe('Jane Doe');
    expect(name('María José van der Berg')).toBe('María José van der Berg');
  });

  it('gives no name when unsure', () => {
    const name = (text: string) => analyzeResumeText(text, LISTS).personName;
    expect(name('Senior Software Engineer\nJane Doe')).toBeNull();
    expect(name('jane@example.com\nJane Doe')).toBeNull();
    expect(name('Jane\nDoe')).toBeNull();
    expect(name('PROFESSIONAL SUMMARY\nJane Doe')).toBeNull();
    expect(name('')).toBeNull();
  });

  it('never takes a bullet, a sentence or a company line for a role', () => {
    const roles = analyzeResumeText(
      ['Jane Doe', 'Experience', '- Led the platform with the product manager, 2019 - 2021', 'Acme Developer Tools, 2016 - 2019', 'Managed the design team 2014 - 2016'].join('\n'),
      LISTS,
    ).keywords.roles;
    expect(roles).toEqual([]);
  });
});

describe('mergeResumeAnalyses', () => {
  const rules: ResumeAnalysisData = {
    hardSkills: ['Go', 'Kubernetes'],
    softSkills: ['Communication'],
    keywords: { roles: ['Engineer'], certifications: ['CKA'], domains: ['finance'] },
    experience: [[monthIndex(2020, 1), null]],
    yearsStated: 5,
    yearsStatedBasis: 'stated',
    personName: null,
  };
  const ai: ResumeAnalysisData = {
    hardSkills: ['golang', 'Terraform'],
    softSkills: ['communication', 'Mentoring'],
    keywords: { roles: ['Senior Backend Engineer', 'Software Engineer'], certifications: ['CISSP'], domains: ['healthcare', 'finance'] },
    experience: [
      [monthIndex(2020, 1), null],
      [monthIndex(2015, 6), monthIndex(2019, 12)],
    ],
    yearsStated: 9,
    yearsStatedBasis: 'stated',
    personName: 'Jane Doe',
  };

  it("joins the lists (Claude's first), takes Claude's roles, dates, larger total and name", () => {
    expect(mergeResumeAnalyses(rules, ai)).toEqual({
      hardSkills: ['golang', 'Terraform', 'Kubernetes'],
      softSkills: ['communication', 'Mentoring'],
      keywords: {
        roles: ['Senior Backend Engineer', 'Software Engineer'],
        certifications: ['CISSP', 'CKA'],
        domains: ['healthcare', 'finance'],
      },
      experience: ai.experience,
      yearsStated: 9,
      yearsStatedBasis: 'stated',
      personName: 'Jane Doe',
    });
  });

  it("keeps the rules' reading where Claude found nothing, and without an AI reading", () => {
    const sparse = { ...ai, keywords: { ...ai.keywords, roles: [] }, experience: [], yearsStated: null, personName: null };
    expect(mergeResumeAnalyses(rules, sparse)).toMatchObject({
      keywords: { roles: ['Engineer'] },
      experience: rules.experience,
      yearsStated: 5,
      personName: null,
    });
    expect(mergeResumeAnalyses(rules, null)).toBe(rules);
    expect(mergeResumeAnalyses({ ...rules, yearsStated: 3, yearsStatedBasis: 'field' }, ai)).toMatchObject({
      yearsStated: 3,
      yearsStatedBasis: 'field',
    });
  });
});

describe('fitResumeInput', () => {
  it("reads a resume for the fit: today's years and whether its text could be read", () => {
    const reading = analyzeResumeText(UPLOAD, LISTS);
    const input = fitResumeInput({ id: 'r1', isDefault: true, editedAt: null, evidenceText: UPLOAD }, reading, NOW);
    expect(input).toMatchObject({ id: 'r1', readable: true, roles: reading.keywords.roles, yearsBasis: 'dates' });
    // Jan 2020 to Oct 2026 (82 months) and Mar 2016 to Dec 2019 (46): 128 months.
    expect(input.years).toBe(10.7);
    expect(fitResumeInput({ id: 'r2', isDefault: false, editedAt: null, evidenceText: 'too short' }, reading, NOW).readable).toBe(false);
  });
});
