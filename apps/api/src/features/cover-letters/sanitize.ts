import sanitizeHtml from 'sanitize-html';
import { htmlToText } from '@tailorit/shared';

// Letter and template HTML comes from the TipTap editor (and from the AI handlers, which build it from escaped text).
// Whatever arrives is cut down to what the editor can make: paragraphs, headings 1-3, lists, quotes, bold / italic /
// underline, links, text alignment and font-family spans. Variables are plain `{{NAME}}` text and pass untouched.

const ALIGN = [/^(?:left|right|center|justify)$/];
// A font stack: names, quotes, commas, spaces and hyphens only (no url(), no expressions).
const FONT_STACK = [/^[\w\s"',-]{1,200}$/];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'h1', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'span'],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    ol: ['start'],
    p: ['style'],
    h1: ['style'],
    h2: ['style'],
    h3: ['style'],
    li: ['style'],
    span: ['style'],
  },
  allowedStyles: {
    p: { 'text-align': ALIGN },
    h1: { 'text-align': ALIGN },
    h2: { 'text-align': ALIGN },
    h3: { 'text-align': ALIGN },
    li: { 'text-align': ALIGN },
    span: { 'font-family': FONT_STACK },
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  // Headings deeper than 3 read as the deepest the editor offers; divs become paragraphs.
  transformTags: {
    h4: 'h3',
    h5: 'h3',
    h6: 'h3',
    div: 'p',
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, ...(attribs.target === '_blank' ? { rel: 'noopener noreferrer nofollow' } : {}) },
    }),
  },
  // A span left with no style is noise: drop the tag, keep its text.
  exclusiveFilter: (frame) => (frame.tag === 'span' && !frame.attribs.style ? 'excludeTag' : false),
  disallowedTagsMode: 'discard',
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'title', 'head'],
};

/** The HTML cut down to the editor's tags and styles. */
export function sanitizeLetterHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}

/** The plain text kept beside the HTML (search, previews, the "is it empty?" test). */
export function letterText(html: string): string {
  return htmlToText(html);
}
