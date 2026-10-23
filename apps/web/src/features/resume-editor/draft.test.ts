import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SECTION_KINDS,
  effectiveSectionOrder,
  normalizeResumeDocument,
  presenceOf,
  type ResumeDocument,
} from '@tailorit/shared/resume';
import {
  addCustomSection,
  addRoleSkill,
  addSectionKind,
  addTechnicalSkill,
  appendEntry,
  buildSkillCategories,
  bulletsRequestFor,
  draftForNewResume,
  draftFromDocument,
  draftToDocument,
  drawnTemplate,
  emptyEntry,
  entryCount,
  entryListOf,
  findEntry,
  headingOf,
  headingOptions,
  interestRefusal,
  isBlankEntry,
  keptCount,
  librarySpelling,
  missingEndDateCount,
  missingEndDateHint,
  parseYears,
  readSkillCategoryMap,
  removeEntry,
  removeSection,
  removeSectionQuestion,
  removeTechnicalSkill,
  renameCustomSection,
  replaceEntry,
  sectionMeta,
  sectionSourceOf,
  setSkillHeading,
  softSkillRefusal,
  technicalSkillRefusal,
  templatePrintsRef,
  type DraftExperience,
} from './draft';

const stored: ResumeDocument = normalizeResumeDocument({
  name: 'Ann Lee',
  title: 'Staff Engineer',
  totalYearsExperience: 9,
  preferredTemplate: 'navy-rule',
  resumeSettings: { technicalSkillsLayout: 'flat', includeSoftSkills: true, includeStrengths: false },
  contact: { email: 'ann@example.com', phone: '555', location: 'Austin, TX', linkedin: 'linkedin.com/in/ann' },
  summary: 'Builds payment systems.',
  experience: [
    {
      title: 'Staff Engineer',
      company: 'Northwind',
      startDate: '01/2020',
      endDate: 'Present',
      location: 'Remote',
      description: 'Payments.',
      achievements: ['Cut costs 30%', 'Led 5 engineers'],
      skills: ['Go'],
    },
  ],
  education: [{ degree: 'B.S.', institution: 'UT', startDate: '2010', endDate: '2014', location: '', gpa: '3.9' }],
  skills: ['Go', 'Kafka', 'constructor'],
  skillCategories: [{ category: 'Languages', skills: ['Go'] }],
  softSkills: ['Mentoring'],
  customSections: [{ key: 'cs-0a0b0c0d', title: 'Patents', entries: [{ heading: 'US 1', achievements: ['Filed'] }] }],
  sectionOrder: ['experience', 'summary'],
});

describe('draftFromDocument / draftToDocument', () => {
  it('reads a stored document into rows with keys, bullet text and one heading per skill', () => {
    const draft = draftFromDocument(stored);
    expect(draft.totalYearsExperience).toBe('9');
    expect(draft.experience[0]?.achievementsText).toBe('Cut costs 30%\nLed 5 engineers');
    expect(draft.experience[0]?.key).toMatch(/^row-\d+$/);
    expect(draft.skillCategoryBySkill).toEqual({ Go: 'Languages' });
    expect(draft.sectionOrder).toEqual(['experience', 'summary']);
    expect(draft.customSections[0]?.entries[0]?.achievementsText).toBe('Filed');
    expect(draft.contact.github).toBe('');
  });

  it('round-trips: what the form saves normalises back to the stored document', () => {
    const saved = normalizeResumeDocument(draftToDocument(draftFromDocument(stored)));
    expect(saved).toEqual(stored);
  });

  it('keeps fields the form does not show (a GPA) on the row', () => {
    const document = draftToDocument(draftFromDocument(stored));
    expect((document.education as Array<{ gpa?: string }>)[0]?.gpa).toBe('3.9');
  });

  it('names every list and setting, drops blank rows and sends [] for the template order', () => {
    const draft = { ...draftForNewResume({ templateId: '', layout: 'categorized' }) };
    draft.projects = [emptyEntry('projects') as never];
    const document = draftToDocument(draft);
    expect(document.projects).toEqual([]);
    expect(document.sectionOrder).toEqual([]);
    expect(document.totalYearsExperience).toBeNull();
    expect(document.resumeSettings).toEqual({ technicalSkillsLayout: 'categorized', includeSoftSkills: false, includeStrengths: false });
    for (const key of ['experience', 'strengths', 'education', 'certifications', 'languages', 'awards', 'publications', 'volunteering', 'courses', 'interests', 'references', 'customSections', 'softSkills', 'skills']) {
      expect(Array.isArray(document[key]), key).toBe(true);
    }
  });

  it('starts a new resume on the chosen template and layout', () => {
    const draft = draftForNewResume({ templateId: 'navy-rule', layout: 'flat' });
    expect(draft.preferredTemplate).toBe('navy-rule');
    expect(draft.settings.technicalSkillsLayout).toBe('flat');
    expect(draft.sectionOrder).toBeNull();
    expect(draft.experience).toEqual([]);
  });
});

