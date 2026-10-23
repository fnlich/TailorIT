import { EXTRA_SECTION_KINDS, SECTION_KIND_IDS, type SectionKind } from '@tailorit/shared/resume';
import { sectionLoops, sectionOfLoop } from './loops';
import {
  nextClassedElement,
  nextDataSectionElement,
  templateNamesField,
  withGuards,
  type MarkupSpan,
} from './markup';

// Where a template's sections are. The compile step strips or guards the two optional sections and moves sections
// into a resume's stored order; the template description reads which kinds a template prints and in what order.
// All of them ask this module, so they always agree.
//
// A section is found, in order, by:
//   Stage A: its marker class `section-<kind>` (every built-in, the generated extra-section blocks) or its
//            `data-section` attribute (azure-stack); the generated blocks also by the comments around them;
//   Stage B: for markup with neither (the uploaded templates), from where its list is printed (loops.ts).

/** How a compile finds sections: everything; marks only (no Stage B); or nothing at all (the last fallback). */
export type SectionFinds = 'all' | 'marked' | 'none';

export interface SectionLocator {
  kind: SectionKind | 'customSections';
  className: string;
  dataSections: readonly string[];
  /** Fields the section's list may be printed from, outermost first (skills: the category loop holds its own). */
  fields: readonly string[];
  /** What its heading reads, for Stage B. */
  heading: RegExp;
}

const extra = (kind: SectionKind, heading: RegExp): SectionLocator => ({
  kind,
  className: `section-${kind}`,
  dataSections: [kind],
  fields: [kind],
  heading,
});

/** In look-up order: Soft Skills before Technical Skills, so a "Soft Skills" heading is never read as the skills'. */
export const SECTION_LOCATORS: readonly SectionLocator[] = [
  { kind: 'summary', className: 'section-summary', dataSections: ['summary'], fields: ['summary'], heading: /summary|profile|about/i },
  {
    kind: 'experience',
    className: 'section-experience',
    dataSections: ['experience'],
    fields: ['experience'],
    heading: /experience|employment|work history/i,
  },
  { kind: 'education', className: 'section-education', dataSections: ['education'], fields: ['education'], heading: /education/i },
  {
    kind: 'softSkills',
    className: 'section-soft-skills',
    dataSections: ['softSkills', 'soft-skills'],
    fields: ['softSkills'],
    heading: /soft[\s-]*skill/i,
  },
  { kind: 'strengths', className: 'section-strengths', dataSections: ['strengths'], fields: ['strengths'], heading: /strength/i },
  {
    kind: 'skills',
    className: 'section-skills',
    dataSections: ['skills', 'hardSkills', 'skillCategories', 'technicalSkills'],
    fields: ['skillCategories', 'hardSkills', 'skills'],
    heading: /^(?!.*\bsoft\b).*(skills?|technolog|tech stack)/i,
  },
  extra('certifications', /certif|licen[cs]e/i),
  extra('projects', /project/i),
  extra('volunteering', /volunteer/i),
  extra('awards', /award|honou?r/i),
  extra('publications', /publication/i),
  extra('courses', /course|training/i),
  extra('languages', /language/i),
  extra('interests', /interest|hobb/i),
  extra('references', /reference/i),
  // Custom sections have no fixed heading; their generated blocks are found by their comments.
  { kind: 'customSections', className: 'section-custom', dataSections: ['customSections'], fields: ['customSections'], heading: /$^/ },
];

export function sectionLocator(kind: SectionLocator['kind']): SectionLocator {
  const found = SECTION_LOCATORS.find((locator) => locator.kind === kind);
  if (!found) throw new Error(`No section locator for ${kind}`);
  return found;
}

/** The one line where a template's extra sections print (expanded by markup/extraSections.ts). */
export const EXTRA_SECTIONS_MACRO_SOURCE = String.raw`\{\{>\s*extra-sections\b([^}]*)\}\}`;

export function hasExtraSectionsMacro(html: string): boolean {
  return new RegExp(EXTRA_SECTIONS_MACRO_SOURCE).test(html);
}

export function withoutExtraSectionsMacro(html: string): string {
  return html.replace(new RegExp(EXTRA_SECTIONS_MACRO_SOURCE, 'g'), '');
}

