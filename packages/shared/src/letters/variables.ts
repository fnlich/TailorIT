import { escapeHtml } from '../format/text';

// Cover-letter template variables: TailorIT's own registry (Simplify's full list is server-side and unknown). A
// variable is written `{{UPPER_SNAKE}}` and stored as that literal text; the editor shows it as a chip.

export const VARIABLE_GROUPS = ['profile', 'dynamic', 'structural', 'ai'] as const;
export type VariableGroup = (typeof VARIABLE_GROUPS)[number];
export const VARIABLE_GROUP_LABEL: Record<VariableGroup, string> = {
  profile: 'Profile',
  dynamic: 'Dynamic',
  structural: 'Structural',
  ai: 'AI Generated',
};

export interface VariableDefinition {
  name: string;
  /** What "Insert variable..." lists. */
  label: string;
  /** One sentence, shown under the label and on the chip's hover. */
  description: string;
  group: VariableGroup;
  /** Used when nothing more specific is known. */
  defaultValue?: string;
}

export const LETTER_VARIABLES: readonly VariableDefinition[] = [
  { name: 'USER_FULL_NAME', label: 'Full name', description: 'Your first and last name.', group: 'profile' },
  { name: 'USER_FIRST_NAME', label: 'First name', description: 'Your first name.', group: 'profile' },
  { name: 'USER_LAST_NAME', label: 'Last name', description: 'Your last name.', group: 'profile' },
  { name: 'USER_EMAIL', label: 'Email', description: 'The email address employers can reach you at.', group: 'profile' },
  { name: 'USER_PHONE', label: 'Phone', description: 'Your phone number.', group: 'profile' },
  { name: 'USER_LOCATION', label: 'Location', description: 'Where you are based, such as your city and state.', group: 'profile' },
  { name: 'USER_LINKEDIN', label: 'LinkedIn', description: 'The link to your LinkedIn profile.', group: 'profile' },
  { name: 'USER_PORTFOLIO', label: 'Portfolio', description: 'The link to your portfolio or personal site.', group: 'profile' },
  {
    name: 'USER_TITLE',
    label: 'Professional title',
    description: 'The headline from your resume, such as Senior Software Engineer.',
    group: 'profile',
  },
  { name: 'COMPANY_NAME', label: 'Company name', description: 'The company you are applying to.', group: 'dynamic' },
  { name: 'JOB_TITLE', label: 'Job title', description: 'The title of the role you are applying for.', group: 'dynamic' },
  {
    name: 'HIRING_MANAGER',
    label: 'Hiring manager',
    description: 'The person the letter is addressed to, or "Hiring Manager" when you do not know.',
    group: 'dynamic',
    defaultValue: 'Hiring Manager',
  },
  {
    name: 'TODAY_DATE',
    label: "Today's date",
    description: 'The date the letter is written, such as October 22, 2026.',
    group: 'dynamic',
  },
  {
    name: 'SALUTATION',
    label: 'Salutation',
    description: 'The greeting line, "Dear Hiring Manager," unless you know who will read it.',
    group: 'structural',
    defaultValue: 'Dear Hiring Manager,',
  },
  {
    name: 'SIGN_OFF',
    label: 'Sign-off',
    description: 'The closing line before your name.',
    group: 'structural',
    defaultValue: 'Sincerely,',
  },
  {
    name: 'CONTACT_LINE',
    label: 'Contact line',
    description: 'Your phone, email and LinkedIn on one line: phone | email | linkedin.',
    group: 'structural',
  },
  {
    name: 'FULL_COVER_LETTER',
    label: 'Full cover letter',
    description: 'The whole letter, written by AI from your resume and the job.',
    group: 'ai',
  },
  {
    name: 'COVER_LETTER_BODY',
    label: 'Cover letter body',
    description: 'The main paragraphs between the greeting and the sign-off, written by AI.',
    group: 'ai',
  },
  {
    name: 'COMPANY_APPEAL',
    label: 'Why this company',
    description: 'What draws you to this company and its work, written by AI.',
    group: 'ai',
  },
  {
    name: 'ROLE_FIT',
    label: 'Fit for the role',
    description: 'How your experience matches what the role asks for, written by AI.',
    group: 'ai',
  },
  {
    name: 'CANDIDATE_STRENGTHS',
    label: 'Your strengths',
    description: 'The strengths from your resume that matter most for this job, written by AI.',
    group: 'ai',
  },
  {
    name: 'SKILL_HIGHLIGHT',
    label: 'Skill highlight',
    description: 'One skill from your resume the job needs, shown in action, written by AI.',
    group: 'ai',
  },
];

const BY_NAME = new Map(LETTER_VARIABLES.map((variable) => [variable.name, variable]));

export type LetterVariableName = (typeof LETTER_VARIABLES)[number]['name'];

