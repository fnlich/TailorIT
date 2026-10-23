import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DOCX_LIMITS,
  docxUnpackProblem,
  PARSE_MAX_CONCURRENCY,
  PARSE_MAX_WAITING,
  parseDocx,
  parsePdf,
  runParseJob,
  TOO_LARGE_UNPACKED,
  UNREADABLE_FILE,
  zipEntries,
} from '../src/core/files/index';
import { AppError } from '../src/core/http/errors';
import { getPdfService } from '../src/core/pdf/index';
import { signIn, type TestAgent } from './auth-helpers';
import { createTestContext, ORIGIN, type TestContext } from './helpers';

// Work package H: hostile uploads. Word files that unpack to far more than they weigh, PDFs with thousands of pages,
// and a reader that hangs, crashes or runs out of memory. Every upload route must answer quickly with a sentence, and
// the API process must stay up (the reader runs in a child process: core/files/parse.ts).

const MB = 1024 * 1024;

let ctx: TestContext | null = null;
afterEach(async () => {
  vi.unstubAllEnvs();
  // Taken first, so a slow close can never clean up the next test's context.
  const current = ctx;
  ctx = null;
  if (!current) return;
  await getPdfService(current.deps).close();
  current.cleanup();
});

/** No browser for these tests (Word thumbnails are drawn by Chrome when one is found): they are about the reader. */
const NO_BROWSER = { CHROME_PATH: join(tmpdir(), 'tailorit-no-browser', 'chrome.exe') };

// ------------------------------------------------------------------------------------------------- test files --

interface ZipPart {
  name: string;
  data: Buffer;
  /** The part already deflated (big parts are packed once and reused). */
  packed?: Buffer;
  /** Stored instead of deflated. */
  store?: boolean;
  /** What the headers claim the part unpacks to (default: the truth). */
  declaredSize?: number;
  /** Write the sizes as ZIP64 (saturated 32-bit fields plus an extra field). */
  zip64?: boolean;
}

/** A ZIP built by hand, parts deflated with node's zlib unless stored. */
function zip(parts: ZipPart[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = Buffer.from(part.name, 'utf8');
    const packed = part.store ? part.data : (part.packed ?? deflateRawSync(part.data));
    const size = part.declaredSize ?? part.data.length;
    const sum = crc32(part.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(part.store ? 0 : 8, 8);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, packed);
    const extra = Buffer.alloc(part.zip64 ? 20 : 0);
    if (part.zip64) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(16, 2);
      extra.writeBigUInt64LE(BigInt(size), 4);
      extra.writeBigUInt64LE(BigInt(packed.length), 12);
    }
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(45, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(part.store ? 0 : 8, 10);
    header.writeUInt32LE(sum, 16);
    header.writeUInt32LE(part.zip64 ? 0xffffffff : packed.length, 20);
    header.writeUInt32LE(part.zip64 ? 0xffffffff : size, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(extra.length, 30);
    header.writeUInt32LE(offset, 42);
    central.push(header, name, extra);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const RELS =
  '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
const BODY_START =
  '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';
const BODY_END = '</w:body></w:document>';

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function docx(documentXml: Buffer, options: { packed?: Buffer; declaredSize?: number; zip64?: boolean } = {}): Buffer {
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES) },
    { name: '_rels/.rels', data: Buffer.from(RELS) },
    { name: 'word/document.xml', data: documentXml, ...options },
  ]);
}

const documentOf = (paragraphs: string[]) => Buffer.from(`${BODY_START}${paragraphs.map(paragraph).join('')}${BODY_END}`);

/** About `bytes` of one paragraph repeated: deflate packs it about 1000:1. */
function repetitiveDocument(bytes: number): Buffer {
  const one = Buffer.from(paragraph('Lorem ipsum dolor sit amet, consectetur adipiscing elit.'));
  const body = Buffer.alloc(Math.floor(bytes / one.length) * one.length);
  body.fill(one);
  return Buffer.concat([Buffer.from(BODY_START), body, Buffer.from(BODY_END)]);
}

