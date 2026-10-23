import sanitizeHtml from 'sanitize-html';
import { escapeHtml } from '@tailorit/shared';

// A posting's description as TailorIT stores it ("Full posting"): sanitized HTML with a small tag set, links forced
// to open safely, every style and class dropped. Plain-text postings become paragraphs and lists.

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 's', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'blockquote',
    'pre', 'code', 'hr', 'div', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub',
  ],
  allowedAttributes: { a: ['href', 'target', 'rel'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  transformTags: {
    h1: 'h2',
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...(attribs.href ? { href: attribs.href } : {}), target: '_blank', rel: 'noopener noreferrer nofollow' },
    }),
  },
  exclusiveFilter: (frame) => frame.tag === 'a' && !frame.attribs.href && !frame.text.trim(),
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'title', 'head', 'iframe', 'svg'],
};

/** The description HTML as stored: sanitized, empty paragraphs and runs of blank lines dropped. */
export function sanitizeDescription(html: string): string {
  return sanitizeHtml(html, SANITIZE)
    .replace(/<(p|div|span|strong|b|em|i)>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi, '')
    .replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br /><br />')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const BULLET = /^\s*(?:[•·●▪◦‣►✓✔]\s*|[-*–—](?=\s)\s*|o\s+|\(?\d{1,2}[.)](?=\s)\s*)/;

/**
 * Plain text as simple HTML: each line a paragraph, runs of bullet lines ("- a", "• b", "1. c") a list. Lines are
 * kept as lines, so headings such as "Requirements:" stay findable.
 */
export function textToHtml(text: string): string {
  const out: string[] = [];
  let list: string[] = [];
  const closeList = () => {
    if (list.length) out.push(`<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\u00a0/g, ' ').replace(/[ \t\f\v]+/g, ' ').trim();
    if (!line) {
      closeList();
      continue;
    }
    if (BULLET.test(line) && line.replace(BULLET, '').trim()) {
      list.push(line.replace(BULLET, '').trim());
      continue;
    }
    closeList();
    out.push(`<p>${escapeHtml(line)}</p>`);
  }
  closeList();
  return out.join('\n');
}

/** A heading and its bullets as HTML (seed postings, Lever lists). */
export function sectionHtml(heading: string, items: readonly string[]): string {
  if (!items.length) return '';
  return `<h3>${escapeHtml(heading)}</h3>\n<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

/** Paragraphs of text as HTML. */
export function paragraphsHtml(paragraphs: readonly string[]): string {
  return paragraphs
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('\n');
}
