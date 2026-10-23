import {
  MAX_CUSTOM_SECTION_TITLE_LENGTH,
  MAX_ENTRY_ACHIEVEMENTS,
  MAX_INTEREST_LENGTH,
  MAX_RESUME_CUSTOM_SECTIONS,
  MAX_RESUME_INTERESTS,
  MAX_RESUME_SECTION_ENTRIES,
  MAX_RESUME_SKILLS,
  MAX_RESUME_SOFT_SKILLS,
  MAX_SKILL_LENGTH,
  MAX_SOFT_SKILL_LENGTH,
  cleanSectionOrder,
  isCustomSectionKey,
} from './catalogue';
import {
  DEFAULT_TECHNICAL_SKILLS_LAYOUT,
  TECHNICAL_SKILLS_LAYOUTS,
  type AwardEntry,
  type CertificationEntry,
  type CourseEntry,
  type CustomSection,
  type CustomSectionEntry,
  type EducationEntry,
  type ExperienceEntry,
  type LanguageEntry,
  type ProjectEntry,
  type PublicationEntry,
  type ReferenceEntry,
  type ResumeContact,
  type ResumeDocument,
  type ResumeSettings,
  type SkillCategoryGroup,
  type StrengthEntry,
  type TechnicalSkillsLayout,
  type VolunteeringEntry,
} from './document';

// free_tailor's normalisation rules (services/resumeDocument.ts), applied on every create, update, import and preview:
// - an omitted field keeps the stored value; a list given replaces the stored list; [] clears it;
// - strings are trimmed; in a list, anything that is not an object is dropped, and so is an entry with nothing that
//   names it (each kind says what names it);
// - caps: 50 entries per list, 10 custom sections, 50 x 100 characters for chip lists;
// - every grouped skill is also in `skills`; naming only a flat `skills` list clears the grouping;
// - the section order is cleaned to valid refs, once each.
// A field of the wrong shape (a string where a list belongs) reads as omitted, so a client mid-edit never errors.

type Record_ = Record<string, unknown>;

function isPlainRecord(value: unknown): value is Record_ {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

/** Raw items read from one list at most: enough for any cap, and a bound on work for a hostile body. */
const MAX_ITEMS_READ = 2000;

/** Bullet lines: strings only, trimmed, blanks dropped, capped. */
function lines(value: unknown, max = MAX_ENTRY_ACHIEVEMENTS): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value.slice(0, MAX_ITEMS_READ)) {
    if (out.length >= max) break;
    if (typeof item !== 'string') continue;
    const line = item.trim();
    if (line) out.push(line);
  }
  return out;
}

/**
 * A chip list: trimmed, inner whitespace collapsed, cut to `maxLength`, the first spelling kept when a name repeats
 * in another case, at most `max`.
 */
export function normalizeChipList(value: unknown, max: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value.slice(0, MAX_ITEMS_READ)) {
    if (out.length >= max) break;
    if (typeof entry !== 'string') continue;
    const name = entry.trim().replace(/\s+/g, ' ').slice(0, maxLength).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** An entry list: omitted (or not a list) keeps `existing`; objects only, read, unnamed ones dropped, capped. */
function entryList<T>(
  value: unknown,
  existing: readonly T[] | undefined,
  read: (item: Record_) => T,
  named: (entry: T) => boolean,
): T[] {
  if (!Array.isArray(value)) return existing ? [...existing] : [];
  const out: T[] = [];
  for (const item of value.slice(0, MAX_ITEMS_READ)) {
    if (out.length >= MAX_RESUME_SECTION_ENTRIES) break;
    if (!isPlainRecord(item)) continue;
    const entry = read(item);
    if (named(entry)) out.push(entry);
  }
  return out;
}

/** Optional text that is stored only when it has something in it. */
function optionalText<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  const result = text(value);
  return result ? ({ [key]: result } as Record<K, string>) : {};
}