/** About `bytes` of numbered paragraphs: within every size and ratio limit, but more than the reader's heap holds. */
function heavyDocument(bytes: number): Buffer {
  const paragraphs: string[] = [];
  for (let size = 0, index = 0; size < bytes; index += 1) {
    const text = paragraph(`Paragraph ${index} of a long and complicated document.`);
    paragraphs.push(text);
    size += text.length;
  }
  return Buffer.from(`${BODY_START}${paragraphs.join('')}${BODY_END}`);
}

const LETTER_PARAGRAPHS = ['Dear Hiring Manager,', 'I build reliable platforms and I would like to build yours.', 'Sincerely,'];
const SMALL_DOCX = docx(documentOf(LETTER_PARAGRAPHS));

const marker = (page: number) => `P${String(page).padStart(4, '0')}`;

/** A PDF of `pages` pages built from a template: each page says "Section P0001 of the long file" (its number). */
function manyPagePdf(pages: number): Buffer {
  const parts: string[] = ['%PDF-1.4\n'];
  let length = parts[0]!.length;
  const offsets: number[] = [];
  const add = (id: number, body: string) => {
    offsets[id] = length;
    const text = `${id} 0 obj\n${body}\nendobj\n`;
    parts.push(text);
    length += text.length;
  };
  const kids = Array.from({ length: pages }, (_, index) => `${4 + index * 2} 0 R`).join(' ');
  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages} /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> >>`);
  add(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let page = 1; page <= pages; page += 1) {
    const ops = `BT /F1 12 Tf 72 720 Td (Section ${marker(page)} of the long file) Tj ET`;
    add(2 + page * 2, `<< /Type /Page /Parent 2 0 R /Contents ${3 + page * 2} 0 R >>`);
    add(3 + page * 2, `<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
  }
  const size = 4 + pages * 2;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id += 1) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  parts.push(xref, `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`);
  return Buffer.from(parts.join(''), 'latin1');
}

let bombDocx: Buffer;
let lyingDocx: Buffer;
let thousandPagePdf: Buffer;
beforeAll(() => {
  // 30 MB of XML in about 100 KB; and the same file claiming its document.xml unpacks to 10 KB.
  const xml = repetitiveDocument(30 * MB);
  const packed = deflateRawSync(xml);
  bombDocx = docx(xml, { packed });
  lyingDocx = docx(xml, { packed, declaredSize: 10_000 });
  thousandPagePdf = manyPagePdf(5_000);
});

// ---------------------------------------------------------------------------------------------------- helpers --

type Route = 'letter upload' | 'letter import' | 'template upload' | 'template import' | 'resume upload';
const ROUTES: Route[] = ['letter upload', 'letter import', 'template upload', 'template import', 'resume upload'];

async function signedIn(): Promise<{ c: TestContext; agent: TestAgent }> {
  ctx = createTestContext({ env: NO_BROWSER });
  const me = await signIn(ctx, 'uploader@example.com');
  return { c: ctx, agent: me.agent };
}

/** The route's URL (creating the letter or template an import goes into). */
async function pathOf(agent: TestAgent, route: Route): Promise<string> {
  if (route === 'letter upload') return '/api/cover-letters/upload';
  if (route === 'template upload') return '/api/cover-letter-templates/upload';
  if (route === 'resume upload') return '/api/resumes/upload';
  if (route === 'letter import') {
    const letter = await agent.post('/api/cover-letters').set('Origin', ORIGIN).send({});
    return `/api/cover-letters/${letter.body.id}/import`;
  }
  const template = await agent.post('/api/cover-letter-templates').set('Origin', ORIGIN).send({ name: 'My template' });
  return `/api/cover-letter-templates/${template.body.id}/import`;
}

async function timedUpload(agent: TestAgent, path: string, buffer: Buffer, name: string) {
  const started = performance.now();
  const res = await agent.post(path).set('Origin', ORIGIN).attach('file', buffer, name);
  return { res, ms: performance.now() - started };
}

