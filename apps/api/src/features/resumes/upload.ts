import type { AppDeps } from '../../core/context';
import { parseDocx, parsePdf, type FileKind } from '../../core/files/index';
import { getPdfService, type PdfService } from '../../core/pdf/index';

// What TailorIT reads from an uploaded resume: its text (keyword matching, and the AI import's input), its page count
// and a PNG of its first page for the Resumes tab. Each part is best effort: a file whose text cannot be read is
// still a stored upload; only "Make an editable copy" needs the text. The file is read in the sandboxed reader process
// (core/files/parse.ts), which refuses (4xx) a file that makes it crash, run out of memory or time.

/** The longest text kept from an upload (and handed to the AI import). */
export const MAX_EXTRACTED_TEXT = 60_000;
/** Only the first pages of a PDF are read for its text and thumbnail; the stored page count is the whole file's. */
export const RESUME_MAX_PDF_PAGES = 30;
/** A Word file's text is cut to this in the reader, before any other work (MAX_EXTRACTED_TEXT of it is kept). */
const MAX_DOCX_TEXT = 200_000;
/** A Word thumbnail is the first page: it is drawn from the document's first blocks only, and at most this much HTML. */
const THUMBNAIL_BLOCKS = 120;
const THUMBNAIL_HTML_CHARS = 2_000_000;
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
  const pdf = await parsePdf(buffer, {
    maxPages: RESUME_MAX_PDF_PAGES,
    textOptions: { pageJoiner: '' },
    thumbnailWidth: THUMBNAIL_WIDTH_PX,
  });
  return {
    text: pdf.text === null ? null : tidyText(pdf.text),
    pageCount: pdf.pageCount !== null && pdf.pageCount > 0 ? pdf.pageCount : null,
    thumbnail: pdf.thumbnail,
  };
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

/** The browser that draws Word thumbnails, when one is set up and installed. */
function thumbnailRenderer(deps: AppDeps): PdfService | null {
  try {
    const pdf = getPdfService(deps);
    return pdf.available() ? pdf : null;
  } catch {
    return null;
  }
}

async function readDocx(deps: AppDeps, buffer: Buffer): Promise<UploadReading> {
  const renderer = thumbnailRenderer(deps);
  const docx = await parseDocx(buffer, {
    maxChars: MAX_DOCX_TEXT,
    ...(renderer ? { html: { maxBlocks: THUMBNAIL_BLOCKS, maxChars: THUMBNAIL_HTML_CHARS } } : {}),
  });
  let thumbnail: Buffer | null = null;
  if (renderer && docx.html !== null) {
    try {
      const png = await renderer.screenshotPng(docxPage(docx.html), { width: 794, height: 1123 });
      thumbnail = png.length > 0 ? png : null;
    } catch {
      thumbnail = null;
    }
  }
  return { text: docx.text === null ? null : tidyText(docx.text), pageCount: null, thumbnail };
}

/**
 * Reads an upload the file store has already accepted (its kind decided from its bytes). Throws the reader's refusals:
 * 413 `file_too_large` (a Word file too large once unpacked), 415 `unsupported_file` (the reader crashed, ran out of
 * memory or time before the text was read) and 429 `rate_limited` (busy reading other files).
 */
export async function readUpload(deps: AppDeps, buffer: Buffer, kind: FileKind | null): Promise<UploadReading> {
  if (kind === 'pdf') return readPdf(buffer);
  if (kind === 'docx') return readDocx(deps, buffer);
  return { text: null, pageCount: null, thumbnail: null };
}

/** Whether a file's text is enough for the AI import. */
export function readableForImport(text: string | null | undefined): boolean {
  return (text ?? '').trim().length >= MIN_IMPORT_TEXT;
}
