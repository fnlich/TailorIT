import {
  CUSTOM_REF_PREFIX,
  HARD_SKILL_CATEGORIES,
  MAX_INTEREST_LENGTH,
  MAX_RESUME_INTERESTS,
  MAX_RESUME_SKILLS,
  MAX_RESUME_SOFT_SKILLS,
  MAX_SKILL_LENGTH,
  MAX_SOFT_SKILL_LENGTH,
  achievementsFromText,
  emptyResumeDocument,
  normalizeResumeDocument,
  type AwardEntry,
  type BulletsRequest,
  type BulletsTask,
  type CertificationEntry,
  type CourseEntry,
  type CustomSectionEntry,
  type EducationEntry,
  type EntryBulletsKind,
  type ExperienceEntry,
  type LanguageEntry,
  type ProjectEntry,
  type PublicationEntry,
  type ReferenceEntry,
  type ResumeDocument,
  type ResumeSettings,
  type SectionSource,
  type SkillCategoryGroup,
  type StrengthEntry,
  type TechnicalSkillsLayout,
  type VolunteeringEntry,
} from '@tailorit/shared/resume';

/*
 * The resume editor's form model and every decision about it that needs no React (free_tailor's lib/resumeDraft.ts,
 * written fresh for TailorIT's document): a stored document as a form, what the form saves and previews, how a row is
 * found and changed, how sections are added and removed, the skill lists' rules and what Write with AI is sent.
 *
 * The form differs from the stored document in four ways:
 *  - every list row carries a `key` of its own, so a half-typed field follows its row, not an index;
 *  - bullet kinds hold `achievementsText` (one line per bullet) rather than a list, so an Enter just pressed survives;
 *  - the Technical skills grouping is one heading per skill (`skillCategoryBySkill`): a skill can be in one group only,
 *    and no group can hold a skill the resume no longer lists;
 *  - `sectionOrder` is null while the cards follow the template, and the years are text, so "4." mid-edit is fine.
 */

type Keyed<T> = T & { key: string };
type WithBullets<T extends { achievements: string[] }> = Omit<T, 'achievements'> & { key: string; achievementsText: string };

export type DraftExperience = WithBullets<ExperienceEntry>;
export type DraftStrength = Keyed<StrengthEntry>;
export type DraftEducation = Keyed<EducationEntry>;
export type DraftCertification = Keyed<CertificationEntry>;
export type DraftProject = WithBullets<ProjectEntry>;
export type DraftLanguage = Keyed<LanguageEntry>;
export type DraftAward = Keyed<AwardEntry>;
export type DraftPublication = Keyed<PublicationEntry>;
export type DraftVolunteering = WithBullets<VolunteeringEntry>;
export type DraftCourse = Keyed<CourseEntry>;
export type DraftReference = Keyed<ReferenceEntry>;
export type DraftCustomEntry = WithBullets<CustomSectionEntry>;

/** A custom section; `key` is the stored key (also the React key): unique in the resume and never reused. */
export interface DraftCustomSection {
  key: string;
  title: string;
  entries: DraftCustomEntry[];
}

export interface DraftContact {
  phone: string;
  email: string;
  location: string;
  linkedin: string;
  github: string;
  portfolio: string;
}

export interface ResumeDraft {
  name: string;
  title: string;
  /** As typed; read on save. */
  totalYearsExperience: string;
  /** '' = none chosen: drawn with the default template. */
  preferredTemplate: string;
  settings: ResumeSettings;
  contact: DraftContact;
  summary: string;
  experience: DraftExperience[];
  strengths: DraftStrength[];
  /** Every technical skill, flat, in the person's order. */
  skills: string[];
  /** The heading each skill goes under in the Grouped layout; a skill missing here is filed by the library. */
  skillCategoryBySkill: Record<string, string>;
  softSkills: string[];
  education: DraftEducation[];
  certifications: DraftCertification[];
  projects: DraftProject[];
  languages: DraftLanguage[];
  awards: DraftAward[];
  publications: DraftPublication[];
  volunteering: DraftVolunteering[];
  courses: DraftCourse[];
  interests: string[];
  references: DraftReference[];
  customSections: DraftCustomSection[];
  /** The order as arranged, or null to follow the template (nothing stored). */
  sectionOrder: string[] | null;
}