describe('years', () => {
  it('reads blank or unreadable as clear, and keeps numbers', () => {
    expect(parseYears('')).toBeNull();
    expect(parseYears('  ')).toBeNull();
    expect(parseYears('4.5')).toBe(4.5);
    expect(parseYears('-1')).toBeNull();
    expect(parseYears('abc')).toBeNull();
    expect(parseYears('81')).toBeNull();
  });
});

describe('rows', () => {
  it('appends, finds, patches and removes a row by key', () => {
    let draft = draftForNewResume({ templateId: '', layout: 'categorized' });
    const row = emptyEntry('experience') as DraftExperience;
    draft = appendEntry(draft, { kind: 'experience' }, row);
    const ref = { kind: 'experience' as const, key: row.key };
    expect(findEntry(draft, ref)).toBe(row);
    draft = replaceEntry(draft, ref, { title: 'Engineer', key: 'hijack' });
    expect(findEntry(draft, ref)).toMatchObject({ title: 'Engineer', key: row.key });
    draft = removeEntry(draft, ref);
    expect(draft.experience).toEqual([]);
  });

  it('works on a custom section by its key', () => {
    let draft = draftFromDocument(stored);
    const list = { kind: 'custom' as const, sectionKey: 'cs-0a0b0c0d' };
    const row = emptyEntry('custom');
    draft = appendEntry(draft, list, row);
    expect(draft.customSections[0]?.entries).toHaveLength(2);
    draft = replaceEntry(draft, { ...list, key: row.key }, { heading: 'US 2' });
    expect(findEntry(draft, { ...list, key: row.key })).toMatchObject({ heading: 'US 2' });
  });

  it('says a row is blank only when nothing is typed', () => {
    expect(isBlankEntry(emptyEntry('experience'))).toBe(true);
    expect(isBlankEntry({ ...emptyEntry('experience'), title: '  ' })).toBe(true);
    expect(isBlankEntry({ ...emptyEntry('experience'), skills: ['Go'] })).toBe(false);
    expect(isBlankEntry({ ...emptyEntry('courses'), name: 'ML' })).toBe(false);
  });

  it('maps a section ref to its entry list', () => {
    expect(entryListOf('experience')).toEqual({ kind: 'experience' });
    expect(entryListOf('custom:cs-1')).toEqual({ kind: 'custom', sectionKey: 'cs-1' });
    expect(entryListOf('skills')).toBeNull();
    expect(entryListOf('summary')).toBeNull();
  });
});