const readExperience = (item: Record_): ExperienceEntry => ({
  title: text(item.title),
  company: text(item.company),
  startDate: text(item.startDate),
  endDate: text(item.endDate),
  location: text(item.location),
  description: text(item.description),
  achievements: lines(item.achievements),
  skills: normalizeChipList(item.skills, MAX_RESUME_SOFT_SKILLS, MAX_SKILL_LENGTH),
});

const readStrength = (item: Record_): StrengthEntry => ({ title: text(item.title), description: text(item.description) });

const readEducation = (item: Record_): EducationEntry => {
  const achievements = lines(item.achievements);
  return {
    degree: text(item.degree),
    institution: text(item.institution),
    startDate: text(item.startDate),
    endDate: text(item.endDate),
    location: text(item.location),
    ...optionalText('gpa', item.gpa),
    ...(achievements.length > 0 ? { achievements } : {}),
  };
};

const readCertification = (item: Record_): CertificationEntry => ({
  name: text(item.name),
  issuer: text(item.issuer),
  date: text(item.date),
  ...optionalText('expiryDate', item.expiryDate),
  ...optionalText('credentialId', item.credentialId),
});

const readProject = (item: Record_): ProjectEntry => ({
  name: text(item.name),
  role: text(item.role),
  startDate: text(item.startDate),
  endDate: text(item.endDate),
  link: text(item.link),
  description: text(item.description),
  achievements: lines(item.achievements),
});

const readLanguage = (item: Record_): LanguageEntry => ({
  language: text(item.language),
  proficiency: text(item.proficiency),
});

const readAward = (item: Record_): AwardEntry => ({
  title: text(item.title),
  issuer: text(item.issuer),
  date: text(item.date),
  description: text(item.description),
});

const readPublication = (item: Record_): PublicationEntry => ({
  title: text(item.title),
  publisher: text(item.publisher),
  date: text(item.date),
  link: text(item.link),
  description: text(item.description),
});

const readVolunteering = (item: Record_): VolunteeringEntry => ({
  role: text(item.role),
  organization: text(item.organization),
  startDate: text(item.startDate),
  endDate: text(item.endDate),
  location: text(item.location),
  description: text(item.description),
  achievements: lines(item.achievements),
});

const readCourse = (item: Record_): CourseEntry => ({
  name: text(item.name),
  institution: text(item.institution),
  date: text(item.date),
});

const readReference = (item: Record_): ReferenceEntry => ({
  name: text(item.name),
  title: text(item.title),
  company: text(item.company),
  email: text(item.email),
  phone: text(item.phone),
});

const readCustomEntry = (item: Record_): CustomSectionEntry => ({
  heading: text(item.heading),
  subheading: text(item.subheading),
  startDate: text(item.startDate),
  endDate: text(item.endDate),
  location: text(item.location),
  description: text(item.description),
  achievements: lines(item.achievements),
});

/** What names an entry of each kind; an entry with none of these is an abandoned row and is dropped. */
const NAMED = {
  experience: (entry: ExperienceEntry) =>
    Boolean(entry.title || entry.company || entry.description || entry.achievements.length),
  strengths: (entry: StrengthEntry) => Boolean(entry.title || entry.description),
  education: (entry: EducationEntry) => Boolean(entry.degree || entry.institution),
  certifications: (entry: CertificationEntry) => Boolean(entry.name || entry.issuer),
  projects: (entry: ProjectEntry) => Boolean(entry.name || entry.role || entry.description || entry.achievements.length),
  languages: (entry: LanguageEntry) => Boolean(entry.language),
  awards: (entry: AwardEntry) => Boolean(entry.title || entry.issuer),
  publications: (entry: PublicationEntry) => Boolean(entry.title),
  volunteering: (entry: VolunteeringEntry) => Boolean(entry.role || entry.organization),
  courses: (entry: CourseEntry) => Boolean(entry.name),
  references: (entry: ReferenceEntry) => Boolean(entry.name),
  custom: (entry: CustomSectionEntry) =>
    Boolean(entry.heading || entry.subheading || entry.description || entry.achievements.length),
};