/** The template a resume with none chosen is drawn with. */
export const FALLBACK_TEMPLATE_ID = 'default';
/** Its name, for where the template list cannot be read. */
export const FALLBACK_TEMPLATE_NAME = 'Professional Two-Column';

let rowSequence = 0;

/** A key for a new row: unique for the page's lifetime, which is all a React key needs. */
export function newRowKey(): string {
  rowSequence += 1;
  return `row-${rowSequence}`;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function withBullets<T extends { achievements?: unknown }>(item: T): Omit<T, 'achievements'> & { key: string; achievementsText: string } {
  const { achievements, ...rest } = item;
  return { ...rest, key: newRowKey(), achievementsText: strings(achievements).join('\n') };
}

/** A skill's heading from the map, or '' (an own-property read: a skill may be called "constructor"). */
export function headingOf(map: Record<string, string>, skill: string): string {
  return Object.hasOwn(map, skill) ? (map[skill] ?? '') : '';
}

/** The stored grouping as one heading per skill (the first heading a skill appears under wins). */
export function readSkillCategoryMap(groups: readonly SkillCategoryGroup[] | null | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const group of groups ?? []) {
    const category = group.category.trim();
    if (!category) continue;
    for (const skill of group.skills) {
      if (skill && !Object.hasOwn(map, skill)) map[skill] = category;
    }
  }
  return map;
}

/**
 * The per-skill headings as groups, the library's headings first in their order, the person's own after them in the
 * order first used. A skill with no heading is left out (the renderer files it); an emptied heading disappears.
 */
export function buildSkillCategories(
  skills: readonly string[],
  categoryBySkill: Record<string, string>,
  knownOrder: readonly string[] = HARD_SKILL_CATEGORIES,
): SkillCategoryGroup[] {
  const order: string[] = [];
  const grouped = new Map<string, string[]>();
  for (const skill of skills) {
    const category = headingOf(categoryBySkill, skill).trim();
    if (!category) continue;
    let members = grouped.get(category);
    if (!members) {
      members = [];
      grouped.set(category, members);
      order.push(category);
    }
    members.push(skill);
  }
  const known = knownOrder.filter((category) => grouped.has(category));
  const own = order.filter((category) => !knownOrder.includes(category));
  return [...known, ...own].map((category) => ({ category, skills: grouped.get(category) ?? [] }));
}

/** A stored document (or none) as the editor's draft. Unshown fields (a GPA, an expiry date) ride along on the row. */
export function draftFromDocument(source: ResumeDocument | null | undefined): ResumeDraft {
  const document = normalizeResumeDocument(source ?? {});
  return {
    name: document.name,
    title: document.title,
    totalYearsExperience: document.totalYearsExperience === undefined ? '' : String(document.totalYearsExperience),
    preferredTemplate: document.preferredTemplate,
    settings: { ...document.resumeSettings },
    contact: {
      phone: text(document.contact.phone),
      email: text(document.contact.email),
      location: text(document.contact.location),
      linkedin: text(document.contact.linkedin),
      github: text(document.contact.github),
      portfolio: text(document.contact.portfolio),
    },
    summary: document.summary,
    experience: document.experience.map((item) => ({ ...withBullets(item), skills: [...item.skills] })),
    strengths: document.strengths.map((item) => ({ ...item, key: newRowKey() })),
    skills: [...document.skills],
    skillCategoryBySkill: readSkillCategoryMap(document.skillCategories),
    softSkills: [...(document.softSkills ?? [])],
    education: document.education.map((item) => ({ ...item, key: newRowKey() })),
    certifications: (document.certifications ?? []).map((item) => ({ ...item, key: newRowKey() })),
    projects: (document.projects ?? []).map(withBullets),
    languages: (document.languages ?? []).map((item) => ({ ...item, key: newRowKey() })),
    awards: (document.awards ?? []).map((item) => ({ ...item, key: newRowKey() })),
    publications: (document.publications ?? []).map((item) => ({ ...item, key: newRowKey() })),
    volunteering: (document.volunteering ?? []).map(withBullets),
    courses: (document.courses ?? []).map((item) => ({ ...item, key: newRowKey() })),
    interests: [...(document.interests ?? [])],
    references: (document.references ?? []).map((item) => ({ ...item, key: newRowKey() })),
    customSections: (document.customSections ?? []).map((section) => ({
      key: section.key,
      title: section.title,
      entries: section.entries.map(withBullets),
    })),
    sectionOrder: document.sectionOrder && document.sectionOrder.length > 0 ? [...document.sectionOrder] : null,
  };
}

