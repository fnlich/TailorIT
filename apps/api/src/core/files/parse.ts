import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../http/errors';
import { apiRoot } from '../paths';
import { assertDocxUnpackable, DOCX_LIMITS, TOO_LARGE_UNPACKED } from './unpack';

// Uploaded PDFs and Word files are read by parse-worker.mjs in a short-lived child process, one per file, never in the
// API process: a crafted file could otherwise keep pdf.js or mammoth busy for minutes, or allocate until the process
// dies. The child has a 256 MB V8 heap, no eval, a wall-clock deadline and none of the server's secrets; whatever it
// does, the API stays up and answers with a sentence.
//
// A child process rather than a worker thread: pdf.js loads @napi-rs/canvas, and a worker thread that has loaded it
// can take the whole process down with an access violation when it ends (5 runs in 6 on Windows, Node 24.19). A child
// also keeps native crashes and native memory away from the API.

/** How long one file may take to read. */
export const PARSE_TIMEOUT_MS = 20_000;
/** The reader's V8 heap (old generation). Past it, the child dies of "heap out of memory", alone. */
export const PARSE_HEAP_MB = 256;
/** Files read at once. Each reader can use a few hundred megabytes, so the rest wait their turn... */
export const PARSE_MAX_CONCURRENCY = 2;
/** ...and past this many waiting, an upload is refused as busy rather than held in memory. */
export const PARSE_MAX_WAITING = 8;
/** Images in a PDF larger than this many pixels are not decoded (the thumbnail shows them blank). */
export const PDF_MAX_IMAGE_PIXELS = 4096 * 4096;

export const UNREADABLE_FILE =
  "We couldn't read that file. It may be damaged or too complex; try saving it again as a PDF or DOCX.";
const BUSY = 'The server is busy reading other files. Please wait a few seconds and try again.';
const BUSY_RETRY_SECONDS = 15;
const NO_READER = 'The server could not start reading that file. Please try again.';

const WORKER_SCRIPT = () => join(apiRoot(), 'src', 'core', 'files', 'parse-worker.mjs');

/** Environment variables the reader gets (by upper-case name; the server's secrets stay behind). */
const CHILD_ENV = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL']);

// ------------------------------------------------------------------------------------------------------- runner --

/** What the reader is asked to do: an `op` it knows, the file's bytes, and the op's options. */
export interface ParseJob {
  op: string;
  data: Uint8Array;
  [option: string]: unknown;
}

/** The parts a reader sent, by name: each a value or the error that part met. */
export type ParseParts = Map<string, { value?: unknown; error?: string }>;

export interface RunParseOptions {
  /**
   * Parts that are enough. A crash or timeout after they arrived keeps what was read (a thumbnail that took too long
   * costs only the thumbnail); before, or when this is not given, it is a 415 `unsupported_file`.
   */
  required?: readonly string[];
  timeoutMs?: number;
  /** The reader script (tests use misbehaving ones). */
  script?: string;
}

type ReaderMessage =
  | { part: string; value?: unknown; error?: string }
  | { done: true }
  | { fatal: string; message?: string };

/** A counting semaphore with a FIFO queue. */
class Slots {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly size: number) {}

  get full(): boolean {
    return this.active >= this.size;
  }

  get waiting(): number {
    return this.queue.length;
  }

  acquire(): Promise<void> {
    if (this.active < this.size) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  /** Hands the slot straight to the next waiter, or frees it. */
  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.active = Math.max(0, this.active - 1);
  }
}

const slots = new Slots(PARSE_MAX_CONCURRENCY);

/** The line of a reader's stderr that says what went wrong (V8's FATAL ERROR, an uncaught exception), else its start. */
function stderrSummary(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const telling = lines.find((line) => /FATAL ERROR|out of memory|\bError\b/.test(line));
  return (telling ?? lines.slice(0, 3).join(' | ')).slice(0, 500);
}

function childEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => CHILD_ENV.has(key.toUpperCase())));
}

