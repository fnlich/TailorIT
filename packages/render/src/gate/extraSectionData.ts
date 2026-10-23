// The render data of the sections beyond the classic six, under each resume field's own name (so a template that
// loops over `certifications` itself keeps working), with the derived text beside the fields: `dates`, `note`,
// `linkHref`/`linkText`, `subline`/`contactLine`. Lenient about shape, and an entry with nothing in it is dropped, so
// no block prints an empty row. Links are policed by the same rules as every other href (links.ts).

export interface LinkRules {
  href(value: string): string;
  display(value: string): string;
}

type Item = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const lines = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
const items = (value: unknown): Item[] =>
  Array.isArray(value)
    ? value.filter((item): item is Item => typeof item === 'object' && item !== null && !Array.isArray(item))
    : [];
const anyOf = (...values: Array<string | string[]>) => values.some((value) => value.length > 0);

/** "01/2022 - Present", one end alone, or ''. */
export function dateRangeText(start: unknown, end: unknown): string {
  return [text(start), text(end)].filter(Boolean).join(' - ');
}

export interface PreparedCustomSection {
  key: string;
  title: string;
  entries: Array<Record<string, unknown>>;
  hasEntries: boolean;
}

export interface ExtraSectionData {
  certifications: Item[];
  projects: Item[];
  volunteering: Item[];
  awards: Item[];
  publications: Item[];
  courses: Item[];
  languages: Item[];
  interests: string[];
  references: Item[];
  customSections: PreparedCustomSection[];
  /** For the generated blocks' `lookup`. */
  customSectionsByKey: Record<string, PreparedCustomSection>;
}

export function prepareExtraSectionData(source: Record<string, unknown>, links: LinkRules): ExtraSectionData {
  const certifications = items(source.certifications)
    .map((item) => {
      const credentialId = text(item.credentialId);
      return {
        name: text(item.name),
        issuer: text(item.issuer),
        date: text(item.date),
        expiryDate: text(item.expiryDate),
        credentialId,
        dates: dateRangeText(item.date, item.expiryDate),
        note: credentialId ? `Credential ID ${credentialId}` : '',
      };
    })
    .filter((item) => anyOf(item.name, item.issuer));

  const projects = items(source.projects)
    .map((item) => ({
      name: text(item.name),
      role: text(item.role),
      startDate: text(item.startDate),
      endDate: text(item.endDate),
      link: text(item.link),
      description: text(item.description),
      achievements: lines(item.achievements),
      dates: dateRangeText(item.startDate, item.endDate),
      linkHref: links.href(text(item.link)),
      linkText: links.display(text(item.link)),
    }))
    .filter((item) => anyOf(item.name, item.role, item.description, item.achievements));

  const volunteering = items(source.volunteering)
    .map((item) => ({
      role: text(item.role),
      organization: text(item.organization),
      startDate: text(item.startDate),
      endDate: text(item.endDate),
      location: text(item.location),
      description: text(item.description),
      achievements: lines(item.achievements),
      dates: dateRangeText(item.startDate, item.endDate),
    }))
    .filter((item) => anyOf(item.role, item.organization));

  const awards = items(source.awards)
    .map((item) => ({
      title: text(item.title),
      issuer: text(item.issuer),
      date: text(item.date),
      description: text(item.description),
      dates: text(item.date),
    }))
    .filter((item) => anyOf(item.title, item.issuer));

  const publications = items(source.publications)
    .map((item) => ({
      title: text(item.title),
      publisher: text(item.publisher),
      date: text(item.date),
      link: text(item.link),
      description: text(item.description),
      dates: text(item.date),
      linkHref: links.href(text(item.link)),
      linkText: links.display(text(item.link)),
    }))
    .filter((item) => anyOf(item.title));

  const courses = items(source.courses)
    .map((item) => ({ name: text(item.name), institution: text(item.institution), date: text(item.date), dates: text(item.date) }))
    .filter((item) => anyOf(item.name));

  const languages = items(source.languages)
    .map((item) => ({ language: text(item.language), proficiency: text(item.proficiency) }))
    .filter((item) => anyOf(item.language));

  const references = items(source.references)
    .map((item) => {
      const title = text(item.title);
      const company = text(item.company);
      const email = text(item.email);
      const phone = text(item.phone);
      return {
        name: text(item.name),
        title,
        company,
        email,
        phone,
        subline: [title, company].filter(Boolean).join(', '),
        contactLine: [email, phone].filter(Boolean).join(' | '),
      };
    })
    .filter((item) => anyOf(item.name));

  const customSections: PreparedCustomSection[] = [];
  for (const item of items(source.customSections)) {
    const key = text(item.key);
    if (!key || customSections.some((section) => section.key === key)) continue;
    const entries = items(item.entries)
      .map((entry) => ({
        heading: text(entry.heading),
        subheading: text(entry.subheading),
        startDate: text(entry.startDate),
        endDate: text(entry.endDate),
        location: text(entry.location),
        description: text(entry.description),
        achievements: lines(entry.achievements),
        dates: dateRangeText(entry.startDate, entry.endDate),
      }))
      .filter((entry) => anyOf(entry.heading, entry.subheading, entry.description, entry.achievements));
    customSections.push({ key, title: text(item.title), entries, hasEntries: entries.length > 0 });
  }
  const customSectionsByKey: Record<string, PreparedCustomSection> = {};
  for (const section of customSections) customSectionsByKey[section.key] = section;

  return {
    certifications,
    projects,
    volunteering,
    awards,
    publications,
    courses,
    languages,
    interests: lines(source.interests),
    references,
    customSections,
    customSectionsByKey,
  };
}