/**
 * Every occurrence of one kind of section, each widened over the `{{#if field.length}}` guards right around it;
 * overlapping finds are merged so a cut never splits one.
 */
export function findSections(html: string, locator: SectionLocator, finds: SectionFinds = 'all'): MarkupSpan[] {
  const found: MarkupSpan[] = [];
  const inside = (pos: number) => found.some((span) => pos >= span.start && pos < span.end);

  for (let element = nextClassedElement(html, locator.className, 0); element; ) {
    found.push(element);
    element = nextClassedElement(html, locator.className, element.end);
  }
  for (let element = nextDataSectionElement(html, locator.dataSections, 0); element; ) {
    if (!inside(element.start)) found.push(element);
    element = nextDataSectionElement(html, locator.dataSections, element.end);
  }
  if (finds === 'all') {
    for (const field of locator.fields) {
      for (const loop of sectionLoops(html, field)) {
        if (inside(loop.start)) continue;
        const unit = sectionOfLoop(html, loop, locator.heading, field);
        if (unit && !inside(unit.start)) found.push(unit);
      }
    }
  }

  const merged: MarkupSpan[] = [];
  for (const span of found.sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && span.start < last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged.map((span) => withGuards(html, span, locator.fields));
}

/** One located section: which (`projects`, `custom:cs-1a2b3c4d`), and where. */
export interface LocatedSection extends MarkupSpan {
  ref: string;
}

/** The comment pair around one generated block. */
export function generatedBlockMarkers(ref: string): { open: string; close: string } {
  return { open: `<!--xs:${ref}-->`, close: `<!--/xs:${ref}-->` };
}

const generatedBlocks = () =>
  new RegExp(`<!--xs:((?:${SECTION_KIND_IDS.join('|')})|custom:[a-z0-9-]{1,40})-->[\\s\\S]*?<!--/xs:\\1-->`, 'g');

/**
 * Every section of the markup in document order: the generated blocks first (nothing is looked for inside them),
 * then each kind's finds. A span inside another, or holding an earlier find whole (a column), is dropped, so the
 * result never nests and a reorder can move each span whole.
 */
export function locateSections(html: string, finds: SectionFinds = 'all'): LocatedSection[] {
  const located: LocatedSection[] = [];
  const inside = (pos: number) => located.some((span) => pos >= span.start && pos < span.end);
  const blocks = generatedBlocks();
  for (let block = blocks.exec(html); block; block = blocks.exec(html)) {
    located.push({ ref: block[1]!, start: block.index, end: blocks.lastIndex });
  }
  for (const locator of SECTION_LOCATORS) {
    if (locator.kind === 'customSections') continue;
    for (const span of findSections(html, locator, finds)) {
      if (inside(span.start)) continue;
      if (located.some((other) => other.start >= span.start && other.end <= span.end)) continue;
      located.push({ ref: locator.kind, ...span });
    }
  }
  return located.sort((a, b) => a.start - b.start);
}

/**
 * The order a template prints its sections in: each located kind once, in document order, and where the markup
 * carries the extra-sections macro, the kinds it will generate (canonical order) at the first macro's position.
 * Custom sections are never part of it.
 */
export function inferNativeSectionOrder(html: string): string[] {
  const source = typeof html === 'string' ? html : '';
  const placed: Array<{ ref: string; at: number; tie: number }> = [];
  const seen = new Set<string>();
  for (const section of locateSections(source, 'all')) {
    if (seen.has(section.ref) || section.ref.startsWith('custom:')) continue;
    seen.add(section.ref);
    placed.push({ ref: section.ref, at: section.start, tie: 0 });
  }
  const macro = new RegExp(EXTRA_SECTIONS_MACRO_SOURCE).exec(source);
  if (macro) {
    const own = withoutExtraSectionsMacro(source);
    EXTRA_SECTION_KINDS.forEach((kind, index) => {
      if (seen.has(kind) || templateNamesField(own, kind)) return;
      seen.add(kind);
      placed.push({ ref: kind, at: macro.index, tie: index + 1 });
    });
  }
  return placed.sort((a, b) => a.at - b.at || a.tie - b.tie).map((entry) => entry.ref);
}
