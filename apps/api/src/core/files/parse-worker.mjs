// Reads one uploaded PDF or Word file for the API, in a child process that core/files/parse.ts starts per file with a
// small V8 heap, eval disabled, a deadline and none of the server's secrets. Plain JavaScript, so it runs the same
// whether the API runs from source (tsx, vitest) or from its bundle (dist).
//
// Protocol (IPC, advanced serialization): the parent sends one job { op, data, ...options }. The reader answers with
// { part, value } or { part, error } as each part is ready (the parent keeps parts that arrived even if the reader dies
// later), then { done: true }, or { fatal, message } when the file must not be read at all; then it exits.
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import process from 'node:process';
import { inflateRawSync } from 'node:zlib';

const require = createRequire(import.meta.url);

/** A first page far taller than it is wide (or the reverse) would need an enormous canvas: no thumbnail then. */
const MAX_PAGE_RATIO = 20;
/** JSZip's marker for a deflated part. */
const DEFLATE = '\x08\x00';

class SetupError extends Error {}

const describe = (error) => (error instanceof Error ? error.message : String(error));

function send(message) {
  return new Promise((resolve) => {
    if (!process.connected) return resolve();
    process.send(message, () => resolve());
  });
}

async function load(name) {
  try {
    return await import(name);
  } catch (error) {
    throw new SetupError(`could not load ${name}: ${describe(error)}`);
  }
}

// ------------------------------------------------------------------------------------------------------------ PDF --

