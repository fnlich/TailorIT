// The resume's section catalogue (free_tailor's, written for TailorIT): fifteen kinds of section plus custom sections
// the person titles, with what the editor needs to show each one, and the one place the section order's semantics
// live. Section ids double as the resume field each kind reads (`skills` also reads `skillCategories`); a custom
// section is referred to as `custom:<key>`.

export type ClassicSectionKind = 'summary' | 'strengths' | 'skills' | 'softSkills' | 'experience' | 'education';
export type ExtraSectionKind =
  | 'certifications'
  | 'projects'
  | 'volunteering'
  | 'awards'
  | 'publications'
  | 'courses'
  | 'languages'
  | 'interests'
  | 'references';
export type SectionKind = ClassicSectionKind | ExtraSectionKind;

/** How a kind's content is shaped: a paragraph, a list of entries, or one inline line. */
export type SectionShape = 'text' | 'entries' | 'inline';

/** Which editor a section's card holds. */
export type SectionEditor = 'summary' | 'skills' | 'softSkills' | 'chips' | 'entries';

/** The three entry kinds Write with AI serves (the bullets endpoint's `kind`). */
export const ENTRY_BULLETS_KINDS = ['experience', 'project', 'volunteering'] as const;
export type EntryBulletsKind = (typeof ENTRY_BULLETS_KINDS)[number];

/** One box of the Edit Entry panel. `url`, `email` and `tel` only pick the keyboard; the text is kept as typed. */
export interface FieldSpec {
  name: string;
  label: string;
  placeholder?: string;
  input?: 'text' | 'textarea' | 'url' | 'email' | 'tel';
  /** Spans both columns of the panel. */
  wide?: boolean;
}

/** Phosphor icon names the web maps to components. */
export type SectionIcon =
  | 'text-align-left'
  | 'shield-check'
  | 'wrench'
  | 'users-three'
  | 'briefcase'
  | 'graduation-cap'
  | 'certificate'
  | 'folder'
  | 'hand-heart'
  | 'trophy'
  | 'book-open'
  | 'book'
  | 'translate'
  | 'star'
  | 'address-book'
  | 'list';

/** The editor's half of a section: shared by the fifteen kinds and the custom sections. */
export interface SectionSpec {
  shape: SectionShape;
  /** Whether entries carry achievement bullets (what Write with AI writes). */
  hasBullets: boolean;
  icon: SectionIcon;
  /** The card label, in the editor's casing ("Soft skills"); `heading` is what prints. */
  label: string;
  /** What one row is called: "+ Add {entryNoun}", "Edit {entryNoun}". */
  entryNoun: string;
  /** The Add content tile's line; '' for the default cards, which are always shown. */
  blurb: string;
  /** The line under the card label; '' for none. */
  description: string;
  editor: SectionEditor;
  /** The Edit Entry panel's boxes, in order; [] for a kind with no entries. */
  fields: readonly FieldSpec[];
  aiKind?: EntryBulletsKind;
}

export interface SectionKindDefinition extends SectionSpec {
  id: SectionKind;
  /** The printed heading. */
  heading: string;
  /** One of the six every template has its own markup for. */
  isClassic: boolean;
  /** Always shown as a card, with no Remove section (the classic six and Certifications). */
  isDefault: boolean;
}

const DATES: readonly FieldSpec[] = [
  { name: 'startDate', label: 'Start date', placeholder: 'MM/YYYY' },
  { name: 'endDate', label: 'End date', placeholder: 'MM/YYYY or Present' },
];
const LOCATION: FieldSpec = { name: 'location', label: 'Location', placeholder: 'City, country or Remote', wide: true };
const description = (placeholder: string): FieldSpec => ({
  name: 'description',
  label: 'Description',
  placeholder,
  input: 'textarea',
  wide: true,
});

const PRINTED_AS_WRITTEN = 'Printed when it has an entry, as you write it here.';

