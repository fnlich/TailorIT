// Small text helpers used across features. Pure string work: no DOM, so they run in the API and the browser alike.

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** The text safe to place in HTML content or a quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
};

/** HTML character references decoded: the named ones above, and every decimal and hex one. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const name = body.toLowerCase();
    return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name]! : whole;
  });
}

// `</li>` is not here: `<li>` already starts its own line.
const BLOCK_END = /<\/(?:p|div|ul|ol|h[1-6]|tr|table|blockquote|section|article|header|footer|pre)\s*>/gi;

/**
 * The readable text of an HTML fragment: scripts and styles dropped, a line break for every `<br>` and block end, a
 * "- " before list items, tags removed, entities decoded, spaces tidied within lines and at most one blank line in a
 * row. For previews, search text and CSV export, never for rendering.
 */
export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(BLOCK_END, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Every run of whitespace one space, ends trimmed. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A display string: Unicode NFC, whitespace collapsed, trimmed; '' for anything that is not a string. */
export function tidyText(value: unknown): string {
  return typeof value === 'string' ? collapseWhitespace(value.normalize('NFC')) : '';
}

/** At most `max` characters, with `ellipsis` appended when anything was cut. */
export function truncateText(text: string, max: number, ellipsis = '...'): string {
  return text.length > max ? `${text.slice(0, max)}${ellipsis}` : text;
}

/** "1 app", "3 apps"; `many` defaults to `one` + "s". */
export function pluralize(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The text with RegExp metacharacters escaped, for building a pattern that matches it literally. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
