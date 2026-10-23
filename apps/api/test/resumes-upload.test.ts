import { crc32 } from 'node:zlib';
import mammoth from 'mammoth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AiTaskAcceptedSchema,
  ResumeDetailSchema,
  ResumeImportTaskResultSchema,
  ResumeUploadResponseSchema,
} from '@tailorit/shared';
import { requireAi } from '../src/ai/index';
import { getPdfService } from '../src/core/pdf/index';
import { getResumeEvidence } from '../src/features/resumes/evidence';
import { signIn, type TestAgent } from './auth-helpers';
import { createTestContext, ORIGIN, type TestContext } from './helpers';

// Uploads: the stored file (bytes checked), its text, page count and first-page picture, and the AI import that
// turns one into an editable resume (the fake Claude CLI answers with tools/fake-claude/scenarios/resume_import.json).

let ctx: TestContext | null = null;
beforeEach(() => {
  vi.stubEnv('FAKE_CLAUDE_MODE', '');
  vi.stubEnv('FAKE_CLAUDE_SCENARIOS', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  // A DOCX upload draws its thumbnail with Chrome when one is installed.
  if (ctx) await getPdfService(ctx.deps).close();
  ctx?.cleanup();
  ctx = null;
});

// ------------------------------------------------------------------------------------------------ test files

function escapePdf(text: string): string {
  return text.replace(/[()\\]/g, (char) => `\\${char}`);
}

/** A small, valid PDF with each page's lines of text in Helvetica. */
export function minimalPdf(pages: string[][]): Buffer {
  const objects: string[] = [];
  const pageIds: number[] = [];
  let next = 4;
  for (const lines of pages) {
    const pageId = next++;
    const contentId = next++;
    pageIds.push(pageId);
    const shown = lines.map((line, index) => `${index === 0 ? '' : '0 -16 Td '}(${escapePdf(line)}) Tj`);
    const ops = ['BT', '/F1 12 Tf', '72 770 Td', ...shown, 'ET'].join('\n');
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R ` +
      '/Resources << /Font << /F1 3 0 R >> >> >>';
    objects[contentId] = `<< /Length ${Buffer.byteLength(ops)} >>\nstream\n${ops}\nendstream`;
  }
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < next; id += 1) {
    offsets[id] = Buffer.byteLength(body);
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let id = 1; id < next; id += 1) body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** A ZIP of stored (uncompressed) entries. */
function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content, 'utf8');
    const fileName = Buffer.from(name, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    locals.push(local, fileName, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** A minimal Word document with one paragraph per line. */
export function minimalDocx(lines: string[]): Buffer {
  const paragraphs = lines.map((line) => `<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`).join('');
  return zip({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':
      '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${paragraphs}</w:body></w:document>`,
  });
}

/** Word 97-2003 (Compound File Binary with a WordDocument stream). */
function legacyDoc(): Buffer {
  return Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(504),
    Buffer.from('WordDocument', 'utf16le'),
    Buffer.alloc(64),
  ]);
}

const RESUME_LINES = [
  'Nadia Ferreira-Lund',
  'Backend Engineer, Raleigh NC, nadia.fl@example.com',
  'Experience: Pinecrest Freight Software, 2021 to present, rates and billing services in Go and PostgreSQL',
];

// ------------------------------------------------------------------------------------------------------- tests

async function setup(env: Record<string, string> = {}): Promise<{ agent: TestAgent; other: TestAgent }> {
  ctx = createTestContext({ env });
  const me = await signIn(ctx, 'uploader@example.com');
  const other = await signIn(ctx, 'other@example.com');
  return { agent: me.agent, other: other.agent };
}

function upload(agent: TestAgent, buffer: Buffer, name: string, query = '', title?: string) {
  const req = agent.post(`/api/resumes/upload${query}`).set('Origin', ORIGIN);
  if (title !== undefined) req.field('title', title);
  return req.attach('file', buffer, name);
}

