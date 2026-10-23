import type { TemplatePageBox } from '../templates/pageBox';

// Turning a rendered template body into documents: the print document (what the PDF prints) and the preview
// document (the same, locked down and sized like the printed page).

/** What a preview may do: draw with inline styles and embedded images and fonts; no script, no request at all. */
export const PREVIEW_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

/** The template's separate stylesheet (when it has one) ahead of its markup. */
export function assembleDocument(cssContent: string, body: string): string {
  return cssContent ? `<style>${cssContent}</style>${body}` : body;
}

/**
 * The policy as a meta tag ahead of everything that could fetch, but never ahead of a leading doctype (that would
 * put the page into quirks mode and lay it out unlike its PDF).
 */
export function withContentSecurityPolicy(document: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CONTENT_SECURITY_POLICY}">`;
  const doctype = /^\s*<!DOCTYPE[^>]*>/i.exec(document);
  return doctype ? `${doctype[0]}${meta}${document.slice(doctype[0].length)}` : `${meta}${document}`;
}

/**
 * The preview's page chrome, appended last so it wins ties with the template's own rules. The page margins go on
 * `html` (padding, and a clip-path where print clips), never on `body`: a border or padding on body would stop a
 * first child's top margin collapsing through it and shift the document against its print. The body gets exactly
 * the content width the PDF prints into, so every width-dependent layout decision resolves as it will there. A
 * page that is not A4 is shrunk and centred onto A4, as the print does; viewport units are pinned to the page.
 */
export function previewPageChrome(box: TemplatePageBox): string {
  const { margin } = box;
  const sides = `${margin.top} ${margin.right} ${margin.bottom} ${margin.left}`;
  const html = [
    'box-sizing: border-box',
    `width: ${box.pageWidthPx}px`,
    `min-height: ${box.pageHeightPx}px`,
    'background: #ffffff',
    `padding: ${sides}`,
    `clip-path: inset(${sides})`,
    '-webkit-print-color-adjust: exact',
    'print-color-adjust: exact',
  ];
  if (box.mediaScale !== 1) {
    html.push(
      `transform: translateY(${box.mediaOffsetYPx.toFixed(2)}px) scale(${box.mediaScale.toFixed(5)})`,
      'transform-origin: top left',
      'overflow-x: hidden',
    );
  }
  const body = [
    `width: ${box.contentWidthPx.toFixed(2)}px !important`,
    `min-height: ${box.contentHeightPx.toFixed(2)}px !important`,
    'margin-left: auto !important',
    'margin-right: auto !important',
  ];
  const rule = (selector: string, declarations: string[]) => `\n  ${selector} {\n    ${declarations.join(';\n    ')};\n  }`;
  const viewportFix = box.usesViewportUnits
    ? rule('body > *', [`min-height: ${box.contentHeightPx.toFixed(2)}px !important`])
    : '';
  return `<style id="resume-preview-page">${rule('html', html)}${rule('body', body)}${viewportFix}\n</style>`;
}
