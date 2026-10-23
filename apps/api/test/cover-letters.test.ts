import { randomUUID } from 'node:crypto';
import HTMLtoDOCX from '@turbodocx/html-to-docx';
import { PDFParse } from 'pdf-parse';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CoverLetterDetailSchema,
  CoverLetterGenerateResultSchema,
  CoverLetterListResponseSchema,
  CoverLetterPreviewResponseSchema,
  LETTER_TITLE_MESSAGE,
} from '@tailorit/shared';
import { requireAi } from '../src/ai/index';
import { defaultBrowserLookup, locateBrowser } from '../src/core/pdf/index';
import { chipPlaceholders } from '../src/features/cover-letters/document';
import { paragraphsFromLines, pdfLinesToParagraphs } from '../src/features/cover-letters/extract';
import { familiesUsed } from '../src/features/cover-letters/fonts';
import { NO_RESUME_MESSAGE } from '../src/features/cover-letters/generate';
import { downloadName } from '../src/features/cover-letters/http';
import { tidyAiText } from '../src/features/cover-letters/prompts';
import { sanitizeLetterHtml } from '../src/features/cover-letters/sanitize';
import { signIn, type SignedIn } from './auth-helpers';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';

// Work package C: /api/cover-letters (CRUD, autosave, upload/import, generation through the fake Claude CLI, preview,
// export) and the pure helpers behind it.

let ctx: TestContext;
beforeEach(() => {
  vi.stubEnv('FAKE_CLAUDE_MODE', '');
  ctx = createTestContext();
});
afterEach(() => {
  vi.unstubAllEnvs();
  ctx.cleanup();
});

const later = (minutes: number) => new Date(TEST_NOW.getTime() + minutes * 60_000);

// --------------------------------------------------------------------------------------------------- fixtures --

const RESUME = {
  name: 'Jordan Avery Chen',
  title: 'Senior Platform Engineer',
  totalYearsExperience: 8,
  contact: { phone: '', email: 'jordan@example.com', location: 'Austin, TX', linkedin: 'linkedin.com/in/jordanchen' },
  summary: 'Platform engineer who keeps large systems calm.',
  experience: [
    {
      title: 'Senior Platform Engineer',
      company: 'Northwind',
      startDate: '2021',
      endDate: 'Present',
      location: 'Remote',
      description: 'Runs the deployment platform.',
      achievements: ['Cut release delays from weeks to days by rebuilding the release checklist.'],
      skills: ['Kubernetes', 'Go'],
    },
  ],
  skills: ['Kubernetes', 'Go', 'Terraform'],
  education: [{ degree: 'BSc Computer Science', institution: 'UT Austin', startDate: '2010', endDate: '2014', location: 'Austin' }],
};

function addResume(userId: string, document: unknown = RESUME): string {
  const id = randomUUID();
  const now = TEST_NOW.toISOString();
  ctx.deps.db
    .prepare(
      `INSERT INTO resumes(id, user_id, kind, title, data, created_at, updated_at) VALUES (?, ?, 'built', NULL, ?, ?, ?)`,
    )
    .run(id, userId, JSON.stringify(document), now, now);
  ctx.deps.db.prepare('UPDATE users SET default_resume_id = ? WHERE id = ?').run(id, userId);
  return id;
}

function addApplication(userId: string, fields: { title: string; company: string; descriptionHtml: string }): string {
  const id = randomUUID();
  const now = TEST_NOW.toISOString();
  ctx.deps.db
    .prepare(
      `INSERT INTO applications(id, user_id, title, company_name, employment_type, description_html, tracked_on,
         created_at, updated_at) VALUES (?, ?, ?, ?, 'full_time', ?, '2026-10-22', ?, ?)`,
    )
    .run(id, userId, fields.title, fields.company, fields.descriptionHtml, now, now);
  return id;
}

