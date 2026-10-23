import { formatLongDate, type DateInput } from '../format/dates';
import { escapeHtml, htmlToText } from '../format/text';
import { normalizePlaceholders } from './variables';

/** The person a letter is written for: from the default resume, with Settings filling what it lacks. */
export interface LetterProfile {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  portfolio: string;
  title: string;
}

export interface LetterJob {
  companyName: string;
  jobTitle: string;
  /** The person addressed, when known. */
  hiringManager?: string | null;
}

/** "Jordan Avery Chen" -> first "Jordan", last "Chen"; one word is a first name only. */
export function splitName(fullName: string): { first: string; last: string } {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { first: '', last: '' };
  if (words.length === 1) return { first: words[0]!, last: '' };
  return { first: words[0]!, last: words[words.length - 1]! };
}

/** "phone | email | linkedin", leaving out what is missing. */
export function buildContactLine(contact: { phone?: string | null; email?: string | null; linkedin?: string | null }): string {
  return [contact.phone, contact.email, contact.linkedin]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' | ');
}

/** "Dear Ms. Lee," for a known reader, else "Dear Hiring Manager,". */
export function salutationFor(hiringManager?: string | null): string {
  const name = (hiringManager ?? '').trim();
  return `Dear ${name || 'Hiring Manager'},`;
}

/**
 * Values for every deterministic variable (Profile, Dynamic and Structural); AI variables come from the template-fill
 * call. An empty value is left out, so its `{{VAR}}` stays visible for the person to fill.
 */
export function letterVariableValues(input: {
  profile: LetterProfile;
  job: LetterJob;
  today: DateInput;
}): Record<string, string> {
  const { profile, job } = input;
  const { first, last } = splitName(profile.fullName);
  const values: Record<string, string> = {
    USER_FULL_NAME: profile.fullName.trim(),
    USER_FIRST_NAME: first,
    USER_LAST_NAME: last,
    USER_EMAIL: profile.email.trim(),
    USER_PHONE: profile.phone.trim(),
    USER_LOCATION: profile.location.trim(),
    USER_LINKEDIN: profile.linkedin.trim(),
    USER_PORTFOLIO: profile.portfolio.trim(),
    USER_TITLE: profile.title.trim(),
    COMPANY_NAME: job.companyName.trim(),
    JOB_TITLE: job.jobTitle.trim(),
    HIRING_MANAGER: (job.hiringManager ?? '').trim() || 'Hiring Manager',
    TODAY_DATE: formatLongDate(input.today),
    SALUTATION: salutationFor(job.hiringManager),
    SIGN_OFF: 'Sincerely,',
    CONTACT_LINE: buildContactLine(profile),
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''));
}

/**
 * A letter generated without a template, in Simplify's wrapper: the name as a centred heading, the contact line
 * centred under it, "Dear Hiring Manager,", the paragraphs, "Sincerely," and the name.
 */
export function composeLetterHtml(input: {
  name: string;
  contactLine: string;
  paragraphs: readonly string[];
  salutation?: string;
  signOff?: string;
}): string {
  const centred = (tag: 'h1' | 'p', text: string) => `<${tag} style="text-align: center">${escapeHtml(text)}</${tag}>`;
  const paragraph = (text: string) => `<p>${escapeHtml(text.trim()).replace(/\n/g, '<br>')}</p>`;
  return [
    input.name.trim() ? centred('h1', input.name.trim()) : '',
    input.contactLine.trim() ? centred('p', input.contactLine.trim()) : '',
    paragraph(input.salutation ?? 'Dear Hiring Manager,'),
    ...input.paragraphs.filter((text) => text.trim()).map(paragraph),
    paragraph(input.signOff ?? 'Sincerely,'),
    input.name.trim() ? paragraph(input.name.trim()) : '',
  ].join('');
}

/**
 * Text read from an uploaded PDF or DOCX as editor HTML: one paragraph per blank-line-separated block, single line
 * breaks kept, `{ {VAR} }` read as `{{VAR}}`, everything escaped.
 */
export function textToHtmlParagraphs(text: string): string {
  return normalizePlaceholders(text.replace(/\r\n?/g, '\n'))
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** A letter's or template's plain text (`content_text`: search and the table preview). */
export function letterPlainText(html: string): string {
  return htmlToText(html);
}
