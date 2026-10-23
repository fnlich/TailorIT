import { tidyText } from '../format/text';
import type { EntryBulletsKind } from './catalogue';
import type { ResumeDocument } from './document';

/**
 * What a resume is called in lists: its custom title (Rename) when it has one; else free_tailor's rule, the headline
 * unless it is empty or the old default "Professional", else the name printed on it, else "Untitled resume".
 */
export function resumeLabel(
  document: Pick<ResumeDocument, 'title' | 'name'> | null | undefined,
  customTitle?: string | null,
): string {
  const custom = tidyText(customTitle);
  if (custom) return custom;
  const headline = tidyText(document?.title);
  if (headline && headline !== 'Professional') return headline;
  return tidyText(document?.name) || 'Untitled resume';
}

/** "{label} (Copy)": Duplicate's title. */
export function duplicateTitle(label: string): string {
  return `${label} (Copy)`;
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

function fieldsOf(list: unknown, keys: readonly string[]): string[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) =>
    item && typeof item === 'object' ? keys.flatMap((key) => strings((item as Record<string, unknown>)[key])) : [],
  );
}

/**
 * The resume's own words, as one text the job keywords are looked for in (free_tailor's `resumeEvidence`): the
 * headline and summary, every skill and the headings they are grouped under, soft skills, strengths, each role's
 * title, description, bullets and skills, and the certifications, projects, volunteering, courses, awards and
 * publications. Never a company's name: having worked at Stripe is not having used Stripe.
 */
export function resumeEvidenceText(document: Partial<ResumeDocument> | null | undefined): string {
  if (!document) return '';
  const source = document as Record<string, unknown>;
  return [
    ...strings(source.title),
    ...strings(source.summary),
    ...strings(source.skills),
    ...fieldsOf(source.skillCategories, ['category', 'skills']),
    ...strings(source.softSkills),
    ...fieldsOf(source.strengths, ['title', 'description']),
    ...fieldsOf(source.experience, ['title', 'description', 'achievements', 'skills']),
    ...fieldsOf(source.certifications, ['name', 'issuer']),
    ...fieldsOf(source.projects, ['name', 'role', 'description', 'achievements']),
    ...fieldsOf(source.volunteering, ['role', 'description', 'achievements']),
    ...fieldsOf(source.courses, ['name']),
    ...fieldsOf(source.awards, ['title', 'description']),
    ...fieldsOf(source.publications, ['title', 'description']),
  ]
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** The preview's `sampled` keys in the order the form asks for them, with the words the notice uses. */
export const SAMPLED_FIELD_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['name', 'name'],
  ['title', 'title'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['location', 'location'],
  ['linkedin', 'LinkedIn'],
  ['summary', 'summary'],
  ['experience', 'experience'],
  ['education', 'education'],
  ['skills', 'skills'],
  ['softSkills', 'soft skills'],
  ['strengths', 'strengths'],
];

/**
 * "Sample text shown for: name, phone, experience. It fills what is empty, in the preview only: it is never saved or
 * printed." Null when the page is all the resume's own. A key this build has no word for is still named.
 */
export function sampledNotice(sampled: readonly string[] | null | undefined): string | null {
  if (!Array.isArray(sampled)) return null;
  const keys = sampled.filter((key): key is string => typeof key === 'string' && key.trim() !== '');
  if (keys.length === 0) return null;
  const known = SAMPLED_FIELD_WORDS.filter(([key]) => keys.includes(key)).map(([, words]) => words);
  const unknown = keys
    .filter((key, index) => !SAMPLED_FIELD_WORDS.some(([word]) => word === key) && keys.indexOf(key) === index)
    .map((key) => key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
  return `Sample text shown for: ${[...known, ...unknown].join(', ')}. It fills what is empty, in the preview only: it is never saved or printed.`;
}

/** The template details dialog's features list. */
export function templateFeatures(template: {
  supportsSoftSkills: boolean;
  supportsStrengths: boolean;
  printsSections: readonly string[];
}): string[] {
  const features = ['A4 page, print-ready PDF', 'Technical skills grouped under headings, or as one list'];
  if (template.supportsSoftSkills && template.supportsStrengths) features.push('Soft skills and strengths sections');
  else if (template.supportsSoftSkills) features.push('A soft skills section');
  else if (template.supportsStrengths) features.push('A strengths section');
  if (template.printsSections.includes('projects')) features.push('Projects, languages, awards and sections of your own');
  features.push('Sections in the order you arrange them', 'Switch to another template any time');
  return features;
}

// ----------------------------------------------------------------------------------------------- Write with AI

/** Bullets Write with AI returns at most, and their length. */
export const MAX_AI_BULLETS = 8;
export const MAX_BULLET_LENGTH = 300;
/** The optional note to the AI. */
export const MAX_BULLETS_NOTE_LENGTH = 300;

/** The achievements box as bullets: one per line, trimmed, blanks dropped. */
export function achievementsFromText(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** "Write with AI" when the entry has no bullets yet, "Improve with AI" once it has. */
export function bulletsTask(achievements: string | readonly string[]): 'write' | 'improve' {
  const list = typeof achievements === 'string' ? achievementsFromText(achievements) : achievements;
  return list.some((line) => line.trim()) ? 'improve' : 'write';
}

/** Why the button is off (the entry has nothing to write from), or null. */
export function bulletsBlocker(kind: EntryBulletsKind, entry: object): string | null {
  const has = (key: string) => {
    const value = (entry as Record<string, unknown>)[key];
    return typeof value === 'string' && value.trim() !== '';
  };
  switch (kind) {
    case 'experience':
      return has('title') || has('company') ? null : 'Give the role a title or a company before asking for bullets.';
    case 'project':
      return has('name') ? null : 'Give the project a name before asking for bullets.';
    case 'volunteering':
      return has('role') || has('organization')
        ? null
        : 'Give the volunteering entry a role or an organisation before asking for bullets.';
  }
}

/** An AI answer's bullets: strings only, a leading "-", "*" or "•" dropped, trimmed, at most eight of 300 chars. */
export function readBullets(answer: unknown): string[] {
  const list = answer && typeof answer === 'object' ? (answer as { bullets?: unknown }).bullets : undefined;
  return strings(list)
    .map((bullet) => bullet.replace(/^\s*[-*•]+\s*/, '').trim().slice(0, MAX_BULLET_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_AI_BULLETS);
}

/** The line under the bullets box, or null with none. */
export function bulletCountNote(count: number): string | null {
  if (count <= 0) return null;
  const noun = count === 1 ? 'bullet' : 'bullets';
  if (count <= MAX_AI_BULLETS) return `${count} ${noun}.`;
  return `${count} ${noun}. Most roles read best with ${MAX_AI_BULLETS} or fewer; every one you keep is printed.`;
}

/** The line a switched-off Soft Skills or Strengths card shows in place of its list, or null when it keeps nothing. */
export function keptNote(count: number, section: 'softSkills' | 'strengths'): string | null {
  if (count <= 0) return null;
  const noun =
    section === 'softSkills' ? (count === 1 ? 'soft skill' : 'soft skills') : count === 1 ? 'strength' : 'strengths';
  return `${count} ${noun} kept with the resume. Turn the switch on to print and edit ${count === 1 ? 'it' : 'them'}.`;
}
