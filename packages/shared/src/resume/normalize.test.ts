import { describe, expect, it } from 'vitest';
import { ResumeDocumentSchema, type ResumeDocument } from './document';
import { documentForTemplate, emptyResumeDocument, normalizeResumeDocument, normalizeSkillsInput } from './normalize';

const base = (input: Record<string, unknown> = {}) => normalizeResumeDocument({ name: 'Jordan Chen', ...input });

describe('normalizeResumeDocument basics', () => {
  it('builds a complete, valid document from nothing', () => {
    const document = normalizeResumeDocument(undefined);
    expect(ResumeDocumentSchema.safeParse(document).success).toBe(true);
    expect(document).toMatchObject({
      name: '',
      title: '',
      preferredTemplate: '',
      resumeSettings: { technicalSkillsLayout: 'categorized', includeSoftSkills: false, includeStrengths: false },
      contact: { phone: '', email: '', location: '', linkedin: '', github: '', portfolio: '' },
      experience: [],
      skills: [],
      customSections: [],
    });
    expect(document.sectionOrder).toBeUndefined();
    expect(document.skillCategories).toBeUndefined();
  });

  it('trims strings and drops unknown fields (profile and tailoring ones included)', () => {
    const document = normalizeResumeDocument({
      name: '  Jordan  ',
      title: ' Engineer ',
      profileId: 'p1',
      ownerId: 'u1',
      matchKeywords: {},
      resumeSettings: { resumePromptId: 'tailor-resume', ai: { modelId: 'x' } },
    });
    expect(document.name).toBe('Jordan');
    expect(document.title).toBe('Engineer');
    expect(document).not.toHaveProperty('profileId');
    expect(document.resumeSettings).toEqual({
      technicalSkillsLayout: 'categorized',
      includeSoftSkills: false,
      includeStrengths: false,
    });
  });

  it('keeps stored values for omitted fields, replaces lists given, clears with []', () => {
    const stored = base({
      summary: 'Old summary',
      experience: [{ title: 'Engineer', company: 'Acme' }],
      projects: [{ name: 'Lakehouse' }],
      contact: { email: 'a@b.c', phone: '1' },
    });
    const next = normalizeResumeDocument(
      { summary: 'New', projects: [], experience: [{ title: 'Lead' }], contact: { phone: '2' } },
      stored,
    );
    expect(next.summary).toBe('New');
    expect(next.name).toBe('Jordan Chen');
    expect(next.projects).toEqual([]);
    expect(next.experience.map((entry) => entry.title)).toEqual(['Lead']);
    expect(next.contact.email).toBe('a@b.c');
    expect(next.contact.phone).toBe('2');
  });

  it('reads a list of the wrong shape as omitted', () => {
    const stored = base({ experience: [{ title: 'Engineer' }], softSkills: ['Grit'] });
    const next = normalizeResumeDocument({ experience: 'oops', softSkills: 'Grit, Care' }, stored);
    expect(next.experience).toEqual(stored.experience);
    expect(next.softSkills).toEqual(['Grit']);
  });

  it('keeps the stored text for null or non-string fields', () => {
    const stored = base({ summary: 'Kept' });
    expect(normalizeResumeDocument({ summary: null, title: 42 }, stored).summary).toBe('Kept');
  });
});

describe('entries', () => {
  it('drops non-objects and entries nothing names, per kind', () => {
    const document = base({
      experience: [{ title: '' }, 'junk', null, [], { company: 'Acme' }, { description: 'Did things' }],
      education: [{ startDate: '2020' }, { institution: 'MIT' }],
      projects: [{ link: 'x' }, { achievements: ['Built it'] }],
      languages: [{ proficiency: 'Fluent' }, { language: 'French' }],
      awards: [{ date: '2020' }, { issuer: 'ACM' }],
      publications: [{ publisher: 'VLDB' }, { title: 'On Lakes' }],
      volunteering: [{ location: 'NYC' }, { organization: 'Code Club' }],
      courses: [{ institution: 'Coursera' }, { name: 'ML' }],
      references: [{ email: 'x@y.z' }, { name: 'Ann' }],
      strengths: [{}, { title: 'Calm' }],
      certifications: [{ date: '2021' }, { issuer: 'AWS' }],
    });
    expect(document.experience.map((entry) => entry.company || entry.description)).toEqual(['Acme', 'Did things']);
    expect(document.education).toHaveLength(1);
    expect(document.projects).toHaveLength(1);
    expect(document.languages).toEqual([{ language: 'French', proficiency: '' }]);
    expect(document.awards).toHaveLength(1);
    expect(document.publications).toHaveLength(1);
    expect(document.volunteering).toHaveLength(1);
    expect(document.courses).toHaveLength(1);
    expect(document.references).toHaveLength(1);
    expect(document.strengths).toHaveLength(1);
    expect(document.certifications).toHaveLength(1);
  });

  it('normalizes bullets and skills used, and keeps optional fields only when filled', () => {
    const [entry] = base({
      experience: [{ title: 'Engineer', achievements: [' Shipped ', '', 3, 'Led'], skills: ['Go', 'go', ' Rust '] }],
    }).experience;
    expect(entry).toEqual({
      title: 'Engineer',
      company: '',
      startDate: '',
      endDate: '',
      location: '',
      description: '',
      achievements: ['Shipped', 'Led'],
      skills: ['Go', 'Rust'],
    });
    const [education] = base({ education: [{ degree: 'BS', gpa: ' 3.9 ', achievements: [] }] }).education;
    expect(education).toEqual({ degree: 'BS', institution: '', startDate: '', endDate: '', location: '', gpa: '3.9' });
    const [cert] = base({ certifications: [{ name: 'CKA', credentialId: '' }] }).certifications ?? [];
    expect(cert).toEqual({ name: 'CKA', issuer: '', date: '' });
  });

  it('caps every list at 50 entries', () => {
    const many = Array.from({ length: 60 }, (_, index) => ({ name: `Course ${index}` }));
    expect(base({ courses: many }).courses).toHaveLength(50);
    const roles = Array.from({ length: 55 }, (_, index) => ({ title: `Role ${index}` }));
    expect(base({ experience: roles }).experience).toHaveLength(50);
  });
});