/** A new resume's draft on the template and layout the chooser started it with ('' for no template). */
export function draftForNewResume(start: { templateId: string; layout: TechnicalSkillsLayout }): ResumeDraft {
  return draftFromDocument(emptyResumeDocument({ templateId: start.templateId, layout: start.layout }));
}

// --------------------------------------------------------------------------------------------------------- rows

/** The kinds whose card is a list of rows opened in the Edit Entry panel. */
export type EntryKind =
  | 'experience'
  | 'strengths'
  | 'education'
  | 'certifications'
  | 'projects'
  | 'volunteering'
  | 'awards'
  | 'publications'
  | 'courses'
  | 'languages'
  | 'references';

export const ENTRY_KINDS: readonly EntryKind[] = [
  'experience',
  'strengths',
  'education',
  'certifications',
  'projects',
  'volunteering',
  'awards',
  'publications',
  'courses',
  'languages',
  'references',
];

export function isEntryKind(value: string): value is EntryKind {
  return (ENTRY_KINDS as readonly string[]).includes(value);
}

export type DraftEntry =
  | DraftExperience
  | DraftStrength
  | DraftEducation
  | DraftCertification
  | DraftProject
  | DraftVolunteering
  | DraftAward
  | DraftPublication
  | DraftCourse
  | DraftLanguage
  | DraftReference
  | DraftCustomEntry;

const EMPTY_ENTRY: Record<EntryKind | 'custom', () => DraftEntry> = {
  experience: () => ({
    key: newRowKey(),
    title: '',
    company: '',
    startDate: '',
    endDate: '',
    location: '',
    description: '',
    achievementsText: '',
    skills: [],
  }),
  strengths: () => ({ key: newRowKey(), title: '', description: '' }),
  education: () => ({ key: newRowKey(), degree: '', institution: '', startDate: '', endDate: '', location: '' }),
  certifications: () => ({ key: newRowKey(), name: '', issuer: '', date: '' }),
  projects: () => ({
    key: newRowKey(),
    name: '',
    role: '',
    startDate: '',
    endDate: '',
    link: '',
    description: '',
    achievementsText: '',
  }),
  volunteering: () => ({
    key: newRowKey(),
    role: '',
    organization: '',
    startDate: '',
    endDate: '',
    location: '',
    description: '',
    achievementsText: '',
  }),
  awards: () => ({ key: newRowKey(), title: '', issuer: '', date: '', description: '' }),
  publications: () => ({ key: newRowKey(), title: '', publisher: '', date: '', link: '', description: '' }),
  courses: () => ({ key: newRowKey(), name: '', institution: '', date: '' }),
  languages: () => ({ key: newRowKey(), language: '', proficiency: '' }),
  references: () => ({ key: newRowKey(), name: '', title: '', company: '', email: '', phone: '' }),
  custom: () => ({
    key: newRowKey(),
    heading: '',
    subheading: '',
    startDate: '',
    endDate: '',
    location: '',
    description: '',
    achievementsText: '',
  }),
};

/** A new, empty row: what "+ Add {entry}" opens. */
export function emptyEntry(kind: EntryKind | 'custom'): DraftEntry {
  return EMPTY_ENTRY[kind]();
}