/** Canonical order: the classic six as resumes have always printed them, then the nine others. */
export const SECTION_KINDS: readonly SectionKindDefinition[] = [
  {
    id: 'summary',
    heading: 'Professional Summary',
    shape: 'text',
    hasBullets: false,
    isClassic: true,
    isDefault: true,
    icon: 'text-align-left',
    label: 'Summary',
    entryNoun: 'summary',
    blurb: '',
    description: 'A few sentences on who you are, what you do best and what you are looking for.',
    editor: 'summary',
    fields: [],
  },
  {
    id: 'strengths',
    heading: 'Key Strengths',
    shape: 'entries',
    hasBullets: false,
    isClassic: true,
    isDefault: true,
    icon: 'shield-check',
    label: 'Strengths',
    entryNoun: 'strength',
    blurb: '',
    description: '',
    editor: 'entries',
    fields: [
      { name: 'title', label: 'Title', placeholder: 'e.g. Customer-centric', wide: true },
      description('One or two sentences, with a number if there is one'),
    ],
  },
  {
    id: 'skills',
    heading: 'Technical Skills',
    shape: 'inline',
    hasBullets: false,
    isClassic: true,
    isDefault: true,
    icon: 'wrench',
    label: 'Technical skills',
    entryNoun: 'skill',
    blurb: '',
    description: 'The skills you list here, in your order. Grouped prints them under headings; Plain prints one list.',
    editor: 'skills',
    fields: [],
  },
  {
    id: 'softSkills',
    heading: 'Soft Skills',
    shape: 'inline',
    hasBullets: false,
    isClassic: true,
    isDefault: true,
    icon: 'users-three',
    label: 'Soft skills',
    entryNoun: 'soft skill',
    blurb: '',
    description: '',
    editor: 'softSkills',
    fields: [],
  },
  {
    id: 'experience',
    heading: 'Professional Experience',
    shape: 'entries',
    hasBullets: true,
    isClassic: true,
    isDefault: true,
    icon: 'briefcase',
    label: 'Experience',
    entryNoun: 'experience',
    blurb: '',
    description:
      'A role, company and dates are enough to start. Add what you did, one achievement per line, or let Write with AI draft the bullets from your notes.',
    editor: 'entries',
    fields: [
      { name: 'title', label: 'Job title', placeholder: 'e.g. Senior Software Engineer' },
      { name: 'company', label: 'Company', placeholder: 'e.g. Northwind Payments' },
      ...DATES,
      LOCATION,
      description('Brief description of the role'),
    ],
    aiKind: 'experience',
  },
  {
    id: 'education',
    heading: 'Education',
    shape: 'entries',
    hasBullets: false,
    isClassic: true,
    isDefault: true,
    icon: 'graduation-cap',
    label: 'Education',
    entryNoun: 'education',
    blurb: '',
    description: '',
    editor: 'entries',
    fields: [
      { name: 'degree', label: 'Degree', placeholder: 'e.g. M.S. Computer Science' },
      { name: 'institution', label: 'Institution', placeholder: 'e.g. University of Washington' },
      ...DATES,
      LOCATION,
    ],
  },
  {
    id: 'certifications',
    heading: 'Certifications',
    shape: 'entries',
    hasBullets: false,
    isClassic: false,
    isDefault: true,
    icon: 'certificate',
    label: 'Certifications',
    entryNoun: 'certification',
    blurb: 'Certificates and licences, with who issued them and when.',
    description: 'Printed when you add one.',
    editor: 'entries',
    fields: [
      { name: 'name', label: 'Certification', placeholder: 'e.g. AWS Certified Solutions Architect', wide: true },
      { name: 'issuer', label: 'Issuer', placeholder: 'e.g. Amazon Web Services' },
      { name: 'date', label: 'Date', placeholder: 'MM/YYYY' },
    ],
  },
  {
    id: 'projects',
    heading: 'Projects',
    shape: 'entries',
    hasBullets: true,
    isClassic: false,
    isDefault: false,
    icon: 'folder',
    label: 'Projects',
    entryNoun: 'project',
    blurb: 'Side projects, open source, a portfolio piece, each with its own bullets.',
    description: PRINTED_AS_WRITTEN,
    editor: 'entries',
    fields: [
      { name: 'name', label: 'Project name', placeholder: 'e.g. Lakehouse' },
      { name: 'role', label: 'Your role', placeholder: 'e.g. Lead developer' },
      ...DATES,
      { name: 'link', label: 'Link', placeholder: 'github.com/you/project', input: 'url', wide: true },
      description('What it is and what it does'),
    ],
    aiKind: 'project',
  },
  {
    id: 'volunteering',
    heading: 'Volunteering',
    shape: 'entries',
    hasBullets: true,
    isClassic: false,
    isDefault: false,
    icon: 'hand-heart',
    label: 'Volunteering',
    entryNoun: 'volunteering role',
    blurb: 'Unpaid roles, with their own bullets.',
    description: PRINTED_AS_WRITTEN,
    editor: 'entries',
    fields: [
      { name: 'role', label: 'Role', placeholder: 'e.g. Mentor' },
      { name: 'organization', label: 'Organisation', placeholder: 'e.g. Code Club' },
      ...DATES,
      LOCATION,
      description('Brief description of the work'),
    ],
    aiKind: 'volunteering',
  },
  {
    id: 'awards',
    heading: 'Awards',
    shape: 'entries',
    hasBullets: false,
    isClassic: false,
    isDefault: false,
    icon: 'trophy',
    label: 'Awards',
    entryNoun: 'award',
    blurb: 'Prizes and recognitions, with who gave them and when.',
    description: PRINTED_AS_WRITTEN,
    editor: 'entries',
    fields: [
      { name: 'title', label: 'Award', placeholder: 'e.g. Best Paper', wide: true },
      { name: 'issuer', label: 'Given by', placeholder: 'e.g. ACM' },
      { name: 'date', label: 'Date', placeholder: 'MM/YYYY' },
      description('What it was for, in a sentence'),
    ],
  },
  {
    id: 'publications',
    heading: 'Publications',
    shape: 'entries',
    hasBullets: false,
    isClassic: false,
    isDefault: false,
    icon: 'book-open',
    label: 'Publications',
    entryNoun: 'publication',
    blurb: 'Papers, articles and talks, each with a link.',
    description: PRINTED_AS_WRITTEN,
    editor: 'entries',
    fields: [
      { name: 'title', label: 'Title', placeholder: 'e.g. On Lakes', wide: true },
      { name: 'publisher', label: 'Published in', placeholder: 'e.g. VLDB' },
      { name: 'date', label: 'Date', placeholder: 'MM/YYYY' },
      { name: 'link', label: 'Link', placeholder: 'doi.org/...', input: 'url', wide: true },
      description('What it says, in a sentence'),
    ],
  },
  {
    id: 'courses',
    heading: 'Courses',
    shape: 'entries',
    hasBullets: false,
    isClassic: false,
    isDefault: false,
    icon: 'book',
    label: 'Courses',
    entryNoun: 'course',
    blurb: 'Courses and training, with the institution and date.',
    description: PRINTED_AS_WRITTEN,
    editor: 'entries',
    fields: [
      { name: 'name', label: 'Course', placeholder: 'e.g. Machine Learning', wide: true },
      { name: 'institution', label: 'Institution', placeholder: 'e.g. Coursera' },
      { name: 'date', label: 'Date', placeholder: 'MM/YYYY' },
    ],
  },
  {
    id: 'languages',
    heading: 'Languages',
    shape: 'inline',
    hasBullets: false,
    isClassic: false,
    isDefault: false,
    icon: 'translate',
    label: 'Languages',
    entryNoun: 'language',
    blurb: 'Languages spoken, and how well.',
    description: PRINTED_AS_WRITTEN,
    editor: 'entries',
    fields: [
      { name: 'language', label: 'Language', placeholder: 'e.g. French' },
      { name: 'proficiency', label: 'Proficiency', placeholder: 'e.g. Fluent, Native, B2' },
    ],
  },
  {
    id: 'interests',
    heading: 'Interests',
    shape: 'inline',
    hasBullets: false,
    isClassic: false,
    isDefault: false,
    icon: 'star',
    label: 'Interests',
    entryNoun: 'interest',
    blurb: 'A short list of interests, printed on one line.',
    description: PRINTED_AS_WRITTEN,
    editor: 'chips',
    fields: [],
  },
  {
    id: 'references',
    heading: 'References',
    shape: 'entries',
    hasBullets: false,
    isClassic: false,
    isDefault: false,
    icon: 'address-book',
    label: 'References',
    entryNoun: 'reference',
    blurb: 'People who will vouch for you, and how to reach them.',
    description: PRINTED_AS_WRITTEN,
    editor: 'entries',
    fields: [
      { name: 'name', label: 'Name', placeholder: 'e.g. Ann Lee', wide: true },
      { name: 'title', label: 'Their title', placeholder: 'e.g. CTO' },
      { name: 'company', label: 'Company', placeholder: 'e.g. Acme' },
      { name: 'email', label: 'Email', placeholder: 'ann@example.com', input: 'email' },
      { name: 'phone', label: 'Phone', placeholder: '+1 (555) 123-4567', input: 'tel' },
    ],
  },
];

