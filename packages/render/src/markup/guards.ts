import { parsesAsHandlebars } from '../document/handlebars';
import { guardOpenerPattern } from '../locator/markup';
import { findSections, sectionLocator, type SectionFinds, type SectionLocator } from '../locator/sections';

// Guards added to the markup at compile time, so templates never written for a case still draw it cleanly.

/**
 * The two optional sections a resume switches on and off. Off: removed outright (with their guard), so no
 * template can show one. On: guarded on their list, so an empty one leaves no heading.
 */
export const OPTIONAL_SECTIONS = [
  { locator: sectionLocator('softSkills'), field: 'softSkills', choice: 'softSkills' },
  { locator: sectionLocator('strengths'), field: 'strengths', choice: 'strengths' },
] as const satisfies ReadonlyArray<{ locator: SectionLocator; field: string; choice: 'softSkills' | 'strengths' }>;

export type OptionalSection = (typeof OPTIONAL_SECTIONS)[number];

export function stripSection(html: string, section: OptionalSection, finds: SectionFinds): string {
  let output = html;
  for (const cut of findSections(html, section.locator, finds).reverse()) {
    output = `${output.slice(0, cut.start)}${output.slice(cut.end)}`;
  }
  return output;
}

export function guardSection(html: string, section: OptionalSection, finds: SectionFinds): string {
  const open = `{{#if ${section.field}.length}}`;
  const alreadyGuarded = new RegExp(`^${guardOpenerPattern(section.field)}`);
  let output = html;
  for (const span of findSections(html, section.locator, finds).reverse()) {
    if (alreadyGuarded.test(output.slice(span.start))) continue;
    output =
      `${output.slice(0, span.start)}${open}${output.slice(span.start, span.end)}{{/if}}` + output.slice(span.end);
  }
  return output;
}

/**
 * A category heading disappears when there is no category: Plain is one group with an empty heading. The
 * `<strong>{{category}}</strong><br>` shape goes first so its line break stays inside the guard. Idempotent.
 */
export function guardEmptyCategoryHeadings(html: string): string {
  return html
    .replace(
      /(?<!\{\{#if category\}\})<strong>\s*\{\{category\}\}\s*<\/strong>\s*<br\s*\/?>/g,
      '{{#if category}}<strong>{{category}}</strong><br>{{/if}}',
    )
    .replace(/(?<!\{\{#if category\}\})(<(\w+)\b[^>]*>)\s*\{\{category\}\}\s*(<\/\2>)/g, '{{#if category}}$1{{category}}$3{{/if}}');
}

/**
 * An element holding only a description disappears when there is none (a role with no description otherwise
 * leaves an empty, margined box). A cut that would stop markup parsing is dropped for the markup as written.
 */
export function guardEmptyDescriptions(html: string): string {
  const guarded = html.replace(
    /(?<!\{\{#if description\}\}\s*)(<(\w+)\b[^>]*>)\s*(?:\{\{#if description\}\}\s*\{\{description\}\}\s*\{\{\/if\}\}|\{\{description\}\})\s*(<\/\2>)/g,
    '{{#if description}}$1{{description}}$3{{/if}}',
  );
  if (guarded === html || parsesAsHandlebars(guarded) || !parsesAsHandlebars(html)) return guarded;
  return html;
}
