import {
  ancestorsAt,
  escapeRegExp,
  findClosingTag,
  guardOpenerPattern,
  insideTag,
  sectionGuardAround,
  TAG_OR_COMMENT,
  VOID_ELEMENTS,
  type MarkupSpan,
} from './markup';

// Stage B of the locator: finding a section that carries no marker (no `section-<kind>` class, no data-section)
// from where its list is printed. Uploaded templates are written that way, and without this a switched-off
// Strengths section would leave its heading over an emptied list, and a stored order could not move anything.

/**
 * Where the markup prints `field`'s list: each `{{#each field}} ... {{/each}}` (nested loops counted), then each
 * mustache printing the list inline (`{{join softSkills ", "}}`, `{{softSkills}}`) that is outside those loops and
 * outside a tag. Sorted by position.
 */
export function sectionLoops(html: string, field: string): MarkupSpan[] {
  const name = escapeRegExp(field);
  const loops: MarkupSpan[] = [];
  const opener = new RegExp(`\\{\\{#each\\s+${name}(?![\\w.])[^}]*\\}\\}`, 'g');
  for (let open = opener.exec(html); open; open = opener.exec(html)) {
    const blocks = /\{\{(#each\b|\/each\s*\}\})/g;
    blocks.lastIndex = opener.lastIndex;
    let depth = 1;
    for (let token = blocks.exec(html); token; token = blocks.exec(html)) {
      depth += token[1]!.startsWith('#') ? 1 : -1;
      if (depth === 0) break;
    }
    if (depth !== 0) continue;
    loops.push({ start: open.index, end: blocks.lastIndex });
    opener.lastIndex = blocks.lastIndex;
  }

  const inLoop = (pos: number) => loops.some((loop) => pos >= loop.start && pos < loop.end);
  const inline = new RegExp(`\\{\\{\\{?~?\\s*(?:[a-zA-Z_][\\w-]*\\s+)?${name}(?![\\w.-])[^{}]*\\}\\}\\}?`, 'g');
  const printed: MarkupSpan[] = [];
  for (let print = inline.exec(html); print; print = inline.exec(html)) {
    if (inLoop(print.index) || insideTag(html, print.index)) continue;
    printed.push({ start: print.index, end: inline.lastIndex });
  }
  return [...loops, ...printed].sort((a, b) => a.start - b.start);
}

/** What a reader sees of a fragment: no tags, no stylesheet or script, `&nbsp;` read as a space. */
export function visibleText(fragment: string): string {
  return fragment
    .replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A heading is short: a paragraph that happens to mention strengths is not one. */
const MAX_HEADING_TEXT = 60;

function readsAsHeading(text: string, heading: RegExp): boolean {
  return text.length > 0 && text.length <= MAX_HEADING_TEXT && heading.test(text);
}

/** Markup that shows something without text: media, a CSS-drawn image, or a stylesheet/script the page needs. */
function holdsContent(markup: string): boolean {
  return (
    /<(?:img|svg|picture|video|audio|canvas|iframe|object|embed|style|script|link)\b/i.test(markup) ||
    /<[a-zA-Z][^>]*\burl\s*\(/i.test(markup)
  );
}

/** Markup that shows nothing of its own: no template data, no visible text, no content. */
function showsNothing(markup: string): boolean {
  return !/\{\{/.test(markup) && !visibleText(markup) && !holdsContent(markup);
}

/**
 * A fragment with the section's own loop and guards taken out. Null when what is left still holds template data
 * (it is somebody's column) or when the field's guards in it do not pair up inside it.
 */
function besidesTheLoop(fragment: string, loop: MarkupSpan, offset: number, field: string): string | null {
  const rest = `${fragment.slice(0, loop.start - offset)}${fragment.slice(loop.end - offset)}`;
  const guards = new RegExp(`${guardOpenerPattern(field)}|\\{\\{\\/if\\s*\\}\\}`, 'g');
  let depth = 0;
  for (const token of rest.match(guards) ?? []) {
    if (token.startsWith('{{#')) depth += 1;
    else if (depth === 0) return null;
    else depth -= 1;
  }
  if (depth !== 0) return null;
  const left = rest.replace(guards, '');
  return /\{\{/.test(left) ? null : left;
}

/** A fragment's top-level pieces in order: each element whole, each lone tag or comment, each run of text. */
function topLevelPieces(fragment: string): MarkupSpan[] {
  const pieces: MarkupSpan[] = [];
  const tags = new RegExp(TAG_OR_COMMENT.source, 'g');
  let at = 0;
  for (let tag = tags.exec(fragment); tag; tag = tags.exec(fragment)) {
    if (tag.index > at) pieces.push({ start: at, end: tag.index });
    let end = tags.lastIndex;
    const name = tag[2]?.toLowerCase();
    if (name && !tag[1] && !VOID_ELEMENTS.has(name) && !tag[0].endsWith('/>')) {
      const close = findClosingTag(fragment, name, tags.lastIndex);
      if (close !== -1) end = close;
    }
    pieces.push({ start: tag.index, end });
    at = end;
    tags.lastIndex = end;
  }
  if (at < fragment.length) pieces.push({ start: at, end: fragment.length });
  return pieces;
}

/** Whether an element's inside (its loop already taken out) is one heading piece beside markup that shows nothing. */
function holdsOnlyTheSection(inner: string, heading: RegExp): boolean {
  for (const piece of topLevelPieces(inner)) {
    if (!readsAsHeading(visibleText(inner.slice(piece.start, piece.end)), heading)) continue;
    if (showsNothing(`${inner.slice(0, piece.start)}${inner.slice(piece.end)}`)) return true;
  }
  return false;
}

/** The element whose closing tag ends exactly at `end`, from its opening tag; null when there is none. */
function elementEndingAt(html: string, end: number): MarkupSpan | null {
  const closing = /<\/([a-zA-Z][\w-]*)\s*>$/.exec(html.slice(0, end));
  if (!closing) return null;
  const tags = new RegExp(`<(/?)${escapeRegExp(closing[1]!)}(?![\\w-])[^>]*>`, 'gi');
  const head = html.slice(0, closing.index);
  const seen: Array<{ index: number; closing: boolean; selfClosing: boolean }> = [];
  for (let tag = tags.exec(head); tag; tag = tags.exec(head)) {
    seen.push({ index: tag.index, closing: Boolean(tag[1]), selfClosing: tag[0].endsWith('/>') });
  }
  let depth = 1;
  for (let index = seen.length - 1; index >= 0; index -= 1) {
    const tag = seen[index]!;
    if (tag.closing) depth += 1;
    else if (!tag.selfClosing) depth -= 1;
    if (depth === 0) return { start: tag.index, end };
  }
  return null;
}

/**
 * The element before `pos`, stepping back over whitespace, comments and anything that shows nothing of its own
 * (a divider under a heading, the `<br>` after a label); null when there is none.
 */
function previousSiblingElement(html: string, pos: number): MarkupSpan | null {
  let end = pos;
  for (;;) {
    const before = html.slice(0, end).replace(/\s+$/, '');
    if (before.endsWith('-->')) {
      const open = before.lastIndexOf('<!--');
      if (open === -1) return null;
      end = open;
      continue;
    }
    end = before.length;
    const lone = /<([a-zA-Z][\w-]*)\b[^<>]*>$/.exec(before);
    if (lone && (VOID_ELEMENTS.has(lone[1]!.toLowerCase()) || lone[0].endsWith('/>'))) {
      if (!showsNothing(lone[0])) return null;
      end = lone.index;
      continue;
    }
    const element = elementEndingAt(html, end);
    if (!element || !showsNothing(html.slice(element.start, element.end))) return element;
    end = element.start;
  }
}

/**
 * The section a loop (or inline print) of `field` belongs to, in markup that marks it neither by class nor by
 * data-section:
 *  1. the nearest element around the loop holding the section and nothing else (its heading, the loop, markup that
 *     shows nothing); climbing stops at the first element holding anything else, which is a column;
 *  2. otherwise the loop's container (with a guard right around it) plus the heading element right before it.
 * Null when neither is found: the gated loop then prints nothing, and no guess removes anything else.
 */
export function sectionOfLoop(html: string, loop: MarkupSpan, heading: RegExp, field: string): MarkupSpan | null {
  const ancestors = ancestorsAt(html, loop.start)
    .filter((span) => span.end >= loop.end)
    .reverse();

  let container: MarkupSpan = loop;
  for (const ancestor of ancestors) {
    const rest = besidesTheLoop(html.slice(ancestor.start, ancestor.end), loop, ancestor.start, field);
    if (rest === null) break;
    const inner = rest.replace(/^<[^>]*>/, '').replace(/<\/[^>]*>$/, '');
    if (holdsOnlyTheSection(inner, heading)) return ancestor;
    if (!showsNothing(inner)) break;
    container = ancestor;
  }

  const core = sectionGuardAround(html, container.start, container.end, field) ?? container;
  const before = previousSiblingElement(html, core.start);
  if (!before) return null;
  const markup = html.slice(before.start, before.end);
  if (/\{\{/.test(markup) || !readsAsHeading(visibleText(markup), heading)) return null;
  return { start: before.start, end: core.end };
}