function addJob(fields: { title: string; company: string; description: string }): number {
  const now = TEST_NOW.toISOString();
  const company = ctx.deps.db
    .prepare('INSERT INTO companies(name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(fields.company, fields.company.toLowerCase(), now, now);
  const job = ctx.deps.db
    .prepare(
      `INSERT INTO jobs(company_id, title, description_text, content_hash, first_seen_at, last_seen_at, created_at,
         updated_at) VALUES (?, ?, ?, 'hash', ?, ?, ?, ?)`,
    )
    .run(company.lastInsertRowid, fields.title, fields.description, now, now, now, now);
  return Number(job.lastInsertRowid);
}

/** A one-page PDF with Helvetica text: `null` leaves a blank line (a paragraph gap). */
function minimalPdf(lines: Array<string | null>): Buffer {
  const escape = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`);
  const ops = ['BT', '/F1 11 Tf', '16 TL', '72 720 Td'];
  lines.forEach((line, index) => {
    if (index > 0) ops.push('T*');
    if (line !== null) ops.push(`(${escape(line)}) Tj`);
  });
  ops.push('ET');
  const content = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function docxOf(html: string): Promise<Buffer> {
  const output = await HTMLtoDOCX(`<!DOCTYPE html><html><body>${html}</body></html>`);
  return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
}

async function newLetter(user: SignedIn, body: Record<string, unknown> = {}) {
  const res = await user.agent.post('/api/cover-letters').set('Origin', ORIGIN).send(body);
  expect(res.status).toBe(201);
  return CoverLetterDetailSchema.parse(res.body);
}

const binary = (res: request.Response, done: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

// ------------------------------------------------------------------------------------------------------- CRUD --

describe('cover letters: CRUD and ownership', () => {
  it('creates "Cover Letter M/D/YYYY", lists, reads, renames and deletes', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const letter = await newLetter(me);
    expect(letter).toMatchObject({
      title: 'Cover Letter 10/22/2026',
      origin: 'blank',
      contentHtml: '',
      fontFamily: 'Times New Roman',
      lastEditedAt: null,
      createdAt: TEST_NOW.toISOString(),
    });

    const list = CoverLetterListResponseSchema.parse((await me.agent.get('/api/cover-letters')).body);
    expect(list.items.map((item) => item.id)).toEqual([letter.id]);
    expect(list.total).toBe(1);

    ctx.setNow(later(5));
    const renamed = await me.agent
      .patch(`/api/cover-letters/${letter.id}`)
      .set('Origin', ORIGIN)
      .send({ title: '  Northwind letter  ' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ title: 'Northwind letter', lastEditedAt: null, updatedAt: later(5).toISOString() });

    const short = await me.agent.patch(`/api/cover-letters/${letter.id}`).set('Origin', ORIGIN).send({ title: 'ab' });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatchObject({ code: 'validation_failed', message: LETTER_TITLE_MESSAGE });

    const deleted = await me.agent.delete(`/api/cover-letters/${letter.id}`).set('Origin', ORIGIN);
    expect(deleted.status).toBe(204);
    expect((await me.agent.get(`/api/cover-letters/${letter.id}`)).status).toBe(404);
  });

  it("answers 404 for another account's letter on every route", async () => {
    const owner = await signIn(ctx, 'owner@example.com');
    const other = await signIn(ctx, 'other@example.com');
    const letter = await newLetter(owner);
    const base = `/api/cover-letters/${letter.id}`;
    const answers = await Promise.all([
      other.agent.get(base),
      other.agent.patch(base).set('Origin', ORIGIN).send({ title: 'Mine now' }),
      other.agent.delete(base).set('Origin', ORIGIN),
      other.agent.get(`${base}/preview`),
      other.agent.get(`${base}/export?format=docx`),
      other.agent
        .post(`${base}/generate`)
        .set('Origin', ORIGIN)
        .send({ companyName: 'Acme', jobTitle: 'Engineer', templateId: null }),
    ]);
    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('That cover letter was not found.');
    }
    expect((await other.agent.get('/api/cover-letters')).body.items).toEqual([]);
    const bulk = await other.agent.post('/api/cover-letters/bulk-delete').set('Origin', ORIGIN).send({ ids: [letter.id] });
    expect(bulk.body).toEqual({ deleted: 0 });
    expect((await owner.agent.get(base)).status).toBe(200);
    expect((await request(ctx.app).get('/api/cover-letters')).status).toBe(401);
  });

  it('prefills company, title and description from a tracked application or a job', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const other = await signIn(ctx, 'other@example.com');
    const applicationId = addApplication(me.account.id, {
      title: 'Staff Engineer',
      company: 'Contoso',
      descriptionHtml: '<p>Own the <strong>platform</strong>.</p><ul><li>Go</li></ul>',
    });
    const fromApplication = await newLetter(me, { applicationId });
    expect(fromApplication).toMatchObject({
      applicationId,
      companyName: 'Contoso',
      jobTitle: 'Staff Engineer',
      jobDescription: 'Own the platform.\n\n- Go',
    });
    const stolen = await other.agent.post('/api/cover-letters').set('Origin', ORIGIN).send({ applicationId });
    expect(stolen.status).toBe(404);

    const jobId = addJob({ title: 'Platform Engineer', company: 'Fabrikam', description: 'Keep the fleet healthy.' });
    const fromJob = await newLetter(me, { jobId });
    expect(fromJob).toMatchObject({ jobId, companyName: 'Fabrikam', jobTitle: 'Platform Engineer', jobDescription: 'Keep the fleet healthy.' });
    expect((await me.agent.post('/api/cover-letters').set('Origin', ORIGIN).send({ jobId: 999_999 })).status).toBe(404);
  });

  it('searches by title, company and job title; bulk delete removes only the selection', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const a = await newLetter(me);
    ctx.setNow(later(1));
    const b = await newLetter(me);
    await me.agent.patch(`/api/cover-letters/${b.id}`).set('Origin', ORIGIN).send({ companyName: 'Contoso 100%' });
    ctx.setNow(later(2));
    const c = await newLetter(me);

    const search = async (q: string) => (await me.agent.get('/api/cover-letters').query({ q })).body.items.map((item: { id: string }) => item.id);
    expect(await search('contoso')).toEqual([b.id]);
    expect(await search('100%')).toEqual([b.id]);
    expect(await search('%')).toEqual([b.id]);
    expect(await search('Cover Letter')).toEqual([c.id, b.id, a.id]);

    const res = await me.agent.post('/api/cover-letters/bulk-delete').set('Origin', ORIGIN).send({ ids: [a.id, c.id, 'nope'] });
    expect(res.body).toEqual({ deleted: 2 });
    expect(await search('')).toEqual([b.id]);
  });
});

// --------------------------------------------------------------------------------------------------- autosave --

describe('cover letters: autosave', () => {
  it('sanitizes HTML, keeps the text, and sets last_edited_at only when the content changes', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const letter = await newLetter(me);
    const html =
      '<h1 style="text-align: center">Jordan</h1><p onclick="x()">Dear <strong>team</strong> at {{COMPANY_NAME}},' +
      '<script>alert(1)</script></p><p><span style="font-family: Lato, sans-serif; color: red">Lato</span> ' +
      '<a href="javascript:alert(1)">bad</a> <a href="https://example.com" target="_blank">ok</a></p><img src="x">';

    ctx.setNow(later(10));
    const saved = await me.agent.patch(`/api/cover-letters/${letter.id}`).set('Origin', ORIGIN).send({ contentHtml: html });
    expect(saved.status).toBe(200);
    const detail = CoverLetterDetailSchema.parse(saved.body);
    expect(detail.contentHtml).toBe(
      '<h1 style="text-align:center">Jordan</h1><p>Dear <strong>team</strong> at {{COMPANY_NAME}},</p>' +
        '<p><span style="font-family:Lato, sans-serif">Lato</span> <a>bad</a> ' +
        '<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">ok</a></p>',
    );
    expect(detail.lastEditedAt).toBe(later(10).toISOString());
    const text = ctx.deps.db.prepare('SELECT content_text FROM cover_letters WHERE id = ?').get(letter.id) as { content_text: string };
    expect(text.content_text).toBe('Jordan\nDear team at {{COMPANY_NAME}},\nLato bad ok');

    // The same content again (a second autosave): not an edit.
    ctx.setNow(later(20));
    const again = await me.agent.patch(`/api/cover-letters/${letter.id}`).set('Origin', ORIGIN).send({ contentHtml: html });
    expect(again.body.lastEditedAt).toBe(later(10).toISOString());
    expect(again.body.updatedAt).toBe(later(20).toISOString());

    // A font change is an edit; the generate dialog's fields are not.
    ctx.setNow(later(30));
    const font = await me.agent.patch(`/api/cover-letters/${letter.id}`).set('Origin', ORIGIN).send({ fontFamily: 'Lato' });
    expect(font.body).toMatchObject({ fontFamily: 'Lato', lastEditedAt: later(30).toISOString() });
    ctx.setNow(later(40));
    const fields = await me.agent
      .patch(`/api/cover-letters/${letter.id}`)
      .set('Origin', ORIGIN)
      .send({ companyName: 'Acme', jobTitle: 'Engineer', jobDescription: 'Build', customPrompt: 'Be brief' });
    expect(fields.body).toMatchObject({ companyName: 'Acme', customPrompt: 'Be brief', lastEditedAt: later(30).toISOString() });

    const badFont = await me.agent.patch(`/api/cover-letters/${letter.id}`).set('Origin', ORIGIN).send({ fontFamily: 'Comic Sans' });
    expect(badFont.status).toBe(400);
    const badTemplate = await me.agent.patch(`/api/cover-letters/${letter.id}`).set('Origin', ORIGIN).send({ templateId: 'missing' });
    expect(badTemplate.status).toBe(404);
  });

  it('refuses a cross-site request', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const letter = await newLetter(me);
    const res = await me.agent.patch(`/api/cover-letters/${letter.id}`).set('Origin', 'https://evil.example').send({ title: 'Hacked' });
    expect(res.status).toBe(403);
  });
});

// ----------------------------------------------------------------------------------------------- upload/import --

describe('cover letters: upload and import', () => {
  it('turns a DOCX into paragraphs, titled from the file name', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const docx = await docxOf('<p>Dear Hiring Manager,</p><p>I build reliable platforms at { {COMPANY_NAME} }.</p><p>Sincerely,</p>');
    const res = await me.agent
      .post('/api/cover-letters/upload')
      .set('Origin', ORIGIN)
      .attach('file', docx, { filename: 'Jordan Chen letter.docx' });
    expect(res.status).toBe(201);
    const letter = CoverLetterDetailSchema.parse(res.body);
    expect(letter).toMatchObject({ title: 'Jordan Chen letter', origin: 'uploaded', lastEditedAt: null });
    expect(letter.contentHtml).toBe(
      '<p>Dear Hiring Manager,</p><p>I build reliable platforms at {{COMPANY_NAME}}.</p><p>Sincerely,</p>',
    );
    const row = ctx.deps.db.prepare('SELECT file_id FROM cover_letters WHERE id = ?').get(letter.id) as { file_id: string };
    expect(row.file_id).toBeTruthy();

    // Deleting the letter deletes its stored upload.
    await me.agent.delete(`/api/cover-letters/${letter.id}`).set('Origin', ORIGIN);
    expect(ctx.deps.db.prepare('SELECT count(*) AS n FROM stored_files').get()).toEqual({ n: 0 });
  });

  it('reads PDF paragraphs from the gaps between lines', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const pdf = minimalPdf([
      'Dear Hiring Manager,',
      null,
      'I have spent eight years keeping production platforms healthy and calm, and the role you',
      'describe is the work I want to do next, close to the engineers who rely on the platform.',
      null,
      'Thank you for your time and for reading my letter.',
      null,
      'Sincerely,',
      'Jordan Chen',
    ]);
    const res = await me.agent.post('/api/cover-letters/upload').set('Origin', ORIGIN).attach('file', pdf, { filename: 'ab.pdf' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Cover Letter 10/22/2026');
    expect(res.body.contentHtml).toBe(
      '<p>Dear Hiring Manager,</p>' +
        '<p>I have spent eight years keeping production platforms healthy and calm, and the role you describe is the ' +
        'work I want to do next, close to the engineers who rely on the platform.</p>' +
        '<p>Thank you for your time and for reading my letter.</p><p>Sincerely,</p><p>Jordan Chen</p>',
    );
  });

  it('refuses files that are not PDF or DOCX, and files with no text', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const text = await me.agent
      .post('/api/cover-letters/upload')
      .set('Origin', ORIGIN)
      .attach('file', Buffer.from('plain text'), { filename: 'letter.pdf' });
    expect(text.status).toBe(415);
    expect(text.body.error.message).toBe('Please upload a PDF or DOCX file.');
    const empty = await me.agent
      .post('/api/cover-letters/upload')
      .set('Origin', ORIGIN)
      .attach('file', minimalPdf([]), { filename: 'empty.pdf' });
    expect(empty.status).toBe(415);
    expect(empty.body.error.message).toMatch(/could not read any text/);
    const none = await me.agent.post('/api/cover-letters/upload').set('Origin', ORIGIN);
    expect(none.status).toBe(400);
    expect(ctx.deps.db.prepare('SELECT count(*) AS n FROM cover_letters').get()).toEqual({ n: 0 });
  });

  it('imports a file into an existing letter: content replaced, marked uploaded and edited', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const letter = await newLetter(me);
    ctx.setNow(later(3));
    const res = await me.agent
      .post(`/api/cover-letters/${letter.id}/import`)
      .set('Origin', ORIGIN)
      .attach('file', await docxOf('<p>Imported paragraph.</p>'), { filename: 'x.docx' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: letter.id,
      title: letter.title,
      origin: 'uploaded',
      contentHtml: '<p>Imported paragraph.</p>',
      lastEditedAt: later(3).toISOString(),
    });
  });
});

// -------------------------------------------------------------------------------------------------- generation --

async function generate(user: SignedIn, letterId: string, body: Record<string, unknown>) {
  const res = await user.agent.post(`/api/cover-letters/${letterId}/generate`).set('Origin', ORIGIN).send(body);
  return res;
}

describe('cover letters: generation (fake Claude CLI)', () => {
  it('says to add a resume first when there is none', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const letter = await newLetter(me);
    const res = await generate(me, letter.id, { companyName: 'Acme', jobTitle: 'Engineer', templateId: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ message: NO_RESUME_MESSAGE, fields: { resume: NO_RESUME_MESSAGE } });
    const missing = await generate(me, letter.id, { companyName: '', jobTitle: 'Engineer', templateId: null });
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields.companyName).toBe('Required');
  });

  it('without a template: AI paragraphs inside the name / contact / greeting / sign-off wrapper', async () => {
    const me = await signIn(ctx, 'me@example.com', { name: 'Jordan' });
    addResume(me.account.id);
    const letter = await newLetter(me);
    ctx.setNow(later(1));
    const res = await generate(me, letter.id, {
      companyName: 'Acme',
      jobTitle: 'Platform Engineer',
      jobDescription: 'Keep our platform healthy.',
      templateId: null,
      customPrompt: 'Mention Kubernetes.',
    });
    expect(res.status).toBe(202);
    const task = await requireAi(ctx.deps).waitFor(res.body.taskId);
    expect(task.status).toBe('succeeded');
    const result = CoverLetterGenerateResultSchema.parse(task.result);
    expect(result.placeholders).toEqual([]);
    expect(result.html).toMatch(
      /^<h1 style="text-align:center">Jordan Avery Chen<\/h1><p style="text-align:center">jordan@example\.com \| linkedin\.com\/in\/jordanchen<\/p><p>Dear Hiring Manager,<\/p><p>I have spent the last several years/,
    );
    expect(result.html).toMatch(/<p>Sincerely,<\/p><p>Jordan Avery Chen<\/p>$/);
    // Contact line, greeting, four paragraphs, sign-off and name.
    expect(result.html.match(/<p[ >]/g)!.length).toBe(1 + 1 + 4 + 1 + 1);

    const detail = CoverLetterDetailSchema.parse((await me.agent.get(`/api/cover-letters/${letter.id}`)).body);
    expect(detail).toMatchObject({
      origin: 'generated',
      contentHtml: result.html,
      lastEditedAt: null,
      companyName: 'Acme',
      jobTitle: 'Platform Engineer',
      jobDescription: 'Keep our platform healthy.',
      customPrompt: 'Mention Kubernetes.',
      templateId: null,
    });
    expect(detail.resumeId).toBeTruthy();
  });

  it('with a template: plain variables substituted, AI variables written, the rest left as {{X}}', async () => {
    const me = await signIn(ctx, 'me@example.com');
    addResume(me.account.id);
    const created = await me.agent
      .post('/api/cover-letter-templates')
      .set('Origin', ORIGIN)
      .send({
        name: 'My template',
        fontFamily: 'Lato',
        contentHtml:
          '<p>Dear {{HIRING_MANAGER}},</p><p>I want the {{JOB_TITLE}} role at {{COMPANY_NAME}}.</p>' +
          '<p>{{COMPANY_APPEAL}}</p><p>I can start on {{START_DATE}}. Call me at {{USER_PHONE}}.</p>' +
          '<p>{{SIGN_OFF}}</p><p>{{USER_FIRST_NAME}}</p>',
      });
    expect(created.status).toBe(201);
    const letter = await newLetter(me);
    const res = await generate(me, letter.id, {
      companyName: 'Acme & Co',
      jobTitle: 'Engineer',
      jobDescription: '',
      templateId: created.body.id,
    });
    expect(res.status).toBe(202);
    const task = await requireAi(ctx.deps).waitFor(res.body.taskId);
    expect(task.status).toBe('succeeded');
    const result = CoverLetterGenerateResultSchema.parse(task.result);
    expect(result.placeholders).toEqual(['START_DATE', 'USER_PHONE']);
    expect(result.html).toBe(
      '<p>Dear Hiring Manager,</p><p>I want the Engineer role at Acme &amp; Co.</p>' +
        '<p>What draws me to your company is the care the job description puts into steady improvement and close work ' +
        'with the people who use the product. That is the way I like to work.</p>' +
        '<p>I can start on {{START_DATE}}. Call me at {{USER_PHONE}}.</p><p>Sincerely,</p><p>Jordan</p>',
    );
    const detail = (await me.agent.get(`/api/cover-letters/${letter.id}`)).body;
    expect(detail).toMatchObject({ origin: 'generated', templateId: created.body.id, fontFamily: 'Lato' });
  });

  it('from a system template; an empty template writes the whole letter', async () => {
    const me = await signIn(ctx, 'me@example.com');
    addResume(me.account.id);
    const templates = (await me.agent.get('/api/cover-letter-templates')).body.items as Array<{ id: string; name: string }>;
    const creative = templates.find((template) => template.name === 'Creative Industry')!;
    const letter = await newLetter(me);
    const res = await generate(me, letter.id, { companyName: 'Acme', jobTitle: 'Designer', templateId: creative.id });
    const task = await requireAi(ctx.deps).waitFor(res.body.taskId);
    expect(task.status).toBe('succeeded');
    const result = CoverLetterGenerateResultSchema.parse(task.result);
    expect(result.html).toContain('<p>Hello Acme team,</p>');
    expect(result.html).toContain('<p>Jordan Avery Chen</p>');
    // No portfolio on the resume or in Settings.
    expect(result.placeholders).toEqual(['USER_PORTFOLIO']);

    const empty = await me.agent.post('/api/cover-letter-templates').set('Origin', ORIGIN).send({ aiPrompt: 'Keep it short.' });
    const second = await generate(me, letter.id, { companyName: 'Acme', jobTitle: 'Designer', templateId: empty.body.id });
    const run = await requireAi(ctx.deps).waitFor(second.body.taskId);
    expect(run.kind).toBe('cover_letter');
    expect(CoverLetterGenerateResultSchema.parse(run.result).html).toContain('<p>Dear Hiring Manager,</p>');
  });

  it('a failed AI call leaves the letter as it was', async () => {
    vi.stubEnv('FAKE_CLAUDE_MODE', 'auth');
    const me = await signIn(ctx, 'me@example.com');
    addResume(me.account.id);
    const letter = await newLetter(me);
    await me.agent.patch(`/api/cover-letters/${letter.id}`).set('Origin', ORIGIN).send({ contentHtml: '<p>Mine</p>' });
    const res = await generate(me, letter.id, { companyName: 'Acme', jobTitle: 'Engineer', templateId: null });
    const task = await requireAi(ctx.deps).waitFor(res.body.taskId);
    expect(task.status).toBe('failed');
    const detail = (await me.agent.get(`/api/cover-letters/${letter.id}`)).body;
    expect(detail).toMatchObject({ contentHtml: '<p>Mine</p>', origin: 'blank' });
  });
});

// ------------------------------------------------------------------------------------------- preview and export --

describe('cover letters: preview and export', () => {
  it('previews a US Letter page with inline fonts, chips and a CSP that allows nothing else', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const letter = await newLetter(me);
    await me.agent
      .patch(`/api/cover-letters/${letter.id}`)
      .set('Origin', ORIGIN)
      .send({ contentHtml: '<p>Dear {{HIRING_MANAGER}},</p>', fontFamily: 'Poppins' });
    const preview = CoverLetterPreviewResponseSchema.parse((await me.agent.get(`/api/cover-letters/${letter.id}/preview`)).body);
    expect(preview.page).toEqual({ widthPx: 816, heightPx: 1056 });
    expect(preview.html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"`);
    expect(preview.html).toContain("font-family:'Poppins'");
    expect(preview.html).toContain('src:url(data:font/woff2;base64,');
    expect(preview.html).toContain('<span class="ti-var">{{HIRING_MANAGER}}</span>');
    expect(preview.html).not.toMatch(/https?:\/\//);
  });

  it('exports Word with the title as the file name', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const letter = await newLetter(me);
    await me.agent.patch(`/api/cover-letters/${letter.id}`).set('Origin', ORIGIN).send({ contentHtml: '<p>Hello Word</p>' });
    const res = await me.agent.get(`/api/cover-letters/${letter.id}/export?format=docx`).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(res.headers['content-disposition']).toContain('filename="Cover Letter 10-22-2026.docx"');
    const body = res.body as Buffer;
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});