describe('sections', () => {
  it('counts what a section holds and says it in the head', () => {
    const draft = draftFromDocument(stored);
    expect(entryCount(draft, 'summary')).toBe(1);
    expect(entryCount(draft, 'skills')).toBe(3);
    expect(entryCount(draft, 'experience')).toBe(1);
    expect(entryCount(draft, 'custom:cs-0a0b0c0d')).toBe(1);
    expect(entryCount(draft, 'projects')).toBe(0);
    expect(sectionMeta(draft, 'summary')).toBe('');
    expect(sectionMeta(draft, 'skills')).toBe('3 skills');
    expect(sectionMeta(draft, 'softSkills')).toBe('1 soft skill');
    expect(sectionMeta(draft, 'experience')).toBe('1 entry');
    expect(sectionMeta(draft, 'projects')).toBe('');
  });

  it('asks before removing a section with entries', () => {
    expect(removeSectionQuestion('Projects', 0)).toBeNull();
    expect(removeSectionQuestion('Projects', 1)).toBe('Remove Projects and its 1 entry? It is deleted when you save.');
    expect(removeSectionQuestion('Patents', 3)).toBe('Remove Patents and its 3 entries? They are deleted when you save.');
  });

  it('adds a kind or a custom section last in the shown order, which becomes the stored order', () => {
    const draft = draftForNewResume({ templateId: '', layout: 'categorized' });
    const shown = effectiveSectionOrder([], DEFAULT_SECTION_KINDS, presenceOf(sectionSourceOf(draft)));
    const withProjects = addSectionKind(draft, 'projects', shown);
    expect(withProjects.sectionOrder).toEqual([...shown, 'projects']);
    const withCustom = addCustomSection(withProjects, 'cs-12345678', '  Patents ', withProjects.sectionOrder ?? []);
    expect(withCustom.customSections).toEqual([{ key: 'cs-12345678', title: 'Patents', entries: [] }]);
    expect(withCustom.sectionOrder?.at(-1)).toBe('custom:cs-12345678');
    const order = effectiveSectionOrder(withCustom.sectionOrder, DEFAULT_SECTION_KINDS, presenceOf(sectionSourceOf(withCustom)));
    expect(order).toContain('projects');
    expect(order.at(-1)).toBe('custom:cs-12345678');
  });

  it('removes a section with its content', () => {
    const draft = draftFromDocument(stored);
    const order = ['experience', 'summary', 'custom:cs-0a0b0c0d'];
    const noCustom = removeSection(draft, 'custom:cs-0a0b0c0d', order);
    expect(noCustom.customSections).toEqual([]);
    expect(noCustom.sectionOrder).toEqual(['experience', 'summary']);
    expect(removeSection(draft, 'skills', order).skillCategoryBySkill).toEqual({});
    expect(removeSection(draft, 'experience', order).experience).toEqual([]);
  });

  it('renames a custom section, capped at 100 characters', () => {
    const draft = renameCustomSection(draftFromDocument(stored), 'cs-0a0b0c0d', 'x'.repeat(150));
    expect(draft.customSections[0]?.title).toHaveLength(100);
  });

  it('knows what a template prints, custom sections with the extra-sections block', () => {
    const full = { supportsSoftSkills: true, supportsStrengths: true, printsSections: ['summary', 'experience', 'projects', 'custom'] };
    const ats = { supportsSoftSkills: false, supportsStrengths: false, printsSections: ['summary', 'experience', 'skills'] };
    expect(templatePrintsRef(full, 'projects')).toBe(true);
    expect(templatePrintsRef(full, 'custom:cs-1')).toBe(true);
    expect(templatePrintsRef(ats, 'projects')).toBe(false);
    expect(templatePrintsRef(ats, 'custom:cs-1')).toBe(false);
    expect(templatePrintsRef({ ...ats, printsSections: [] }, 'projects')).toBeNull();
    expect(templatePrintsRef(null, 'projects')).toBeNull();
  });
});

