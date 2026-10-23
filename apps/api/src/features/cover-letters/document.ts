import { escapeHtml, LETTER_PAGE } from '@tailorit/shared';
import { familiesUsed, fontFaceCss, fontStack } from './fonts';

// A letter (or template) as a whole HTML document: for the PDF print, and for previews (the documents grid's
// thumbnails, the "Cover Letter Preview" dialog). Everything is inline: styles in <style>, fonts as data: URLs, so it
// renders the same in the print browser (network blocked) and in a sandboxed frame. The typography is in em of one
// base size, the same proportions the editor's paper uses (16 px there, 11 pt on paper).

export type LetterDocumentMode = 'print' | 'preview';

export const LETTER_MARGIN_IN = 1;
const BASE_SIZE = '11pt';

const LETTER_CSS = `
.letter{font-size:${BASE_SIZE};line-height:1.5;color:#191919;overflow-wrap:break-word;-webkit-font-smoothing:antialiased}
.letter>:first-child{margin-top:0}
.letter p{margin:0 0 1.5em}
.letter p:empty::before{content:"\\00a0"}
.letter h1{font-size:1.75em;line-height:1.25;font-weight:700;margin:0 0 .3em}
.letter h2{font-size:1.4em;line-height:1.3;font-weight:700;margin:0 0 .5em}
.letter h3{font-size:1.15em;line-height:1.35;font-weight:700;margin:0 0 .5em}
.letter blockquote{margin:0 0 1.5em;padding-left:1em;border-left:3px solid #d7d7d7;color:#3d3d3d}
.letter blockquote p:last-child{margin-bottom:0}
.letter ul,.letter ol{margin:0 0 1.5em;padding-left:1.6em}
.letter li>p{margin:0}
.letter a{color:#0b5c99;text-decoration:underline}
.letter strong,.letter b{font-weight:700}
.letter>:last-child{margin-bottom:0}
.ti-var{display:inline-block;border-radius:4px;padding:1px 6px;font-size:.85em;font-weight:500;line-height:1.35;background:#e9f6ff;color:#016094}
`;

/** `{{NAME}}` in text (never inside a tag) wrapped as a chip, as the editor shows it. */
export function chipPlaceholders(html: string): string {
  return html
    .split(/(<[^>]*>)/)
    .map((part) =>
      part.startsWith('<') ? part : part.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, '<span class="ti-var">{{$1}}</span>'),
    )
    .join('');
}

export interface LetterDocumentInput {
  contentHtml: string;
  fontFamily: string;
  title: string;
  mode: LetterDocumentMode;
}

/**
 * The document. `print`: the content only (Puppeteer adds the 1 in margins of a US Letter page). `preview`: one
 * 816 x 1056 px page with the same margins drawn as padding (a thumbnail shows its first page; the dialog scrolls),
 * placeholders drawn as chips, and a CSP that allows nothing but inline styles and data: fonts.
 */
export function letterDocument({ contentHtml, fontFamily, title, mode }: LetterDocumentInput): string {
  const fonts = fontFaceCss(familiesUsed(contentHtml, fontFamily), 'data');
  const marginPx = LETTER_MARGIN_IN * 96;
  const page =
    mode === 'preview'
      ? `html,body{margin:0;background:#fff}.page{box-sizing:border-box;width:${LETTER_PAGE.widthPx}px;min-height:${LETTER_PAGE.heightPx}px;padding:${marginPx}px}`
      : `html,body{margin:0;background:#fff}@page{size:letter}`;
  const body = mode === 'preview' ? chipPlaceholders(contentHtml) : contentHtml;
  const csp =
    mode === 'preview'
      ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">`
      : '';
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    csp,
    `<title>${escapeHtml(title)}</title>`,
    `<style>${fonts}\n${page}\n.letter{font-family:${fontStack(fontFamily)}}${LETTER_CSS}</style>`,
    '</head><body>',
    mode === 'preview' ? `<div class="page"><main class="letter">${body}</main></div>` : `<main class="letter">${body}</main>`,
    '</body></html>',
  ].join('');
}
