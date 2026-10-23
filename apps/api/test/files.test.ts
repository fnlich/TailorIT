import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { Router } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { requireUser, userOf } from '../src/core/auth/guards';
import type { Feature } from '../src/core/feature';
import {
  contentDisposition,
  detectFileKind,
  getFileStore,
  isPasswordProtectedOffice,
  zipEntryNames,
} from '../src/core/files/index';
import { AppError } from '../src/core/http/errors';
import { FEATURES } from '../src/features/index';
import { signIn } from './auth-helpers';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';

let ctx: TestContext | null = null;
afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

// ------------------------------------------------------------------------------------------------------ fixtures --

/** A stored (uncompressed) ZIP, optionally with an archive comment or ZIP64 end records. */
function zip(entries: Record<string, string>, options: { comment?: string; zip64?: boolean } = {}): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content, 'utf8');
    const fileName = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    parts.push(local, fileName, data);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(fileName.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const directory = Buffer.concat(central);
  const count = Object.keys(entries).length;
  const tail: Buffer[] = [];
  if (options.zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(directory.length), 40);
    record.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + directory.length), 8);
    locator.writeUInt32LE(1, 16);
    tail.push(record, locator);
  }
  const comment = Buffer.from(options.comment ?? '', 'utf8');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(options.zip64 ? 0xffff : count, 8);
  end.writeUInt16LE(options.zip64 ? 0xffff : count, 10);
  end.writeUInt32LE(options.zip64 ? 0xffffffff : directory.length, 12);
  end.writeUInt32LE(options.zip64 ? 0xffffffff : offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...parts, directory, ...tail, end, comment]);
}

const DOCX_PARTS = {
  '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
  '_rels/.rels': '<?xml version="1.0"?><Relationships/>',
  'word/document.xml': '<?xml version="1.0"?><w:document/>',
};
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const DOCX = zip(DOCX_PARTS);
const CFB = (stream: string) =>
  Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(504),
    Buffer.from(stream, 'utf16le'),
    Buffer.alloc(64),
  ]);
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

function thrown(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

/** Reads a binary response body into a Buffer. */
function binary(test: request.Test): request.Test {
  return test.buffer(true).parse((res, done) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  });
}

// ------------------------------------------------------------------------------------------------------- tests --

describe('magic-byte detection', () => {
  it('recognises PDF, DOCX and Word 97-2003 from their bytes', () => {
    expect(detectFileKind(PDF)).toBe('pdf');
    expect(detectFileKind(DOCX)).toBe('docx');
    expect(detectFileKind(zip(DOCX_PARTS, { comment: 'made by a test' }))).toBe('docx');
    expect(detectFileKind(zip(DOCX_PARTS, { zip64: true }))).toBe('docx');
    expect(detectFileKind(CFB('WordDocument'))).toBe('doc');
  });

  it('accepts the variants Word writes', () => {
    const lowerCase = zip({ '[content_types].xml': 'x', 'Word/Document.xml': 'x' });
    const webWord = zip({ '[Content_Types].xml': 'x', 'word/document2.xml': 'x' });
    expect(detectFileKind(lowerCase)).toBe('docx');
    expect(detectFileKind(webWord)).toBe('docx');
  });

  it('refuses other ZIP packages, broken archives and everything else', () => {
    const xlsx = zip({ '[Content_Types].xml': 'x', 'xl/workbook.xml': 'x' });
    const odt = zip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': 'x' });
    const noTypes = zip({ 'word/document.xml': 'x' });
    expect(zipEntryNames(xlsx)).toEqual(['[Content_Types].xml', 'xl/workbook.xml']);
    for (const [label, buffer] of Object.entries({
      xlsx,
      odt,
      noTypes,
      truncated: DOCX.subarray(0, DOCX.length - 30),
      localHeaderOnly: Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.from('[Content_Types].xml word/document.xml')]),
      excel97: CFB('Workbook'),
      encrypted: CFB('EncryptedPackage'),
      text: Buffer.from('Just a resume in plain text. word/document.xml [Content_Types].xml'),
      html: Buffer.from('<!doctype html><title>%PDF-</title>'),
      png: PNG_1PX,
      empty: Buffer.alloc(0),
    })) {
      expect(detectFileKind(buffer), label).toBeNull();
    }
    expect(isPasswordProtectedOffice(CFB('EncryptedPackage'))).toBe(true);
    expect(isPasswordProtectedOffice(CFB('WordDocument'))).toBe(false);
  });
});