describe('skills', () => {
  it('groups skills by heading, the library headings first', () => {
    expect(
      buildSkillCategories(['Go', 'React', 'Kafka', 'Vault'], { Go: 'Languages', Vault: 'My Infra', React: 'Frontend & UI/UX Development' }),
    ).toEqual([
      { category: 'Languages', skills: ['Go'] },
      { category: 'Frontend & UI/UX Development', skills: ['React'] },
      { category: 'My Infra', skills: ['Vault'] },
    ]);
  });

  it('reads a grouping back, the first heading winning', () => {
    expect(
      readSkillCategoryMap([
        { category: 'A', skills: ['x'] },
        { category: 'B', skills: ['x', 'y'] },
      ]),
    ).toEqual({ x: 'A', y: 'B' });
  });

  it('never reads a skill called "constructor" off the prototype', () => {
    expect(headingOf({}, 'constructor')).toBe('');
    expect(headingOf({}, '__proto__')).toBe('');
  });

  it('adds, re-heads and removes technical skills', () => {
    let draft = draftFromDocument(stored);
    draft = addTechnicalSkill(draft, '  Rust  ');
    expect(draft.skills.at(-1)).toBe('Rust');
    expect(addTechnicalSkill(draft, 'rust')).toBe(draft);
    draft = setSkillHeading(draft, 'Rust', 'Languages');
    expect(draft.skillCategoryBySkill.Rust).toBe('Languages');
    draft = setSkillHeading(draft, 'Rust', '');
    expect(Object.hasOwn(draft.skillCategoryBySkill, 'Rust')).toBe(false);
    draft = setSkillHeading(draft, 'Go', 'Mine');
    expect(headingOptions(draft).at(-1)).toBe('Mine');
    draft = removeTechnicalSkill(draft, 'Go');
    expect(draft.skills).not.toContain('Go');
    expect(Object.hasOwn(draft.skillCategoryBySkill, 'Go')).toBe(false);
    expect(draft.experience[0]?.skills).toEqual(['Go']);
  });

  it('adds a role skill to the role and to Technical skills', () => {
    let draft = draftFromDocument(stored);
    const key = draft.experience[0]!.key;
    draft = addRoleSkill(draft, key, 'Postgres');
    expect(draft.experience[0]?.skills).toEqual(['Go', 'Postgres']);
    expect(draft.skills).toContain('Postgres');
  });

  it('refuses repeats, long names and full lists with a sentence', () => {
    expect(softSkillRefusal(['Mentoring'], 'mentoring')).toBe('mentoring is already on the list.');
    expect(softSkillRefusal([], 'x'.repeat(101))).toBe('A soft skill can be at most 100 characters.');
    expect(interestRefusal(Array.from({ length: 50 }, (_, i) => `i${i}`), 'Chess')).toBe('A resume can list at most 50 interests.');
    expect(technicalSkillRefusal(Array.from({ length: 100 }, (_, i) => `s${i}`), 'Go')).toBe(
      'A resume can list at most 100 technical skills.',
    );
    expect(softSkillRefusal([], '   ')).toBeNull();
    expect(interestRefusal([], 'Chess')).toBeNull();
  });

  it('finds the library spelling case-insensitively', () => {
    expect(librarySpelling(['JavaScript', 'Go'], ' javascript ')).toBe('JavaScript');
    expect(librarySpelling(['Go'], 'Rust')).toBeNull();
  });

  it('counts what a switched-off section keeps', () => {
    const draft = draftFromDocument(stored);
    expect(keptCount(draft, 'softSkills')).toBe(1);
    expect(keptCount({ ...draft, strengths: [{ key: 'k', title: ' ', description: '' }] }, 'strengths')).toBe(0);
  });
});