export const SECTION_KIND_IDS: readonly SectionKind[] = SECTION_KINDS.map((kind) => kind.id);

export const SECTION_KIND_BY_ID = Object.fromEntries(SECTION_KINDS.map((kind) => [kind.id, kind])) as Readonly<
  Record<SectionKind, SectionKindDefinition>
>;

/** The six every template has markup for, canonical order. */
export const CLASSIC_SECTION_KINDS = SECTION_KINDS.filter((kind) => kind.isClassic).map(
  (kind) => kind.id,
) as readonly ClassicSectionKind[];

/** The nine printed through a template's extra-sections block, canonical order. */
export const EXTRA_SECTION_KINDS = SECTION_KINDS.filter((kind) => !kind.isClassic).map(
  (kind) => kind.id,
) as readonly ExtraSectionKind[];

/** The cards every resume shows, with no Remove section: the classic six and Certifications. */
export const DEFAULT_SECTION_KINDS: readonly SectionKind[] = SECTION_KINDS.filter((kind) => kind.isDefault).map(
  (kind) => kind.id,
);

/** A section of the person's own: titled by them, its entries shaped like a role's. */
export const CUSTOM_SECTION_SPEC: SectionSpec = {
  shape: 'entries',
  hasBullets: true,
  icon: 'list',
  label: 'Custom section',
  entryNoun: 'entry',
  blurb: "A section of your own, under a title you give it, with entries like a role's.",
  description: 'Printed under its title when it has an entry.',
  editor: 'entries',
  fields: [
    { name: 'heading', label: 'Heading', placeholder: 'e.g. US Patent 1234567' },
    { name: 'subheading', label: 'Subheading', placeholder: 'e.g. Co-inventor' },
    ...DATES,
    LOCATION,
    description('A sentence or two'),
  ],
};