describe('FileStore', () => {
  async function setup(env: Record<string, string> = {}) {
    ctx = createTestContext({ env: { UPLOAD_MAX_MB: '1', ...env } });
    const owner = await signIn(ctx, 'owner@example.com');
    const other = await signIn(ctx, 'other@example.com');
    return { c: ctx, store: getFileStore(ctx.deps), owner, other };
  }

  it('stores the bytes under DATA_DIR/files/<user>/<file> with a stored_files row', async () => {
    const { c, store, owner } = await setup();
    const file = store.save({
      userId: owner.account.id,
      purpose: 'resume',
      buffer: PDF,
      originalName: 'C:\\fakepath\\My Résumé.pdf',
    });
    expect(file).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      userId: owner.account.id,
      purpose: 'resume',
      originalName: 'My Résumé.pdf',
      mime: 'application/pdf',
      kind: 'pdf',
      sizeBytes: PDF.length,
      sha256: sha256(PDF),
      storagePath: `${owner.account.id}/${file.id}`,
      thumbPath: null,
      pageCount: null,
      createdAt: TEST_NOW.toISOString(),
    });
    const onDisk = join(c.dataDir, 'files', owner.account.id, file.id);
    expect(readFileSync(onDisk)).toEqual(PDF);
    expect(store.pathOf(file)).toBe(onDisk);
    expect(store.pathOf(file.id)).toBe(onDisk);
    expect(store.read(file.id, owner.account.id).buffer).toEqual(PDF);

    const docx = store.save({ userId: owner.account.id, purpose: 'letter_import', buffer: DOCX, originalName: 'l.docx' });
    expect(docx.mime).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    store.setPageCount(file.id, 2);
    expect(store.get(file.id, owner.account.id)?.pageCount).toBe(2);
  });

  it('keeps every file to its owner', async () => {
    const { store, owner, other } = await setup();
    const file = store.save({ userId: owner.account.id, purpose: 'resume', buffer: PDF, originalName: 'a.pdf' });
    expect(store.get(file.id, other.account.id)).toBeNull();
    const error = thrown(() => store.read(file.id, other.account.id));
    expect(error).toMatchObject({ code: 'not_found', status: 404, message: 'That file was not found.' });
    expect(store.remove(file.id, other.account.id)).toBe(false);
    expect(existsSync(store.pathOf(file))).toBe(true);
  });

  it('refuses files over UPLOAD_MAX_MB', async () => {
    const { store, owner } = await setup();
    const big = Buffer.concat([PDF, Buffer.alloc(1024 * 1024)]);
    const error = thrown(() => store.save({ userId: owner.account.id, purpose: 'resume', buffer: big, originalName: 'big.pdf' }));
    expect(error).toMatchObject({
      code: 'file_too_large',
      status: 413,
      message: 'big.pdf is larger than 1 MB. Choose a smaller file.',
    });
    const exact = Buffer.concat([PDF, Buffer.alloc(1024 * 1024 - PDF.length)]);
    expect(store.save({ userId: owner.account.id, purpose: 'resume', buffer: exact, originalName: 'ok.pdf' }).sizeBytes).toBe(
      1024 * 1024,
    );
  });

  it('refuses anything that is not what the caller accepts, saying what to upload', async () => {
    const { c, store, owner } = await setup();
    const save = (buffer: Buffer, accept?: Array<'pdf' | 'docx' | 'doc'>) =>
      store.save({ userId: owner.account.id, purpose: 'resume', buffer, originalName: 'fake.pdf', accept });

    for (const buffer of [Buffer.from('plain text pretending to be a PDF'), PNG_1PX, Buffer.alloc(0)]) {
      expect(thrown(() => save(buffer))).toMatchObject({
        code: 'unsupported_file',
        status: 415,
        message: 'Please upload a PDF or DOCX file.',
      });
    }
    expect(thrown(() => save(CFB('WordDocument'))).message).toBe(
      'Please upload a PDF or DOCX file. Save Word 97-2003 documents as .docx first.',
    );
    expect(thrown(() => save(CFB('EncryptedPackage'))).message).toBe(
      'That document is password-protected. Remove the password, save it, and upload it again.',
    );
    expect(thrown(() => save(DOCX, ['pdf'])).message).toBe('Please upload a PDF file.');
    expect(save(CFB('WordDocument'), ['pdf', 'docx', 'doc']).mime).toBe('application/msword');
    expect(c.deps.db.prepare('SELECT count(*) AS n FROM stored_files').get()).toEqual({ n: 1 });
  });

  it('keeps a thumbnail beside the file and removes both', async () => {
    const { store, owner } = await setup();
    const file = store.save({ userId: owner.account.id, purpose: 'resume', buffer: PDF, originalName: 'a.pdf' });
    expect(store.readThumbnail(file.id, owner.account.id)).toBeNull();
    store.saveThumbnail(file.id, PNG_1PX);
    const withThumb = store.get(file.id, owner.account.id)!;
    expect(withThumb.thumbPath).toBe(`${file.storagePath}.thumb.png`);
    expect(store.readThumbnail(file.id, owner.account.id)).toEqual(PNG_1PX);
    expect(() => store.saveThumbnail(file.id, Buffer.from('not a png'))).toThrow(/PNG/);

    expect(store.remove(file.id, owner.account.id)).toBe(true);
    expect(store.get(file.id, owner.account.id)).toBeNull();
    expect(existsSync(store.pathOf(withThumb))).toBe(false);
    expect(existsSync(`${store.pathOf(withThumb)}.thumb.png`)).toBe(false);
  });

  it('builds Content-Disposition with an ASCII fallback and the UTF-8 name', () => {
    expect(contentDisposition('My Résumé (final).pdf')).toBe(
      `attachment; filename="My R_sum_ (final).pdf"; filename*=UTF-8''My%20R%C3%A9sum%C3%A9%20%28final%29.pdf`,
    );
    expect(contentDisposition('a"b%c.pdf', 'inline')).toBe(`inline; filename="a_b_c.pdf"; filename*=UTF-8''a%22b%25c.pdf`);
    // Path segments (either separator) never reach the header.
    expect(contentDisposition('../../etc/passwd')).toBe(`attachment; filename="passwd"; filename*=UTF-8''passwd`);
    expect(contentDisposition('C:\\Users\\x\\cv.pdf')).toBe(`attachment; filename="cv.pdf"; filename*=UTF-8''cv.pdf`);
    // Control and bidi-override characters are dropped (no header injection, no disguised extensions).
    expect(contentDisposition('cv\r\nSet-Cookie: x=1\u202Efdp.exe')).toBe(
      `attachment; filename="cvSet-Cookie: x=1fdp.exe"; filename*=UTF-8''cvSet-Cookie%3A%20x%3D1fdp.exe`,
    );
  });
});

