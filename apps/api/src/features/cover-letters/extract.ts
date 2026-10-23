import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { textToHtmlParagraphs } from '@tailorit/shared';
import { detectFileKind, type FileKind } from '../../core/files/index';
import { AppError } from '../../core/http/errors';

// Uploaded cover letters and templates: the text of a PDF or DOCX, split into paragraphs, as editor HTML. Loose
// variable spellings that PDF text extraction produces (`{ {COMPANY_NAME} }`) are read as `{{COMPANY_NAME}}`.

export const UNSUPPORTED_UPLOAD = 'Please upload a PDF or DOCX file.';
const UNREADABLE =
  'We could not read any text in that file. If it is a scanned PDF, upload a DOCX or a PDF with selectable text.';
/** Letters are short; anything past this is cut (a stray 300-page PDF must not become one paragraph each). */
const MAX_TEXT = 60_000;

/** The kind of an uploaded letter or template, from its bytes: PDF or DOCX, else 415. */
export function uploadKind(buffer: Buffer): Extract<FileKind, 'pdf' | 'docx'> {
  const kind = detectFileKind(buffer);
  if (kind === 'pdf' || kind === 'docx') return kind;
  const hint = kind === 'doc' ? ' Save Word 97-2003 documents as .docx first.' : '';
  throw new AppError('unsupported_file', `${UNSUPPORTED_UPLOAD}${hint}`);
}

/** The parts of pdf.js's document that pdf-parse loads and that paragraph finding reads. */
interface PdfTextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
}
interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<{ getTextContent(): Promise<{ items: PdfTextItem[] }>; cleanup?: () => void }>;
}

export interface PdfLine {
  y: number;
  height: number;
  text: string;
  page: number;
}

/** The page's text items as lines (top to bottom), words spaced by their positions. */
async function pdfLines(doc: PdfDocumentLike): Promise<PdfLine[]> {
  const lines: PdfLine[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const { items } = await page.getTextContent();
    let line: (PdfLine & { endX: number }) | null = null;
    for (const item of items) {
      if (typeof item.str !== 'string' || !item.transform) continue;
      const x = item.transform[4] ?? 0;
      const y = item.transform[5] ?? 0;
      const height = item.height || Math.abs(item.transform[3] ?? 0) || 10;
      if (line && Math.abs(line.y - y) < Math.max(line.height, height) * 0.5) {
        const gap = x - line.endX;
        const spaced = /\s$/.test(line.text) || /^\s/.test(item.str);
        line.text += !spaced && gap > height * 0.12 ? ` ${item.str}` : item.str;
        line.endX = x + (item.width ?? 0);
        line.height = Math.max(line.height, height);
        continue;
      }
      if (line) lines.push(line);
      line = { y, height, text: item.str, page: pageNumber, endX: x + (item.width ?? 0) };
    }
    if (line) lines.push(line);
    page.cleanup?.();
  }
  return lines
    .map(({ y, height, text, page }) => ({ y, height, page, text: text.replace(/\s+/g, ' ').trim() }))
    .filter((line) => line.text !== '');
}

/**
 * Paragraphs from line positions: a vertical gap clearly larger than the usual line pitch starts a new paragraph
 * (letters space paragraphs apart), and so does a line after a short one (the last line of a paragraph).
 */
export function paragraphsFromLines(lines: readonly PdfLine[]): string {
  const pitches: number[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1]!;
    const current = lines[index]!;
    if (previous.page === current.page && previous.y > current.y) pitches.push(previous.y - current.y);
  }
  pitches.sort((a, b) => a - b);
  // The usual line pitch: low in the distribution, since paragraph gaps are the large ones.
  const pitch = pitches.length ? pitches[Math.floor(pitches.length / 4)]! : 0;
  const lengths = lines.map((line) => line.text.length).sort((a, b) => a - b);
  const typical = lengths.length ? lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.9))]! : 0;
  const fullLine = typical >= 40 ? typical * 0.72 : Number.POSITIVE_INFINITY;

  const paragraphs: string[] = [];
  let current = '';
  lines.forEach((line, index) => {
    const previous = index > 0 ? lines[index - 1]! : null;
    let breakBefore = false;
    if (previous) {
      const gap = previous.page === line.page ? previous.y - line.y : null;
      if (gap !== null && (gap <= 0 || (pitch > 0 && gap > pitch * 1.45))) breakBefore = true;
      if (previous.text.length < fullLine) breakBefore = true;
    }
    if (breakBefore && current) {
      paragraphs.push(current);
      current = '';
    }
    current = !current ? line.text : current.endsWith('-') ? `${current}${line.text}` : `${current} ${line.text}`;
  });
  if (current) paragraphs.push(current);
  return paragraphs.join('\n\n');
}