/** Nothing typed into the row (its key aside): such a row is not saved, and closing its panel drops it. */
export function isBlankEntry(row: object): boolean {
  for (const [field, value] of Object.entries(row)) {
    if (field === 'key') continue;
    if (typeof value === 'string') {
      if (value.trim()) return false;
    } else if (Array.isArray(value)) {
      if (value.length > 0) return false;
    } else if (value !== undefined && value !== null) {
      return false;
    }
  }
  return true;
}

const END_DATE_HINT: Partial<Record<EntryKind | 'custom', string>> = {
  experience: 'Add an end date, or Present for a current role.',
  volunteering: 'Add an end date, or Present for a current role.',
  projects: 'Add an end date, or Present for an ongoing project.',
  education: 'Add an end date, or Present if you are still studying.',
  custom: 'Add an end date, or Present if it is ongoing.',
};

/**
 * The hint for a row with a start date and no end date, or null. Every template prints "{start} - {end}", so such a
 * row prints "2021-02 - " with nothing after the dash. A hint only: saving is never held up by it.
 */
export function missingEndDateHint(kind: EntryKind | 'custom' | (string & {}), row: object): string | null {
  const hint = (END_DATE_HINT as Record<string, string | undefined>)[kind];
  if (!hint) return null;
  const { startDate, endDate } = row as { startDate?: unknown; endDate?: unknown };
  const filled = (value: unknown) => typeof value === 'string' && value.trim() !== '';
  return filled(startDate) && !filled(endDate) ? hint : null;
}

/** How many of a section's rows (by its ref: "experience", "custom:cs-…") have a start date but no end date. */
export function missingEndDateCount(draft: ResumeDraft, ref: string): number {
  const list = entryListOf(ref);
  if (!list) return 0;
  return entriesOf(draft, list).filter((row) => missingEndDateHint(list.kind, row) !== null).length;
}

/** One section's rows: a kind's list, or a custom section's by its key. */
export type EntryListRef = { kind: EntryKind } | { kind: 'custom'; sectionKey: string };
/** One row: its list and its own key. */
export type EntryRef = EntryListRef & { key: string };

export function entriesOf(draft: ResumeDraft, ref: EntryListRef): DraftEntry[] {
  if (ref.kind === 'custom') return draft.customSections.find((section) => section.key === ref.sectionKey)?.entries ?? [];
  return draft[ref.kind];
}

function withEntries(draft: ResumeDraft, ref: EntryListRef, entries: DraftEntry[]): ResumeDraft {
  if (ref.kind === 'custom') {
    return {
      ...draft,
      customSections: draft.customSections.map((section) =>
        section.key === ref.sectionKey ? { ...section, entries: entries as DraftCustomEntry[] } : section,
      ),
    };
  }
  return { ...draft, [ref.kind]: entries } as ResumeDraft;
}

export function findEntry(draft: ResumeDraft, ref: EntryRef): DraftEntry | null {
  return entriesOf(draft, ref).find((row) => row.key === ref.key) ?? null;
}

/** The draft with one row patched (its key never changes). */
export function replaceEntry(draft: ResumeDraft, ref: EntryRef, patch: object): ResumeDraft {
  return withEntries(
    draft,
    ref,
    entriesOf(draft, ref).map((row) => (row.key === ref.key ? ({ ...row, ...patch, key: row.key } as DraftEntry) : row)),
  );
}

export function removeEntry(draft: ResumeDraft, ref: EntryRef): ResumeDraft {
  return withEntries(
    draft,
    ref,
    entriesOf(draft, ref).filter((row) => row.key !== ref.key),
  );
}

export function appendEntry(draft: ResumeDraft, ref: EntryListRef, entry: DraftEntry): ResumeDraft {
  return withEntries(draft, ref, [...entriesOf(draft, ref), entry]);
}

/** The list a section ref names, for an entry card ('experience', 'custom:cs-…'); null for the other kinds. */
export function entryListOf(ref: string): EntryListRef | null {
  if (ref.startsWith(CUSTOM_REF_PREFIX)) return { kind: 'custom', sectionKey: ref.slice(CUSTOM_REF_PREFIX.length) };
  return isEntryKind(ref) ? { kind: ref } : null;
}