const configuredChrome = process.env.CHROME_PATH?.trim() || null;
const chrome = locateBrowser(defaultBrowserLookup(configuredChrome));

describe.skipIf(chrome?.exists !== true)('cover letters: PDF export (installed browser)', () => {
  let pdfCtx: TestContext;
  afterAll(async () => {
    await pdfCtx?.deps.services.pdf?.close();
    pdfCtx?.cleanup();
  });

  it('prints a US Letter PDF that round-trips through upload', async () => {
    pdfCtx = createTestContext({ env: configuredChrome ? { CHROME_PATH: configuredChrome } : {} });
    const me = await signIn(pdfCtx, 'me@example.com');
    const created = await me.agent.post('/api/cover-letters').set('Origin', ORIGIN).send({});
    const id = created.body.id as string;
    const paragraph =
      'I have spent eight years keeping production platforms healthy, and the role you describe is the work I want ' +
      'to do next, close to the engineers who rely on the platform every single day.';
    await me.agent
      .patch(`/api/cover-letters/${id}`)
      .set('Origin', ORIGIN)
      .send({ contentHtml: `<p>Dear Hiring Manager,</p><p>${paragraph}</p><p>Sincerely,</p>`, fontFamily: 'Lato' });
    const res = await me.agent.get(`/api/cover-letters/${id}/export?format=pdf`).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('filename="Cover Letter 10-22-2026.pdf"');
    const pdf = res.body as Buffer;
    const parser = new PDFParse({ data: new Uint8Array(pdf) });
    try {
      const info = await parser.getInfo();
      expect(info.total).toBe(1);
      expect((await parser.getText()).text).toContain('Dear Hiring Manager,');
    } finally {
      await parser.destroy();
    }
    const upload = await me.agent.post('/api/cover-letters/upload').set('Origin', ORIGIN).attach('file', pdf, { filename: 'Exported.pdf' });
    expect(upload.status).toBe(201);
    expect(upload.body.contentHtml).toBe(`<p>Dear Hiring Manager,</p><p>${paragraph}</p><p>Sincerely,</p>`);
  });
});