/** Runs one job in a fresh reader process, at most PARSE_MAX_CONCURRENCY at a time. */
export async function runParseJob(job: ParseJob, options: RunParseOptions = {}): Promise<ParseParts> {
  if (slots.full && slots.waiting >= PARSE_MAX_WAITING) {
    throw new AppError('rate_limited', BUSY, { retryAfterSeconds: BUSY_RETRY_SECONDS });
  }
  await slots.acquire();
  try {
    return await runReader(job, options);
  } finally {
    slots.release();
  }
}

function runReader(job: ParseJob, options: RunParseOptions): Promise<ParseParts> {
  const { required, timeoutMs = PARSE_TIMEOUT_MS, script = WORKER_SCRIPT() } = options;
  return new Promise((resolve, reject) => {
    const parts: ParseParts = new Map();
    let stderr = '';
    let settled = false;

    if (!existsSync(script)) {
      reject(new AppError('internal', NO_READER, { cause: new Error(`The file reader ${script} is missing.`) }));
      return;
    }
    let child: ReturnType<typeof fork>;
    try {
      child = fork(script, [], {
        // Replaces the API's own flags (tsx's loader, inspector...): the reader is plain JavaScript.
        execArgv: [`--max-old-space-size=${PARSE_HEAP_MB}`, '--disallow-code-generation-from-strings'],
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: childEnv(),
        windowsHide: true,
      });
    } catch (error) {
      reject(new AppError('internal', NO_READER, { cause: error }));
      return;
    }

    const timer = setTimeout(() => stopped(`reading took longer than ${timeoutMs} ms`), timeoutMs);
    const settle = (error: AppError | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // SIGKILL: a reader stuck in a loop gets no say (on Windows every kill is TerminateProcess).
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (error) reject(error);
      else resolve(parts);
    };
    /** The reader stopped before saying it was done: keep what arrived if it is enough. */
    const stopped = (reason: string, cause?: unknown) => {
      if (settled) return;
      if (required && required.every((name) => parts.has(name))) return settle(null);
      const said = stderrSummary(stderr);
      const detail = said ? `${reason}: ${said}` : reason;
      settle(new AppError('unsupported_file', UNREADABLE_FILE, { cause: new Error(detail, { cause }) }));
    };

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 16_000) stderr += chunk;
    });
    child.on('message', (message: ReaderMessage) => {
      if (!message || typeof message !== 'object') return;
      if ('part' in message && typeof message.part === 'string') {
        parts.set(message.part, { value: message.value, error: message.error });
      } else if ('done' in message) {
        settle(null);
      } else if ('fatal' in message) {
        const cause = new Error(message.message ?? message.fatal);
        if (message.fatal === 'too_large_unpacked') settle(new AppError('file_too_large', TOO_LARGE_UNPACKED, { cause }));
        // The reader could not load its own modules: the server's fault, not the file's.
        else if (message.fatal === 'setup') settle(new AppError('internal', NO_READER, { cause }));
        else settle(new AppError('unsupported_file', UNREADABLE_FILE, { cause }));
      }
    });
    child.on('error', (error) => stopped('the reader failed', error));
    // 'close' (not 'exit'): every message the reader sent has been received by then.
    child.on('close', (code, signal) => stopped(`the reader stopped (${signal ?? `exit code ${code}`})`));
    try {
      child.send(job, (error) => {
        if (error) stopped('the file could not be handed to the reader', error);
      });
    } catch (error) {
      stopped('the file could not be handed to the reader', error);
    }
  });
}

const bytesOf = (buffer: Buffer) => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
const asBuffer = (value: unknown) =>
  value instanceof Uint8Array && value.length > 0 ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : null;
const problemsOf = (parts: ParseParts) =>
  [...parts].filter(([, part]) => part.error).map(([name, part]) => `${name}: ${part.error}`);

// --------------------------------------------------------------------------------------------------------- PDF --

/** One pdf.js text item: what the letter paragraph finder reads. */
export interface PdfTextItem {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
}