async function readPdf(data, job) {
  const { PDFParse } = await load('pdf-parse');
  const parser = new PDFParse({
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    // pdf.js compiles font glyphs with `new Function` when it may; the interpreter path is enough here.
    isEvalSupported: false,
    maxImageSize: job.maxImagePixels,
  });
  try {
    let readable = false;
    try {
      // Only the first pages; `total` is still the whole file's page count.
      const result = await parser.getText({ ...job.textOptions, first: job.maxPages });
      readable = true;
      await send({
        part: 'text',
        value: { pageCount: result.total, text: result.text, pages: result.pages.map(({ num, text }) => ({ num, text })) },
      });
    } catch (error) {
      await send({ part: 'text', error: describe(error) });
    }
    if (job.items) await send(readable ? await pdfItems(parser, job.maxPages) : { part: 'items', error: 'no text' });
    if (job.thumbnailWidth > 0) await send(await pdfThumbnail(parser, job.thumbnailWidth));
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

/** The text items of the first pages, with the positions the letter paragraph finder reads. */
async function pdfItems(parser, maxPages) {
  try {
    const doc = parser.doc;
    if (!doc || typeof doc.getPage !== 'function') return { part: 'items', error: 'no document' };
    const pages = [];
    for (let number = 1; number <= Math.min(doc.numPages, maxPages); number += 1) {
      const page = await doc.getPage(number);
      const { items } = await page.getTextContent();
      pages.push(
        items
          .filter((item) => typeof item.str === 'string' && Array.isArray(item.transform))
          .map((item) => ({ str: item.str, transform: item.transform.slice(0, 6), width: item.width, height: item.height })),
      );
      page.cleanup?.();
    }
    return { part: 'items', value: pages };
  } catch (error) {
    return { part: 'items', error: describe(error) };
  }
}

async function pdfThumbnail(parser, width) {
  try {
    const doc = parser.doc ?? (await parser.load());
    const page = await doc.getPage(1);
    const { width: pageWidth, height: pageHeight } = page.getViewport({ scale: 1 });
    page.cleanup?.();
    const ratio = pageHeight / pageWidth;
    if (!(pageWidth > 0 && pageHeight > 0) || ratio > MAX_PAGE_RATIO || ratio < 1 / MAX_PAGE_RATIO) {
      return { part: 'thumbnail', error: `the first page is ${Math.round(pageWidth)} x ${Math.round(pageHeight)} points` };
    }
    const shot = await parser.getScreenshot({ partial: [1], desiredWidth: width, imageBuffer: true, imageDataUrl: false });
    const png = shot.pages[0]?.data;
    return { part: 'thumbnail', value: png && png.length > 0 ? png : null };
  } catch (error) {
    return { part: 'thumbnail', error: describe(error) };
  }
}

// ----------------------------------------------------------------------------------------------------------- DOCX --

/**
 * Why the package must not be unpacked, or null. Reads it the way mammoth will (with mammoth's own JSZip), checks the
 * declared sizes against the limits (the same rules as docxUnpackProblem in unpack.ts), then unpacks every deflated part
 * with a hard cap at its declared size: a part that claims 10 KB and holds 300 MB stops after 10 KB.
 */
async function packageProblem(JSZip, data, limits) {
  let zip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    return null; // Not a package JSZip can open: mammoth says so when it reads the text.
  }
  const parts = [];
  for (const file of Object.values(zip.files)) {
    if (file.dir) continue;
    const packed = file._data;
    if (!packed || typeof packed.uncompressedSize !== 'number' || typeof packed.compressedSize !== 'number') {
      return `${file.name}: its size is unknown`;
    }
    parts.push({ name: file.name, packed });
  }
  let total = 0;
  for (const { name, packed } of parts) {
    total += packed.uncompressedSize;
    if (total > limits.maxUnpackedBytes) return 'the parts unpack to more than the limit';
    if (packed.uncompressedSize > limits.maxPartBytes) return `${name} unpacks to ${packed.uncompressedSize} bytes`;
    const ratio = packed.uncompressedSize / Math.max(1, packed.compressedSize);
    if (packed.uncompressedSize >= limits.ratioFloorBytes && ratio > limits.maxRatio) {
      return `${name} unpacks ${Math.round(ratio)}:1`;
    }
  }
  for (const { name, packed } of parts) {
    if (packed.compression?.magic !== DEFLATE) continue;
    if (!(packed.compressedContent instanceof Uint8Array)) return `${name}: its packed bytes cannot be checked`;
    try {
      inflateRawSync(packed.compressedContent, { maxOutputLength: Math.max(1, packed.uncompressedSize) });
    } catch (error) {
      if (error?.code === 'ERR_BUFFER_TOO_LARGE') {
        return `${name} unpacks to more than the ${packed.uncompressedSize} bytes it declares`;
      }
      // A damaged part: mammoth reports it when (and if) it reads it.
    }
  }
  return null;
}

/** mammoth's transformDocument: only the first blocks (a thumbnail shows the first page). */
const firstBlocks = (maxBlocks) => (document) =>
  Array.isArray(document?.children) && document.children.length > maxBlocks
    ? { ...document, children: document.children.slice(0, maxBlocks) }
    : document;

/** At most `maxChars`, cut after a tag so no tag is left half-open. */
function cutHtml(html, maxChars) {
  if (html.length <= maxChars) return html;
  const end = html.lastIndexOf('>', maxChars - 1);
  return end > 0 ? html.slice(0, end + 1) : '';
}

async function readDocx(data, job) {
  let mammoth;
  let JSZip;
  try {
    mammoth = require('mammoth');
    // mammoth's own copy, so the package is checked exactly as mammoth will read it.
    JSZip = createRequire(require.resolve('mammoth'))('jszip');
  } catch (error) {
    throw new SetupError(`could not load mammoth: ${describe(error)}`);
  }
  const problem = await packageProblem(JSZip, data, job.limits);
  if (problem) return { fatal: 'too_large_unpacked', message: problem };

  try {
    const { value } = await mammoth.extractRawText({ buffer: data });
    await send({ part: 'text', value: String(value ?? '').slice(0, job.maxChars) });
  } catch (error) {
    await send({ part: 'text', error: describe(error) });
  }
  if (job.html) {
    try {
      const { value } = await mammoth.convertToHtml(
        { buffer: data },
        { externalFileAccess: false, transformDocument: firstBlocks(job.html.maxBlocks) },
      );
      await send({ part: 'html', value: cutHtml(String(value ?? ''), job.html.maxChars) });
    } catch (error) {
      await send({ part: 'html', error: describe(error) });
    }
  }
  return null;
}

// ------------------------------------------------------------------------------------------------------------ run --

async function run(job) {
  const data = Buffer.from(job.data.buffer, job.data.byteOffset, job.data.byteLength);
  if (job.op === 'pdf') return (await readPdf(data, job)) ?? null;
  if (job.op === 'docx') return readDocx(data, job);
  return { fatal: 'failed', message: `unknown job "${job.op}"` };
}

// The API went away: nothing is waiting for the answer.
process.on('disconnect', () => process.exit(0));
process.once('message', (job) => {
  run(job).then(
    async (fatal) => {
      await send(fatal ?? { done: true });
      process.exit(0);
    },
    async (error) => {
      await send({ fatal: error instanceof SetupError ? 'setup' : 'failed', message: describe(error) });
      process.exit(0);
    },
  );
});