/** The registry entry for a name, or null for a variable TailorIT does not know. */
export function variableDefinition(name: string): VariableDefinition | null {
  return BY_NAME.get(name) ?? null;
}

/** The registry grouped for "Insert variable...", in group order. */
export function variablesByGroup(): Array<{ group: VariableGroup; label: string; variables: VariableDefinition[] }> {
  return VARIABLE_GROUPS.map((group) => ({
    group,
    label: VARIABLE_GROUP_LABEL[group],
    variables: LETTER_VARIABLES.filter((variable) => variable.group === group),
  }));
}

/** Whether a variable is written by AI at generation time (the AI Generated group). */
export function isAiVariable(name: string): boolean {
  return BY_NAME.get(name)?.group === 'ai';
}

/** A well-formed variable name: UPPER_SNAKE, starting with a letter. */
export const VARIABLE_NAME_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

export function isVariableName(value: string): boolean {
  return VARIABLE_NAME_PATTERN.test(value);
}

/**
 * `{{NAME}}` as stored. Global: use it with `matchAll` or `replace`, which do not keep state between calls; for
 * `exec`/`test` build a fresh copy (`new RegExp(VARIABLE_PATTERN)`).
 */
export const VARIABLE_PATTERN = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

/** Loose spellings that mean the same variable: `{ {NAME} }` (PDF text), `{{ NAME }}`. */
const LOOSE_VARIABLE_PATTERN = /\{\s*\{\s*([A-Z][A-Z0-9_]*)\s*\}\s*\}/g;

/** The text with every loose variable spelling written as `{{NAME}}`. */
export function normalizePlaceholders(text: string): string {
  return text.replace(LOOSE_VARIABLE_PATTERN, (_match, name: string) => `{{${name}}}`);
}

/** The variable names a text or HTML uses, once each, in the order they first appear. Unknown names included. */
export function findPlaceholders(text: string): string[] {
  const names: string[] = [];
  for (const match of normalizePlaceholders(text).matchAll(VARIABLE_PATTERN)) {
    const name = match[1]!;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

export interface VariableUse {
  name: string;
  count: number;
  /** Null for a name the registry does not know (it can still be replaced by hand). */
  definition: VariableDefinition | null;
}

/** The variables a template's HTML uses, with how often and their registry entries. */
export function listVariables(html: string): VariableUse[] {
  const counts = new Map<string, number>();
  for (const match of normalizePlaceholders(html).matchAll(VARIABLE_PATTERN)) {
    counts.set(match[1]!, (counts.get(match[1]!) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count, definition: variableDefinition(name) }));
}

/** The AI variables a template uses: what the template-fill prompt is asked to write. */
export function aiVariablesIn(html: string): string[] {
  return findPlaceholders(html).filter(isAiVariable);
}

/** A value as HTML: escaped, single line breaks as <br>. */
function inlineHtml(value: string): string {
  return escapeHtml(value.replace(/\r\n?/g, '\n').trim()).replace(/\n/g, '<br>');
}

function paragraphsOf(value: string): string[] {
  return value
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function usable(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Fills a template: every `{{NAME}}` with a non-blank value in `values` becomes that value, HTML-escaped (line breaks
 * as <br>; a value of several paragraphs that fills a paragraph of its own becomes several paragraphs). A variable
 * with no value, or a blank one, stays as the literal `{{NAME}}` for the "Almost there" banner. Loose spellings
 * (`{ {NAME} }`) are read as the variable.
 */
export function substituteVariables(html: string, values: Readonly<Record<string, string | null | undefined>>): string {
  const valueOf = (name: string) => (Object.hasOwn(values, name) ? values[name] : undefined);
  // One pass over the template, so text a value brings in is never read as a variable itself. Attributes are bounded
  // so a run of "<p " with no ">" cannot make the scan quadratic.
  const pattern = /<p(\s[^>]{0,500})?>\s*\{\{([A-Z][A-Z0-9_]*)\}\}\s*<\/p>|\{\{([A-Z][A-Z0-9_]*)\}\}/g;
  return normalizePlaceholders(html).replace(
    pattern,
    (whole, attributes: string | undefined, paragraphName: string | undefined, inlineName: string | undefined) => {
      const name = (paragraphName ?? inlineName)!;
      const value = valueOf(name);
      if (!usable(value)) return whole;
      if (paragraphName === undefined) return inlineHtml(value);
      const parts = paragraphsOf(value);
      const open = `<p${attributes ?? ''}>`;
      return parts.length < 2 ? `${open}${inlineHtml(value)}</p>` : parts.map((part) => `${open}${inlineHtml(part)}</p>`).join('');
    },
  );
}

/** "Replace placeholder": every copy of `{{NAME}}` becomes `text` (escaped). Blank text changes nothing. */
export function replaceAllPlaceholder(html: string, name: string, text: string): string {
  return substituteVariables(html, { [name]: text });
}
