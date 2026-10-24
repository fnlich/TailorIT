import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import request from 'supertest';
import type { Browser } from 'puppeteer-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeResumeDocument, ResumeZipBuildSchema, type ResumeDocument, type ResumeZipBuild } from '@tailorit/shared';
import { getFileStore, zipEntries } from '../src/core/files/index';
import { AppError } from '../src/core/http/errors';
import {
  createPdfService,
  Semaphore,
  SlotWaitTimeout,
  type BrowserLocation,
  type PdfService,
  type PrintPdfOptions,
} from '../src/core/pdf/index';
import { insertResume } from '../src/features/resumes/repository';
import { resumeZipFeature } from '../src/features/resume-zip/index';
import { createResumeZipService, type ResumeZipOptions } from '../src/features/resume-zip/registry';
import { signIn, type TestAgent } from './auth-helpers';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';
import { insertJob } from './job-fixtures';

// "Build resumes" (work package WP11): POST 202 -> poll -> GET the file; the scope (the ids, or every active Saved
// application); uploads copied byte for byte with their own extension; each built resume rendered once (PDF, Word when
// Chrome is missing or failing); STORE entries with UTF-8 names dated in the person's time zone; SKIPPED.txt; the
// limits (413 from stored sizes before any read, 409 per account, 429 for the server); the due choices made first;
// temporary files removed; and the PDF pool's wait limit and abort signal the build relies on.

let ctx: TestContext | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  const current = ctx;
  ctx = null;
  if (!current) return;
  await current.deps.services.resumeZip?.stop();
  current.cleanup();
});

/** A context whose resume ZIP service has these options (the router reads the service on each request). */
function context(options: Partial<ResumeZipOptions> = {}, env?: Record<string, string>): TestContext {
  ctx = createTestContext({ env });
  ctx.deps.services.resumeZip = createResumeZipService(ctx.deps, options);
  return ctx;
}

const ZIP = '/api/applications/resume-zip';
const NOT_AVAILABLE = 'That zip is no longer available. Build your resumes again.';

// ----------------------------------------------------------------------------------------------- the PDF stand-in

interface FakePdf extends PdfService {
  prints: Array<{ html: string; options: PrintPdfOptions | undefined }>;
}

/** A PdfService that records each print; `print` decides the answer (default: a small distinct PDF). */
function fakePdf(
  c: TestContext,
  options: { available?: boolean; print?: (html: string, count: number) => Promise<Buffer> } = {},
): FakePdf {
  const prints: FakePdf['prints'] = [];
  const service: FakePdf = {
    prints,
    available: () => options.available ?? true,
    executablePath: () => ((options.available ?? true) ? 'C:\\fake\\chrome.exe' : null),
    async printPdf(html, printOptions) {
      prints.push({ html, options: printOptions });
      if (options.print) return options.print(html, prints.length);
      return Buffer.from(`%PDF-1.7\n% rendered ${prints.length}\n%%EOF\n`, 'latin1');
    },
    async screenshotPng() {
      return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    },
    async close() {},
  };
  c.deps.services.pdf = service;
  return service;
}

// ---------------------------------------------------------------------------------------------------- fixtures

/** PDF bytes with binary noise in them: a copy that changes a single byte is caught. */
function pdfBytes(label: string): Buffer {
  return Buffer.concat([Buffer.from(`%PDF-1.4\n% ${label}\n`, 'latin1'), randomBytes(4096), Buffer.from('\n%%EOF\n', 'latin1')]);
}

