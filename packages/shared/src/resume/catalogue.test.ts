import { describe, expect, it } from 'vitest';
import {
  CLASSIC_SECTION_KINDS,
  CUSTOM_SECTION_SPEC,
  DEFAULT_SECTION_KINDS,
  EXTRA_SECTION_KINDS,
  HARD_SKILL_CATEGORIES,
  SECTION_KINDS,
  SECTION_KIND_BY_ID,
  cleanSectionOrder,
  dateRange,
  effectiveSectionOrder,
  entrySummary,
  insertRelative,
  moveSection,
  newCustomSectionKey,
  parseSectionRef,
  presenceOf,
  sectionSortKey,
  sectionSpecOf,
  type SectionKind,
} from './catalogue';

const presence = (kinds: SectionKind[], customKeys: string[] = []) => ({ kinds, customKeys });

describe('section catalogue', () => {
  it('has the fifteen kinds in canonical order', () => {
    expect(SECTION_KINDS.map((kind) => kind.id)).toEqual([
      'summary',
      'strengths',
      'skills',
      'softSkills',
      'experience',
      'education',
      'certifications',
      'projects',
      'volunteering',
      'awards',
      'publications',
      'courses',
      'languages',
      'interests',
      'references',
    ]);
    expect(CLASSIC_SECTION_KINDS).toEqual(['summary', 'strengths', 'skills', 'softSkills', 'experience', 'education']);
    expect(EXTRA_SECTION_KINDS).toHaveLength(9);
    expect(DEFAULT_SECTION_KINDS).toEqual([...CLASSIC_SECTION_KINDS, 'certifications']);
  });

  it('carries the printed headings, labels and bullet kinds', () => {
    expect(SECTION_KIND_BY_ID.skills.heading).toBe('Technical Skills');
    expect(SECTION_KIND_BY_ID.softSkills.label).toBe('Soft skills');
    expect(SECTION_KIND_BY_ID.experience.aiKind).toBe('experience');
    expect(SECTION_KIND_BY_ID.projects.aiKind).toBe('project');
    expect(SECTION_KIND_BY_ID.volunteering.aiKind).toBe('volunteering');
    expect(SECTIONS_WITH_BULLETS()).toEqual(['experience', 'projects', 'volunteering']);
    expect(SECTION_KIND_BY_ID.experience.fields.map((field) => field.name)).toEqual([
      'title',
      'company',
      'startDate',
      'endDate',
      'location',
      'description',
    ]);
    expect(CUSTOM_SECTION_SPEC.fields[0]).toMatchObject({ name: 'heading', label: 'Heading' });
  });

  it('never mentions tailoring in its copy', () => {
    const copy = [...SECTION_KINDS, CUSTOM_SECTION_SPEC].flatMap((spec) => [spec.description, spec.blurb]).join(' ');
    expect(copy.toLowerCase()).not.toContain('tailor');
  });

  it('has the 17 library skill headings', () => {
    expect(HARD_SKILL_CATEGORIES).toHaveLength(17);
    expect(HARD_SKILL_CATEGORIES[0]).toBe('Languages');
    expect(HARD_SKILL_CATEGORIES.at(-1)).toBe('Mobile Development');
  });
});

function SECTIONS_WITH_BULLETS() {
  return SECTION_KINDS.filter((kind) => kind.hasBullets).map((kind) => kind.id);
}

describe('section refs', () => {
  it('parses kinds and custom refs strictly', () => {
    expect(parseSectionRef('projects')).toEqual({ kind: 'projects' });
    expect(parseSectionRef('custom:cs-1a2b3c4d')).toEqual({ kind: 'custom', key: 'cs-1a2b3c4d' });
    expect(parseSectionRef('custom:Bad Key')).toBeNull();
    expect(parseSectionRef(' projects')).toBeNull();
    expect(parseSectionRef(42)).toBeNull();
    expect(sectionSpecOf({ kind: 'custom', key: 'x' })).toBe(CUSTOM_SECTION_SPEC);
  });

  it('mints cs- keys and redraws on a collision', () => {
    const draws = [
      [0xab, 0xcd, 0xef, 0x01],
      [0x12, 0x34, 0x56, 0x78],
    ];
    const random = (bytes: Uint8Array, attempt: number) => bytes.set(draws[attempt]!);
    expect(newCustomSectionKey(random)).toBe('cs-abcdef01');
    expect(newCustomSectionKey(random, ['cs-abcdef01'])).toBe('cs-12345678');
    expect(newCustomSectionKey()).toMatch(/^cs-[0-9a-f]{8}$/);
  });
});