const count = (c: TestContext, table: string) => (c.deps.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

/** The rejection of a promise that must reject with an AppError. */
async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

// ------------------------------------------------------------------------------------------------------ tests --

describe('reading the ZIP central directory', () => {
  it('reads the declared sizes, ZIP64 extra fields included, without unpacking anything', () => {
    const entries = zipEntries(bombDocx)!;
    const main = entries.find((entry) => entry.name === 'word/document.xml')!;
    expect(main).toMatchObject({ method: 8, uncompressedSize: expect.any(Number) });
    expect(main.uncompressedSize).toBeGreaterThan(29 * MB);
    expect(main.compressedSize).toBeLessThan(200_000);
    expect(bombDocx.length).toBeLessThan(200_000);

    const wide = zipEntries(docx(documentOf(['Hello']), { zip64: true }))!;
    const wideMain = wide.find((entry) => entry.name === 'word/document.xml')!;
    expect(wideMain.uncompressedSize).toBe(documentOf(['Hello']).length);
    expect(wideMain.compressedSize).toBeGreaterThan(0);
    expect(wideMain.compressedSize).toBeLessThan(0xffffffff);
  });

  it('knows a package that unpacks to too much', () => {
    const part = (name: string, uncompressedSize: number, compressedSize = uncompressedSize) => ({ name, compressedSize, uncompressedSize });
    expect(docxUnpackProblem([part('word/document.xml', 2 * MB, MB)])).toBeNull();
    expect(docxUnpackProblem([part('word/document.xml', 16 * MB, 8 * MB)])).toMatch(/word\/document\.xml unpacks to 16 MB/);
    expect(docxUnpackProblem([part('a.xml', 13 * MB), part('word/media/b.png', 13 * MB)])).toMatch(/more than 25 MB/);
    expect(docxUnpackProblem([part('word/document.xml', 2 * MB, 10_000)])).toMatch(/unpacks 210:1/);
    // Small parts compress well and are harmless whatever their ratio.
    expect(docxUnpackProblem([part('word/styles.xml', 900_000, 1_000)])).toBeNull();
    expect(DOCX_LIMITS).toEqual({ maxUnpackedBytes: 25 * MB, maxPartBytes: 15 * MB, maxRatio: 100, ratioFloorBytes: MB });
  });
});

describe('a Word file that unpacks to 30 MB', () => {
  for (const route of ROUTES) {
    it(`${route}: answers 413 at once, reads and stores nothing`, async () => {
      const { c, agent } = await signedIn();
      const path = await pathOf(agent, route);
      const { res, ms } = await timedUpload(agent, path, bombDocx, 'bomb.docx');
      expect(res.status, JSON.stringify(res.body)).toBe(413);
      expect(res.body.error).toMatchObject({ code: 'file_too_large', message: TOO_LARGE_UNPACKED });
      expect(ms).toBeLessThan(3_000);
      expect(count(c, 'stored_files')).toBe(0);
      expect(count(c, 'resumes')).toBe(0);
      // The API is still up and reads a normal file.
      const fine = await agent.post(path).set('Origin', ORIGIN).attach('file', SMALL_DOCX, 'letter.docx');
      expect(fine.status, JSON.stringify(fine.body)).toBeLessThan(300);
    });
  }

  it('is refused in the reader when it lies about its sizes, before anything unpacks past the lie', async () => {
    const { c, agent } = await signedIn();
    // The central directory says 10 KB, so the cheap check lets it through to the reader.
    expect(docxUnpackProblem(zipEntries(lyingDocx)!)).toBeNull();
    for (const route of ['letter upload', 'resume upload'] as const) {
      const { res, ms } = await timedUpload(agent, await pathOf(agent, route), lyingDocx, 'small.docx');
      expect(res.status, `${route} ${JSON.stringify(res.body)}`).toBe(413);
      expect(res.body.error.message).toBe(TOO_LARGE_UNPACKED);
      expect(ms).toBeLessThan(5_000);
    }
    expect(count(c, 'cover_letters')).toBe(0);
    expect(count(c, 'resumes')).toBe(0);
    // The resume route stores the file before the reader sees it, and removes it again when the reader refuses.
    expect(count(c, 'stored_files')).toBe(0);
  });

  it('a Word file within the size limits but too much for the reader is refused with a sentence', async () => {
    const { agent } = await signedIn();
    // 14 MB of varied XML in about half a megabyte: mammoth would need far more than the reader's 256 MB heap.
    const heavy = docx(heavyDocument(14 * MB));
    expect(docxUnpackProblem(zipEntries(heavy)!)).toBeNull();
    const { res, ms } = await timedUpload(agent, '/api/cover-letters/upload', heavy, 'heavy.docx');
    expect(res.status, JSON.stringify(res.body)).toBe(415);
    expect(res.body.error).toMatchObject({ code: 'unsupported_file', message: UNREADABLE_FILE });
    expect(ms).toBeLessThan(15_000);
    const fine = await agent.post('/api/cover-letters/upload').set('Origin', ORIGIN).attach('file', SMALL_DOCX, 'letter.docx');
    expect(fine.status).toBe(201);
  }, 30_000);
});

describe('a PDF with 5,000 pages', () => {
  it('resume upload: reads the first 30 pages quickly and keeps the true page count', async () => {
    const { c, agent } = await signedIn();
    const { res, ms } = await timedUpload(agent, '/api/resumes/upload', thousandPagePdf, 'long.pdf');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(ms).toBeLessThan(10_000);
    const detail = (await agent.get(`/api/resumes/${res.body.resume.id}`)).body;
    expect(detail.file.pageCount).toBe(5_000);
    const { extracted_text: text } = c.deps.db.prepare('SELECT extracted_text FROM resumes').get() as { extracted_text: string };
    expect(text).toContain(marker(1));
    expect(text).toContain(marker(30));
    expect(text).not.toContain(marker(31));
    expect((await agent.get(`/api/resumes/${res.body.resume.id}/thumbnail`)).body.kind).toBe('image');
  });

  for (const route of ['letter upload', 'letter import', 'template upload', 'template import'] as const) {
    it(`${route}: reads the first 10 pages quickly`, async () => {
      const { agent } = await signedIn();
      const { res, ms } = await timedUpload(agent, await pathOf(agent, route), thousandPagePdf, 'long.pdf');
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      expect(ms).toBeLessThan(10_000);
      expect(res.body.contentHtml).toContain(marker(10));
      expect(res.body.contentHtml).not.toContain(marker(11));
    });
  }
});

describe('normal files', () => {
  it('read exactly as pdf-parse and mammoth read them in the API process', async () => {
    const pdf = manyPagePdf(3);
    const parser = new PDFParse({ data: new Uint8Array(pdf) });
    const direct = await parser.getText({ pageJoiner: '' }).finally(() => parser.destroy());
    const read = await parsePdf(pdf, { maxPages: 30, textOptions: { pageJoiner: '' }, thumbnailWidth: 480 });
    expect(read).toMatchObject({ pageCount: 3, text: direct.text, problems: [] });
    expect(read.pages.map((page) => page.text)).toEqual(direct.pages.map((page) => page.text));
    expect(read.thumbnail?.subarray(0, 4).toString('latin1')).toBe('\x89PNG');

    const word = await parseDocx(SMALL_DOCX, { maxChars: 200_000, html: { maxBlocks: 120, maxChars: 2_000_000 } });
    expect(word.text).toBe((await mammoth.extractRawText({ buffer: SMALL_DOCX })).value);
    expect(word.html).toBe((await mammoth.convertToHtml({ buffer: SMALL_DOCX })).value);
  });

  it('cut long Word text and thumbnail HTML in the reader', async () => {
    const long = docx(documentOf(Array.from({ length: 400 }, (_, index) => `Paragraph number ${index} of a long letter.`)));
    const word = await parseDocx(long, { maxChars: 1_000, html: { maxBlocks: 5, maxChars: 2_000_000 } });
    expect(word.text).toHaveLength(1_000);
    expect(word.html).toBe(
      Array.from({ length: 5 }, (_, index) => `<p>Paragraph number ${index} of a long letter.</p>`).join(''),
    );
    const capped = await parseDocx(long, { maxChars: 1_000, html: { maxBlocks: 400, maxChars: 100 } });
    expect(capped.html!.length).toBeLessThanOrEqual(100);
    expect(capped.html).toMatch(/^<p>Paragraph number 0 of a long letter\.<\/p>/);
    expect(capped.html!.endsWith('>')).toBe(true);
  });
});

describe('the reader process', () => {
  let dir: string;
  let script: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'tailorit-reader-'));
    script = join(dir, 'misbehaving-reader.mjs');
    // A stand-in for parse-worker.mjs that does what job.op says.
    writeFileSync(
      script,
      `import process from 'node:process';
process.once('message', (job) => {
  const send = (message) => new Promise((resolve) => process.send(message, resolve));
  if (job.op === 'spin') for (;;) {}
  if (job.op === 'idle') setInterval(() => {}, 1000);
  if (job.op === 'crash') process.abort();
  if (job.op === 'oom') { const kept = []; for (;;) kept.push(new Array(1e6).fill(job.op)); }
  if (job.op === 'partial') send({ part: 'text', value: 'kept' }).then(() => { for (;;) {} });
  if (job.op === 'fatal') send({ fatal: job.fatal, message: 'said so' });
  if (job.op === 'introspect') send({ part: 'self', value: { env: Object.keys(process.env), execArgv: process.execArgv, bytes: job.data.length } }).then(() => send({ done: true })).then(() => process.exit(0));
});
`,
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const job = (op: string, extra: Record<string, unknown> = {}) => ({ op, data: new Uint8Array(8), ...extra });

  it('stops a reader that takes too long', async () => {
    const started = performance.now();
    const error = await refusal(runParseJob(job('spin'), { script, timeoutMs: 400 }));
    expect(error).toMatchObject({ code: 'unsupported_file', status: 415, message: UNREADABLE_FILE });
    expect(String((error.cause as Error).message)).toMatch(/longer than 400 ms/);
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it('outlives a reader that runs out of memory or crashes', async () => {
    const oom = await refusal(runParseJob(job('oom'), { script, timeoutMs: 20_000 }));
    expect(oom).toMatchObject({ code: 'unsupported_file', message: UNREADABLE_FILE });
    expect(String((oom.cause as Error).message)).toMatch(/heap/i);
    const crash = await refusal(runParseJob(job('crash'), { script }));
    expect(crash).toMatchObject({ code: 'unsupported_file', message: UNREADABLE_FILE });
  }, 30_000);

  it('keeps the parts that arrived before the reader died', async () => {
    const parts = await runParseJob(job('partial'), { script, timeoutMs: 400, required: ['text'] });
    expect(parts.get('text')).toEqual({ value: 'kept', error: undefined });
    const error = await refusal(runParseJob(job('partial'), { script, timeoutMs: 400, required: ['text', 'html'] }));
    expect(error.code).toBe('unsupported_file');
  });

  it("passes on the reader's refusals", async () => {
    expect(await refusal(runParseJob(job('fatal', { fatal: 'too_large_unpacked' }), { script }))).toMatchObject({
      code: 'file_too_large',
      message: TOO_LARGE_UNPACKED,
    });
    expect(await refusal(runParseJob(job('fatal', { fatal: 'setup' }), { script }))).toMatchObject({ code: 'internal', status: 500 });
    expect(await refusal(runParseJob(job('fatal', { fatal: 'failed' }), { script }))).toMatchObject({ code: 'unsupported_file' });
  });

  it('runs with a small heap, no eval and none of the server secrets', async () => {
    vi.stubEnv('SMTP_PASS', 'do-not-leak');
    vi.stubEnv('NODE_OPTIONS', '--max-old-space-size=8192');
    const parts = await runParseJob(job('introspect', { data: new Uint8Array(1234) }), { script, required: ['self'] });
    const self = parts.get('self')!.value as { env: string[]; execArgv: string[]; bytes: number };
    expect(self.execArgv).toEqual(['--max-old-space-size=256', '--disallow-code-generation-from-strings']);
    expect(self.env.map((key) => key.toUpperCase())).not.toContain('SMTP_PASS');
    expect(self.env.map((key) => key.toUpperCase())).not.toContain('NODE_OPTIONS');
    expect(self.bytes).toBe(1234);
  });

  it(`reads ${PARSE_MAX_CONCURRENCY} files at a time and refuses more than ${PARSE_MAX_WAITING} waiting`, async () => {
    const waiting = Array.from({ length: PARSE_MAX_CONCURRENCY + PARSE_MAX_WAITING }, () =>
      refusal(runParseJob(job('idle'), { script, timeoutMs: 300 })),
    );
    const busy = await refusal(runParseJob(job('idle'), { script, timeoutMs: 300 }));
    expect(busy).toMatchObject({ code: 'rate_limited', status: 429, retryAfterSeconds: 15 });
    for (const error of await Promise.all(waiting)) expect(error.code).toBe('unsupported_file');
    // Room again.
    expect((await refusal(runParseJob(job('idle'), { script, timeoutMs: 300 }))).code).toBe('unsupported_file');
  }, 30_000);
});