async function docxBytes(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/></Types>',
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

/** An upload as the app stores it (file, row, rules' reading); Claude is not asked to read it. */
function storeUpload(c: TestContext, userId: string, input: { name: string; buffer: Buffer; text: string; title?: string }) {
  const file = getFileStore(c.deps).save({ userId, purpose: 'resume', buffer: input.buffer, originalName: input.name });
  const resumeId = insertResume(c.deps, userId, {
    kind: 'uploaded',
    title: input.title ?? null,
    fileId: file.id,
    extractedText: input.text,
    aiRefine: false,
  });
  return { resumeId, file };
}

function built(c: TestContext, userId: string, document: Partial<ResumeDocument>, title?: string): string {
  return insertResume(c.deps, userId, { kind: 'built', title: title ?? null, document: normalizeResumeDocument(document) });
}

let tracked = 0;

/** A tracker application written directly (the tracker's own writes are another package's): newer ones list first. */
function addApplication(
  c: TestContext,
  userId: string,
  input: {
    title: string;
    company: string;
    status?: 1 | 2 | 11 | 12 | 13 | 21 | 22 | 23 | 24;
    resumeId?: string | null;
    archived?: boolean;
    jobId?: number;
    due?: boolean;
  },
): string {
  tracked += 1;
  const id = randomUUID();
  const status = input.status ?? 1;
  // Each one a second older than the last: the tracker's order (newest first) is the order they are added in.
  const createdAt = new Date(TEST_NOW.getTime() - tracked * 1000).toISOString();
  c.deps.db
    .prepare(
      `INSERT INTO applications(id, user_id, job_id, title, company_name, employment_type, current_status, archived_at,
         resume_id, resume_origin, resume_match_due, tracked_on, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'full_time', ?, ?, ?, ?, ?, '2026-10-20', ?, ?)`,
    )
    .run(
      id,
      userId,
      input.jobId ?? null,
      input.title,
      input.company,
      status,
      input.archived ? createdAt : null,
      input.resumeId ?? null,
      input.resumeId ? 'user' : null,
      input.due ? 1 : 0,
      createdAt,
      createdAt,
    );
  const event = c.deps.db.prepare('INSERT INTO application_status_events(application_id, status, occurred_on, created_at) VALUES (?, ?, ?, ?)');
  event.run(id, 1, '2026-10-20', createdAt);
  if (status !== 1) event.run(id, status, '2026-10-21', createdAt);
  return id;
}

// -------------------------------------------------------------------------------------------------- the routes

function binary(res: request.Response, callback: (error: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

function startZip(agent: TestAgent, body: Record<string, unknown> = {}) {
  return agent.post(ZIP).set('Origin', ORIGIN).send(body);
}

async function settledBuild(c: TestContext, agent: TestAgent, buildId: string): Promise<ResumeZipBuild> {
  await c.deps.services.resumeZip!.settled(buildId);
  const res = await agent.get(`${ZIP}/${buildId}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return ResumeZipBuildSchema.parse(res.body);
}

function downloadZip(agent: TestAgent, buildId: string) {
  return agent.get(`${ZIP}/${buildId}/file`).buffer(true).parse(binary);
}

interface ReadEntry {
  name: string;
  method: number;
  flags: number;
  /** The local header's own flags and size (no data descriptor: the sizes are written up front). */
  localFlags: number;
  localSize: number;
  dosTime: number;
  dosDate: number;
  data: Buffer;
}

async function readZip(buffer: Buffer): Promise<ReadEntry[]> {
  const listed = zipEntries(buffer);
  expect(listed).not.toBeNull();
  const zip = await JSZip.loadAsync(buffer);
  return Promise.all(
    listed!.map(async (entry) => ({
      name: entry.name,
      method: entry.method,
      flags: entry.flags,
      localFlags: buffer.readUInt16LE(entry.localHeaderOffset + 6),
      localSize: buffer.readUInt32LE(entry.localHeaderOffset + 22),
      dosTime: buffer.readUInt16LE(entry.localHeaderOffset + 10),
      dosDate: buffer.readUInt16LE(entry.localHeaderOffset + 12),
      data: await zip.file(entry.name)!.async('nodebuffer'),
    })),
  );
}

/** POST, wait, download: the ready build, its zip's entries by name, and the download response. */
async function buildZip(c: TestContext, agent: TestAgent, body: Record<string, unknown> = {}) {
  const started = await startZip(agent, body);
  expect(started.status, JSON.stringify(started.body)).toBe(202);
  const build = await settledBuild(c, agent, started.body.buildId as string);
  expect(build.status, JSON.stringify(build.error)).toBe('ready');
  const response = await downloadZip(agent, build.buildId);
  expect(response.status).toBe(200);
  const zip = response.body as Buffer;
  const entries = await readZip(zip);
  return { build, zip, response, entries: new Map(entries.map((entry) => [entry.name, entry])) };
}

const dosTime = (hours: number, minutes: number, seconds: number) => (hours << 11) | (minutes << 5) | (seconds >> 1);
const dosDate = (year: number, month: number, day: number) => ((year - 1980) << 9) | (month << 5) | day;

describe('the routes', () => {
  it('reach the zip feature, never the tracker routes beside them', async () => {
    const c = context();
    const me = await signIn(c, 'routes@example.com');
    const resume = built(c, me.account.id, { name: 'Ada Lovelace' });
    fakePdf(c);
    addApplication(c, me.account.id, { title: 'Analyst', company: 'Acme', resumeId: resume });

    const started = await startZip(me.agent);
    expect(started.status, JSON.stringify(started.body)).toBe(202);
    expect(Object.keys(started.body)).toEqual(['buildId']);
    await c.deps.services.resumeZip!.settled(started.body.buildId);

    // An unknown build is the zip feature's own 404, not "That application was not found."
    for (const path of [`${ZIP}/${randomUUID()}`, `${ZIP}/${randomUUID()}/file`, `${ZIP}/resume-matches`, `${ZIP}/questions`]) {
      const res = await me.agent.get(path);
      expect(res.status, path).toBe(404);
      expect(res.body.error.message, path).toBe(NOT_AVAILABLE);
    }
    expect((await me.agent.get(`${ZIP}/${started.body.buildId}`)).body.status).toBe('ready');

    // Signed out, another site's Origin, a body that is not valid.
    expect((await request(c.app).post(ZIP).set('Origin', ORIGIN).send({})).status).toBe(401);
    expect((await request(c.app).get(`${ZIP}/${started.body.buildId}`)).status).toBe(401);
    const foreign = await me.agent.post(ZIP).set('Origin', 'https://evil.example').send({});
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe('bad_origin');
    const invalid = await startZip(me.agent, { ids: [] });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.message).toContain('Choose at least one application');
    expect((await startZip(me.agent, { tzOffsetMinutes: 2000 })).status).toBe(400);
  });

  it('answers 202, reports progress, then sends the file with its length and dated name, once', async () => {
    const c = context();
    const me = await signIn(c, 'flow@example.com', { name: 'Ada Lovelace' });
    const resume = built(c, me.account.id, { name: 'Ada Lovelace', title: 'Backend Engineer' });
    fakePdf(c);
    addApplication(c, me.account.id, { title: 'Platform Engineer', company: 'Globex', resumeId: resume });
    addApplication(c, me.account.id, { title: 'Data Engineer', company: 'Initech', resumeId: resume });

    const started = await startZip(me.agent, { tzOffsetMinutes: -300 });
    expect(started.status).toBe(202);
    const buildId = started.body.buildId as string;
    const first = ResumeZipBuildSchema.parse((await me.agent.get(`${ZIP}/${buildId}`)).body);
    expect(first).toMatchObject({ buildId, status: 'building', total: 2, error: null, expiresAt: null });
    expect(first.fileName).toBe('TailorIT_Resumes_2026-10-22.zip');

    const build = await settledBuild(c, me.agent, buildId);
    expect(build).toMatchObject({
      status: 'ready',
      done: 2,
      total: 2,
      counts: { included: 2, skipped: 0, word: 0, leftOut: 0, usedDefault: 0 },
      error: null,
      expiresAt: '2026-10-22T13:00:00.000Z',
    });

    const response = await downloadZip(me.agent, buildId);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-length']).toBe(String((response.body as Buffer).length));
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="TailorIT_Resumes_2026-10-22.zip"; filename*=UTF-8''TailorIT_Resumes_2026-10-22.zip`,
    );
    expect(response.headers['cache-control']).toContain('no-store');
    const names = (await readZip(response.body as Buffer)).map((entry) => entry.name);
    expect(names).toEqual(['Globex/Platform Engineer/Ada_Lovelace_resume.pdf', 'Initech/Data Engineer/Ada_Lovelace_resume.pdf']);

    // Downloaded whole: the zip is gone, from the registry and from disk.
    expect((await downloadZip(me.agent, buildId)).status).toBe(404);
    expect((await me.agent.get(`${ZIP}/${buildId}`)).status).toBe(404);
    expect(existsSync(join(c.deps.services.resumeZip!.root, buildId))).toBe(false);
  });

  it("never shows another account's build, and a HEAD request removes nothing", async () => {
    const c = context();
    const me = await signIn(c, 'owner@example.com');
    const other = await signIn(c, 'other@example.com');
    const resume = built(c, me.account.id, { name: 'Ada Lovelace' });
    fakePdf(c);
    addApplication(c, me.account.id, { title: 'Analyst', company: 'Acme', resumeId: resume });
    const started = await startZip(me.agent);
    const build = await settledBuild(c, me.agent, started.body.buildId);

    for (const path of [`${ZIP}/${build.buildId}`, `${ZIP}/${build.buildId}/file`]) {
      const res = await other.agent.get(path);
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe(NOT_AVAILABLE);
    }
    const head = await me.agent.head(`${ZIP}/${build.buildId}/file`);
    expect(head.status).toBe(200);
    expect(Number(head.headers['content-length'])).toBeGreaterThan(0);
    expect((await downloadZip(me.agent, build.buildId)).status).toBe(200);
  });
});

