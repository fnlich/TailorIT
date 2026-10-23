import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import type { AppDeps } from '../../core/context';
import type { FileKind } from '../../core/files/index';
import { getPdfService } from '../../core/pdf/index';

// What TailorIT reads from an uploaded resume: its text (keyword matching, and the AI import's input), its page count
// and a PNG of its first page for the Resumes tab. Each part is best effort: a file whose text cannot be read is
// still a stored upload; only "Make an editable copy" needs the text.

/** The longest text kept from an upload (and handed to the AI import). */
export const MAX_EXTRACTED_TEXT = 60_000;
/** Under this many characters a file has no readable text (a scan, an image-only PDF). */
export const MIN_IMPORT_TEXT = 50;
export const UNREADABLE_TEXT =
  'We could not read enough text from that file to make an editable copy. It may be a scan or an image; upload a ' +
  'PDF or Word file with selectable text.';

const THUMBNAIL_WIDTH_PX = 480;

export interface UploadReading {
  text: string | null;
  pageCount: number | null;
  thumbnail: Buffer | null;
}

function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_EXTRACTED_TEXT);
}

async function readPdf(buffer: Buffer): Promise<UploadReading> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    let text: string | null = null;
    let pageCount: number | null = null;
    try {
      const result = await parser.getText({ pageJoiner: '' });
      text = tidyText(result.text);
      pageCount = result.total > 0 ? result.total : null;
    } catch {
      text = null;
    }
    let thumbnail: Buffer | null = null;
    try {
      const shot = await parser.getScreenshot({
        partial: [1],
        desiredWidth: THUMBNAIL_WIDTH_PX,
        imageBuffer: true,
        imageDataUrl: false,
      });
      const first = shot.pages[0];
      if (first?.data && first.data.length > 0) thumbnail = Buffer.from(first.data);
    } catch {
      thumbnail = null;
    }
    return { text, pageCount, thumbnail };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

/** The page a DOCX's first-page thumbnail is drawn on (Chrome, when one is installed). */
function docxPage(bodyHtml: string): string {
  return (
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    'html,body{margin:0;background:#fff}body{box-sizing:border-box;width:794px;min-height:1123px;padding:72px;' +
    'font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.35;color:#111}' +
    'h1,h2,h3{margin:0 0 6px}p{margin:0 0 6px}ul{margin:0 0 6px;padding-left:20px}img{max-width:100%}' +
    `</style></head><body>${bodyHtml}</body></html>`
  );
}

async function readDocx(deps: AppDeps, buffer: Buffer): Promise<UploadReading> {
  let text: string | null = null;
  try {
    text = tidyText((await mammoth.extractRawText({ buffer })).value);
  } catch {
    text = null;
  }
  let thumbnail: Buffer | null = null;
  try {
    const pdf = getPdfService(deps);
    if (pdf.available()) {
      const html = (await mammoth.convertToHtml({ buffer }, { externalFileAccess: false })).value;
      const png = await pdf.screenshotPng(docxPage(html), { width: 794, height: 1123 });
      thumbnail = png.length > 0 ? png : null;
    }
  } catch {
    thumbnail = null;
  }
  return { text, pageCount: null, thumbnail };
}

/** Reads an upload the file store has already accepted (its kind decided from its bytes). */
export async function readUpload(deps: AppDeps, buffer: Buffer, kind: FileKind | null): Promise<UploadReading> {
  if (kind === 'pdf') return readPdf(buffer);
  if (kind === 'docx') return readDocx(deps, buffer);
  return { text: null, pageCount: null, thumbnail: null };
}

/** Whether a file's text is enough for the AI import. */
export function readableForImport(text: string | null | undefined): boolean {
  return (text ?? '').trim().length >= MIN_IMPORT_TEXT;
}
