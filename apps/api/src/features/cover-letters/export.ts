import HTMLtoDOCX from '@turbodocx/html-to-docx';
import type { AppDeps } from '../../core/context';
import { AppError } from '../../core/http/errors';
import { getPdfService } from '../../core/pdf/index';
import { letterDocument, LETTER_MARGIN_IN } from './document';
import { docxFontName } from './fonts';

// Letters (and templates) as files: a US Letter PDF through the shared print browser, and a DOCX of the same content
// (a simple Word layout: the letter's font at 11 pt, 1 in margins).

export interface PrintableLetter {
  title: string;
  contentHtml: string;
  fontFamily: string;
}

export async function letterPdf(deps: Pick<AppDeps, 'services'>, letter: PrintableLetter): Promise<Buffer> {
  const html = letterDocument({ ...letter, mode: 'print' });
  const margin = `${LETTER_MARGIN_IN}in`;
  return getPdfService(deps).printPdf(html, {
    format: 'Letter',
    margin: { top: margin, right: margin, bottom: margin, left: margin },
  });
}

/** Twips: 1 in = 1440. US Letter is 8.5 x 11 in. */
const TWIPS_PER_INCH = 1440;

export async function letterDocx(letter: PrintableLetter): Promise<Buffer> {
  const body = letter.contentHtml.trim() || '<p></p>';
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title></title></head><body>${body}</body></html>`;
  const margin = LETTER_MARGIN_IN * TWIPS_PER_INCH;
  try {
    const output = await HTMLtoDOCX(html, null, {
      orientation: 'portrait',
      pageSize: { width: 8.5 * TWIPS_PER_INCH, height: 11 * TWIPS_PER_INCH },
      margins: { top: margin, right: margin, bottom: margin, left: margin, header: 720, footer: 720, gutter: 0 },
      title: letter.title,
      creator: 'TailorIT',
      font: docxFontName(letter.fontFamily),
      // Half-points: 22 = 11 pt.
      fontSize: 22,
      complexScriptFontSize: 22,
      decodeUnicode: true,
      lang: 'en-US',
    });
    if (Buffer.isBuffer(output)) return output;
    if (output instanceof ArrayBuffer) return Buffer.from(output);
    return Buffer.from(await (output as Blob).arrayBuffer());
  } catch (error) {
    throw new AppError('render_failed', 'We could not make a Word file of this letter. Please try again.', { cause: error });
  }
}