/**
 * The custom sections. A malformed or repeated key drops the whole section (a repaired key would no longer match the
 * `custom:<key>` ref the order carries); a section survives on its title alone, so an added, empty card keeps its name.
 */
function normalizeCustomSections(value: unknown, existing?: readonly CustomSection[]): CustomSection[] {
  if (!Array.isArray(value)) return existing ? [...existing] : [];
  const seen = new Set<string>();
  const out: CustomSection[] = [];
  for (const item of value.slice(0, MAX_ITEMS_READ)) {
    if (out.length >= MAX_RESUME_CUSTOM_SECTIONS) break;
    if (!isPlainRecord(item)) continue;
    const key = text(item.key);
    if (!isCustomSectionKey(key) || seen.has(key)) continue;
    const title = text(item.title).replace(/\s+/g, ' ').slice(0, MAX_CUSTOM_SECTION_TITLE_LENGTH).trim();
    const entries = entryList(item.entries, undefined, readCustomEntry, NAMED.custom);
    if (!title && entries.length === 0) continue;
    seen.add(key);
    out.push({ key, title, entries });
  }
  return out;
}

/**
 * Skills in any shape a file writes them: a flat list (["C#", "Python"]), a category map ({ Languages: ["C#"] }), a
 * list of groups ([{ category, skills }]; also { name, items } and similar), or a mix of names and groups. `skills` is
 * the flat union in first-seen order; `categories` the grouping, [] when there was none. A group with an empty heading
 * still adds its skills to the flat list; a heading repeated later extends the first.
 */
export function normalizeSkillsInput(value: unknown): { skills: string[]; categories: SkillCategoryGroup[] } {
  const skills: string[] = [];
  const spelling = new Map<string, string>();
  const categories: SkillCategoryGroup[] = [];
  const byCategory = new Map<string, { group: SkillCategoryGroup; members: Set<string> }>();
  // Every list read is bounded, and lookups are by key, so a hostile file costs linear time.
  let budget = MAX_ITEMS_READ * 5;

  const addSkill = (raw: unknown): string => {
    const skill = text(raw).replace(/\s+/g, ' ').slice(0, MAX_SKILL_LENGTH).trim();
    if (!skill) return '';
    const key = skill.toLowerCase();
    const held = spelling.get(key);
    if (held !== undefined) return held;
    spelling.set(key, skill);
    skills.push(skill);
    return skill;
  };

  const addGroup = (rawCategory: unknown, rawSkills: unknown) => {
    const category = text(rawCategory).replace(/\s+/g, ' ');
    const members: string[] = [];
    for (const raw of (Array.isArray(rawSkills) ? rawSkills : [rawSkills]).slice(0, MAX_ITEMS_READ)) {
      if (budget-- <= 0) break;
      const skill = addSkill(raw);
      if (skill) members.push(skill);
    }
    if (!category || members.length === 0) return;
    const categoryKey = category.toLowerCase();
    let entry = byCategory.get(categoryKey);
    if (!entry) {
      entry = { group: { category, skills: [] }, members: new Set() };
      byCategory.set(categoryKey, entry);
      categories.push(entry.group);
    }
    for (const skill of members) {
      const key = skill.toLowerCase();
      if (entry.members.has(key)) continue;
      entry.members.add(key);
      entry.group.skills.push(skill);
    }
  };

  const readEntry = (entry: unknown) => {
    if (budget-- <= 0) return;
    if (typeof entry === 'string') {
      addSkill(entry);
      return;
    }
    if (!isPlainRecord(entry)) return;
    addGroup(entry.category ?? entry.name ?? entry.title ?? entry.label, entry.skills ?? entry.items ?? entry.values ?? entry.list);
  };

  if (Array.isArray(value)) value.slice(0, MAX_ITEMS_READ).forEach(readEntry);
  else if (isPlainRecord(value)) {
    for (const [category, members] of Object.entries(value).slice(0, MAX_ITEMS_READ)) addGroup(category, members);
  }
  return { skills, categories };
}