describe('chips', () => {
  it('dedupes soft skills and interests case-insensitively, caps 50 x 100', () => {
    const long = 'x'.repeat(150);
    const document = base({
      softSkills: [' Calm ', 'calm', 'Clear   writing', '', 7, long],
      interests: Array.from({ length: 70 }, (_, index) => `Interest ${index}`),
    });
    expect(document.softSkills).toEqual(['Calm', 'Clear writing', 'x'.repeat(100)]);
    expect(document.interests).toHaveLength(50);
  });
});

describe('custom sections', () => {
  it('drops malformed or repeated keys, keeps titled empty sections, caps at 10', () => {
    const document = base({
      customSections: [
        { key: 'cs-00000001', title: 'Patents', entries: [{ heading: 'US 123' }, { location: 'x' }] },
        { key: 'cs-00000001', title: 'Duplicate', entries: [] },
        { key: 'Bad Key', title: 'Bad', entries: [] },
        { key: 'cs-00000002', title: '', entries: [] },
        { key: 'cs-00000003', title: 'Talks', entries: [] },
      ],
    });
    expect(document.customSections).toEqual([
      {
        key: 'cs-00000001',
        title: 'Patents',
        entries: [
          { heading: 'US 123', subheading: '', startDate: '', endDate: '', location: '', description: '', achievements: [] },
        ],
      },
      { key: 'cs-00000003', title: 'Talks', entries: [] },
    ]);
    const twelve = Array.from({ length: 12 }, (_, index) => ({ key: `cs-${index}`, title: `S${index}` }));
    expect(base({ customSections: twelve }).customSections).toHaveLength(10);
  });
});