// ------------------------------------------------------------------------------------------------------ sections

function customKeyOf(ref: string): string | null {
  return ref.startsWith(CUSTOM_REF_PREFIX) ? ref.slice(CUSTOM_REF_PREFIX.length) : null;
}

/** What `presenceOf` reads, from the draft (its rows count whether or not anything is typed in them yet). */
export function sectionSourceOf(draft: ResumeDraft): SectionSource {
  return {
    summary: draft.summary,
    skills: draft.skills,
    customSections: draft.customSections,
    strengths: draft.strengths,
    softSkills: draft.softSkills,
    experience: draft.experience,
    education: draft.education,
    certifications: draft.certifications,
    projects: draft.projects,
    volunteering: draft.volunteering,
    awards: draft.awards,
    publications: draft.publications,
    courses: draft.courses,
    languages: draft.languages,
    interests: draft.interests,
    references: draft.references,
  };
}

/** How much a section holds: the summary is one thing or none, chip lists count names, the rest count rows. */
export function entryCount(draft: ResumeDraft, ref: string): number {
  const customKey = customKeyOf(ref);
  if (customKey !== null) return draft.customSections.find((section) => section.key === customKey)?.entries.length ?? 0;
  switch (ref) {
    case 'summary':
      return draft.summary.trim() ? 1 : 0;
    case 'skills':
      return draft.skills.length;
    case 'softSkills':
      return draft.softSkills.length;
    case 'interests':
      return draft.interests.length;
    default:
      return isEntryKind(ref) ? draft[ref].length : 0;
  }
}

/** A card head's count: "3 entries", "12 skills", "1 soft skill"; '' for nothing, or for the summary. */
export function sectionMeta(draft: ResumeDraft, ref: string): string {
  if (ref === 'summary') return '';
  const count = entryCount(draft, ref);
  if (count === 0) return '';
  const nouns: Record<string, [string, string]> = {
    skills: ['skill', 'skills'],
    softSkills: ['soft skill', 'soft skills'],
    interests: ['interest', 'interests'],
  };
  const [one, many] = nouns[ref] ?? ['entry', 'entries'];
  return `${count} ${count === 1 ? one : many}`;
}

/** The sentence Remove section asks, or null when the section holds nothing (it goes at once). */
export function removeSectionQuestion(label: string, count: number): string | null {
  if (count <= 0) return null;
  return `Remove ${label} and its ${count} ${count === 1 ? 'entry' : 'entries'}? ${count === 1 ? 'It is' : 'They are'} deleted when you save.`;
}

/** The draft with a kind added last in `order` (the cards as shown, stored from here on). */
export function addSectionKind(draft: ResumeDraft, kind: string, order: readonly string[]): ResumeDraft {
  return { ...draft, sectionOrder: [...order.filter((ref) => ref !== kind), kind] };
}

/** The draft with a new, empty custom section under `title`, last in the order. */
export function addCustomSection(draft: ResumeDraft, key: string, title: string, order: readonly string[]): ResumeDraft {
  const ref = `${CUSTOM_REF_PREFIX}${key}`;
  return {
    ...draft,
    customSections: [...draft.customSections.filter((section) => section.key !== key), { key, title: title.trim(), entries: [] }],
    sectionOrder: [...order.filter((item) => item !== ref), ref],
  };
}

/** The draft with a section gone: out of the order, and its content with it. */
export function removeSection(draft: ResumeDraft, ref: string, order: readonly string[]): ResumeDraft {
  const sectionOrder = order.filter((item) => item !== ref);
  const customKey = customKeyOf(ref);
  if (customKey !== null) {
    return { ...draft, sectionOrder, customSections: draft.customSections.filter((section) => section.key !== customKey) };
  }
  switch (ref) {
    case 'summary':
      return { ...draft, sectionOrder, summary: '' };
    case 'skills':
      return { ...draft, sectionOrder, skills: [], skillCategoryBySkill: {} };
    case 'softSkills':
      return { ...draft, sectionOrder, softSkills: [] };
    case 'interests':
      return { ...draft, sectionOrder, interests: [] };
    default:
      return isEntryKind(ref) ? ({ ...draft, sectionOrder, [ref]: [] } as ResumeDraft) : { ...draft, sectionOrder };
  }
}