/**
 * The two skill fields, decided together:
 * - naming neither keeps both as stored;
 * - a grouped shape given (in `skills` or `skillCategories`) is the grouping, merged into the flat list so every
 *   grouped skill is also in `skills`; the flat list keeps the order it was given in (the stored one when only
 *   `skillCategories` is sent), grouped skills it lacks follow;
 * - naming only a flat `skills` list clears the grouping.
 */
function normalizeSkills(
  input: Record_,
  stored?: ResumeDocument,
): { skills: string[]; skillCategories?: SkillCategoryGroup[] } {
  // Only a list or a category map counts as given; any other shape reads as omitted, like every field here.
  const shaped = (value: unknown) => Array.isArray(value) || isPlainRecord(value);
  const hasSkills = shaped(input.skills);
  const hasCategories = shaped(input.skillCategories);
  if (!hasSkills && !hasCategories) {
    return {
      skills: [...(stored?.skills ?? [])],
      ...(stored?.skillCategories?.length ? { skillCategories: stored.skillCategories } : {}),
    };
  }
  const fromSkills = normalizeSkillsInput(hasSkills ? input.skills : (stored?.skills ?? []));
  const fromCategories = hasCategories ? normalizeSkillsInput(input.skillCategories) : { skills: [], categories: [] };
  const merged = normalizeSkillsInput([...fromSkills.skills, ...fromSkills.categories, ...fromCategories.categories]);
  const kept = merged.skills.slice(0, MAX_RESUME_SKILLS);
  const keptKeys = new Set(kept.map((skill) => skill.toLowerCase()));
  const categories = merged.categories
    .map((group) => ({ ...group, skills: group.skills.filter((skill) => keptKeys.has(skill.toLowerCase())) }))
    .filter((group) => group.skills.length > 0);
  return { skills: kept, ...(categories.length > 0 ? { skillCategories: categories } : {}) };
}

function isLayout(value: unknown): value is TechnicalSkillsLayout {
  return (TECHNICAL_SKILLS_LAYOUTS as readonly unknown[]).includes(value);
}

/** Booleans decide only when boolean; the layout only when valid; anything else keeps the stored choice. */
function normalizeSettings(value: unknown, stored?: ResumeSettings): ResumeSettings {
  const source = isPlainRecord(value) ? value : {};
  return {
    technicalSkillsLayout: isLayout(source.technicalSkillsLayout)
      ? source.technicalSkillsLayout
      : (stored?.technicalSkillsLayout ?? DEFAULT_TECHNICAL_SKILLS_LAYOUT),
    includeSoftSkills:
      typeof source.includeSoftSkills === 'boolean' ? source.includeSoftSkills : stored?.includeSoftSkills === true,
    includeStrengths:
      typeof source.includeStrengths === 'boolean' ? source.includeStrengths : stored?.includeStrengths === true,
  };
}

function normalizeContact(value: unknown, stored?: ResumeContact): Required<ResumeContact> {
  const source = isPlainRecord(value) ? value : {};
  const pick = (key: keyof ResumeContact) => text(source[key], stored?.[key] ?? '');
  return {
    phone: pick('phone'),
    email: pick('email'),
    location: pick('location'),
    linkedin: pick('linkedin'),
    github: pick('github'),
    portfolio: pick('portfolio'),
  };
}

/** Years as a number of at most 80 to one decimal; null or blank text clears; anything unreadable keeps the stored value. */
function normalizeYears(value: unknown, stored?: number): number | undefined {
  if (value === null || (typeof value === 'string' && value.trim() === '')) return undefined;
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 80) return Math.round(parsed * 10) / 10;
  return stored;
}

/**
 * The stored order (catalogue semantics). Omitted, or not a list, keeps the stored order re-cleaned against the custom
 * sections just saved; [] (or a list with no valid ref) clears it back to the template's own order.
 */