describe('skills', () => {
  it('reads the four shapes', () => {
    expect(normalizeSkillsInput(['C#', 'Python'])).toEqual({ skills: ['C#', 'Python'], categories: [] });
    expect(normalizeSkillsInput({ Languages: ['C#'], Cloud: ['Vault'] })).toEqual({
      skills: ['C#', 'Vault'],
      categories: [
        { category: 'Languages', skills: ['C#'] },
        { category: 'Cloud', skills: ['Vault'] },
      ],
    });
    expect(normalizeSkillsInput([{ name: 'Languages', items: ['Go'] }])).toEqual({
      skills: ['Go'],
      categories: [{ category: 'Languages', skills: ['Go'] }],
    });
    expect(normalizeSkillsInput(['C#', { category: 'Cloud', skills: ['Vault'] }, { category: '', skills: ['Kafka'] }])).toEqual({
      skills: ['C#', 'Vault', 'Kafka'],
      categories: [{ category: 'Cloud', skills: ['Vault'] }],
    });
  });

  it('keeps every grouped skill in the flat list, flat order first', () => {
    const document = base({ skills: ['Rust', 'Go'], skillCategories: [{ category: 'Languages', skills: ['C#', 'go'] }] });
    expect(document.skills).toEqual(['Rust', 'Go', 'C#']);
    expect(document.skillCategories).toEqual([{ category: 'Languages', skills: ['C#', 'Go'] }]);
  });

  it('keeps both when neither is named, and clears the grouping when only a flat list is named', () => {
    const stored = base({ skills: [{ category: 'Languages', skills: ['C#', 'Python'] }] });
    expect(normalizeResumeDocument({ title: 'Engineer' }, stored).skillCategories).toEqual([
      { category: 'Languages', skills: ['C#', 'Python'] },
    ]);
    const flattened = normalizeResumeDocument({ skills: ['C#', 'Python'] }, stored);
    expect(flattened.skills).toEqual(['C#', 'Python']);
    expect(flattened.skillCategories).toBeUndefined();
  });

  it('regroups the stored flat list when only the grouping is named', () => {
    const stored = base({ skills: ['Go', 'Rust', 'AWS'] });
    const next = normalizeResumeDocument({ skillCategories: { Cloud: ['AWS'] } }, stored);
    expect(next.skills).toEqual(['Go', 'Rust', 'AWS']);
    expect(next.skillCategories).toEqual([{ category: 'Cloud', skills: ['AWS'] }]);
  });

  it('reads a wrong-shaped skills field as omitted', () => {
    const stored = base({ skills: ['C#', 'Python', 'Go'], skillCategories: [{ category: 'Languages', skills: ['Go'] }] });
    for (const junk of ['C#, Python', null, 42, true]) {
      const next = normalizeResumeDocument({ skills: junk, skillCategories: junk }, stored);
      expect(next.skills).toEqual(['C#', 'Python', 'Go']);
      expect(next.skillCategories).toEqual([{ category: 'Languages', skills: ['Go'] }]);
    }
  });

  it('stays fast on a huge skills list', () => {
    const started = Date.now();
    const many = Array.from({ length: 40_000 }, (_, index) => `Skill ${index}`);
    const document = base({ skills: many, skillCategories: [{ category: 'Big', skills: many }] });
    expect(document.skills).toHaveLength(100);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('merges a repeated heading and caps skills at 100', () => {
    expect(base({ skillCategories: [{ category: 'Cloud', skills: ['AWS'] }, { category: 'cloud', skills: ['GCP'] }] }).skillCategories).toEqual([
      { category: 'Cloud', skills: ['AWS', 'GCP'] },
    ]);
    const many = Array.from({ length: 120 }, (_, index) => `Skill ${index}`);
    expect(base({ skills: many }).skills).toHaveLength(100);
  });
});

describe('settings, years and order', () => {
  it('decides switches only from booleans and the layout only from valid values', () => {
    const stored = base({ resumeSettings: { technicalSkillsLayout: 'flat', includeSoftSkills: true } });
    expect(normalizeResumeDocument({ resumeSettings: { includeSoftSkills: 'yes', technicalSkillsLayout: 'grid' } }, stored).resumeSettings).toEqual({
      technicalSkillsLayout: 'flat',
      includeSoftSkills: true,
      includeStrengths: false,
    });
    expect(normalizeResumeDocument({ resumeSettings: { includeSoftSkills: false } }, stored).resumeSettings.includeSoftSkills).toBe(false);
  });

  it('reads years leniently, clears with null', () => {
    expect(base({ totalYearsExperience: '7.25' }).totalYearsExperience).toBe(7.3);
    const stored = base({ totalYearsExperience: 5 });
    expect(normalizeResumeDocument({ totalYearsExperience: 'lots' }, stored).totalYearsExperience).toBe(5);
    expect(normalizeResumeDocument({ totalYearsExperience: null }, stored).totalYearsExperience).toBeUndefined();
    expect(base({ totalYearsExperience: -1 }).totalYearsExperience).toBeUndefined();
    expect(normalizeResumeDocument({ totalYearsExperience: '   ' }, stored).totalYearsExperience).toBeUndefined();
    expect(normalizeResumeDocument({ totalYearsExperience: '0x10' }, stored).totalYearsExperience).toBe(5);
  });

  it('cleans the order, keeps the stored one when omitted, clears with []', () => {
    const stored = base({
      customSections: [{ key: 'cs-1', title: 'Talks' }],
      sectionOrder: ['skills', 'custom:cs-1', 'nope', 'skills'],
    });
    expect(stored.sectionOrder).toEqual(['skills', 'custom:cs-1']);
    expect(normalizeResumeDocument({ customSections: [] }, stored).sectionOrder).toEqual(['skills']);
    expect(normalizeResumeDocument({ sectionOrder: [] }, stored).sectionOrder).toBeUndefined();
    expect(normalizeResumeDocument({ sectionOrder: ['junk'] }, stored).sectionOrder).toBeUndefined();
  });
});

describe('helpers', () => {
  it('starts an empty document on a template and layout', () => {
    const document: ResumeDocument = emptyResumeDocument({ templateId: 'navy-rule', layout: 'flat' });
    expect(document.preferredTemplate).toBe('navy-rule');
    expect(document.resumeSettings.technicalSkillsLayout).toBe('flat');
  });

  it('turns off a switch the template cannot print', () => {
    const document = base({ resumeSettings: { includeSoftSkills: true, includeStrengths: true } });
    const drawn = documentForTemplate(document, { supportsSoftSkills: false, supportsStrengths: true });
    expect(drawn.resumeSettings).toMatchObject({ includeSoftSkills: false, includeStrengths: true });
    expect(documentForTemplate(document, { supportsSoftSkills: true, supportsStrengths: true })).toBe(document);
    expect(documentForTemplate(document, null)).toBe(document);
  });
});
