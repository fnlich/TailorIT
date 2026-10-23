import sanitizeHtml from 'sanitize-html';

// The "Full posting" HTML. Ingestion stores what the job board sent (already cleaned there); it is sanitized again on
// the way out so the page can render it with dangerouslySetInnerHTML whatever wrote the row: structure and links
// only, no styles, classes, scripts, frames or images.

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'div', 'span', 'section',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'small',
    'blockquote', 'code', 'pre',
    'a',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  ],
  allowedAttributes: { a: ['href', 'target', 'rel'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  // Every link opens the original site in a new tab and passes nothing back to this page.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
  },
};

const MAX_HTML = 200_000;

/** The description HTML, safe to render. */
export function sanitizeDescription(html: string | null | undefined): string {
  if (!html) return '';
  return sanitizeHtml(html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html, OPTIONS).trim();
}