describe('the scope', () => {
  it('takes every active Saved application without ids, and the given ones (any status) with ids', async () => {
    const c = context();
    const me = await signIn(c, 'scope@example.com');
    const other = await signIn(c, 'scope-other@example.com');
    const resume = built(c, me.account.id, { name: 'Ada Lovelace' });
    const theirs = built(c, other.account.id, { name: 'Grace Hopper' });
    fakePdf(c);
    const saved = addApplication(c, me.account.id, { title: 'Saved One', company: 'Acme', resumeId: resume });
    addApplication(c, me.account.id, { title: 'Saved Two', company: 'Acme', resumeId: resume });
    const archived = addApplication(c, me.account.id, { title: 'Archived Saved', company: 'Acme', resumeId: resume, archived: true });
    const applied = addApplication(c, me.account.id, { title: 'Applied Role', company: 'Acme', status: 2, resumeId: resume });
    const foreign = addApplication(c, other.account.id, { title: 'Their Role', company: 'Acme', resumeId: theirs });

    const all = await buildZip(c, me.agent);
    expect([...all.entries.keys()]).toEqual(['Acme/Saved One/Ada_Lovelace_resume.pdf', 'Acme/Saved Two/Ada_Lovelace_resume.pdf']);

    const chosen = await buildZip(c, me.agent, { ids: [applied, archived, foreign, applied] });
    expect([...chosen.entries.keys()]).toEqual([
      'Acme/Archived Saved/Ada_Lovelace_resume.pdf',
      'Acme/Applied Role/Ada_Lovelace_resume.pdf',
    ]);
    expect(chosen.build.total).toBe(2);

    const none = await startZip(me.agent, { ids: [foreign, randomUUID()] });
    expect(none.status).toBe(404);
    expect(none.body.error.message).toBe('Those applications were not found.');
    expect((await startZip(me.agent, { ids: [saved] })).status).toBe(202);
  });

  it('refuses at once when there is nothing to build', async () => {
    const c = context();
    const me = await signIn(c, 'nothing@example.com');
    const noSaved = await startZip(me.agent);
    expect(noSaved.status).toBe(400);
    expect(noSaved.body.error.message).toBe(
      'You have no Saved applications. Save jobs first, or select applications in Manage jobs.',
    );
    addApplication(c, me.account.id, { title: 'Analyst', company: 'Acme' });
    const noResume = await startZip(me.agent);
    expect(noResume.status).toBe(400);
    expect(noResume.body.error.message).toBe('You have no resumes yet. Upload or create one in Documents, then try again.');
    expect(existsSync(c.deps.services.resumeZip!.root)).toBe(false);
  });

  it('leaves the Saved applications past 500 out, and says so in SKIPPED.txt', async () => {
    const c = context();
    const me = await signIn(c, 'many@example.com');
    const resume = built(c, me.account.id, { name: 'Ada Lovelace' });
    const pdf = fakePdf(c);
    c.deps.db.transaction(() => {
      for (let n = 0; n < 501; n += 1) addApplication(c, me.account.id, { title: `Role ${n}`, company: 'Acme', resumeId: resume });
    })();

    const { build, entries } = await buildZip(c, me.agent);
    expect(build.counts).toMatchObject({ included: 500, leftOut: 1, skipped: 0 });
    // One built resume, rendered once for all 500 entries.
    expect(pdf.prints).toHaveLength(1);
    expect(entries.has('Acme/Role 0/Ada_Lovelace_resume.pdf')).toBe(true);
    expect(entries.has('Acme/Role 500/Ada_Lovelace_resume.pdf')).toBe(false);
    const skipped = entries.get('SKIPPED.txt')!.data.toString('utf8');
    expect(skipped).toBe(
      '1 more Saved application was left out, because one zip holds up to 500. Select them in Manage jobs and build again.\r\n',
    );
  });
});