export interface PdfParseOptions {
  /** Only the first pages are read (the page count is still the whole file's). */
  maxPages: number;
  /** pdf-parse getText options (pageJoiner, cellSeparator...). */
  textOptions?: { pageJoiner?: string; cellSeparator?: string };
  /** Also return the pages' text items with their positions. */
  items?: boolean;
  /** Also draw the first page as a PNG this many pixels wide. */
  thumbnailWidth?: number;
}

export interface PdfParseResult {
  /** The whole file's page count; null when its text could not be read. */
  pageCount: number | null;
  /** pdf-parse's text of the pages read; null when it could not be read. */
  text: string | null;
  pages: Array<{ num: number; text: string }>;
  /** Per page read, its text items (when asked for and readable). */
  items: PdfTextItem[][] | null;
  thumbnail: Buffer | null;
  /** Why a part is missing, for logs. */
  problems: string[];
}

interface PdfTextValue {
  pageCount: number;
  text: string;
  pages: Array<{ num: number; text: string }>;
}

function isPdfText(value: unknown): value is PdfTextValue {
  const text = value as PdfTextValue | null;
  return Boolean(text) && typeof text!.text === 'string' && typeof text!.pageCount === 'number' && Array.isArray(text!.pages);
}

/**
 * Reads a PDF in the reader process: the text of its first `maxPages` pages (and their text items), its page count and,
 * when asked, a PNG of its first page. Throws 415 `unsupported_file` when the reader crashes, runs out of memory or
 * time before the text is read, and 429 when the server is busy reading other files.
 */
export async function parsePdf(buffer: Buffer, options: PdfParseOptions): Promise<PdfParseResult> {
  const parts = await runParseJob(
    {
      op: 'pdf',
      data: bytesOf(buffer),
      maxPages: options.maxPages,
      textOptions: options.textOptions ?? {},
      items: options.items === true,
      thumbnailWidth: options.thumbnailWidth ?? 0,
      maxImagePixels: PDF_MAX_IMAGE_PIXELS,
    },
    { required: ['text'] },
  );
  const text = parts.get('text')?.value;
  const items = parts.get('items')?.value;
  const readable = isPdfText(text) ? text : null;
  return {
    pageCount: readable ? readable.pageCount : null,
    text: readable ? readable.text : null,
    pages: readable ? readable.pages : [],
    items: Array.isArray(items) ? (items as PdfTextItem[][]) : null,
    thumbnail: asBuffer(parts.get('thumbnail')?.value),
    problems: problemsOf(parts),
  };
}

// -------------------------------------------------------------------------------------------------------- DOCX --

export interface DocxParseOptions {
  /** The text is cut to this many characters in the reader, before anything else happens to it. */
  maxChars: number;
  /** Also convert the start of the document to HTML (a thumbnail's worth): its first blocks, then a character cap. */
  html?: { maxBlocks: number; maxChars: number };
}

export interface DocxParseResult {
  /** mammoth's raw text; null when it could not be read. */
  text: string | null;
  /** The first part of the document as HTML, when asked for and readable. */
  html: string | null;
  problems: string[];
}

/**
 * Reads a Word file in the reader process. Throws 413 `file_too_large` when the package unpacks to more than
 * DOCX_LIMITS allow (checked here first, then in the reader against what really unpacks), 415 when the reader fails
 * before the text is read, and 429 when the server is busy.
 */
export async function parseDocx(buffer: Buffer, options: DocxParseOptions): Promise<DocxParseResult> {
  assertDocxUnpackable(buffer);
  const parts = await runParseJob(
    { op: 'docx', data: bytesOf(buffer), maxChars: options.maxChars, html: options.html ?? null, limits: DOCX_LIMITS },
    { required: ['text'] },
  );
  const text = parts.get('text')?.value;
  const html = parts.get('html')?.value;
  return {
    text: typeof text === 'string' ? text : null,
    html: typeof html === 'string' ? html : null,
    problems: problemsOf(parts),
  };
}
