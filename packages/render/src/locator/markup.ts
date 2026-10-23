// Low-level reading of template markup: element spans, closing tags, the `{{#if field.length}}` guards around a
// span, and the elements open at a position. Templates are Handlebars over HTML, so none of this parses either
// language fully; it reads tags with the same tolerant patterns every step of the engine shares, which is what
// keeps the strip, the guard, the reorder and the template description agreeing about where a section is.

/** A stretch of markup: [start, end). */
export interface MarkupSpan {
  start: number;
  end: number;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether the markup prints `field` itself: a loop over it, a guard on it, or an inline print (`{{summary}}`). */
export function templateNamesField(html: string, field: string): boolean {
  return new RegExp(`\\{\\{[#\\w\\s]*${escapeRegExp(field)}\\b`).test(html);
}

/** Elements that never close, so an opening tag of one is never an ancestor. */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/**
 * The end (just past `>`) of the tag that closes the element whose opening tag ends at `from`, counting nested
 * elements of the same name (case-insensitive); -1 when it never closes. A `<name .../>` does not nest.
 */
export function findClosingTag(html: string, tagName: string, from: number): number {
  const tags = new RegExp(`<(/?)${escapeRegExp(tagName)}(?![\\w-])[^>]*>`, 'gi');
  tags.lastIndex = from;
  let depth = 1;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    if (tag[1]) {
      depth -= 1;
      if (depth === 0) return tags.lastIndex;
    } else if (!tag[0].endsWith('/>')) {
      depth += 1;
    }
  }
  return -1;
}

/** The first element at or after `from` whose opening tag `opener` matches (tag name in group 1) and that closes. */
function nextElement(html: string, opener: RegExp, from: number): MarkupSpan | null {
  opener.lastIndex = from;
  for (let open = opener.exec(html); open; open = opener.exec(html)) {
    const end = findClosingTag(html, open[1]!, opener.lastIndex);
    if (end !== -1) return { start: open.index, end };
  }
  return null;
}

/**
 * The next element at or after `from` carrying `className` as a whole token of its class attribute. Anchored on
 * the tag that carries the class, so a class named in a stylesheet or on an outer column is never taken for it.
 */
export function nextClassedElement(html: string, className: string, from: number): MarkupSpan | null {
  const token = escapeRegExp(className);
  const opener = new RegExp(
    `<([a-zA-Z][\\w-]*)\\b[^>]*?(?<![\\w-])class\\s*=\\s*(["'])(?:(?!\\2)[\\s\\S])*?` +
      `(?<![\\w-])${token}(?![\\w-])(?:(?!\\2)[\\s\\S])*?\\2[^>]*>`,
    'g',
  );
  return nextElement(html, opener, from);
}

/** The next element at or after `from` whose `data-section` is one of `names`. */
export function nextDataSectionElement(html: string, names: readonly string[], from: number): MarkupSpan | null {
  const opener = new RegExp(
    `<([a-zA-Z][\\w-]*)\\b[^>]*?(?<![\\w-])data-section\\s*=\\s*(["'])\\s*` +
      `(?:${names.map(escapeRegExp).join('|')})\\s*\\2[^>]*>`,
    'g',
  );
  return nextElement(html, opener, from);
}

/** `{{#if field.length}}` or `{{#if field}}`: an empty list is falsy either way. */
export function guardOpenerPattern(field: string): string {
  return `\\{\\{#if\\s+${escapeRegExp(field)}(?:\\.length)?\\s*\\}\\}`;
}

/**
 * The guard written immediately around [start, end): both its opener and its `{{/if}}`, or nothing. Taking one
 * half would leave the other dangling and the template would stop compiling.
 */
export function sectionGuardAround(html: string, start: number, end: number, field: string): MarkupSpan | null {
  const opener = new RegExp(`${guardOpenerPattern(field)}\\s*$`).exec(html.slice(0, start));
  if (!opener) return null;
  const closer = /^\s*\{\{\/if\s*\}\}/.exec(html.slice(end));
  if (!closer) return null;
  return { start: start - opener[0].length, end: end + closer[0].length };
}

/** A span grown over every guard on one of `fields` written right around it (a guard written twice is one section). */
export function withGuards(html: string, span: MarkupSpan, fields: readonly string[]): MarkupSpan {
  let current = span;
  for (;;) {
    let grown: MarkupSpan | null = null;
    for (const field of fields) {
      grown = sectionGuardAround(html, current.start, current.end, field);
      if (grown) break;
    }
    if (!grown) return current;
    current = grown;
  }
}

/** Tags and comments, as one pattern: group 1 is "/" on a closing tag, group 2 the tag name (none for a comment). */
export const TAG_OR_COMMENT = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)\b[^>]*>/g;

/**
 * The elements open at `pos`, outermost first, each as its own whole span. A `<style>` or `<script>` is stepped
 * over whole (a position inside one has no ancestors worth reporting); an element that never closes ends the list.
 */
export function ancestorsAt(html: string, pos: number): MarkupSpan[] {
  const open: Array<{ name: string; start: number; openEnd: number }> = [];
  const tags = new RegExp(TAG_OR_COMMENT.source, 'g');
  for (let tag = tags.exec(html); tag && tag.index < pos; tag = tags.exec(html)) {
    const rawName = tag[2];
    if (!rawName) continue;
    const name = rawName.toLowerCase();
    if (tag[1]) {
      const at = open.map((item) => item.name).lastIndexOf(name);
      if (at !== -1) open.length = at;
      continue;
    }
    if (VOID_ELEMENTS.has(name) || tag[0].endsWith('/>')) continue;
    if (name === 'style' || name === 'script') {
      const close = findClosingTag(html, name, tags.lastIndex);
      if (close === -1 || close > pos) return [];
      tags.lastIndex = close;
      continue;
    }
    open.push({ name, start: tag.index, openEnd: tags.lastIndex });
  }
  const spans: MarkupSpan[] = [];
  for (const item of open) {
    const end = findClosingTag(html, item.name, item.openEnd);
    if (end === -1) return spans;
    spans.push({ start: item.start, end });
  }
  return spans;
}

/**
 * The column a section sits in: the start of the innermost element open at its start that holds it whole, or -1
 * for a fragment with nothing around it. Sections with the same key may trade places; others never do.
 */
export function parentKeyOf(html: string, span: MarkupSpan): number {
  const holders = ancestorsAt(html, span.start).filter((ancestor) => ancestor.end >= span.end);
  const innermost = holders[holders.length - 1];
  return innermost ? innermost.start : -1;
}

/** Whether `pos` falls inside a tag (`<div title="{{join softSkills}}">`) rather than between tags. */
export function insideTag(html: string, pos: number): boolean {
  return html.lastIndexOf('<', pos) > html.lastIndexOf('>', pos - 1);
}
