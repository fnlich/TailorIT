import sanitizeHtml from 'sanitize-html';

// The tracker stores two rich-text fields (the job description and the notes). Both come from the browser's TipTap
// editor or from a job posting, and the detail sheet renders them as HTML, so they are cleaned on the way in: a small
// formatting vocabulary, http(s)/mailto links that open in a new tab, nothing executable.

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'code', 'pre', 'blockquote', 'hr',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'span', 'div',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
  },
};

/** Rich text safe to render: '' for nothing but whitespace or empty paragraphs. */
export function cleanRichText(html: string): string {
  const clean = sanitizeHtml(html, OPTIONS).trim();
  // An editor that was emptied leaves "<p></p>"; store it as nothing.
  return /^(?:<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>\s*)*$/i.test(clean) ? '' : clean;
}

/** Plain text (an import's notes) as paragraphs of escaped text. */
export function textToParagraphs(text: string): string {
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${block.split('\n').map(escape).join('<br>')}</p>`)
    .join('');
}