describe('Write with AI', () => {
  it('sends the naming fields by kind, the bullets as a list and five facts about the person', () => {
    const draft = draftFromDocument(stored);
    const row = draft.experience[0]!;
    const request = bulletsRequestFor('experience', row, draft, 'improve', '  the   cost savings ');
    expect(request).toMatchObject({
      kind: 'experience',
      task: 'improve',
      instructions: 'the cost savings',
      entry: { title: 'Staff Engineer', company: 'Northwind', achievements: ['Cut costs 30%', 'Led 5 engineers'], skills: ['Go'] },
      resume: { name: 'Ann Lee', title: 'Staff Engineer', totalYearsExperience: 9, summary: 'Builds payment systems.' },
    });
    expect(request.resume).not.toHaveProperty('email');
    const project = bulletsRequestFor('project', { name: 'Lake', role: 'Lead', achievementsText: '' }, draft, 'write', '');
    expect(project.entry).toMatchObject({ name: 'Lake', role: 'Lead', achievements: [] });
    expect(project).not.toHaveProperty('instructions');
  });
});

describe('templates', () => {
  const list = [{ id: 'default' }, { id: 'navy-rule' }];
  it('draws a resume with its own template, else the default, else the first', () => {
    expect(drawnTemplate(list, 'navy-rule')).toEqual({ stored: { id: 'navy-rule' }, drawn: { id: 'navy-rule' } });
    expect(drawnTemplate(list, '')).toEqual({ stored: { id: 'default' }, drawn: { id: 'default' } });
    expect(drawnTemplate(list, 'gone')).toEqual({ stored: null, drawn: { id: 'default' } });
    expect(drawnTemplate([{ id: 'x' }], 'gone')).toEqual({ stored: null, drawn: { id: 'x' } });
  });
});

describe('end dates', () => {
  it('hints when a dated row has no end date, in words that fit the kind', () => {
    expect(missingEndDateHint('experience', { startDate: '2021-02', endDate: '' })).toBe('Add an end date, or Present for a current role.');
    expect(missingEndDateHint('volunteering', { startDate: '2021', endDate: '  ' })).toBe('Add an end date, or Present for a current role.');
    expect(missingEndDateHint('projects', { startDate: '2021', endDate: '' })).toBe('Add an end date, or Present for an ongoing project.');
    expect(missingEndDateHint('education', { startDate: '2014', endDate: '' })).toBe('Add an end date, or Present if you are still studying.');
    expect(missingEndDateHint('custom', { startDate: '2014', endDate: '' })).toBe('Add an end date, or Present if it is ongoing.');
  });

  it('says nothing for an end date, Present, no start date, or a kind without a range', () => {
    expect(missingEndDateHint('experience', { startDate: '2021-02', endDate: 'Present' })).toBeNull();
    expect(missingEndDateHint('experience', { startDate: '2021-02', endDate: '2023-01' })).toBeNull();
    expect(missingEndDateHint('experience', { startDate: '', endDate: '' })).toBeNull();
    expect(missingEndDateHint('certifications', { date: '2021' })).toBeNull();
    expect(missingEndDateHint('awards', { startDate: '2021', endDate: '' })).toBeNull();
  });

  it('counts the open rows of a section, custom sections included', () => {
    let draft = draftForNewResume({ templateId: 'navy-rule', layout: 'categorized' });
    const open = { ...(emptyEntry('experience') as DraftExperience), title: 'Engineer', startDate: '2021-02' };
    const closed = { ...(emptyEntry('experience') as DraftExperience), title: 'Intern', startDate: '2019', endDate: '2020' };
    draft = appendEntry(appendEntry(draft, { kind: 'experience' }, open), { kind: 'experience' }, closed);
    expect(missingEndDateCount(draft, 'experience')).toBe(1);
    expect(missingEndDateCount(draft, 'education')).toBe(0);
    expect(missingEndDateCount(draft, 'summary')).toBe(0);

    draft = addCustomSection(draft, 'cs-1', 'Patents', []);
    draft = appendEntry(draft, { kind: 'custom', sectionKey: 'cs-1' }, { ...emptyEntry('custom'), startDate: '2020' });
    expect(missingEndDateCount(draft, 'custom:cs-1')).toBe(1);
  });
});