describe('the files', () => {
  it('copies uploads byte for byte with their own extension, as STORE entries with UTF-8 names', async () => {
    const c = context();
    const me = await signIn(c, 'bytes@example.com', { name: 'Account Person' });
    const pdf = pdfBytes('nadia');
    const docx = await docxBytes('Nadia Ferreira-Lund');
    const pdfUpload = storeUpload(c, me.account.id, {
      name: 'Nadia CV.pdf',
      buffer: pdf,
      text: 'Nadia Ferreira-Lund\nBackend Engineer, Raleigh NC\nExperience: Go and PostgreSQL services.',
    });
    const docxUpload = storeUpload(c, me.account.id, {
      name: 'Nadia CV.docx',
      buffer: docx,
      text: 'Nadia Ferreira-Lund\nBackend Engineer\nExperience: Go services.',
    });
    fakePdf(c);
    addApplication(c, me.account.id, { title: 'Ingénieure Backend', company: 'Café Ünïcode', resumeId: pdfUpload.resumeId });
    addApplication(c, me.account.id, { title: 'Platform Engineer', company: 'Globex', resumeId: docxUpload.resumeId });

    const { entries, build } = await buildZip(c, me.agent);
    expect(build.counts).toMatchObject({ included: 2, word: 0 });
    const first = entries.get('Café Ünïcode/Ingénieure Backend/Nadia_Ferreira-Lund_resume.pdf')!;
    const second = entries.get('Globex/Platform Engineer/Nadia_Ferreira-Lund_resume.docx')!;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // The bytes are the upload's own: the stored file's sha256, never converted.
    expect(sha256(first.data)).toBe(pdfUpload.file.sha256);
    expect(sha256(first.data)).toBe(sha256(pdf));
    expect(sha256(second.data)).toBe(docxUpload.file.sha256);
    expect(Buffer.compare(second.data, docx)).toBe(0);
    for (const entry of [first, second]) {
      expect(entry.method).toBe(0);
      expect(entry.flags & 0x0008).toBe(0);
      expect(entry.localFlags & 0x0008).toBe(0);
      expect(entry.localSize).toBe(entry.data.length);
    }
    expect(first.flags & 0x0800).toBe(0x0800);
    expect(second.flags & 0x0800).toBe(0);
    // The uploads themselves are untouched.
    expect(getFileStore(c.deps).read(pdfUpload.file.id, me.account.id).buffer.equals(pdf)).toBe(true);
  });

  it("names each file after the resume's name, then the account's, then plainly resume", async () => {
    const c = context();
    const me = await signIn(c, 'names@example.com', { name: 'Zip Person' });
    const nameless = await signIn(c, 'nameless@example.com', { name: '' });
    fakePdf(c);
    const builtOne = built(c, me.account.id, { name: 'Ada Lovelace', title: 'Engineer' });
    const builtNoName = built(c, me.account.id, { name: '', title: 'Engineer' }, 'No name');
    const named = storeUpload(c, me.account.id, { name: 'a.pdf', buffer: pdfBytes('a'), text: 'Nadia Ferreira-Lund\nBackend Engineer' });
    const unnamed = storeUpload(c, me.account.id, { name: 'b.pdf', buffer: pdfBytes('b'), text: 'Experience\nBuilt Go services for ten years.' });
    addApplication(c, me.account.id, { title: 'One', company: 'Acme', resumeId: builtOne });
    addApplication(c, me.account.id, { title: 'Two', company: 'Acme', resumeId: builtNoName });
    addApplication(c, me.account.id, { title: 'Three', company: 'Acme', resumeId: named.resumeId });
    addApplication(c, me.account.id, { title: 'Four', company: 'Acme', resumeId: unnamed.resumeId });
    const { entries } = await buildZip(c, me.agent);
    expect([...entries.keys()]).toEqual([
      'Acme/One/Ada_Lovelace_resume.pdf',
      'Acme/Two/Zip_Person_resume.pdf',
      'Acme/Three/Nadia_Ferreira-Lund_resume.pdf',
      'Acme/Four/Zip_Person_resume.pdf',
    ]);

    const theirs = storeUpload(c, nameless.account.id, { name: 'c.pdf', buffer: pdfBytes('c'), text: 'Experience\nGo services.' });
    addApplication(c, nameless.account.id, { title: 'Five', company: 'Acme', resumeId: theirs.resumeId });
    const plain = await buildZip(c, nameless.agent);
    expect([...plain.entries.keys()]).toEqual(['Acme/Five/resume.pdf']);
  });

  it('renders each distinct built resume once, and adds Word files when Chrome is missing', async () => {
    const c = context();
    const me = await signIn(c, 'render@example.com');
    const backend = built(c, me.account.id, { name: 'Ada Lovelace', title: 'Backend Engineer' });
    const frontend = built(c, me.account.id, { name: 'Ada Lovelace', title: 'Frontend Engineer' });
    const pdf = fakePdf(c);
    for (const title of ['A', 'B', 'C']) addApplication(c, me.account.id, { title, company: 'Acme', resumeId: backend });
    addApplication(c, me.account.id, { title: 'D', company: 'Acme', resumeId: frontend });

    const { entries, build } = await buildZip(c, me.agent);
    expect(pdf.prints).toHaveLength(2);
    // Each print waits a limited time for a page, and stops with the build.
    expect(pdf.prints[0]!.options).toMatchObject({ format: 'A4', waitMs: 60_000 });
    expect(pdf.prints[0]!.options!.signal).toBeInstanceOf(AbortSignal);
    expect(build.counts).toMatchObject({ included: 4, word: 0 });
    const a = entries.get('Acme/A/Ada_Lovelace_resume.pdf')!.data;
    expect(entries.get('Acme/B/Ada_Lovelace_resume.pdf')!.data.equals(a)).toBe(true);
    expect(entries.get('Acme/D/Ada_Lovelace_resume.pdf')!.data.equals(a)).toBe(false);

    const missing = fakePdf(c, { available: false });
    const word = await buildZip(c, me.agent);
    expect(missing.prints).toHaveLength(0);
    expect(word.build.counts).toMatchObject({ included: 4, word: 4 });
    const docx = word.entries.get('Acme/A/Ada_Lovelace_resume.docx')!;
    expect(docx.data.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(word.entries.get('Acme/C/Ada_Lovelace_resume.docx')!.data.equals(docx.data)).toBe(true);
  });

  it('adds a Word file for a PDF that fails or waits too long, and only Word files once Chrome is gone', async () => {
    const c = context();
    const me = await signIn(c, 'fallback@example.com');
    const titles = ['Alpha', 'Beta', 'Gamma', 'Delta'];
    const ids = titles.map((title) => built(c, me.account.id, { name: 'Ada Lovelace', title: `${title} Engineer` }));
    const pdf = fakePdf(c, {
      print: async (html) => {
        if (html.includes('Alpha Engineer')) throw new AppError('render_failed', 'We could not render that document. Please try again.');
        if (html.includes('Beta Engineer')) throw new AppError('rate_limited', 'PDF export is busy right now.');
        if (html.includes('Gamma Engineer')) throw new AppError('browser_unavailable', 'PDF export needs Google Chrome.');
        return Buffer.from('%PDF-1.7 delta\n', 'latin1');
      },
    });
    titles.forEach((title, index) => addApplication(c, me.account.id, { title, company: 'Acme', resumeId: ids[index] }));

    const { entries, build } = await buildZip(c, me.agent);
    // One worker (PDF_MAX_CONCURRENCY 2, one page kept for others): Alpha, Beta, Gamma tried; Delta never is.
    expect(pdf.prints).toHaveLength(3);
    expect([...entries.keys()]).toEqual([
      'Acme/Alpha/Ada_Lovelace_resume.docx',
      'Acme/Beta/Ada_Lovelace_resume.docx',
      'Acme/Gamma/Ada_Lovelace_resume.docx',
      'Acme/Delta/Ada_Lovelace_resume.docx',
    ]);
    expect(build.counts).toMatchObject({ included: 4, word: 4, skipped: 0 });
  });

  it('lists a missing upload in SKIPPED.txt, and fails when nothing is left to add', async () => {
    const c = context();
    const me = await signIn(c, 'missing@example.com');
    fakePdf(c);
    const kept = built(c, me.account.id, { name: 'Ada Lovelace' });
    const gone = storeUpload(c, me.account.id, { name: 'Nadia CV.pdf', buffer: pdfBytes('gone'), text: 'Experience', title: 'Nadia CV' });
    rmSync(getFileStore(c.deps).pathOf(gone.file));
    addApplication(c, me.account.id, { title: 'Senior Backend Engineer', company: 'Stripe', resumeId: gone.resumeId });
    addApplication(c, me.account.id, { title: 'Analyst', company: 'Acme', resumeId: kept });

    const { entries, build } = await buildZip(c, me.agent);
    expect(build.counts).toMatchObject({ included: 1, skipped: 1 });
    expect([...entries.keys()]).toEqual(['SKIPPED.txt', 'Acme/Analyst/Ada_Lovelace_resume.pdf']);
    expect(entries.get('SKIPPED.txt')!.data.toString('utf8')).toBe(
      'TailorIT could not add a resume for 1 application:\r\n\r\n' +
        '- Stripe / Senior Backend Engineer (Saved): the uploaded file of "Nadia CV" is missing. Upload it again in Documents.\r\n',
    );

    const only = await startZip(me.agent, { ids: [addApplication(c, me.account.id, { title: 'Lone', company: 'Acme', resumeId: gone.resumeId })] });
    const failed = await settledBuild(c, me.agent, only.body.buildId);
    expect(failed).toMatchObject({
      status: 'failed',
      error: { code: 'not_found', message: 'The resume files for these applications are missing. Upload the resumes again in Documents.' },
    });
    expect((await downloadZip(me.agent, failed.buildId)).status).toBe(404);
    expect(existsSync(join(c.deps.services.resumeZip!.root, failed.buildId))).toBe(false);
  });

  it('gives an application with no resume linked the default resume, counted and listed', async () => {
    const c = context();
    const me = await signIn(c, 'default@example.com');
    // Each PDF says which resume it was printed from.
    fakePdf(c, { print: async (html) => Buffer.from(`%PDF-1.7 ${html.includes('Generalist') ? 'Generalist' : 'Backend'}`) });
    const pdfTitles = (entries: Map<string, ReadEntry>) =>
      Object.fromEntries(
        [...entries].filter(([name]) => name.endsWith('.pdf')).map(([name, entry]) => [name, entry.data.toString('latin1').slice(9)]),
      );
    // The first resume is the default one.
    built(c, me.account.id, { name: 'Ada Lovelace', title: 'Generalist' }, 'Main resume');
    const second = built(c, me.account.id, { name: 'Ada Lovelace', title: 'Backend' });
    addApplication(c, me.account.id, { title: 'Linked', company: 'Acme', resumeId: second });
    addApplication(c, me.account.id, { title: 'Unlinked', company: 'Initech' });

    const { entries, build } = await buildZip(c, me.agent);
    expect(build.counts).toMatchObject({ included: 2, usedDefault: 1, skipped: 0 });
    expect(pdfTitles(entries)).toEqual({
      'Acme/Linked/Ada_Lovelace_resume.pdf': 'Backend',
      'Initech/Unlinked/Ada_Lovelace_resume.pdf': 'Generalist',
    });
    const text = entries.get('SKIPPED.txt')!.data.toString('utf8');
    expect(text).toContain('1 application has no resume linked, so it got your default resume, "Main resume".');
    expect(text).toContain('- Initech / Unlinked (Saved)');
    expect(text).not.toContain('Acme / Linked');
  });
});

// The postings and resumes the match service tells apart (as in resume-match.test.ts).
const BACKEND_POSTING =
  '<h3>Requirements</h3><ul><li>Go and PostgreSQL services.</li><li>Kubernetes and Docker in production.</li>' +
  '<li>Kafka pipelines and gRPC APIs.</li></ul>';
const BACKEND_TEXT = [
  'Ada Lovelace',
  'Backend Engineer',
  'Experience',
  'Backend Engineer, Acme | 01/2019 - Present',
  'Built Go and PostgreSQL services on Kubernetes with Docker.',
  'Designed gRPC APIs and Kafka pipelines.',
].join('\n');
const FRONTEND_TEXT = [
  'Ada Lovelace',
  'Frontend Engineer',
  'Experience',
  'Frontend Engineer, Acme | 01/2019 - Present',
  'Built React and TypeScript apps with CSS and HTML.',
  'Shipped Next.js and Redux at scale.',
].join('\n');

describe('the choices', () => {
  it("makes the selection's due choices first, so the zip has the best match", async () => {
    const c = context();
    const me = await signIn(c, 'due@example.com');
    fakePdf(c);
    const frontend = storeUpload(c, me.account.id, { name: 'Frontend.pdf', buffer: pdfBytes('front'), text: FRONTEND_TEXT });
    const backend = storeUpload(c, me.account.id, { name: 'Backend.pdf', buffer: pdfBytes('back'), text: BACKEND_TEXT });
    const job = insertJob(c.deps.db, { title: 'Backend Engineer', description: BACKEND_POSTING });
    const id = addApplication(c, me.account.id, { title: 'Backend Engineer', company: 'Acme Robotics', jobId: job, due: true });

    const { entries, build } = await buildZip(c, me.agent);
    expect(build.counts).toMatchObject({ included: 1, usedDefault: 0 });
    const entry = entries.get('Acme Robotics/Backend Engineer/Ada_Lovelace_resume.pdf')!;
    expect(sha256(entry.data)).toBe(backend.file.sha256);
    expect(c.deps.db.prepare('SELECT resume_id, resume_origin, resume_match_due FROM applications WHERE id = ?').get(id)).toEqual({
      resume_id: backend.resumeId,
      resume_origin: 'auto',
      resume_match_due: 0,
    });
    expect(frontend.resumeId).not.toBe(backend.resumeId);
  });

  it('gives the choices not made within the budget the default resume', async () => {
    const c = context({ drainBudgetMs: 0 });
    const me = await signIn(c, 'pending@example.com');
    fakePdf(c);
    const frontend = storeUpload(c, me.account.id, { name: 'Frontend.pdf', buffer: pdfBytes('front'), text: FRONTEND_TEXT });
    storeUpload(c, me.account.id, { name: 'Backend.pdf', buffer: pdfBytes('back'), text: BACKEND_TEXT });
    const job = insertJob(c.deps.db, { title: 'Backend Engineer', description: BACKEND_POSTING });
    const id = addApplication(c, me.account.id, { title: 'Backend Engineer', company: 'Acme', jobId: job, due: true });

    const { entries, build } = await buildZip(c, me.agent);
    expect(build.counts).toMatchObject({ included: 1, usedDefault: 1 });
    expect(sha256(entries.get('Acme/Backend Engineer/Ada_Lovelace_resume.pdf')!.data)).toBe(frontend.file.sha256);
    expect(entries.get('SKIPPED.txt')!.data.toString('utf8')).toContain('so it got your default resume');
    expect((c.deps.db.prepare('SELECT resume_match_due FROM applications WHERE id = ?').get(id) as { resume_match_due: number }).resume_match_due).toBe(1);
  });
});

describe('the limits', () => {
  it('refuses a zip over the cap from stored sizes, before any file is read', async () => {
    const c = context({ maxBytes: 6000 });
    const me = await signIn(c, 'large@example.com');
    const upload = storeUpload(c, me.account.id, { name: 'Big.pdf', buffer: pdfBytes('big'), text: 'Experience' });
    addApplication(c, me.account.id, { title: 'One', company: 'Acme', resumeId: upload.resumeId });
    // The file is gone from disk: a check that read it would fail differently.
    rmSync(getFileStore(c.deps).pathOf(upload.file));
    addApplication(c, me.account.id, { title: 'Two', company: 'Acme', resumeId: upload.resumeId });

    const res = await startZip(me.agent);
    expect(res.status).toBe(413);
    expect(res.body.error).toMatchObject({
      code: 'file_too_large',
      message: 'These resumes add up to more than 1 MB. Select fewer applications and try again.',
    });
    expect(existsSync(c.deps.services.resumeZip!.root)).toBe(false);
    // A built resume counts as 400 KB before it is rendered.
    const big = context({ maxBytes: 500 * 1024 });
    const other = await signIn(big, 'built-large@example.com');
    const resume = built(big, other.account.id, { name: 'Ada Lovelace' });
    addApplication(big, other.account.id, { title: 'One', company: 'Acme', resumeId: resume });
    addApplication(big, other.account.id, { title: 'Two', company: 'Acme', resumeId: resume });
    expect((await startZip(other.agent)).status).toBe(413);
    // ctx is the second context now; the first one is cleaned here.
    await c.deps.services.resumeZip!.stop();
    c.cleanup();
  });

  it('answers 409 to the same account and 429 to another while a build runs', async () => {
    const c = context();
    const me = await signIn(c, 'busy@example.com');
    const other = await signIn(c, 'busy-other@example.com');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fakePdf(c, {
      print: async () => {
        await gate;
        return Buffer.from('%PDF-1.7 slow\n', 'latin1');
      },
    });
    for (const account of [me.account.id, other.account.id]) {
      const resume = built(c, account, { name: 'Ada Lovelace' });
      addApplication(c, account, { title: 'Analyst', company: 'Acme', resumeId: resume });
    }

    const started = await startZip(me.agent);
    expect(started.status).toBe(202);
    const again = await startZip(me.agent);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe('Your resumes are already being built. Wait for that download to finish, then try again.');
    const busy = await startZip(other.agent);
    expect(busy.status).toBe(429);
    expect(busy.body.error).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 15 });
    expect(busy.headers['retry-after']).toBe('15');
    const early = await downloadZip(me.agent, started.body.buildId);
    expect(early.status).toBe(409);

    release();
    expect((await settledBuild(c, me.agent, started.body.buildId)).status).toBe('ready');
    expect((await startZip(other.agent)).status).toBe(202);
  });

  it('stops a build that passes its deadline, and leaves nothing on disk', async () => {
    const c = context({ deadlineMs: 300, pdfReserveMs: 0 });
    const me = await signIn(c, 'slow@example.com');
    fakePdf(c, {
      print: () => new Promise<Buffer>(() => undefined),
    });
    const resume = built(c, me.account.id, { name: 'Ada Lovelace' });
    addApplication(c, me.account.id, { title: 'Analyst', company: 'Acme', resumeId: resume });
    const started = await startZip(me.agent);
    const build = await settledBuild(c, me.agent, started.body.buildId);
    expect(build).toMatchObject({
      status: 'failed',
      error: {
        code: 'internal',
        message: 'Building your resumes took too long, so it was stopped. Select fewer applications and try again.',
      },
    });
    expect(existsSync(join(c.deps.services.resumeZip!.root, build.buildId))).toBe(false);
  });
});