async function pdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText({ pageJoiner: '', cellSeparator: ' ' });
    const fallback = () => pdfLinesToParagraphs(result.pages.map((page) => page.text).join('\n\n'));
    // pdf-parse keeps the pdf.js document it loaded; its text positions show where paragraphs end.
    const doc = (parser as unknown as { doc?: PdfDocumentLike }).doc;
    if (!doc || typeof doc.getPage !== 'function') return fallback();
    try {
      const text = paragraphsFromLines(await pdfLines(doc));
      return text.trim() ? text : fallback();
    } catch {
      return fallback();
    }
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function docxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

/**
 * PDF text comes as lines, not paragraphs. A line much shorter than the page's usual line ends its paragraph (the
 * last line of a paragraph, "Dear Hiring Manager,", "Sincerely,", a name); blank lines always do. Lines of one
 * paragraph are joined with a space, or directly after a trailing hyphen.
 */
export function pdfLinesToParagraphs(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t\u00a0]+/g, ' ').replace(/ {2,}/g, ' ').trim())
    .filter((line) => !/^--\s*\d+\s+of\s+\d+\s*--$/.test(line));
  const lengths = lines
    .filter(Boolean)
    .map((line) => line.length)
    .sort((a, b) => a - b);
  const typical = lengths.length ? lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.9))]! : 0;
  // A page of short lines only (a list, a note) keeps every line as its own paragraph.
  const fullLine = typical >= 40 ? typical * 0.72 : Number.POSITIVE_INFINITY;
  const endsParagraph = (line: string) =>
    line.length < fullLine || (/[.!?:]["')\]]?$/.test(line) && line.length < typical * 0.85);

  const paragraphs: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) paragraphs.push(current.trim());
    current = '';
  };
  let previous = '';
  for (const line of lines) {
    if (!line) {
      flush();
      previous = '';
      continue;
    }
    if (current && endsParagraph(previous)) flush();
    current = !current ? line : current.endsWith('-') ? `${current}${line}` : `${current} ${line}`;
    previous = line;
  }
  flush();
  return paragraphs.join('\n\n');
}

/** Plain text with paragraphs separated by blank lines. Throws 415 when nothing readable is in the file. */
export async function extractUploadText(buffer: Buffer): Promise<{ kind: 'pdf' | 'docx'; text: string }> {
  const kind = uploadKind(buffer);
  let text: string;
  try {
    text = kind === 'pdf' ? await pdfText(buffer) : await docxText(buffer);
  } catch (error) {
    throw new AppError('unsupported_file', 'Could not read file. It may be damaged; try saving it again and uploading the copy.', {
      cause: error,
    });
  }
  const clean = text.split(String.fromCharCode(0)).join('').slice(0, MAX_TEXT).trim();
  if (!clean) throw new AppError('unsupported_file', UNREADABLE);
  return { kind, text: clean };
}

/** An uploaded file's text as editor HTML (one <p> per paragraph). */
export async function extractUploadHtml(buffer: Buffer): Promise<{ kind: 'pdf' | 'docx'; html: string; text: string }> {
  const { kind, text } = await extractUploadText(buffer);
  return { kind, text, html: textToHtmlParagraphs(text) };
}

/** "Jordan_Chen cover letter.pdf" -> "Jordan_Chen cover letter". */
export function titleFromFileName(name: string | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  return base
    .replace(/\.(pdf|docx?)$/i, '')
    .replace(/\p{Cc}+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