// ------------------------------------------------------------------------------------------------------ limits

/** Entries per list (every entry kind, and each custom section's entries). */
export const MAX_RESUME_SECTION_ENTRIES = 50;
export const MAX_RESUME_CUSTOM_SECTIONS = 10;
export const MAX_CUSTOM_SECTION_TITLE_LENGTH = 100;
/** Achievement bullets kept per entry. */
export const MAX_ENTRY_ACHIEVEMENTS = 50;
/** Chip lists: soft skills, interests, and each role's "Skills used". */
export const MAX_RESUME_SOFT_SKILLS = 50;
export const MAX_SOFT_SKILL_LENGTH = 100;
export const MAX_RESUME_INTERESTS = 50;
export const MAX_INTEREST_LENGTH = 100;
/** Technical skills (a TailorIT guard; free_tailor set none). */
export const MAX_RESUME_SKILLS = 100;
export const MAX_SKILL_LENGTH = 100;

export const CUSTOM_REF_PREFIX = 'custom:';
/** A custom section's key: safe in a class name, an attribute and a template string literal. */
export const CUSTOM_KEY_PATTERN = /^[a-z0-9-]{1,40}$/;

/**
 * The library's headings for Technical Skills, in the order Grouped prints them (free_tailor's 17, which skills.json
 * uses). Headings a person types follow them.
 */