/** A custom section's title as the person types it (kept to 100 characters). */
export function renameCustomSection(draft: ResumeDraft, key: string, title: string): ResumeDraft {
  return {
    ...draft,
    customSections: draft.customSections.map((section) => (section.key === key ? { ...section, title: title.slice(0, 100) } : section)),
  };
}

/** What a template can print, as the Customize tab and the cards ask it. */
export interface TemplateCapabilities {
  supportsSoftSkills: boolean;
  supportsStrengths: boolean;
  printsSections: readonly string[];
}

/**
 * Whether the template prints a section: its `printsSections` by kind id; a custom section prints wherever the
 * template has the extra-sections block (it then lists "custom", or at least the extra kinds). Null when the template
 * says nothing about it (an empty list: unknown).
 */
export function templatePrintsRef(template: TemplateCapabilities | null | undefined, ref: string): boolean | null {
  if (!template || template.printsSections.length === 0) return null;
  if (customKeyOf(ref) !== null) return template.printsSections.includes('custom') || template.printsSections.includes('projects');
  return template.printsSections.includes(ref);
}

// -------------------------------------------------------------------------------------------------- the payload

function withoutKey<T extends { key: string }>(row: T): Omit<T, 'key'> {
  const copy: Partial<T> = { ...row };
  delete copy.key;
  return copy as Omit<T, 'key'>;
}

function savedRows<T extends { key: string }>(rows: readonly T[]): Omit<T, 'key'>[] {
  return rows.filter((row) => !isBlankEntry(row)).map(withoutKey);
}

function savedBulletRows<T extends { key: string; achievementsText: string }>(
  rows: readonly T[],
): Array<Omit<T, 'key' | 'achievementsText'> & { achievements: string[] }> {
  return rows
    .filter((row) => !isBlankEntry(row))
    .map((row) => {
      const copy: Partial<T> = { ...row };
      delete copy.key;
      delete copy.achievementsText;
      return { ...(copy as Omit<T, 'key' | 'achievementsText'>), achievements: achievementsFromText(row.achievementsText) };
    });
}

/** The years as a number (at most one decimal is kept by the server), or null to clear: blank or unreadable. */
export function parseYears(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 80 ? parsed : null;
}

/**
 * What Create / Save sends as `document` (and the preview draws). EVERY list is named, empty or not: an omitted list
 * keeps what is stored, and a row somebody deleted must go. A row with nothing typed into it is not sent. The order
 * goes as [] while the cards follow the template, which clears a stored one; every setting is named, so a switch just
 * turned off saves as off.
 */
export function draftToDocument(draft: ResumeDraft): Record<string, unknown> {
  return {
    name: draft.name,
    title: draft.title,
    totalYearsExperience: parseYears(draft.totalYearsExperience),
    preferredTemplate: draft.preferredTemplate,
    resumeSettings: {
      technicalSkillsLayout: draft.settings.technicalSkillsLayout,
      includeSoftSkills: draft.settings.includeSoftSkills,
      includeStrengths: draft.settings.includeStrengths,
    },
    contact: { ...draft.contact },
    summary: draft.summary,
    experience: savedBulletRows(draft.experience),
    strengths: savedRows(draft.strengths),
    skills: [...draft.skills],
    // Sent in either layout: the grouping is the person's, the layout only how it prints. Plain and back keeps it.
    skillCategories: buildSkillCategories(draft.skills, draft.skillCategoryBySkill),
    softSkills: [...draft.softSkills],
    education: savedRows(draft.education),
    certifications: savedRows(draft.certifications),
    projects: savedBulletRows(draft.projects),
    languages: savedRows(draft.languages),
    awards: savedRows(draft.awards),
    publications: savedRows(draft.publications),
    volunteering: savedBulletRows(draft.volunteering),
    courses: savedRows(draft.courses),
    interests: [...draft.interests],
    references: savedRows(draft.references),
    // A section survives on its title alone: an added, empty card keeps its name.
    customSections: draft.customSections.map((section) => ({
      key: section.key,
      title: section.title.trim(),
      entries: savedBulletRows(section.entries),
    })),
    sectionOrder: draft.sectionOrder ?? [],
  };
}