// ---------------------------------------------------------------------------------------------- pure helpers --

describe('letter helpers', () => {
  it('sanitizes to the editor tags', () => {
    expect(sanitizeLetterHtml('<div>One</div><h5>Deep</h5><p style="text-align: justify; color: red">x</p>')).toBe(
      '<p>One</p><h3>Deep</h3><p style="text-align:justify">x</p>',
    );
    expect(sanitizeLetterHtml('<span style="font-family: url(x)">x</span>')).toBe('x');
  });

  it('finds the bundled fonts a letter uses', () => {
    expect(familiesUsed('<p>x</p>', 'Times New Roman')).toEqual([]);
    expect(familiesUsed('<span style="font-family:&quot;Open Sans&quot;, sans-serif">x</span>', 'Roboto').sort()).toEqual([
      'Open Sans',
      'Roboto',
    ]);
    expect(familiesUsed('<span style="font-family:&quot;Roboto Mono&quot;, monospace">x</span>', 'Helvetica')).toEqual(['Roboto Mono']);
  });

  it('chips placeholders in text only', () => {
    expect(chipPlaceholders('<a href="{{X}}">{{X}}</a>')).toBe('<a href="{{X}}"><span class="ti-var">{{X}}</span></a>');
  });

  it('keeps AI text in house style', () => {
    expect(tidyAiText('I led teams — well, mostly – for 2019–2021. It -- worked. **Bold**')).toBe(
      'I led teams, well, mostly, for 2019-2021. It, worked. Bold',
    );
  });

  it('names downloads after the title', () => {
    expect(downloadName('Cover Letter 10/22/2026', 'pdf', 'Cover Letter')).toBe('Cover Letter 10-22-2026.pdf');
    expect(downloadName('  ...  ', 'pdf', 'Cover Letter')).toBe('Cover Letter.pdf');
  });

  it('splits PDF lines into paragraphs', () => {
    expect(pdfLinesToParagraphs('Dear team,\nOne line\n-- 1 of 1 --\n')).toBe('Dear team,\n\nOne line');
    const line = (text: string, y: number) => ({ text, y, height: 11, page: 1 });
    expect(
      paragraphsFromLines([
        line('A first line that is long enough to count as a full line of text', 700),
        line('and it continues here on a second line of the same paragraph text', 684),
        line('A new paragraph after a gap that is about twice the line pitch.', 652),
      ]),
    ).toBe(
      'A first line that is long enough to count as a full line of text and it continues here on a second line of ' +
        'the same paragraph text\n\nA new paragraph after a gap that is about twice the line pitch.',
    );
  });
});
