import { sectionSortKey } from '@tailorit/shared/resume';
import { parsesAsHandlebars } from '../document/handlebars';
import { parentKeyOf, templateNamesField } from '../locator/markup';
import { locateSections, type LocatedSection, type SectionFinds } from '../locator/sections';

export type WarnOnce = (key: string, message: string) => void;

/**
 * The markup with its sections in the stored order. Within each parent element (each column of a two-column
 * template) the sections found are sorted by `sectionSortKey` and refilled into the slots they occupied: what sits
 * between the slots stays put, and a section never leaves the column its template put it in. A result that no
 * longer parses (a Handlebars block opened inside a section and closed outside it) is dropped for the input.
 */
export function reorderSections(
  html: string,
  order: readonly string[],
  finds: SectionFinds,
  templateId: string,
  warn: WarnOnce,
): string {
  const located = locateSections(html, finds);
  const columns = new Map<number, LocatedSection[]>();
  for (const section of located) {
    const key = parentKeyOf(html, section);
    const column = columns.get(key);
    if (column) column.push(section);
    else columns.set(key, [section]);
  }

  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const slots of columns.values()) {
    if (slots.length < 2) continue;
    const sorted = slots
      .map((section, nativeIndex) => ({ section, key: sectionSortKey(section.ref, order, nativeIndex) }))
      .sort((a, b) => a.key - b.key)
      .map((entry) => entry.section);
    if (sorted.every((section, index) => section === slots[index])) continue;
    slots.forEach((slot, index) => {
      const mover = sorted[index]!;
      edits.push({ start: slot.start, end: slot.end, text: html.slice(mover.start, mover.end) });
    });
  }

  const found = new Set(located.map((section) => section.ref));
  for (const ref of order) {
    if (found.has(ref) || ref.startsWith('custom:') || !templateNamesField(html, ref)) continue;
    warn(
      `unmovable|${templateId}|${ref}`,
      `Template "${templateId}" prints a ${ref} section that cannot be moved into the resume's order (no ` +
        `section-${ref} class, no data-section, and no heading to find it by), so it prints where the template puts it.`,
    );
  }

  if (edits.length === 0) return html;
  let output = html;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
  }
  if (parsesAsHandlebars(output) || !parsesAsHandlebars(html)) return output;
  warn(
    `unorderable|${templateId}`,
    `Template "${templateId}" cannot be drawn in the resume's section order: a Handlebars block opens inside one of ` +
      "its sections and closes outside it, so its sections print in the template's own order.",
  );
  return html;
}