describe('uploading a resume', () => {
  it('stores a PDF with its text, page count and a first-page PNG', async () => {
    const { agent, other } = await setup();
    const pdf = minimalPdf([RESUME_LINES, ['Page two: education and skills']]);
    const res = await upload(agent, pdf, 'Nadia CV.pdf');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const body = ResumeUploadResponseSchema.parse(res.body);
    expect(body.taskId).toBeNull();
    expect(body.resume).toMatchObject({ kind: 'uploaded', label: 'Nadia CV', fileKind: 'pdf', isDefault: true, nameOnResume: '', templateId: null });

    const detail = ResumeDetailSchema.parse((await agent.get(`/api/resumes/${body.resume.id}`)).body);
    expect(detail.document).toBeNull();
    expect(detail.hasExtractedText).toBe(true);
    expect(detail.file).toMatchObject({ name: 'Nadia CV.pdf', mime: 'application/pdf', sizeBytes: pdf.length, pageCount: 2 });
    const row = ctx!.deps.db.prepare('SELECT extracted_text FROM resumes WHERE id = ?').get(body.resume.id) as { extracted_text: string };
    expect(row.extracted_text).toContain('Pinecrest Freight Software');

    const thumbnail = await agent.get(`/api/resumes/${body.resume.id}/thumbnail`);
    expect(thumbnail.body).toEqual({ kind: 'image', url: `/api/files/${detail.file!.id}/thumbnail` });
    const png = await agent.get(thumbnail.body.url).buffer(true);
    expect(png.status).toBe(200);
    expect((png.body as Buffer).subarray(0, 4).toString('latin1')).toBe('\x89PNG');

    const original = await agent.get(`/api/resumes/${body.resume.id}/file`).buffer(true);
    expect(original.status).toBe(200);
    expect(original.headers['content-type']).toBe('application/pdf');
    expect(Buffer.compare(original.body as Buffer, pdf)).toBe(0);
    expect((await other.get(`/api/files/${detail.file!.id}/thumbnail`)).status).toBe(404);
  });

  it("gives other features an upload's text and file name as its evidence", async () => {
    ctx = createTestContext();
    const me = await signIn(ctx, 'evidence@example.com');
    const res = await upload(me.agent, minimalPdf([RESUME_LINES]), 'Nadia CV.pdf');
    const evidence = getResumeEvidence(ctx.deps, me.account.id);
    expect(evidence).toMatchObject({ resumeId: res.body.resume.id, kind: 'uploaded', label: 'Nadia CV', document: null });
    expect(evidence!.text).toContain('Pinecrest Freight Software');
    expect(evidence!.profile.email).toBe('evidence@example.com');
    const built = await me.agent
      .post('/api/resumes')
      .set('Origin', ORIGIN)
      .send({ document: { name: 'Nadia', title: 'Engineer', skills: ['Go'], contact: { email: 'n@example.com' } } });
    const own = getResumeEvidence(ctx.deps, me.account.id, built.body.id);
    expect(own).toMatchObject({ kind: 'built', label: 'Engineer', profile: { email: 'n@example.com', name: 'Nadia' } });
    expect(own!.text).toContain('Go');
    expect(getResumeEvidence(ctx.deps, me.account.id, 'not-mine')).toBeNull();
  });

  it('stores a DOCX with its text, and a custom title', async () => {
    const { agent } = await setup();
    const docx = minimalDocx(RESUME_LINES);
    expect((await mammoth.extractRawText({ buffer: docx })).value).toContain('Nadia');
    const res = await upload(agent, docx, 'nadia.docx', '', 'Nadia (Word)');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.resume).toMatchObject({ kind: 'uploaded', fileKind: 'docx', label: 'Nadia (Word)', title: 'Nadia (Word)' });
    const detail = (await agent.get(`/api/resumes/${res.body.resume.id}`)).body;
    expect(detail.hasExtractedText).toBe(true);
  });

  it('refuses a Word 97-2003 file with a hint, and a file that is not a document', async () => {
    const { agent } = await setup();
    const doc = await upload(agent, legacyDoc(), 'old.doc');
    expect(doc.status).toBe(415);
    expect(doc.body.error.message).toMatch(/Save Word 97-2003 documents as \.docx first/);
    const text = await upload(agent, Buffer.from('just some text, not a resume file'), 'resume.pdf');
    expect(text.status).toBe(415);
    expect((await agent.get('/api/resumes')).body.items).toEqual([]);
  });

  it('refuses a file over the size limit', async () => {
    const { agent } = await setup({ UPLOAD_MAX_MB: '1' });
    const big = Buffer.concat([minimalPdf([RESUME_LINES]), Buffer.alloc(1024 * 1024 + 10, 0x20)]);
    const res = await upload(agent, big, 'big.pdf');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('file_too_large');
  });

  it('deletes the stored file with the resume', async () => {
    const { agent } = await setup();
    const res = await upload(agent, minimalPdf([RESUME_LINES]), 'cv.pdf');
    const detail = (await agent.get(`/api/resumes/${res.body.resume.id}`)).body;
    expect((await agent.get(`/api/files/${detail.file.id}`)).status).toBe(200);
    await agent.delete(`/api/resumes/${res.body.resume.id}`).set('Origin', ORIGIN);
    expect((await agent.get(`/api/files/${detail.file.id}`)).status).toBe(404);
  });

  it('downloads an upload as itself, and refuses another format', async () => {
    const { agent } = await setup();
    const pdf = minimalPdf([RESUME_LINES]);
    const res = await upload(agent, pdf, 'cv.pdf');
    const asPdf = await agent.get(`/api/resumes/${res.body.resume.id}/export?format=pdf`).buffer(true);
    expect(asPdf.status).toBe(200);
    expect(Buffer.compare(asPdf.body as Buffer, pdf)).toBe(0);
    expect(asPdf.headers['content-disposition']).toContain('cv.pdf');
    const asDocx = await agent.get(`/api/resumes/${res.body.resume.id}/export?format=docx`);
    expect(asDocx.status).toBe(400);
    expect(asDocx.body.error.message).toMatch(/is a PDF/);
  });

  it('duplicates an upload with its own copy of the file', async () => {
    const { agent } = await setup();
    const res = await upload(agent, minimalPdf([RESUME_LINES]), 'cv.pdf');
    const copy = await agent.post(`/api/resumes/${res.body.resume.id}/duplicate`).set('Origin', ORIGIN).send({});
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ kind: 'uploaded', label: 'cv (Copy)', hasExtractedText: true });
    const original = (await agent.get(`/api/resumes/${res.body.resume.id}`)).body;
    expect(copy.body.file.id).not.toBe(original.file.id);
    await agent.delete(`/api/resumes/${res.body.resume.id}`).set('Origin', ORIGIN);
    expect((await agent.get(`/api/resumes/${copy.body.id}/file`)).status).toBe(200);
  });
});