describe('times and temporary files', () => {
  it("dates the entries and the file name in the person's time zone", async () => {
    const c = context();
    const me = await signIn(c, 'time@example.com');
    fakePdf(c);
    const resume = built(c, me.account.id, { name: 'Ada Lovelace' });
    addApplication(c, me.account.id, { title: 'Analyst', company: 'Acme', resumeId: resume });

    const newYork = await buildZip(c, me.agent, { tzOffsetMinutes: -300 });
    const entry = newYork.entries.get('Acme/Analyst/Ada_Lovelace_resume.pdf')!;
    expect(entry.dosTime).toBe(dosTime(7, 0, 0));
    expect(entry.dosDate).toBe(dosDate(2026, 10, 22));

    const auckland = await buildZip(c, me.agent, { tzOffsetMinutes: 780 });
    expect(auckland.build.fileName).toBe('TailorIT_Resumes_2026-10-23.zip');
    expect(auckland.entries.get('Acme/Analyst/Ada_Lovelace_resume.pdf')!.dosTime).toBe(dosTime(1, 0, 0));

    const utc = await buildZip(c, me.agent);
    expect(utc.entries.get('Acme/Analyst/Ada_Lovelace_resume.pdf')!.dosTime).toBe(dosTime(12, 0, 0));
  });

  it('keeps only the zip once it is built, removes it at expiry, and clears leftovers at start and stop', async () => {
    const c = context();
    const me = await signIn(c, 'cleanup@example.com');
    fakePdf(c);
    const resume = built(c, me.account.id, { name: 'Ada Lovelace' });
    addApplication(c, me.account.id, { title: 'Analyst', company: 'Acme', resumeId: resume });
    const service = c.deps.services.resumeZip!;

    const started = await startZip(me.agent);
    const build = await settledBuild(c, me.agent, started.body.buildId);
    const dir = join(service.root, build.buildId);
    // The rendered PDF went into the zip and was removed.
    expect(readdirSync(dir)).toEqual(['resumes.zip']);

    c.setNow(new Date(TEST_NOW.getTime() + 59 * 60_000));
    await service.sweep();
    expect(existsSync(dir)).toBe(true);
    c.setNow(new Date(TEST_NOW.getTime() + 61 * 60_000));
    await service.sweep();
    expect(existsSync(dir)).toBe(false);
    expect((await me.agent.get(`${ZIP}/${build.buildId}`)).status).toBe(404);

    // A new build replaces the account's last one.
    const one = await settledBuild(c, me.agent, (await startZip(me.agent)).body.buildId);
    const two = await settledBuild(c, me.agent, (await startZip(me.agent)).body.buildId);
    expect(existsSync(join(service.root, one.buildId))).toBe(false);
    expect(existsSync(join(service.root, two.buildId))).toBe(true);

    // What an earlier run left behind goes at start; the running process's own zip stays.
    const leftover = join(service.root, 'old-build');
    mkdirSync(leftover, { recursive: true });
    writeFileSync(join(leftover, 'resumes.zip'), 'old');
    const stop = resumeZipFeature.start!(c.deps);
    expect(existsSync(leftover)).toBe(false);
    expect(existsSync(join(service.root, two.buildId))).toBe(true);
    expect(typeof stop).toBe('function');
    await (stop as () => Promise<void>)();
    expect(existsSync(join(service.root, two.buildId))).toBe(false);
    expect((await startZip(me.agent)).status).toBe(500);
  });
});