// ------------------------------------------------------------------------------------------------------- skills

/** Trimmed, inner whitespace collapsed: the server's own reading of a chip. */
export function cleanChip(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function hasChip(list: readonly string[], value: string): boolean {
  const wanted = value.toLowerCase();
  return list.some((entry) => entry.toLowerCase() === wanted);
}

/** Why a name cannot join a chip list, or null when it can (the server would drop it silently otherwise). */
function chipRefusal(list: readonly string[], value: string, noun: { one: string; many: string }, max: number, maxLength: number) {
  const name = cleanChip(value);
  if (!name) return null;
  if (hasChip(list, name)) return `${name} is already on the list.`;
  if (name.length > maxLength) return `${noun.one.charAt(0).toUpperCase()}${noun.one.slice(1)} can be at most ${maxLength} characters.`;
  if (list.length >= max) return `A resume can list at most ${max} ${noun.many}.`;
  return null;
}

export function technicalSkillRefusal(list: readonly string[], value: string): string | null {
  return chipRefusal(list, value, { one: 'a skill', many: 'technical skills' }, MAX_RESUME_SKILLS, MAX_SKILL_LENGTH);
}

export function softSkillRefusal(list: readonly string[], value: string): string | null {
  return chipRefusal(list, value, { one: 'a soft skill', many: 'soft skills' }, MAX_RESUME_SOFT_SKILLS, MAX_SOFT_SKILL_LENGTH);
}

export function interestRefusal(list: readonly string[], value: string): string | null {
  return chipRefusal(list, value, { one: 'an interest', many: 'interests' }, MAX_RESUME_INTERESTS, MAX_INTEREST_LENGTH);
}

/** The library's spelling of a skill when it knows it (case-insensitively), else null. */
export function librarySpelling(library: readonly string[], value: string): string | null {
  const wanted = cleanChip(value).toLowerCase();
  if (!wanted) return null;
  return library.find((skill) => skill.toLowerCase() === wanted) ?? null;
}

/** The draft with a technical skill added at the end (a repeat in any case changes nothing). */
export function addTechnicalSkill(draft: ResumeDraft, skill: string): ResumeDraft {
  const name = cleanChip(skill);
  if (!name || hasChip(draft.skills, name) || draft.skills.length >= MAX_RESUME_SKILLS) return draft;
  return { ...draft, skills: [...draft.skills, name] };
}

/** The draft without a technical skill, and without its heading. A role keeps the skills it says it used. */
export function removeTechnicalSkill(draft: ResumeDraft, skill: string): ResumeDraft {
  const skillCategoryBySkill = { ...draft.skillCategoryBySkill };
  delete skillCategoryBySkill[skill];
  return { ...draft, skills: draft.skills.filter((item) => item !== skill), skillCategoryBySkill };
}

/** The heading a skill goes under ('' = let the library decide). */
export function setSkillHeading(draft: ResumeDraft, skill: string, heading: string): ResumeDraft {
  const skillCategoryBySkill = { ...draft.skillCategoryBySkill };
  if (heading.trim()) skillCategoryBySkill[skill] = heading.trim();
  else delete skillCategoryBySkill[skill];
  return { ...draft, skillCategoryBySkill };
}

/** The headings a skill can go under: the library's, then any this resume already uses. */
export function headingOptions(draft: ResumeDraft): string[] {
  const used = draft.skills.map((skill) => headingOf(draft.skillCategoryBySkill, skill).trim()).filter(Boolean);
  return [...HARD_SKILL_CATEGORIES, ...used].filter((heading, index, all) => all.indexOf(heading) === index);
}

/** A role's "Skills used" grows, and the skill joins Technical skills too: a skill used in a role is one the resume claims. */
export function addRoleSkill(draft: ResumeDraft, rowKey: string, skill: string): ResumeDraft {
  const name = cleanChip(skill);
  if (!name) return draft;
  const experience = draft.experience.map((row) =>
    row.key === rowKey && !hasChip(row.skills, name) && row.skills.length < MAX_RESUME_SOFT_SKILLS
      ? { ...row, skills: [...row.skills, name] }
      : row,
  );
  return addTechnicalSkill({ ...draft, experience }, name);
}

export function removeRoleSkill(draft: ResumeDraft, rowKey: string, skill: string): ResumeDraft {
  return {
    ...draft,
    experience: draft.experience.map((row) => (row.key === rowKey ? { ...row, skills: row.skills.filter((item) => item !== skill) } : row)),
  };
}

/** How many entries a switched-off section keeps: every soft skill, every strength with anything in it. */
export function keptCount(draft: Pick<ResumeDraft, 'softSkills' | 'strengths'>, section: 'softSkills' | 'strengths'): number {
  if (section === 'softSkills') return draft.softSkills.length;
  return draft.strengths.filter((row) => row.title.trim() || row.description.trim()).length;
}

// ---------------------------------------------------------------------------------------------- Write with AI

const clip = (value: string, max: number) => value.trim().slice(0, max);

/**
 * The request for one entry: the fields that name it by kind (title and company, name and role, role and
 * organisation), its dates, location, description, bullets and skills; five facts about the person, never their
 * contact details; the task; and the note when there is one. Clipped to the contract's limits.
 */
export function bulletsRequestFor(
  kind: EntryBulletsKind,
  row: object,
  draft: Pick<ResumeDraft, 'name' | 'title' | 'totalYearsExperience' | 'summary' | 'skills'>,
  task: BulletsTask,
  instructions: string,
): BulletsRequest {
  const source = row as Record<string, unknown>;
  const field = (name: string, max = 500) => clip(text(source[name]), max);
  const named =
    kind === 'experience'
      ? { title: field('title'), company: field('company') }
      : kind === 'project'
        ? { name: field('name'), role: field('role') }
        : { role: field('role'), organization: field('organization') };
  const years = parseYears(draft.totalYearsExperience);
  const note = instructions.replace(/\s+/g, ' ').trim().slice(0, 300);
  return {
    kind,
    entry: {
      ...named,
      startDate: field('startDate', 50),
      endDate: field('endDate', 50),
      location: field('location'),
      description: field('description', 5000),
      achievements: achievementsFromText(text(source.achievementsText))
        .slice(0, 50)
        .map((line) => line.slice(0, 1000)),
      skills: strings(source.skills)
        .slice(0, 100)
        .map((skill) => skill.slice(0, 100)),
    },
    resume: {
      name: clip(draft.name, 200),
      title: clip(draft.title, 200),
      ...(years !== null ? { totalYearsExperience: years } : {}),
      summary: clip(draft.summary, 5000),
      skills: draft.skills.slice(0, 200).map((skill) => skill.slice(0, 100)),
    },
    task,
    ...(note ? { instructions: note } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------- templates

/** The template a draft is drawn with: its own, else the default every resume falls back to. */
export function effectiveTemplateId(draft: Pick<ResumeDraft, 'preferredTemplate'>): string {
  return draft.preferredTemplate || FALLBACK_TEMPLATE_ID;
}

/**
 * The template a resume is drawn with, decided as the server decides it: its own when offered, else `default`, else
 * the first one offered. `stored` is null when its own is not offered (any more).
 */
export function drawnTemplate<T extends { id: string }>(
  templates: readonly T[],
  preferredTemplate: string | null | undefined,
): { stored: T | null; drawn: T | null } {
  const wanted = preferredTemplate || FALLBACK_TEMPLATE_ID;
  const stored = templates.find((template) => template.id === wanted) ?? null;
  const fallback = templates.find((template) => template.id === FALLBACK_TEMPLATE_ID) ?? null;
  return { stored, drawn: stored ?? fallback ?? templates[0] ?? null };
}