describe('presenceOf', () => {
  it('reads what has content', () => {
    expect(
      presenceOf({
        summary: '  ',
        skills: [],
        skillCategories: [{ category: 'Cloud', skills: ['AWS'] }],
        experience: [{}],
        projects: [],
        customSections: [{ key: 'cs-1' }, { key: 'cs-1' }, { key: 'BAD' }, null],
      }),
    ).toEqual(presence(['skills', 'experience'], ['cs-1']));
    expect(presenceOf({ summary: 'Hi' }).kinds).toEqual(['summary']);
  });
});

describe('cleanSectionOrder', () => {
  it('keeps valid refs once, custom refs only for known keys', () => {
    expect(cleanSectionOrder(['skills', 'bogus', 'skills', 'custom:cs-1', 'custom:cs-2', 7], ['cs-1'])).toEqual([
      'skills',
      'custom:cs-1',
    ]);
    expect(cleanSectionOrder('skills', [])).toEqual([]);
  });

  it('sorts unlisted sections after the listed ones in native order', () => {
    const stored = ['experience', 'summary'];
    expect(sectionSortKey('summary', stored, 0)).toBe(1);
    expect(sectionSortKey('education', stored, 3)).toBe(5);
  });
});

describe('effectiveSectionOrder', () => {
  const native = ['summary', 'experience', 'skills', 'education', 'strengths'];

  it('follows the template, then defaults and present kinds it lacks, then custom sections', () => {
    expect(effectiveSectionOrder(undefined, native, presence(['projects', 'experience'], ['cs-1']))).toEqual([
      'summary',
      'experience',
      'skills',
      'education',
      'strengths',
      'softSkills',
      'certifications',
      'projects',
      'custom:cs-1',
    ]);
  });

  it('uses the canonical order with no template', () => {
    expect(effectiveSectionOrder([], [], presence([]))).toEqual([...DEFAULT_SECTION_KINDS]);
  });

  it('puts a stored order first, keeping listed empty kinds, then fills in the rest', () => {
    expect(
      effectiveSectionOrder(['projects', 'skills', 'custom:cs-2'], native, presence(['languages'], ['cs-1', 'cs-2'])),
    ).toEqual([
      'projects',
      'skills',
      'custom:cs-2',
      'summary',
      'experience',
      'education',
      'strengths',
      'softSkills',
      'certifications',
      'languages',
      'custom:cs-1',
    ]);
  });

  it('treats a stored order of junk as no order', () => {
    expect(effectiveSectionOrder(['nope', 'custom:gone'], native, presence([]))).toEqual(
      effectiveSectionOrder(undefined, native, presence([])),
    );
  });
});

describe('rearranging and rows', () => {
  it('moves within bounds', () => {
    expect(moveSection(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveSection(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveSection(['a', 'b'], 'x', 1)).toEqual(['a', 'b']);
  });

  it('drops before or after a target', () => {
    expect(insertRelative(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
    expect(insertRelative(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
    expect(insertRelative(['a', 'b'], 'a', 'a', 'after')).toEqual(['a', 'b']);
  });

  it('summarises entries, with a stand-in for unnamed ones', () => {
    expect(
      entrySummary('experience', { title: 'Engineer', company: 'Acme', startDate: '2021', endDate: 'Present' }, 0),
    ).toEqual({ title: 'Engineer at Acme', meta: '2021 - Present', untitled: false });
    expect(entrySummary('projects', { role: 'Lead' }, 1)).toEqual({ title: 'Project 2', meta: 'Lead', untitled: true });
    expect(entrySummary('custom', { heading: 'Patent' }, 0).title).toBe('Patent');
    expect(dateRange(' 01/2020 ', '')).toBe('01/2020');
  });
});