// --------------------------------------------------------------------------------------- the PDF pool's limits

const FOUND: BrowserLocation = { executablePath: 'C:\\chrome.exe', source: 'installed', label: 'Google Chrome', exists: true };

class GatedPage {
  closed = false;
  constructor(private readonly content: () => Promise<void>) {}
  setDefaultTimeout() {}
  setDefaultNavigationTimeout() {}
  async setJavaScriptEnabled() {}
  async setRequestInterception() {}
  on() {
    return this;
  }
  async setContent() {
    await this.content();
  }
  async pdf() {
    return new TextEncoder().encode('%PDF-fake');
  }
  async close() {
    this.closed = true;
  }
}

class GatedBrowser extends EventEmitter {
  connected = true;
  readonly pages: GatedPage[] = [];
  constructor(private readonly content: () => Promise<void>) {
    super();
  }
  async newPage() {
    const page = new GatedPage(this.content);
    this.pages.push(page);
    return page;
  }
  async close() {
    this.connected = false;
  }
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe("the PDF pool's wait limit and abort signal", () => {
  it('lets a waiter give up on a timeout or an abort without ever holding a slot', async () => {
    const slots = new Semaphore(1);
    await slots.acquire();
    const timedOut = await rejectionOf(slots.acquire({ timeoutMs: 20 }));
    expect(timedOut).toBeInstanceOf(SlotWaitTimeout);
    const stop = new AbortController();
    const waiting = slots.acquire({ signal: stop.signal });
    expect(slots.waiting).toBe(1);
    stop.abort(new Error('stopped'));
    expect(((await rejectionOf(waiting)) as Error).message).toBe('stopped');
    expect(slots.waiting).toBe(0);
    // An aborted signal never waits.
    expect(((await rejectionOf(slots.acquire({ signal: stop.signal }))) as Error).message).toBe('stopped');
    // The slot goes to the next real waiter.
    const next = slots.acquire({ timeoutMs: 1_000 });
    slots.release();
    await next;
    expect(slots.inUse).toBe(1);
    slots.release();
    expect(slots.inUse).toBe(0);
  });

  it('printPdf waits at most waitMs for a page, stops with its signal, and frees its slot', async () => {
    const c = createTestContext({ env: { PDF_MAX_CONCURRENCY: '1' } });
    ctx = c;
    let open!: () => void;
    let gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const browser = new GatedBrowser(() => gate);
    const pool = createPdfService(c.deps, { locate: () => FOUND, launch: async () => browser as unknown as Browser });

    const slow = pool.printPdf('<p>slow</p>');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const busy = await rejectionOf(pool.printPdf('<p>busy</p>', { waitMs: 30 }));
    expect(busy).toBeInstanceOf(AppError);
    expect(busy).toMatchObject({ code: 'rate_limited', status: 429, retryAfterSeconds: 10 });
    const stop = new AbortController();
    const waiting = pool.printPdf('<p>stopped</p>', { signal: stop.signal });
    stop.abort(new Error('the build stopped'));
    expect(((await rejectionOf(waiting)) as Error).message).toBe('the build stopped');
    open();
    expect((await slow).toString()).toBe('%PDF-fake');
    expect(browser.pages).toHaveLength(1);

    // Stopped mid-render: rejected with the reason as it is, the page closed and the slot free again.
    gate = new Promise<void>(() => undefined);
    const rendering = new AbortController();
    const mid = pool.printPdf('<p>mid</p>', { signal: rendering.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    rendering.abort(new Error('stopped mid-render'));
    expect(((await rejectionOf(mid)) as Error).message).toBe('stopped mid-render');
    expect(browser.pages[1]!.closed).toBe(true);
    gate = Promise.resolve();
    expect((await pool.printPdf('<p>after</p>', { waitMs: 1_000 })).toString()).toBe('%PDF-fake');
  });
});
