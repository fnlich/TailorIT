import { collapseWhitespace, truncateText } from '../format/text';
import { formatEnUsDateTime, formatMDYYYY, type DateInput } from '../format/dates';

// Cover letter and template constants: fonts, default names, limits and Simplify's generic UI copy.

export interface LetterFont {
  name: string;
  /** The CSS font stack the editor and the print use. */
  css: string;
}

/** The editor's font select, Times New Roman first (the default). Fonts are bundled, so print needs no network. */
export const LETTER_FONTS = [
  { name: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { name: 'Helvetica', css: 'Helvetica, Arial, sans-serif' },
  { name: 'Courier', css: '"Courier New", Courier, monospace' },
  { name: 'Open Sans', css: '"Open Sans", sans-serif' },
  { name: 'Roboto', css: 'Roboto, sans-serif' },
  { name: 'Lato', css: 'Lato, sans-serif' },
  { name: 'Poppins', css: 'Poppins, sans-serif' },
  { name: 'Arimo', css: 'Arimo, sans-serif' },
  { name: 'Work Sans', css: '"Work Sans", sans-serif' },
  { name: 'Roboto Mono', css: '"Roboto Mono", monospace' },
] as const satisfies readonly LetterFont[];

export type LetterFontName = (typeof LETTER_FONTS)[number]['name'];
export const LETTER_FONT_NAMES = LETTER_FONTS.map((font) => font.name) as [LetterFontName, ...LetterFontName[]];
export const DEFAULT_LETTER_FONT: LetterFontName = 'Times New Roman';

/** The CSS stack of a font name; the default font's for an unknown name. */
export function letterFontCss(name: string | null | undefined): string {
  return LETTER_FONTS.find((font) => font.name === name)?.css ?? LETTER_FONTS[0].css;
}

/** A new letter's title: "Cover Letter 10/22/2026". */
export function defaultLetterTitle(date: DateInput): string {
  return `Cover Letter ${formatMDYYYY(date)}`;
}

/** A new template's name: "Template 10/22/2026, 3:04:05 PM". */
export function defaultTemplateName(date: DateInput): string {
  return `Template ${formatEnUsDateTime(date)}`;
}

/** Duplicate's name: "{name} (Copy)". */
export function duplicateTemplateName(name: string): string {
  return `${name} (Copy)`;
}

/** The Templates table's preview: the first 80 characters of the plain text, then "..." when there is more. */
export const TEMPLATE_PREVIEW_LENGTH = 80;
export function templatePreviewText(text: string): string {
  return truncateText(collapseWhitespace(text), TEMPLATE_PREVIEW_LENGTH);
}

export const TEMPLATE_NAME_MIN = 3;
export const TEMPLATE_NAME_MAX = 200;
export const TEMPLATE_NAME_MESSAGE = 'Template name must be at least 3 characters long';
export const LETTER_TITLE_MIN = 3;
export const LETTER_TITLE_MAX = 200;
export const LETTER_TITLE_MESSAGE = 'Cover letter name must be at least 3 characters long';

/** The rename rule (trimmed length of at least 3), or null when the name is fine. */
export function validateTemplateName(name: string): string | null {
  const length = name.trim().length;
  if (length < TEMPLATE_NAME_MIN) return TEMPLATE_NAME_MESSAGE;
  if (length > TEMPLATE_NAME_MAX) return `Template name must be at most ${TEMPLATE_NAME_MAX} characters long`;
  return null;
}

export function validateLetterTitle(title: string): string | null {
  const length = title.trim().length;
  if (length < LETTER_TITLE_MIN) return LETTER_TITLE_MESSAGE;
  if (length > LETTER_TITLE_MAX) return `Cover letter name must be at most ${LETTER_TITLE_MAX} characters long`;
  return null;
}

/** "Copilot AI Prompt" (a template's), the generate dialog's Custom Prompt, and the pasted job description. */
export const AI_PROMPT_MAX = 1000;
export const CUSTOM_PROMPT_MAX = 5000;
export const JOB_DESCRIPTION_MAX = 50_000;
/** Letter and template HTML (TipTap output). */
export const LETTER_HTML_MAX = 200_000;

/** "Load an example" in the Custom Prompt tab. */
export const CUSTOM_PROMPT_EXAMPLE =
  "Emphasize my skills and experience in [REPLACE] and how that relates to [COMPANY]'s mission of [REPLACE]";

export const LETTER_EDITOR_PLACEHOLDER = 'Dear Hiring Manager...';
export const TEMPLATE_EDITOR_PLACEHOLDER =
  'Write your template here using placeholders, or leave it empty and use the AI Prompt to generate the entire cover letter.';
export const PLACEHOLDER_BANNER_TITLE = 'Almost there - fill in these details to finish your letter';
export const PLACEHOLDER_BANNER_TEXT = 'Click a tag to replace it.';
export const REPLACE_PLACEHOLDER_TITLE = 'Replace placeholder';
export function replacePlaceholderHint(name: string): string {
  return `All tags named {{${name}}} will become the text you enter below.`;
}
export const LETTER_NAME_TOOLTIP =
  'This name is only for your documents list. It is not shown inside the letter unless you add it in the editor.';
export const TEMPLATE_NAME_TOOLTIP =
  'This name appears in your documents list when you choose a template for a cover letter.';
export const AI_PROMPT_HINT =
  'This prompt will be used as additional context when generating a cover letter from this template.';