export const HARD_SKILL_CATEGORIES = [
  'Languages',
  'Frameworks and Libraries',
  'Software Architecture & Design',
  'Security',
  'Cloud and Infrastructure',
  'Databases and Storage',
  'DevOps and CI/CD',
  'Observability and Monitoring',
  'Testing and Quality',
  'APIs and Integration',
  'Engineering Practices & Methodology',
  'Data Engineering & Streaming',
  'AI/ML & Data Science',
  'Version Control & Collaboration',
  'Operating Systems & Platforms',
  'Frontend & UI/UX Development',
  'Mobile Development',
] as const;
export type HardSkillCategory = (typeof HARD_SKILL_CATEGORIES)[number];

// ------------------------------------------------------------------------------------------------- references

export type SectionRef = { kind: SectionKind; key?: undefined } | { kind: 'custom'; key: string };

const KIND_SET: ReadonlySet<string> = new Set<string>(SECTION_KIND_IDS);

export function isSectionKind(value: unknown): value is SectionKind {
  return typeof value === 'string' && KIND_SET.has(value);
}

export function isCustomSectionKey(value: unknown): value is string {
  return typeof value === 'string' && CUSTOM_KEY_PATTERN.test(value);
}

export function customSectionRef(key: string): string {
  return `${CUSTOM_REF_PREFIX}${key}`;
}

/** A kind id, or `custom:<key>` with a well-formed key; anything else is null. No trimming, no case folding. */
export function parseSectionRef(value: unknown): SectionRef | null {
  if (typeof value !== 'string') return null;
  if (isSectionKind(value)) return { kind: value };
  if (value.startsWith(CUSTOM_REF_PREFIX)) {
    const key = value.slice(CUSTOM_REF_PREFIX.length);
    return isCustomSectionKey(key) ? { kind: 'custom', key } : null;
  }
  return null;
}

export function sectionRefId(ref: SectionRef): string {
  return ref.kind === 'custom' ? customSectionRef(ref.key) : ref.kind;
}

/** The editor's definition of a section: its kind's, or the one every custom section shares. */
export function sectionSpecOf(ref: SectionRef): SectionSpec {
  return ref.kind === 'custom' ? CUSTOM_SECTION_SPEC : SECTION_KIND_BY_ID[ref.kind];
}

/** Fills `bytes` with random values; `attempt` counts draws for one key (tests use it to force collisions). */
export type RandomBytes = (bytes: Uint8Array, attempt: number) => void;

