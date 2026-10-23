import type { TechnicalSkillsLayout } from '@tailorit/shared/resume';
import { parsesAsHandlebars } from '../document/handlebars';
import type { SectionFinds } from '../locator/sections';
import { expandExtraSectionsMacro, injectExtraSectionsStyle } from './extraSections';
import { guardEmptyCategoryHeadings, guardEmptyDescriptions, guardSection, OPTIONAL_SECTIONS, stripSection } from './guards';
import { fitPlainSkillGroups } from './plainSkills';
import { reorderSections, type WarnOnce } from './reorder';
import { rewritePerItemSkillLoops } from './skillLoops';

/** What one resume decides about a template's markup. Read from the render data, so markup and data agree. */
export interface CompileChoices {
  layout: TechnicalSkillsLayout;
  softSkills: boolean;
  strengths: boolean;
  /** The stored order (cleaned), or null for the template's own. */
  sectionOrder: readonly string[] | null;
  /** The custom sections' keys: one generated block each. */
  customKeys: readonly string[];
}

/**
 * A template's markup as compiled for one resume's choices, in this order:
 *  1. expand the extra-sections macro (first, so its blocks are guarded and moved like the template's own);
 *  2. strip a switched-off Soft Skills / Strengths section, guard a switched-on one;
 *  3. move sections into the stored order, within each column;
 *  4. "Hard Skills" headings read "Technical Skills";
 *  5. Grouped: rewrite the per-skill loops into groups; Plain: let the one headless group take the whole row;
 *  6. the generated blocks' baseline stylesheet;
 *  7. guard empty category headings, then empty descriptions.
 */
export function normalizeTemplateMarkup(
  html: string,
  choices: CompileChoices,
  finds: SectionFinds,
  templateId: string,
  warn: WarnOnce,
): string {
  let output = expandExtraSectionsMacro(html, choices.customKeys);
  if (finds !== 'none') {
    for (const section of OPTIONAL_SECTIONS) {
      output = choices[section.choice] ? guardSection(output, section, finds) : stripSection(output, section, finds);
    }
    if (choices.sectionOrder && choices.sectionOrder.length > 0) {
      output = reorderSections(output, choices.sectionOrder, finds, templateId, warn);
    }
  }
  output = output.replace(/Hard Skills/g, 'Technical Skills');
  output = choices.layout === 'categorized' ? rewritePerItemSkillLoops(output) : fitPlainSkillGroups(output);
  output = injectExtraSectionsStyle(output);
  return guardEmptyDescriptions(guardEmptyCategoryHeadings(output));
}

/**
 * The markup a template compiles from. A cut follows the HTML and a Handlebars block need not, so when finding
 * sections leaves markup that no longer parses (and the template itself does), the finds fall back: marks only,
 * then nothing at all (a switched-off list then prints empty, and only its heading may show).
 */
export function compilableMarkup(html: string, choices: CompileChoices, templateId: string, warn: WarnOnce): string {
  const full = normalizeTemplateMarkup(html, choices, 'all', templateId, warn);
  if (parsesAsHandlebars(full) || !parsesAsHandlebars(html)) return full;
  const marked = normalizeTemplateMarkup(html, choices, 'marked', templateId, warn);
  if (parsesAsHandlebars(marked)) {
    warn(
      `fallback|${templateId}|marked`,
      `Template "${templateId}" does not compile with its sections found from their lists, so only sections marked ` +
        'with a section-<kind> class or data-section are removed, guarded or moved.',
    );
    return marked;
  }
  warn(
    `fallback|${templateId}|none`,
    `Template "${templateId}" does not compile with its optional sections removed or its sections moved, so it is ` +
      "drawn with every section in place and in its own order.",
  );
  return normalizeTemplateMarkup(html, choices, 'none', templateId, warn);
}