describe('making an editable copy (resume_import)', () => {
  it('upload with parse=1 reads the file into a new built resume', async () => {
    const { agent } = await setup();
    const res = await upload(agent, minimalPdf([RESUME_LINES]), 'nadia.pdf', '?parse=1&templateId=navy-gold&layout=flat');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { taskId } = ResumeUploadResponseSchema.parse(res.body);
    expect(taskId).toEqual(expect.any(String));
    const task = await requireAi(ctx!.deps).waitFor(taskId!, 20_000);
    expect(task.status, JSON.stringify(task.error)).toBe('succeeded');
    const { resumeId } = ResumeImportTaskResultSchema.parse(task.result);
    const built = ResumeDetailSchema.parse((await agent.get(`/api/resumes/${resumeId}`)).body);
    expect(built).toMatchObject({ kind: 'built', label: 'Backend Engineer', nameOnResume: 'Nadia Ferreira-Lund', templateId: 'navy-gold' });
    expect(built.document?.resumeSettings.technicalSkillsLayout).toBe('flat');
    expect(built.document?.customSections?.[0]).toMatchObject({ title: 'Talks' });
    expect(built.document?.customSections?.[0]?.key).toMatch(/^cs-[0-9a-f]{8}$/);
    expect(built.document?.certifications?.[0]?.name).toBe('AWS Certified Developer - Associate');
    const row = ctx!.deps.db.prepare('SELECT source_resume_id FROM resumes WHERE id = ?').get(resumeId) as { source_resume_id: string };
    expect(row.source_resume_id).toBe(res.body.resume.id);
    // The upload stays, and stays the default (it came first).
    expect((await agent.get(`/api/resumes/${res.body.resume.id}`)).body.isDefault).toBe(true);
  });

  it('POST /:id/parse starts the import for an upload (202), and refuses a built resume', async () => {
    const { agent } = await setup();
    const res = await upload(agent, minimalPdf([RESUME_LINES]), 'nadia.pdf');
    const accepted = await agent.post(`/api/resumes/${res.body.resume.id}/parse`).set('Origin', ORIGIN).send({});
    expect(accepted.status).toBe(202);
    const { taskId } = AiTaskAcceptedSchema.parse(accepted.body);
    const task = await requireAi(ctx!.deps).waitFor(taskId, 20_000);
    expect(task.status).toBe('succeeded');
    const polled = await agent.get(`/api/ai/tasks/${taskId}`);
    expect(polled.body.result).toEqual(task.result);
    const built = (task.result as { resumeId: string }).resumeId;
    const again = await agent.post(`/api/resumes/${built}/parse`).set('Origin', ORIGIN).send({});
    expect(again.status).toBe(400);
  });

  it('refuses a file without readable text before calling the AI, and keeps nothing', async () => {
    const { agent } = await setup();
    const res = await upload(agent, minimalPdf([['Too short']]), 'scan.pdf', '?parse=1');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/could not read enough text/);
    expect((await agent.get('/api/resumes')).body.items).toEqual([]);
    const stored = await upload(agent, minimalPdf([['Too short']]), 'scan.pdf');
    expect(stored.status).toBe(201);
    const parse = await agent.post(`/api/resumes/${stored.body.resume.id}/parse`).set('Origin', ORIGIN).send({});
    expect(parse.status).toBe(400);
  });

  it('reports an AI failure on the task', async () => {
    const { agent } = await setup();
    vi.stubEnv('FAKE_CLAUDE_MODE', 'auth');
    const res = await upload(agent, minimalPdf([RESUME_LINES]), 'nadia.pdf', '?parse=1');
    const task = await requireAi(ctx!.deps).waitFor(res.body.taskId, 20_000);
    expect(task.status).toBe('failed');
    expect(task.error?.code).toBe('ai_unavailable');
    expect((await agent.get('/api/resumes')).body.items).toHaveLength(1);
  });
});