function normalizeSectionOrder(
  value: unknown,
  stored: readonly string[] | undefined,
  customSections: readonly CustomSection[],
): string[] | undefined {
  const cleaned = cleanSectionOrder(Array.isArray(value) ? value : stored, customSections.map((section) => section.key));
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * A resume document from any input (a request body, an imported file, an editor draft), laid over `stored` with the
 * rules above. Never throws.
 */
export function normalizeResumeDocument(input: unknown, stored?: ResumeDocument | null): ResumeDocument {
  const source = isPlainRecord(input) ? input : {};
  const base = stored ?? undefined;
  const customSections = normalizeCustomSections(source.customSections, base?.customSections);
  const sectionOrder = normalizeSectionOrder(source.sectionOrder, base?.sectionOrder, customSections);
  const years = normalizeYears(source.totalYearsExperience, base?.totalYearsExperience);
  const softSkills = Array.isArray(source.softSkills) ? source.softSkills : base?.softSkills;
  const interests = Array.isArray(source.interests) ? source.interests : base?.interests;
  return {
    name: text(source.name, base?.name ?? ''),
    title: text(source.title, base?.title ?? ''),
    ...(years !== undefined ? { totalYearsExperience: years } : {}),
    preferredTemplate: text(source.preferredTemplate, base?.preferredTemplate ?? ''),
    resumeSettings: normalizeSettings(source.resumeSettings, base?.resumeSettings),
    contact: normalizeContact(source.contact, base?.contact),
    summary: text(source.summary, base?.summary ?? ''),
    experience: entryList(source.experience, base?.experience, readExperience, NAMED.experience),
    strengths: entryList(source.strengths, base?.strengths, readStrength, NAMED.strengths),
    ...normalizeSkills(source, base),
    softSkills: normalizeChipList(softSkills, MAX_RESUME_SOFT_SKILLS, MAX_SOFT_SKILL_LENGTH),
    education: entryList(source.education, base?.education, readEducation, NAMED.education),
    certifications: entryList(source.certifications, base?.certifications, readCertification, NAMED.certifications),
    projects: entryList(source.projects, base?.projects, readProject, NAMED.projects),
    languages: entryList(source.languages, base?.languages, readLanguage, NAMED.languages),
    awards: entryList(source.awards, base?.awards, readAward, NAMED.awards),
    publications: entryList(source.publications, base?.publications, readPublication, NAMED.publications),
    volunteering: entryList(source.volunteering, base?.volunteering, readVolunteering, NAMED.volunteering),
    courses: entryList(source.courses, base?.courses, readCourse, NAMED.courses),
    interests: normalizeChipList(interests, MAX_RESUME_INTERESTS, MAX_INTEREST_LENGTH),
    references: entryList(source.references, base?.references, readReference, NAMED.references),
    customSections,
    ...(sectionOrder ? { sectionOrder } : {}),
  };
}

/** A new, empty resume on a template and layout (the editor's start, "Start from blank"). */
export function emptyResumeDocument(
  options: { templateId?: string | null; layout?: TechnicalSkillsLayout } = {},
): ResumeDocument {
  return normalizeResumeDocument({
    preferredTemplate: options.templateId ?? '',
    resumeSettings: { technicalSkillsLayout: options.layout ?? DEFAULT_TECHNICAL_SKILLS_LAYOUT },
  });
}

/**
 * The document as a template draws it: a section switch that is on, on a template with no such section, counts as
 * off (free_tailor's `resumeForTemplate`). The same object comes back when nothing changes.
 */
export function documentForTemplate<T extends Pick<ResumeDocument, 'resumeSettings'>>(
  document: T,
  template: { supportsSoftSkills: boolean; supportsStrengths: boolean } | null | undefined,
): T {
  if (!template) return document;
  const settings = document.resumeSettings;
  const dropSoft = settings.includeSoftSkills && !template.supportsSoftSkills;
  const dropStrengths = settings.includeStrengths && !template.supportsStrengths;
  if (!dropSoft && !dropStrengths) return document;
  return {
    ...document,
    resumeSettings: {
      ...settings,
      ...(dropSoft ? { includeSoftSkills: false } : {}),
      ...(dropStrengths ? { includeStrengths: false } : {}),
    },
  };
}