function cryptoRandomBytes(bytes: Uint8Array): void {
  const source = (globalThis as unknown as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (source && typeof source.getRandomValues === 'function') {
    source.getRandomValues(bytes);
    return;
  }
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
}

/** A key for a new custom section: "cs-" and eight lowercase hex digits, drawn again while `taken` has it. */
export function newCustomSectionKey(random: RandomBytes = cryptoRandomBytes, taken: readonly string[] = []): string {
  const bytes = new Uint8Array(4);
  for (let attempt = 0; ; attempt += 1) {
    random(bytes, attempt);
    const key = `cs-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    if (!taken.includes(key)) return key;
  }
}

// ---------------------------------------------------------------------------------------------- the order

/** What `presenceOf` reads: a resume document, the editor's draft, or render data. */
export type SectionSource = {
  summary?: unknown;
  skills?: unknown;
  skillCategories?: unknown;
  customSections?: unknown;
} & Partial<Record<Exclude<SectionKind, 'summary' | 'skills'>, unknown>>;

export type SectionPresence = {
  /** The kinds with content, canonical order. */
  kinds: SectionKind[];
  /** Every well-formed `customSections[].key`, in stored order, once each. */
  customKeys: string[];
};

const hasEntries = (value: unknown) => Array.isArray(value) && value.length > 0;

/**
 * Which kinds have something to print: a summary that is not blank, skills when the flat list or the grouping has
 * one, every other list when it has an entry. Shape only; the normaliser decides what an entry is.
 */
export function presenceOf(source: SectionSource): SectionPresence {
  const kinds: SectionKind[] = [];
  for (const kind of SECTION_KIND_IDS) {
    let present: boolean;
    if (kind === 'summary') present = typeof source.summary === 'string' && source.summary.trim().length > 0;
    else if (kind === 'skills') present = hasEntries(source.skills) || hasEntries(source.skillCategories);
    else present = hasEntries(source[kind]);
    if (present) kinds.push(kind);
  }
  const customKeys: string[] = [];
  if (Array.isArray(source.customSections)) {
    for (const section of source.customSections) {
      const key = section && typeof section === 'object' ? (section as { key?: unknown }).key : undefined;
      if (isCustomSectionKey(key) && !customKeys.includes(key)) customKeys.push(key);
    }
  }
  return { kinds, customKeys };
}

/**
 * The save rule's core: the valid refs of `value` in their order, once each, a `custom:` ref kept only for a key in
 * `customKeys`. Anything that is not a list reads as nothing. Nothing is appended: completion happens where the order
 * is read (`effectiveSectionOrder`) or drawn (`sectionSortKey`).
 */
export function cleanSectionOrder(value: unknown, customKeys: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const ref = parseSectionRef(item);
    if (!ref) continue;
    if (ref.kind === 'custom' && !customKeys.includes(ref.key)) continue;
    const id = sectionRefId(ref);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * The sort key the PDF reorder and the DOCX share: a listed section's place in the stored order; one the order does
 * not name goes after every listed one, in the template's own order. A kind added later never hides a section.
 */
export function sectionSortKey(ref: string, stored: readonly string[], nativeIndex: number): number {
  const listed = stored.indexOf(ref);
  return listed >= 0 ? listed : stored.length + nativeIndex;
}

/**
 * The order the editor shows a resume's sections in (and the DOCX prints), complete.
 *
 * With nothing stored: the template's own order (`nativeOrder`) filtered to the default kinds and the kinds with
 * content, then any default or present kind the template does not place (canonical order), then the custom sections.
 * With a stored order: that order first (a listed kind with no entries stays: it is an added, empty section), then the
 * unlisted default kinds in the template's order (one it lacks in canonical order), then the unlisted present kinds in
 * that same order, then the unlisted custom sections.
 */
export function effectiveSectionOrder(
  stored: unknown,
  nativeOrder: readonly string[],
  presence: SectionPresence,
): string[] {
  const present = new Set<string>(presence.kinds);
  const defaults = new Set<string>(DEFAULT_SECTION_KINDS);
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (ref: string) => {
    if (seen.has(ref)) return;
    seen.add(ref);
    out.push(ref);
  };
  const nativeKinds = nativeOrder.filter(isSectionKind);
  const storedRefs = cleanSectionOrder(stored, presence.customKeys);

  if (storedRefs.length === 0) {
    for (const id of nativeKinds) if (defaults.has(id) || present.has(id)) push(id);
    for (const id of SECTION_KIND_IDS) if (defaults.has(id) || present.has(id)) push(id);
    for (const key of presence.customKeys) push(customSectionRef(key));
    return out;
  }

  for (const ref of storedRefs) push(ref);
  for (const id of nativeKinds) if (defaults.has(id)) push(id);
  for (const id of DEFAULT_SECTION_KINDS) push(id);
  for (const id of nativeKinds) if (present.has(id)) push(id);
  for (const id of SECTION_KIND_IDS) if (present.has(id)) push(id);
  for (const key of presence.customKeys) push(customSectionRef(key));
  return out;
}

/** The order with `ref` moved `delta` places (negative is up), held inside the list. Always a new array. */
export function moveSection(order: readonly string[], ref: string, delta: number): string[] {
  const from = order.indexOf(ref);
  if (from < 0) return [...order];
  const to = Math.min(order.length - 1, Math.max(0, from + delta));
  if (to === from) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, ref);
  return next;
}

/** The order with `moved` put just before or after `target` (a drop). Unknown refs change nothing. */
export function insertRelative(
  order: readonly string[],
  moved: string,
  target: string,
  edge: 'before' | 'after',
): string[] {
  if (moved === target || !order.includes(moved) || !order.includes(target)) return [...order];
  const without = order.filter((ref) => ref !== moved);
  const at = without.indexOf(target) + (edge === 'after' ? 1 : 0);
  return [...without.slice(0, at), moved, ...without.slice(at)];
}

// ------------------------------------------------------------------------------------------------- the rows

const field = (entry: object, key: string): string => {
  const value = (entry as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
};

/** "01/2023 - 06/2023", "2021 - Present", or one end alone; '' with neither. */
export function dateRange(startDate: unknown, endDate: unknown): string {
  return [startDate, endDate]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join(' - ');
}

const joined = (...parts: string[]) => parts.filter(Boolean).join(' · ');
const atOrganisation = (role: string, organisation: string) =>
  role && organisation ? `${role} at ${organisation}` : role || organisation;

/** A row's two lines, by section: title and meta ('' when nothing names it yet). */
function rowLines(kind: SectionKind | 'custom', entry: object): { title: string; meta: string } {
  const dates = () => dateRange(field(entry, 'startDate'), field(entry, 'endDate'));
  switch (kind) {
    case 'strengths':
      return { title: field(entry, 'title'), meta: field(entry, 'description') };
    case 'experience':
      return { title: atOrganisation(field(entry, 'title'), field(entry, 'company')), meta: joined(dates(), field(entry, 'location')) };
    case 'education':
      return {
        title: field(entry, 'degree') || field(entry, 'institution'),
        meta: joined(field(entry, 'degree') ? field(entry, 'institution') : '', dates()),
      };
    case 'certifications':
      return { title: field(entry, 'name'), meta: joined(field(entry, 'issuer'), field(entry, 'date')) };
    case 'projects':
      return { title: field(entry, 'name'), meta: joined(field(entry, 'role'), dates()) };
    case 'volunteering':
      return {
        title: atOrganisation(field(entry, 'role'), field(entry, 'organization')),
        meta: joined(dates(), field(entry, 'location')),
      };
    case 'awards':
      return { title: field(entry, 'title'), meta: joined(field(entry, 'issuer'), field(entry, 'date')) };
    case 'publications':
      return { title: field(entry, 'title'), meta: joined(field(entry, 'publisher'), field(entry, 'date')) };
    case 'courses':
      return { title: field(entry, 'name'), meta: joined(field(entry, 'institution'), field(entry, 'date')) };
    case 'languages':
      return { title: field(entry, 'language'), meta: field(entry, 'proficiency') };
    case 'references':
      return { title: field(entry, 'name'), meta: joined(field(entry, 'title'), field(entry, 'company')) };
    case 'custom':
      return { title: field(entry, 'heading'), meta: joined(field(entry, 'subheading'), dates()) };
    default:
      return { title: '', meta: '' };
  }
}

export interface EntrySummary {
  title: string;
  meta: string;
  /** Nothing names the entry yet and `title` is the stand-in ("Project 2"). */
  untitled: boolean;
}

/** How a card lists one entry: its title and a second line, or "{Entry noun} {n}" for one not yet named. */
export function entrySummary(kind: SectionKind | 'custom', entry: object, index: number): EntrySummary {
  const { title, meta } = rowLines(kind, entry);
  if (title) return { title, meta, untitled: false };
  const noun = (kind === 'custom' ? CUSTOM_SECTION_SPEC : SECTION_KIND_BY_ID[kind]).entryNoun;
  return { title: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${index + 1}`, meta, untitled: true };
}