describe('/api/files', () => {
  async function setup() {
    ctx = createTestContext();
    const owner = await signIn(ctx, 'owner@example.com');
    const other = await signIn(ctx, 'other@example.com');
    const store = getFileStore(ctx.deps);
    const pdf = store.save({ userId: owner.account.id, purpose: 'resume', buffer: PDF, originalName: 'My Résumé' });
    const docx = store.save({ userId: owner.account.id, purpose: 'letter_import', buffer: DOCX, originalName: 'L.docx' });
    return { c: ctx, store, owner, other, pdf, docx };
  }

  it('downloads the owner’s file as an attachment, or inline for a PDF', async () => {
    const { owner, pdf, docx } = await setup();
    const res = await binary(owner.agent.get(`/api/files/${pdf.id}`));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-length']).toBe(String(PDF.length));
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="My R_sum_.pdf"; filename*=UTF-8''My%20R%C3%A9sum%C3%A9.pdf`,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual(PDF);

    const inline = await binary(owner.agent.get(`/api/files/${pdf.id}?inline=1`));
    expect(inline.headers['content-disposition']).toMatch(/^inline; /);
    const word = await binary(owner.agent.get(`/api/files/${docx.id}?inline=1`));
    expect(word.headers['content-disposition']).toMatch(/^attachment; filename="L.docx"/);
    expect(word.body).toEqual(DOCX);
  });

  it('answers 404 for anyone else’s file, 401 when signed out', async () => {
    const { c, other, pdf } = await setup();
    const theirs = await other.agent.get(`/api/files/${pdf.id}`);
    expect(theirs.status).toBe(404);
    expect(theirs.body.error).toMatchObject({ code: 'not_found', message: 'That file was not found.' });
    expect((await other.agent.get(`/api/files/${pdf.id}/thumbnail`)).status).toBe(404);
    expect((await other.agent.get('/api/files/no-such-file')).status).toBe(404);
    expect((await request(c.app).get(`/api/files/${pdf.id}`)).status).toBe(401);
  });

  it('answers 404 when the bytes have gone missing', async () => {
    const { store, owner, pdf } = await setup();
    rmSync(store.pathOf(pdf));
    expect((await owner.agent.get(`/api/files/${pdf.id}`)).status).toBe(404);
  });

  it('serves the thumbnail once there is one', async () => {
    const { store, owner, pdf } = await setup();
    const none = await owner.agent.get(`/api/files/${pdf.id}/thumbnail`);
    expect(none.status).toBe(404);
    expect(none.body.error.message).toBe('That thumbnail was not found.');
    store.saveThumbnail(pdf.id, PNG_1PX);
    const res = await binary(owner.agent.get(`/api/files/${pdf.id}/thumbnail`));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body).toEqual(PNG_1PX);
  });
});

describe('uploadSingle', () => {
  const uploadFeature: Feature = {
    name: 'test-upload',
    routes: [
      {
        path: '/api/test-upload',
        router: (deps) => {
          const router = Router();
          const files = getFileStore(deps);
          router.post('/', requireUser, files.uploadSingle('file'), (req, res) => {
            const file = files.save({
              userId: userOf(req).id,
              purpose: 'resume',
              buffer: req.file!.buffer,
              originalName: req.file!.originalname,
            });
            res.status(201).json({ file, fields: { ...req.body } });
          });
          router.post('/optional', requireUser, files.uploadSingle('file', { required: false }), (req, res) => {
            res.json({ hasFile: Boolean(req.file) });
          });
          return router;
        },
      },
    ],
  };

  async function setup() {
    ctx = createTestContext({ env: { UPLOAD_MAX_MB: '1' }, features: [...FEATURES, uploadFeature] });
    const user = await signIn(ctx, 'uploader@example.com');
    const upload = (path = '/api/test-upload') => user.agent.post(path).set('Origin', ORIGIN);
    return { c: ctx, user, upload };
  }

  it('stores an upload with its UTF-8 name and passes the other form fields on', async () => {
    const { c, user, upload } = await setup();
    const res = await upload()
      .field('note', 'first upload')
      .attach('file', PDF, { filename: 'Résumé – 2026.pdf', contentType: 'text/plain' });
    expect(res.status).toBe(201);
    expect(res.body.fields).toEqual({ note: 'first upload' });
    expect(res.body.file).toMatchObject({ originalName: 'Résumé – 2026.pdf', mime: 'application/pdf', sizeBytes: PDF.length });
    expect(readFileSync(join(c.dataDir, 'files', user.account.id, res.body.file.id))).toEqual(PDF);
  });

  it('answers 413, 415 and 400 with sentences a person can act on', async () => {
    const { upload } = await setup();
    const big = await upload().attach('file', Buffer.concat([PDF, Buffer.alloc(1024 * 1024)]), 'big.pdf');
    expect(big.status).toBe(413);
    expect(big.body.error).toMatchObject({
      code: 'file_too_large',
      message: 'big.pdf is larger than 1 MB. Choose a smaller file.',
    });

    const fake = await upload().attach('file', Buffer.from('not really a pdf'), {
      filename: 'resume.pdf',
      contentType: 'application/pdf',
    });
    expect(fake.status).toBe(415);
    expect(fake.body.error).toMatchObject({ code: 'unsupported_file', message: 'Please upload a PDF or DOCX file.' });

    const none = await upload().field('note', 'no file');
    expect(none.status).toBe(400);
    expect(none.body.error).toMatchObject({ code: 'validation_failed', message: 'Choose a file to upload.' });
    const json = await upload().send({ file: 'x' });
    expect(json.status).toBe(400);
    expect(json.body.error.message).toBe('Choose a file to upload.');

    const two = await upload().attach('file', PDF, 'a.pdf').attach('file', PDF, 'b.pdf');
    expect(two.status).toBe(400);
    expect(two.body.error.message).toBe('Upload one file at a time.');
    const wrongField = await upload().attach('document', PDF, 'a.pdf');
    expect(wrongField.status).toBe(400);
    expect(wrongField.body.error.message).toBe('Send the file in the "file" field.');
  });

  it('can leave the file optional', async () => {
    const { upload } = await setup();
    expect((await upload('/api/test-upload/optional').field('x', '1')).body).toEqual({ hasFile: false });
    expect((await upload('/api/test-upload/optional').attach('file', PDF, 'a.pdf')).body).toEqual({ hasFile: true });
  });
});
