import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_RESUMES_PER_ACCOUNT,
  normalizeResumeDocument,
  RESUME_ANALYSIS_VERSION,
  resumeAnalysisInput,
  ResumeAnalysisViewSchema,
  ResumeListResponseSchema,
  ResumeUploadResponseSchema,
  type AiTaskView,
  type ResumeAnalysisSubject,
} from '@tailorit/shared';
import type * as Shared from '@tailorit/shared';
import { requireAi } from '../src/ai/index';
import { getFileStore } from '../src/core/files/index';
import { getPdfService } from '../src/core/pdf/index';
import { DEMO_EMAIL } from '../src/features/demo/content';
import { seedDemo } from '../src/features/demo/seed';
import {
  finishResumeAnalysis,
  ResumeAnalysisOutputSchema,
  resumeAnalysisPrompt,
} from '../src/features/resumes/analysis/prompt';
import { createResumeAnalysisBacklog } from '../src/features/resumes/analysis/backlog';
import { analysisHashOf, skillLists, storeAiResumeAnalysis } from '../src/features/resumes/analysis/store';
import { resumesFeature } from '../src/features/resumes/index';
import { insertResume } from '../src/features/resumes/repository';
import { signIn, type SignedIn } from './auth-helpers';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';
import { insertApplication, insertJob } from './job-fixtures';

// What TailorIT reads from resumes (work package WP3): the rules' reading of every resume on every write path, the
// backfill, the list's line and GET /:id/analysis, and Claude's reading of uploads through the durable backlog (the
// fake Claude CLI answers with tools/fake-claude/scenarios/resume_analysis.mjs, which slips in made-up items that the
// grounding must drop). Uploaded resumes are never changed by any of it.

/** A switch that breaks the rules' reader of upload text (an extractor failure). */
const reader = vi.hoisted(() => ({ broken: false }));
vi.mock('@tailorit/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof Shared>();
  return {
    ...actual,
    analyzeResumeText: (...args: Parameters<typeof actual.analyzeResumeText>) => {
      if (reader.broken) throw new Error('the reader broke');
      return actual.analyzeResumeText(...args);
    },
  };
});

let ctx: TestContext | null = null;
beforeEach(() => {
  vi.stubEnv('FAKE_CLAUDE_MODE', '');
  vi.stubEnv('FAKE_CLAUDE_SCENARIOS', '');
});
afterEach(async () => {
  reader.broken = false;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  const current = ctx;
  ctx = null;
  if (!current) return;
  await getPdfService(current.deps).close();
  current.cleanup();
}, 30_000);

const MINUTE = 60_000;
const at = (ms: number) => new Date(TEST_NOW.getTime() + ms);

const RESUME_LINES = [
  'Nadia Ferreira-Lund',
  'Senior Backend Engineer',
  'nadia.fl@example.com | Raleigh, NC',
  'Summary',
  'Backend engineer with 8+ years of experience building payments platforms in fintech.',
  'Experience',
  'Senior Backend Engineer, Pinecrest Freight Software | 03/2021 - Present',
  'Rates and billing services in Go and PostgreSQL on Kubernetes.',
  'Clear communication with finance teams.',
  'Software Engineer, Harbor Payments | 06/2016 - 02/2021',
  'Python and Kafka pipelines. Mentoring two junior engineers.',
  'Education',
  'B.S. Computer Science, NC State University, 2012 - 2016',
  'Certifications',
  'Certified Kubernetes Administrator (CKA)',
];
const RESUME_TEXT = RESUME_LINES.join('\n');
/** Another person's resume that states no total of years (the fake makes one up: 37). */
const OTHER_TEXT = [
  'Tomas Okafor',
  'Data Analyst',
  'Experience',
  'Data Analyst, Riverbend Health | 2019 - Present',
  'SQL and Tableau dashboards for clinical operations. Strong stakeholder management.',
].join('\n');

// ---------------------------------------------------------------------------------------------------- helpers

function escapePdf(text: string): string {
  return text.replace(/[()\\]/g, (char) => `\\${char}`);
}

/** A small, valid PDF with each page's lines of text in Helvetica. */
function minimalPdf(pages: string[][]): Buffer {
  const objects: string[] = [];
  const pageIds: number[] = [];
  let next = 4;
  for (const lines of pages) {
    const pageId = next++;
    const contentId = next++;
    pageIds.push(pageId);
    const shown = lines.map((line, index) => `${index === 0 ? '' : '0 -16 Td '}(${escapePdf(line)}) Tj`);
    const ops = ['BT', '/F1 10 Tf', '40 800 Td', ...shown, 'ET'].join('\n');
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

function context(env: Record<string, string> = {}): TestContext {
  ctx = createTestContext({ env });
  return ctx;
}

const db = () => ctx!.deps.db;
const workers = () => ctx!.deps.services.resumeAnalysis!;
const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

interface ReadingRow {
  source: string;
  version: number;
  content_hash: string;
  created_at: string;
}

function readings(resumeId: string): ReadingRow[] {
  return db()
    .prepare('SELECT source, version, content_hash, created_at FROM resume_analyses WHERE resume_id = ? ORDER BY source')
    .all(resumeId) as ReadingRow[];
}

interface BacklogRow {
  user_id: string;
  content_hash: string;
  version: number;
  state: string;
  attempts: number;
  task_id: string | null;
  next_attempt_at: string;
  started_at: string | null;
  last_error: string | null;
}

function backlogRow(resumeId: string): BacklogRow | undefined {
  return db().prepare('SELECT * FROM resume_analysis_backlog WHERE resume_id = ?').get(resumeId) as BacklogRow | undefined;
}

interface TaskRow {
  id: string;
  user_id: string | null;
  status: string;
  priority: number;
  dedupe_key: string | null;
  error_code: string | null;
}

function readingTasks(): TaskRow[] {
  return db()
    .prepare("SELECT id, user_id, status, priority, dedupe_key, error_code FROM ai_tasks WHERE kind = 'resume_analysis' ORDER BY rowid")
    .all() as TaskRow[];
}

/** The content hash of a stored resume, worked out the way the reading works it out. */
function hashOfStored(resumeId: string): string {
  const row = db().prepare('SELECT kind, data, extracted_text FROM resumes WHERE id = ?').get(resumeId) as {
    kind: 'built' | 'uploaded';
    data: string | null;
    extracted_text: string | null;
  };
  const subject: ResumeAnalysisSubject =
    row.kind === 'built'
      ? { kind: 'built', document: normalizeResumeDocument(JSON.parse(row.data ?? '{}')) }
      : { kind: 'uploaded', text: row.extracted_text };
  return analysisHashOf(resumeAnalysisInput(subject));
}

/** An upload stored through the repository (no file): enough for everything but the file routes. */
function addUpload(userId: string, text = RESUME_TEXT, title = 'CV'): string {
  return insertResume(ctx!.deps, userId, { kind: 'uploaded', title, extractedText: text });
}

/** A resume row written straight to the table, as rows from before this feature are: no reading at all. */
function addOldResume(userId: string, text: string, updatedAt = '2026-10-01T00:00:00.000Z'): string {
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO resumes(id, user_id, kind, title, extracted_text, created_at, updated_at)
       VALUES (?, ?, 'uploaded', 'Old resume', ?, '2026-09-01T00:00:00.000Z', ?)`,
    )
    .run(id, userId, text, updatedAt);
  return id;
}

/** Starts the next reading and waits for its task to finish. */
async function readNext(): Promise<AiTaskView> {
  const taskId = workers().backlog.tick();
  expect(taskId, 'a reading starts').toEqual(expect.any(String));
  return requireAi(ctx!.deps).waitFor(taskId!, 20_000);
}

function uploadFile(agent: SignedIn['agent'], buffer: Buffer, name: string, query = '') {
  return agent.post(`/api/resumes/upload${query}`).set('Origin', ORIGIN).attach('file', buffer, name);
}

// ------------------------------------------------------------------------------------------- the rules' reading

describe("the rules' reading of every resume", () => {
  it('every write path stores a reading: create, upload, JSON import, edit, both duplicates, the AI copy, the seed', async () => {
    context();
    const me = await signIn(ctx!, 'paths@example.com');
    const expectReading = (id: string) => {
      expect(readings(id)).toEqual([
        { source: 'deterministic', version: RESUME_ANALYSIS_VERSION, content_hash: hashOfStored(id), created_at: expect.any(String) },
      ]);
    };

    const created = await me.agent
      .post('/api/resumes')
      .set('Origin', ORIGIN)
      .send({ document: { name: 'Nadia', title: 'Backend Engineer', skills: ['Go', 'PostgreSQL'] } });
    expect(created.status).toBe(201);
    expectReading(created.body.id);
    expect(backlogRow(created.body.id)).toBeUndefined(); // built resumes get no AI reading

    const uploaded = await uploadFile(me.agent, minimalPdf([RESUME_LINES]), 'nadia.pdf');
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const uploadId = uploaded.body.resume.id as string;
    expectReading(uploadId);
    expect(backlogRow(uploadId)).toMatchObject({
      user_id: me.account.id,
      content_hash: hashOfStored(uploadId),
      version: RESUME_ANALYSIS_VERSION,
      state: 'waiting',
      attempts: 0,
    });

    const imported = await me.agent
      .post('/api/resumes/import-json')
      .set('Origin', ORIGIN)
      .send({ data: [{ name: 'A', title: 'Data Engineer', skills: ['SQL'] }, { name: 'B', title: 'SRE', skills: ['Go'] }] });
    expect(imported.status).toBe(201);
    for (const resume of imported.body.resumes as Array<{ id: string }>) expectReading(resume.id);

    ctx!.setNow(at(MINUTE));
    const before = readings(created.body.id)[0]!;
    const edited = await me.agent
      .put(`/api/resumes/${created.body.id}`)
      .set('Origin', ORIGIN)
      .send({ document: { skills: ['Go', 'PostgreSQL', 'Kafka'] } });
    expect(edited.status).toBe(200);
    expectReading(created.body.id);
    expect(readings(created.body.id)[0]).toMatchObject({ created_at: at(MINUTE).toISOString() });
    expect(readings(created.body.id)[0]!.content_hash).not.toBe(before.content_hash);

    const builtCopy = await me.agent.post(`/api/resumes/${created.body.id}/duplicate`).set('Origin', ORIGIN).send({});
    expect(builtCopy.status).toBe(201);
    expectReading(builtCopy.body.id);
    const uploadCopy = await me.agent.post(`/api/resumes/${uploadId}/duplicate`).set('Origin', ORIGIN).send({});
    expect(uploadCopy.status).toBe(201);
    expectReading(uploadCopy.body.id);
    expect(readings(uploadCopy.body.id)[0]!.content_hash).toBe(readings(uploadId)[0]!.content_hash);
    expect(backlogRow(uploadCopy.body.id)).toMatchObject({ state: 'waiting' });

    // The AI's editable copy (resume_import) is a new built resume, read like any other.
    const accepted = await me.agent.post(`/api/resumes/${uploadId}/parse`).set('Origin', ORIGIN).send({});
    expect(accepted.status).toBe(202);
    const task = await requireAi(ctx!.deps).waitFor(accepted.body.taskId, 20_000);
    expect(task.status, JSON.stringify(task.error)).toBe('succeeded');
    expectReading((task.result as { resumeId: string }).resumeId);

    // The demo seed writes through insertResume: its built resumes are read, and its upload is never sent to Claude.
    await seedDemo(ctx!.deps, { pdf: false });
    const seeded = db()
      .prepare('SELECT r.id FROM resumes r JOIN users u ON u.id = r.user_id WHERE u.email = ?')
      .all(DEMO_EMAIL) as Array<{ id: string }>;
    expect(seeded.length).toBeGreaterThan(0);
    for (const { id } of seeded) expectReading(id);
    const seededUpload = insertResume(ctx!.deps, me.account.id, { kind: 'uploaded', extractedText: RESUME_TEXT, aiRefine: false });
    expectReading(seededUpload);
    expect(backlogRow(seededUpload)).toMatchObject({ state: 'skipped', last_error: 'Not asked for.' });
    // No reading task was queued by any of it: uploads never wait on Claude.
    expect(readingTasks()).toEqual([]);
  });

  it("the demo seed's uploaded PDF is read by the rules and never sent to Claude (when Chrome is installed)", async ({ skip }) => {
    context();
    if (!getPdfService(ctx!.deps).available()) skip();
    const result = await seedDemo(ctx!.deps);
    expect(result.resumes.uploaded).toBe(1);
    const upload = db()
      .prepare("SELECT r.id FROM resumes r JOIN users u ON u.id = r.user_id WHERE u.email = ? AND r.kind = 'uploaded'")
      .get(DEMO_EMAIL) as { id: string };
    expect(readings(upload.id)).toMatchObject([{ source: 'deterministic', version: RESUME_ANALYSIS_VERSION }]);
    expect(backlogRow(upload.id)).toMatchObject({ state: 'skipped', last_error: 'Not asked for.' });
    expect(workers().backlog.tick()).toBeNull();
    expect(readingTasks()).toEqual([]);
  }, 60_000);

  it('a rename keeps the reading and its hash; an edit that changes nothing reads nothing again', async () => {
    context();
    const me = await signIn(ctx!, 'rename@example.com');
    const created = await me.agent
      .post('/api/resumes')
      .set('Origin', ORIGIN)
      .send({ document: { name: 'Nadia', title: 'Backend Engineer', skills: ['Go'] } });
    const uploadId = addUpload(me.account.id);
    const first = [readings(created.body.id), readings(uploadId)];

    ctx!.setNow(at(5 * MINUTE));
    for (const id of [created.body.id, uploadId]) {
      const renamed = await me.agent.patch(`/api/resumes/${id}`).set('Origin', ORIGIN).send({ title: 'A brand new name' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.updatedAt).toBe(at(5 * MINUTE).toISOString());
      // Reading the panel checks the hash: still the same reading, not read again.
      expect((await me.agent.get(`/api/resumes/${id}/analysis`)).status).toBe(200);
    }
    const sameDocument = await me.agent
      .put(`/api/resumes/${created.body.id}`)
      .set('Origin', ORIGIN)
      .send({ document: {}, title: 'Renamed through PUT' });
    expect(sameDocument.status).toBe(200);
    expect([readings(created.body.id), readings(uploadId)]).toEqual(first);
  });

  it("a reader that breaks never fails an upload; the resume is read later", async () => {
    context();
    const me = await signIn(ctx!, 'broken@example.com');
    reader.broken = true;
    const res = await uploadFile(me.agent, minimalPdf([RESUME_LINES]), 'nadia.pdf');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.resume.id as string;
    expect(readings(id)).toEqual([]);
    // Its place in Claude's line needs only its text.
    expect(backlogRow(id)).toMatchObject({ state: 'waiting' });
    const logged = (ctx!.deps.log as unknown as { lines: string[] }).lines;
    expect(logged.some((line) => line.includes(`could not read resume ${id}`))).toBe(true);
    // The list shows the upload without a reading, and does not fail either.
    const list = await me.agent.get('/api/resumes');
    expect(list.status).toBe(200);
    expect(list.body.items).toMatchObject([{ id, analysis: null }]);

    reader.broken = false;
    // The backfill waits an hour before it tries a broken reading again...
    expect(await workers().backfill.drain()).toBe(0);
    expect(readings(id)).toEqual([]);
    ctx!.setNow(at(61 * MINUTE));
    expect(await workers().backfill.drain()).toBe(1);
    expect(readings(id)).toMatchObject([{ source: 'deterministic', version: RESUME_ANALYSIS_VERSION }]);
  });

  it("the person's own panel tries a broken reading again at once", async () => {
    context();
    const me = await signIn(ctx!, 'panel@example.com');
    reader.broken = true;
    const id = addUpload(me.account.id);
    const broken = await me.agent.get(`/api/resumes/${id}/analysis`);
    expect(broken.status).toBe(500);
    expect(broken.body.error.message).toBe("What TailorIT read from this resume can't be shown right now. Please try again later.");
    reader.broken = false;
    expect((await me.agent.get(`/api/resumes/${id}/analysis`)).status).toBe(200);
  });

  it('GET /:id/analysis shows the reading, and is 404 for another account', async () => {
    context();
    const me = await signIn(ctx!, 'view@example.com');
    const other = await signIn(ctx!, 'other@example.com');
    const id = addUpload(me.account.id);
    const res = await me.agent.get(`/api/resumes/${id}/analysis`);
    expect(res.status).toBe(200);
    const view = ResumeAnalysisViewSchema.parse(res.body);
    expect(view).toMatchObject({
      resumeId: id,
      source: 'deterministic',
      refining: false,
      aiWaiting: true,
      aiFailed: false,
      keywords: { roles: ['Senior Backend Engineer', 'Software Engineer'], domains: expect.arrayContaining(['finance']) },
      yearsBasis: 'dates',
      analyzedAt: TEST_NOW.toISOString(),
    });
    expect(view.hardSkills).toEqual(expect.arrayContaining(['Go', 'PostgreSQL', 'Kubernetes', 'Python']));
    expect(view.softSkills).toEqual(expect.arrayContaining(['Communication', 'Mentoring']));
    // 03/2021 to Present (October 2026) and 06/2016 to 02/2021: 10.4 years, worked out today.
    expect(view.yearsExperience).toBe(10.4);

    const theirs = await other.agent.get(`/api/resumes/${id}/analysis`);
    expect(theirs.status).toBe(404);
    expect(theirs.body.error.message).toBe('That resume was not found.');
    expect((await other.agent.get('/api/resumes/not-a-resume/analysis')).status).toBe(404);
  });

  it('the list reads at most 5 resumes a request, the backfill the rest, and never selects extracted_text', async () => {
    context();
    const me = await signIn(ctx!, 'list@example.com');
    const ids = Array.from({ length: 7 }, (_, index) =>
      addOldResume(me.account.id, `${RESUME_TEXT}\nProject ${index}`, `2026-10-0${index + 1}T00:00:00.000Z`),
    );
    const count = () => (db().prepare('SELECT count(*) AS n FROM resume_analyses').get() as { n: number }).n;
    expect(count()).toBe(0);

    const first = ResumeListResponseSchema.parse((await me.agent.get('/api/resumes')).body);
    expect(count()).toBe(5);
    // The most recently updated come first and are the ones read.
    const newestFirst = [...ids].reverse();
    expect(first.items.map((item) => item.id)).toEqual(newestFirst);
    expect(first.items.map((item) => item.analysis !== null)).toEqual([true, true, true, true, true, false, false]);
    expect(first.items[0]!.analysis).toMatchObject({ yearsExperience: 10.4, softSkillCount: 2, refining: false, aiWaiting: true });
    expect(first.items[0]!.analysis!.hardSkills).toEqual(expect.arrayContaining(['Go', 'PostgreSQL']));

    const second = ResumeListResponseSchema.parse((await me.agent.get('/api/resumes')).body);
    expect(count()).toBe(7);
    expect(second.items.every((item) => item.analysis !== null)).toBe(true);

    // With every reading there, a list request reads no resume text at all.
    const prepare = vi.spyOn(db(), 'prepare');
    const third = await me.agent.get('/api/resumes?source=uploaded');
    expect(third.status).toBe(200);
    const statements = prepare.mock.calls.map(([sql]) => String(sql));
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter((sql) => /extracted_text|\br\.\*/.test(sql))).toEqual([]);
  });

  it('the backfill reads resumes from before, one per step, and leaves disabled accounts for later', async () => {
    context();
    const me = await signIn(ctx!, 'backfill@example.com');
    const off = await signIn(ctx!, 'disabled@example.com');
    const mine = [addOldResume(me.account.id, RESUME_TEXT), addOldResume(me.account.id, OTHER_TEXT)];
    const theirs = addOldResume(off.account.id, RESUME_TEXT);
    db().prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(TEST_NOW.toISOString(), off.account.id);

    expect(workers().backfill.step()).toEqual(expect.any(String));
    expect(mine.filter((id) => readings(id).length > 0)).toHaveLength(1);
    expect(await workers().backfill.drain()).toBe(1);
    for (const id of mine) {
      expect(readings(id)).toMatchObject([{ source: 'deterministic', version: RESUME_ANALYSIS_VERSION }]);
      expect(backlogRow(id)).toMatchObject({ state: 'waiting', content_hash: hashOfStored(id) });
    }
    expect(readings(theirs)).toEqual([]);
    expect(await workers().backfill.drain()).toBe(0);

    db().prepare('UPDATE users SET disabled_at = NULL WHERE id = ?').run(off.account.id);
    expect(await workers().backfill.drain()).toBe(1);
    expect(readings(theirs)).toHaveLength(1);
  });

  it('a step whose reader breaks is logged and the backfill goes on', async () => {
    context();
    const me = await signIn(ctx!, 'goes-on@example.com');
    const ids = [addOldResume(me.account.id, RESUME_TEXT), addOldResume(me.account.id, OTHER_TEXT)];
    reader.broken = true;
    expect(await workers().backfill.drain()).toBe(2);
    expect(ids.map((id) => readings(id).length)).toEqual([0, 0]);
    const logged = (ctx!.deps.log as unknown as { lines: string[] }).lines;
    for (const id of ids) expect(logged.some((line) => line.includes(`could not read resume ${id}`))).toBe(true);
    reader.broken = false;
    ctx!.setNow(at(61 * MINUTE));
    expect(await workers().backfill.drain()).toBe(2);
    expect(ids.map((id) => readings(id).length)).toEqual([1, 1]);
  });
});

// --------------------------------------------------------------------------------------------- Claude's backlog

describe("Claude's reading of uploads (the backlog)", () => {
  it('one reading in flight server-wide, owned by the uploader, the account served least recently first', async () => {
    context();
    const a = await signIn(ctx!, 'first@example.com');
    const b = await signIn(ctx!, 'second@example.com');
    const a1 = addUpload(a.account.id, RESUME_TEXT, 'A one');
    ctx!.setNow(at(1000));
    const a2 = addUpload(a.account.id, `${RESUME_TEXT}\nVolunteer mentor`, 'A two');
    ctx!.setNow(at(2000));
    const b1 = addUpload(b.account.id, OTHER_TEXT, 'B one');
    expect(workers().backlog.enabled).toBe(true);

    // Nobody served yet: the oldest upload first.
    const firstTask = workers().backlog.tick();
    expect(firstTask).toEqual(expect.any(String));
    expect(workers().backlog.tick()).toBeNull(); // one in flight, server-wide
    expect(readingTasks()).toEqual([
      {
        id: firstTask,
        user_id: a.account.id,
        status: expect.stringMatching(/queued|running/),
        priority: 0,
        dedupe_key: `${a.account.id}:resume_analysis:${a1}:${hashOfStored(a1)}:${RESUME_ANALYSIS_VERSION}`,
        error_code: null,
      },
    ]);
    expect(backlogRow(a1)).toMatchObject({ state: 'queued', task_id: firstTask, started_at: at(2000).toISOString() });
    const view = (await a.agent.get(`/api/resumes/${a1}/analysis`)).body;
    expect(view).toMatchObject({ refining: true, aiWaiting: false });
    expect((await requireAi(ctx!.deps).waitFor(firstTask!, 20_000)).status).toBe('succeeded');

    // Next: the other account (never served), although A's second upload is older.
    ctx!.setNow(at(MINUTE));
    const second = await readNext();
    expect(second.status).toBe('succeeded');
    expect(readingTasks()[1]).toMatchObject({ user_id: b.account.id });
    expect(backlogRow(a1)).toMatchObject({ state: 'done' });
    ctx!.setNow(at(2 * MINUTE));
    await readNext();
    expect(readingTasks().map((task) => task.user_id)).toEqual([a.account.id, b.account.id, a.account.id]);
    expect(workers().backlog.tick()).toBeNull();
    for (const id of [a1, a2, b1]) {
      expect(backlogRow(id)).toMatchObject({ state: 'done' });
      expect(readings(id).map((row) => row.source)).toEqual(['ai', 'deterministic']);
    }
  });

  it("grounding keeps what the resume says and drops what the model made up", async () => {
    context();
    const me = await signIn(ctx!, 'grounding@example.com');
    const id = addUpload(me.account.id);
    const other = addUpload(me.account.id, OTHER_TEXT, 'Other');
    expect((await readNext()).status).toBe('succeeded');
    ctx!.setNow(at(MINUTE));
    expect((await readNext()).status).toBe('succeeded');

    const ai = db().prepare("SELECT * FROM resume_analyses WHERE resume_id = ? AND source = 'ai'").get(id) as Record<string, string | number | null>;
    expect(ai).toMatchObject({ version: RESUME_ANALYSIS_VERSION, content_hash: hashOfStored(id), model: 'claude-sonnet-5-5' });
    expect(ai.prompt_hash).toMatch(/^[0-9a-f]{16}$/);
    const hardSkills = JSON.parse(String(ai.hard_skills)) as string[];
    // The skill library's spelling ("Kafka" in the answer is the library's "Apache Kafka").
    expect(hardSkills).toEqual(['Go', 'Python', 'Kubernetes', 'PostgreSQL', 'Apache Kafka']);
    expect(JSON.parse(String(ai.soft_skills))).toEqual(['Communication', 'Mentoring']);
    expect(JSON.parse(String(ai.keywords))).toEqual({
      roles: ['Senior Backend Engineer', 'Software Engineer'],
      certifications: ['Certified Kubernetes Administrator (CKA)'],
      domains: ['finance'],
    });
    // 03/2021 - Present and 06/2016 - 02/2021, as written; the made-up 1960s role is gone.
    expect(JSON.parse(String(ai.experience))).toEqual([
      [2021 * 12 + 2, null],
      [2016 * 12 + 5, 2021 * 12 + 1],
    ]);
    expect(ai).toMatchObject({ years_stated: 8, years_stated_basis: 'stated', person_name: 'Nadia Ferreira-Lund' });
    const everything = JSON.stringify(ai);
    for (const invented of ['Quantum knitting', 'Telepathy', 'Chief Happiness Astronaut', 'Certified Dragon Tamer', 'Space mining', 'media_entertainment', 'Lunar Base']) {
      expect(everything).not.toContain(invented);
    }
    // A total the resume does not state is not kept (the fake said 37 years).
    const otherAi = db().prepare("SELECT years_stated, person_name FROM resume_analyses WHERE resume_id = ? AND source = 'ai'").get(other);
    expect(otherAi).toEqual({ years_stated: null, person_name: 'Tomas Okafor' });

    const view = ResumeAnalysisViewSchema.parse((await me.agent.get(`/api/resumes/${id}/analysis`)).body);
    expect(view).toMatchObject({ source: 'ai', refining: false, aiWaiting: false, aiFailed: false, yearsExperience: 10.4 });
  });

  it('only a failed reading counts: 3 attempts with 30 and 60 minutes between, then failed, tried again after 24 h', async () => {
    context();
    const scenarios = join(ctx!.dataDir, 'scenarios');
    mkdirSync(scenarios, { recursive: true });
    writeFileSync(join(scenarios, 'resume_analysis.mjs'), "export default () => 'Sorry, I cannot read that.';\n");
    vi.stubEnv('FAKE_CLAUDE_SCENARIOS', scenarios);
    const me = await signIn(ctx!, 'attempts@example.com');
    const id = addUpload(me.account.id);

    const first = await readNext();
    expect(first.error?.code).toBe('ai_failed');
    expect(workers().backlog.tick()).toBeNull(); // settles it; not due again yet
    expect(backlogRow(id)).toMatchObject({ state: 'waiting', attempts: 1, next_attempt_at: at(30 * MINUTE).toISOString() });
    expect(backlogRow(id)!.last_error).toMatch(/could not be understood/);

    ctx!.setNow(at(30 * MINUTE));
    expect((await readNext()).error?.code).toBe('ai_failed');
    expect(workers().backlog.tick()).toBeNull();
    expect(backlogRow(id)).toMatchObject({ state: 'waiting', attempts: 2, next_attempt_at: at(90 * MINUTE).toISOString() });

    ctx!.setNow(at(90 * MINUTE));
    expect((await readNext()).error?.code).toBe('ai_failed');
    expect(workers().backlog.tick()).toBeNull();
    const failedAt = at(90 * MINUTE).getTime();
    expect(backlogRow(id)).toMatchObject({ state: 'failed', attempts: 3, next_attempt_at: new Date(failedAt + 24 * 60 * MINUTE).toISOString() });
    expect((await me.agent.get(`/api/resumes/${id}/analysis`)).body).toMatchObject({ source: 'deterministic', aiFailed: true, aiWaiting: false });

    ctx!.setNow(new Date(failedAt + 24 * 60 * MINUTE - MINUTE));
    expect(workers().backlog.tick()).toBeNull();
    ctx!.setNow(new Date(failedAt + 24 * 60 * MINUTE));
    expect(workers().backlog.tick()).toEqual(expect.any(String));
    expect(backlogRow(id)).toMatchObject({ state: 'queued', attempts: 3 });
    expect(readingTasks()).toHaveLength(4);
    await requireAi(ctx!.deps).waitFor(backlogRow(id)!.task_id!, 20_000);
  });

  it('a restart (interrupted) or a cancel does not count as an attempt', async () => {
    context();
    const me = await signIn(ctx!, 'restart@example.com');
    const id = addUpload(me.account.id);
    const finishedTask = db().prepare(
      `INSERT INTO ai_tasks(id, user_id, kind, status, priority, input, error_code, error_message, created_at, finished_at)
       VALUES (?, ?, 'resume_analysis', ?, 0, '{}', ?, ?, ?, ?)`,
    );
    const inFlight = (taskId: string, attempts: number) =>
      db().prepare("UPDATE resume_analysis_backlog SET state = 'queued', task_id = ?, attempts = ? WHERE resume_id = ?").run(taskId, attempts, id);

    finishedTask.run('t-cut', me.account.id, 'failed', 'interrupted', 'The server restarted.', TEST_NOW.toISOString(), TEST_NOW.toISOString());
    inFlight('t-cut', 1);
    // Settled as waiting (not counted), and started again at once.
    const again = workers().backlog.tick();
    expect(again).toEqual(expect.any(String));
    expect(backlogRow(id)).toMatchObject({ state: 'queued', task_id: again, attempts: 1 });
    await requireAi(ctx!.deps).waitFor(again!, 20_000);
    expect(workers().backlog.tick()).toBeNull();
    expect(backlogRow(id)).toMatchObject({ state: 'done', attempts: 1 });

    const second = addUpload(me.account.id, OTHER_TEXT, 'Second');
    finishedTask.run('t-cancel', me.account.id, 'cancelled', 'cancelled', 'Cancelled.', TEST_NOW.toISOString(), TEST_NOW.toISOString());
    db().prepare("UPDATE resume_analysis_backlog SET state = 'queued', task_id = 't-cancel' WHERE resume_id = ?").run(second);
    expect(workers().backlog.tick()).toBeNull();
    expect(backlogRow(second)).toMatchObject({ state: 'waiting', attempts: 0, next_attempt_at: at(5 * MINUTE).toISOString() });
  });

  it('an outage (ai_unavailable) waits for the hold to end, at least 5 minutes, without counting', async () => {
    context();
    const me = await signIn(ctx!, 'outage@example.com');
    const id = addUpload(me.account.id);
    vi.stubEnv('FAKE_CLAUDE_MODE', 'auth');
    expect((await readNext()).error?.code).toBe('ai_unavailable');
    expect(workers().backlog.tick()).toBeNull();
    expect(backlogRow(id)).toMatchObject({ state: 'waiting', attempts: 0, next_attempt_at: at(5 * MINUTE).toISOString() });
    expect(backlogRow(id)!.last_error).toMatch(/sign the Claude CLI in again/);

    // A spent usage window holds every AI call: the upload waits until the hold ends, still not counted.
    ctx!.setNow(at(5 * MINUTE));
    vi.stubEnv('FAKE_CLAUDE_MODE', 'ratelimit');
    expect((await readNext()).error?.code).toBe('ai_unavailable');
    workers().backlog.tick();
    const hold = requireAi(ctx!.deps).provider.holdFor('resume_analysis');
    expect(hold?.until).toBeGreaterThan(at(10 * MINUTE).getTime());
    expect(backlogRow(id)).toMatchObject({ state: 'waiting', attempts: 0, next_attempt_at: new Date(hold!.until).toISOString() });
    expect(readingTasks()).toHaveLength(2);
  });

  it('AI off: nothing is queued and nothing shows waiting, but the handler stays registered', async () => {
    const settings: Array<Record<string, string>> = [
      { AI_RESUME_ANALYSIS: 'off' },
      { AI_CLI_BACKGROUND_SLOTS: '0' },
      { AI_ENABLED: 'false' },
    ];
    for (const env of settings) {
      context(env);
      const me = await signIn(ctx!, 'off@example.com');
      const id = addUpload(me.account.id);
      expect(workers().backlog.enabled).toBe(false);
      expect(workers().backlog.tick()).toBeNull();
      expect(readingTasks()).toEqual([]);
      expect(backlogRow(id)).toMatchObject({ state: 'waiting' });
      expect((await me.agent.get(`/api/resumes/${id}/analysis`)).body).toMatchObject({ aiWaiting: false, refining: false });
      if (env.AI_ENABLED !== 'false') {
        // The handler answers a task queued by hand (interactive priority, as background slots may be 0).
        const { taskId } = requireAi(ctx!.deps).enqueue({
          kind: 'resume_analysis',
          userId: me.account.id,
          input: { resumeId: id, contentHash: hashOfStored(id), version: RESUME_ANALYSIS_VERSION },
        });
        const task = await requireAi(ctx!.deps).waitFor(taskId, 20_000);
        expect(task.status, JSON.stringify(task.error)).toBe('succeeded');
        expect(task.result).toEqual({ resumeId: id, stored: true });
        expect(backlogRow(id)).toMatchObject({ state: 'done' });
      }
      await getPdfService(ctx!.deps).close();
      ctx!.cleanup();
      ctx = null;
    }
  });

  it('the hourly cap (AI_RESUME_ANALYSIS_PER_HOUR)', async () => {
    context({ AI_RESUME_ANALYSIS_PER_HOUR: '1' });
    const me = await signIn(ctx!, 'cap@example.com');
    const first = addUpload(me.account.id, RESUME_TEXT, 'One');
    ctx!.setNow(at(1000));
    const second = addUpload(me.account.id, OTHER_TEXT, 'Two');
    await readNext();
    ctx!.setNow(at(59 * MINUTE));
    expect(workers().backlog.tick()).toBeNull();
    expect(backlogRow(first)).toMatchObject({ state: 'done' });
    expect(backlogRow(second)).toMatchObject({ state: 'waiting' });
    ctx!.setNow(at(60 * MINUTE + 1000));
    expect(workers().backlog.tick()).toEqual(expect.any(String));
    await requireAi(ctx!.deps).waitFor(backlogRow(second)!.task_id!, 20_000);
  });

  it.each(['0', '2'])('starts a reading on a clock that moves while it steps (AI_RESUME_ANALYSIS_PER_HOUR=%s)', async (perHour) => {
    context({ AI_RESUME_ANALYSIS_PER_HOUR: perHour });
    const me = await signIn(ctx!, 'clock@example.com');
    const upload = addUpload(me.account.id, RESUME_TEXT, 'One');
    // As a real clock does, every reading is a millisecond after the one before: the step's and the budget's differ.
    let ms = ctx!.deps.now().getTime();
    const backlog = createResumeAnalysisBacklog({ ...ctx!.deps, now: () => new Date((ms += 1)) });
    expect(backlog.pending()).toBe(true);
    const taskId = backlog.tick();
    expect(taskId).toEqual(expect.any(String));
    await requireAi(ctx!.deps).waitFor(taskId!, 20_000);
    expect(backlogRow(upload)).toMatchObject({ state: 'done' });
  });

  it('pending(): a reading in flight, or one due that the budget allows (other background AI yields to it)', async () => {
    context({ AI_RESUME_ANALYSIS_PER_HOUR: '1' });
    const me = await signIn(ctx!, 'pending@example.com');
    expect(workers().backlog.pending()).toBe(false);
    addUpload(me.account.id);
    expect(workers().backlog.pending()).toBe(true);
    const taskId = workers().backlog.tick()!;
    expect(workers().backlog.pending()).toBe(true);
    await requireAi(ctx!.deps).waitFor(taskId, 20_000);
    workers().backlog.tick();
    expect(workers().backlog.pending()).toBe(false);
    ctx!.setNow(at(1000));
    addUpload(me.account.id, OTHER_TEXT, 'Two');
    expect(workers().backlog.pending()).toBe(false); // due, but this hour's budget is spent
    ctx!.setNow(at(61 * MINUTE));
    expect(workers().backlog.pending()).toBe(true);
  });

  it('a usage warning (allowed_warning) pauses it until the window resets', async () => {
    context();
    const me = await signIn(ctx!, 'warning@example.com');
    addUpload(me.account.id);
    const provider = requireAi(ctx!.deps).provider;
    vi.spyOn(provider, 'lastRateLimit').mockReturnValue({
      status: 'allowed_warning',
      resetsAtMs: at(90 * MINUTE).getTime(),
      usingOverage: false,
      seenAtMs: TEST_NOW.getTime(),
    });
    expect(workers().backlog.tick()).toBeNull();
    ctx!.setNow(at(89 * MINUTE));
    expect(workers().backlog.tick()).toBeNull();
    expect(readingTasks()).toEqual([]);
    ctx!.setNow(at(90 * MINUTE));
    const taskId = workers().backlog.tick();
    expect(taskId).toEqual(expect.any(String));
    await requireAi(ctx!.deps).waitFor(taskId!, 20_000);
  });

  it('a disabled account waits; the others are read', async () => {
    context();
    const off = await signIn(ctx!, 'disabled@example.com');
    const on = await signIn(ctx!, 'enabled@example.com');
    const theirs = addUpload(off.account.id);
    const mine = addUpload(on.account.id, OTHER_TEXT);
    db().prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(TEST_NOW.toISOString(), off.account.id);
    await readNext();
    expect(readingTasks().map((task) => task.user_id)).toEqual([on.account.id]);
    expect(workers().backlog.tick()).toBeNull();
    expect(backlogRow(mine)).toMatchObject({ state: 'done' });
    expect(backlogRow(theirs)).toMatchObject({ state: 'waiting' });
    db().prepare('UPDATE users SET disabled_at = NULL WHERE id = ?').run(off.account.id);
    await readNext();
    expect(readingTasks().map((task) => task.user_id)).toEqual([on.account.id, off.account.id]);
  });

  it("Duplicate and a re-upload of the same file copy Claude's reading instead of asking again", async () => {
    context();
    const me = await signIn(ctx!, 'reuse@example.com');
    const pdf = minimalPdf([RESUME_LINES]);
    const original = (await uploadFile(me.agent, pdf, 'nadia.pdf')).body.resume.id as string;
    await readNext();
    expect(workers().backlog.tick()).toBeNull();
    const reading = () =>
      db()
        .prepare("SELECT hard_skills, soft_skills, keywords, experience, years_stated, person_name FROM resume_analyses WHERE resume_id = ? AND source = 'ai'")
        .get(original);
    const theirs = (id: string) =>
      db()
        .prepare("SELECT hard_skills, soft_skills, keywords, experience, years_stated, person_name FROM resume_analyses WHERE resume_id = ? AND source = 'ai'")
        .get(id);

    const copy = await me.agent.post(`/api/resumes/${original}/duplicate`).set('Origin', ORIGIN).send({});
    expect(copy.status).toBe(201);
    expect(theirs(copy.body.id)).toEqual(reading());
    expect(backlogRow(copy.body.id)).toMatchObject({ state: 'done' });
    const again = (await uploadFile(me.agent, pdf, 'nadia again.pdf')).body.resume.id as string;
    expect(theirs(again)).toEqual(reading());
    expect(backlogRow(again)).toMatchObject({ state: 'done' });
    expect((await me.agent.get(`/api/resumes/${again}/analysis`)).body).toMatchObject({ source: 'ai' });

    expect(workers().backlog.tick()).toBeNull();
    expect(readingTasks()).toHaveLength(1);
    // Another account's identical file is read for that account (readings are never shared between accounts).
    const other = await signIn(ctx!, 'reuse-other@example.com');
    const otherId = (await uploadFile(other.agent, pdf, 'nadia.pdf')).body.resume.id as string;
    expect(backlogRow(otherId)).toMatchObject({ state: 'waiting' });
  });

  it('storing a reading after its upload was deleted is a no-op, not an error', async () => {
    context();
    const me = await signIn(ctx!, 'deleted@example.com');
    const gone = addUpload(me.account.id);
    const stored = storeAiResumeAnalysis(ctx!.deps, {
      resumeId: 'no-such-resume',
      userId: me.account.id,
      contentHash: hashOfStored(gone),
      data: {
        hardSkills: ['Go'],
        softSkills: [],
        keywords: { roles: [], certifications: [], domains: [] },
        experience: [],
        yearsStated: null,
        yearsStatedBasis: null,
        personName: null,
      },
      model: 'claude-sonnet-5-5',
      promptHash: null,
    });
    expect(stored).toBe(false);

    // Deleted while Claude reads it.
    vi.stubEnv('FAKE_CLAUDE_MODE', 'slow');
    vi.stubEnv('FAKE_CLAUDE_SLOW_MS', '1500');
    const taskId = workers().backlog.tick()!;
    await vi.waitFor(() => expect(requireAi(ctx!.deps).getTask(taskId, null)?.status).toBe('running'), { timeout: 10_000 });
    expect((await me.agent.delete(`/api/resumes/${gone}`).set('Origin', ORIGIN)).status).toBe(200);
    const task = await requireAi(ctx!.deps).waitFor(taskId, 20_000);
    expect(task.status, JSON.stringify(task.error)).toBe('succeeded');
    expect(task.result).toEqual({ resumeId: gone, stored: false, skipped: 'deleted' });
    expect(db().prepare('SELECT count(*) AS n FROM resume_analyses WHERE resume_id = ?').get(gone)).toEqual({ n: 0 });
    expect(backlogRow(gone)).toBeUndefined();
    expect(workers().backlog.tick()).toBeNull();
    const logged = (ctx!.deps.log as unknown as { lines: string[] }).lines;
    expect(logged.filter((line) => line.includes(taskId))).toEqual([]);
  });

  it('a version bump reads every resume again and queues Claude again', async () => {
    context();
    const me = await signIn(ctx!, 'version@example.com');
    const id = addUpload(me.account.id);
    await readNext();
    expect(workers().backlog.tick()).toBeNull();
    // As if these rows were written by the version before.
    db().prepare('UPDATE resume_analyses SET version = version - 1').run();
    db().prepare('UPDATE resume_analysis_backlog SET version = version - 1').run();
    expect(workers().backlog.tick()).toBeNull(); // the backlog reads only current rows

    ctx!.setNow(at(MINUTE));
    expect(await workers().backfill.drain()).toBe(1);
    expect(readings(id)).toEqual([
      { source: 'ai', version: RESUME_ANALYSIS_VERSION - 1, content_hash: hashOfStored(id), created_at: TEST_NOW.toISOString() },
      { source: 'deterministic', version: RESUME_ANALYSIS_VERSION, content_hash: hashOfStored(id), created_at: at(MINUTE).toISOString() },
    ]);
    expect(backlogRow(id)).toMatchObject({ state: 'waiting', attempts: 0, version: RESUME_ANALYSIS_VERSION, task_id: null });
    // Claude's old reading is not used meanwhile.
    expect((await me.agent.get(`/api/resumes/${id}/analysis`)).body).toMatchObject({ source: 'deterministic', aiWaiting: true });

    const task = await readNext();
    expect(task.status).toBe('succeeded');
    expect(readingTasks()[1]!.dedupe_key).toBe(`${me.account.id}:resume_analysis:${id}:${hashOfStored(id)}:${RESUME_ANALYSIS_VERSION}`);
    expect(readings(id).map((row) => [row.source, row.version])).toEqual([
      ['ai', RESUME_ANALYSIS_VERSION],
      ['deterministic', RESUME_ANALYSIS_VERSION],
    ]);
  });

  it('the workers start only on start(), read on their own, and stop cleanly', async () => {
    context();
    const me = await signIn(ctx!, 'timers@example.com');
    const old = addOldResume(me.account.id, RESUME_TEXT);
    // Before start(), no timer exists: a nudge does nothing.
    workers().backfill.nudge();
    workers().backlog.nudge();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(readings(old)).toEqual([]);

    const stop = resumesFeature.start!(ctx!.deps);
    if (typeof stop !== 'function') throw new Error('the resumes feature returns a stop function');
    workers().backfill.nudge();
    await vi.waitFor(() => expect(readings(old).map((row) => row.source)).toEqual(['ai', 'deterministic']), {
      timeout: 20_000,
      interval: 100,
    });
    await stop();
    // Stopped: a nudge starts nothing.
    const later = addOldResume(me.account.id, OTHER_TEXT);
    workers().backfill.nudge();
    workers().backlog.nudge();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(readings(later)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------- the prompt and grounding

describe('the resume_analysis prompt and its grounding', () => {
  it('sends only the resume text between the markers (at most 60,000 characters), under the copy-never-infer rule', () => {
    const user = resumeAnalysisPrompt.user({ text: `Nadia\n${'x'.repeat(70_000)}` });
    expect(user.startsWith('RESUME TEXT (between the markers):\n<<<RESUME\nNadia\n')).toBe(true);
    expect(user.endsWith('\nRESUME>>>')).toBe(true);
    expect(user.length).toBeLessThan(60_100);
    const system = resumeAnalysisPrompt.system({ text: '' });
    expect(system).toContain('THE RULE: copy, never infer.');
    expect(system).toContain('The headline under the name first');
    expect(system).not.toMatch(/\u2014/);
    expect(resumeAnalysisPrompt.kind).toBe('resume_analysis');
  });

  it('reads an answer leniently, but a missing list is asked for again', () => {
    const parsed = ResumeAnalysisOutputSchema.parse({
      personName: 7,
      roles: ['Engineer', null, { title: 'x' }],
      hardSkills: null,
      softSkills: [],
      certifications: Array.from({ length: 40 }, (_, index) => `Cert ${index}`),
      industries: [],
      experience: [{ title: 'Engineer', startDate: 2019, endDate: 'Present' }, 'not an entry'],
      totalYearsExperience: '8+',
    });
    expect(parsed).toMatchObject({
      personName: null,
      roles: ['Engineer'],
      hardSkills: [],
      experience: [{ title: 'Engineer', company: '', startDate: '2019', endDate: 'Present' }],
      totalYearsExperience: 8,
    });
    expect(parsed.certifications).toHaveLength(30);
    expect(ResumeAnalysisOutputSchema.safeParse({ roles: [] }).success).toBe(false);
  });

  it('keeps what the text says, in the library spelling or as written, and drops the rest', () => {
    const text = [
      'JANE DOE',
      'Platform Engineer',
      'Over 12 years of experience in fintech platforms.',
      'Experience',
      'Platform Engineer, Ledgerline | 01/2020 - Present',
      'Kafka, Buck2 and Go; clear communication and change management.',
      'Education',
      'B.S. Computer Science, NC State University, 2012 - 2016',
      'AWS Certified Solutions Architect - Associate',
    ].join('\n');
    const data = finishResumeAnalysis(
      ResumeAnalysisOutputSchema.parse({
        personName: 'Jane Doe',
        roles: ['Platform Engineer', 'Staff Engineer'],
        hardSkills: ['Kafka', 'Buck2', 'Communication', 'Go', 'Rust'],
        softSkills: ['Change Management', 'Patience'],
        certifications: ['AWS Certified Solutions Architect - Associate', 'Six Sigma Black Belt'],
        industries: ['FinTech', 'Healthcare'],
        experience: [
          { title: 'Platform Engineer', company: 'Ledgerline', startDate: '01/2020', endDate: 'Present' },
          { title: 'B.S. Computer Science', company: 'NC State University', startDate: '2012', endDate: '2016' },
        ],
        totalYearsExperience: 12,
      }),
      text,
      skillLists(),
    );
    expect(data).toEqual({
      // The library's spelling; a skill it does not list stays as written; a soft skill listed as hard is soft.
      hardSkills: ['Apache Kafka', 'Buck2', 'Go'],
      // "Change Management" is a hard skill too, so it is not a soft one; "Patience" is not in the text.
      softSkills: ['Communication'],
      // Certifications by their canonical names.
      keywords: { roles: ['Platform Engineer'], certifications: ['AWS Certified Solutions Architect'], domains: ['finance'] },
      // The degree is not a role.
      experience: [[2020 * 12, null]],
      yearsStated: 12,
      yearsStatedBasis: 'stated',
      personName: 'Jane Doe',
    });
  });
});

// ------------------------------------------------------------------------------------------ uploads never change

describe('uploaded resumes are never changed', () => {
  it("the file's bytes, file_id, extracted_text and updated_at are the same after both readings", async () => {
    context();
    const me = await signIn(ctx!, 'unchanged@example.com');
    const pdf = minimalPdf([RESUME_LINES]);
    const id = (await uploadFile(me.agent, pdf, 'nadia.pdf')).body.resume.id as string;
    const snapshot = () => {
      const row = db()
        .prepare(
          `SELECT r.file_id, r.extracted_text, r.updated_at, r.last_edited_at, r.title, r.data, f.sha256, f.size_bytes
           FROM resumes r JOIN stored_files f ON f.id = r.file_id WHERE r.id = ?`,
        )
        .get(id) as { file_id: string; sha256: string };
      const { buffer } = getFileStore(ctx!.deps).read(row.file_id, me.account.id);
      return { row, bytes: sha256(buffer) };
    };
    const before = snapshot();
    expect(before.bytes).toBe(sha256(pdf));
    expect(before.row.sha256).toBe(sha256(pdf));

    ctx!.setNow(at(10 * MINUTE));
    await workers().backfill.drain();
    expect((await me.agent.get(`/api/resumes/${id}/analysis`)).status).toBe(200);
    await me.agent.get('/api/resumes');
    await readNext();
    workers().backlog.tick();
    expect(readings(id).map((row) => row.source)).toEqual(['ai', 'deterministic']);
    expect(snapshot()).toEqual(before);
  });

  it('parse=1 that cannot start keeps the upload: 201 with taskId null and copyError (unreadable, AI busy, AI off)', async () => {
    context();
    const me = await signIn(ctx!, 'kept@example.com');
    const listed = async () => ((await me.agent.get('/api/resumes')).body.items as Array<{ id: string }>).map((item) => item.id);

    const unreadable = await uploadFile(me.agent, minimalPdf([['Too short']]), 'scan.pdf', '?parse=1');
    expect(unreadable.status, JSON.stringify(unreadable.body)).toBe(201);
    expect(ResumeUploadResponseSchema.parse(unreadable.body)).toMatchObject({ taskId: null, copyError: expect.stringMatching(/could not read enough text/) });
    expect(backlogRow(unreadable.body.resume.id)).toMatchObject({ state: 'skipped', last_error: 'Its text could not be read.' });

    // Two editable copies already queued for this account: a third is "busy".
    const queued = db().prepare(
      "INSERT INTO ai_tasks(id, user_id, kind, status, priority, input, created_at) VALUES (?, ?, 'resume_import', 'queued', 1, '{}', ?)",
    );
    queued.run('t-busy-1', me.account.id, TEST_NOW.toISOString());
    queued.run('t-busy-2', me.account.id, TEST_NOW.toISOString());
    const busy = await uploadFile(me.agent, minimalPdf([RESUME_LINES]), 'nadia.pdf', '?parse=1');
    expect(busy.status, JSON.stringify(busy.body)).toBe(201);
    expect(busy.body).toMatchObject({ taskId: null, copyError: expect.stringMatching(/already running for your account/) });
    const busyFile = (await me.agent.get(`/api/resumes/${busy.body.resume.id}/file`)).status;
    expect(busyFile).toBe(200);
    expect(await listed()).toEqual(expect.arrayContaining([unreadable.body.resume.id, busy.body.resume.id]));
    await getPdfService(ctx!.deps).close();
    ctx!.cleanup();

    context({ AI_ENABLED: 'false' });
    const off = await signIn(ctx!, 'kept-off@example.com');
    const noAi = await uploadFile(off.agent, minimalPdf([RESUME_LINES]), 'nadia.pdf', '?parse=1');
    expect(noAi.status).toBe(201);
    expect(noAi.body).toMatchObject({ taskId: null, copyError: 'AI features are turned off on this server.' });
    expect(((await off.agent.get('/api/resumes')).body.items as unknown[]).length).toBe(1);
  });

  it(`an account keeps at most ${MAX_RESUMES_PER_ACCOUNT} resumes: 409 on every route that adds one`, async () => {
    context();
    const me = await signIn(ctx!, 'full@example.com');
    const upload = addUpload(me.account.id, RESUME_TEXT, 'The upload');
    const fileRows = () => (db().prepare('SELECT count(*) AS n FROM stored_files WHERE user_id = ?').get(me.account.id) as { n: number }).n;
    const insert = db().prepare(
      "INSERT INTO resumes(id, user_id, kind, title, data, created_at, updated_at) VALUES (?, ?, 'built', ?, '{}', ?, ?)",
    );
    db().transaction(() => {
      for (let index = 0; index < MAX_RESUMES_PER_ACCOUNT - 2; index += 1) {
        insert.run(randomUUID(), me.account.id, `Resume ${index}`, TEST_NOW.toISOString(), TEST_NOW.toISOString());
      }
    })();
    const create = () => me.agent.post('/api/resumes').set('Origin', ORIGIN).send({ document: { name: 'One more' } });
    const last = await create();
    expect(last.status).toBe(201); // the 500th

    const refused = await create();
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({
      code: 'conflict',
      message: `You can keep up to ${MAX_RESUMES_PER_ACCOUNT} resumes. Delete resumes you no longer need, then try again.`,
    });
    const files = fileRows();
    const file = await uploadFile(me.agent, minimalPdf([RESUME_LINES]), 'nadia.pdf');
    expect(file.status).toBe(409);
    expect(fileRows()).toBe(files);
    const imported = await me.agent
      .post('/api/resumes/import-json')
      .set('Origin', ORIGIN)
      .send({ data: [{ name: 'A', title: 'Data Engineer', skills: ['SQL'] }, { name: 'B', title: 'SRE', skills: ['Go'] }] });
    expect(imported.status, JSON.stringify(imported.body)).toBe(409);
    expect(imported.body.error.message).toMatch(/these 2 would take you past that/);
    expect((await me.agent.post(`/api/resumes/${last.body.id}/duplicate`).set('Origin', ORIGIN).send({})).status).toBe(409);
    expect((await me.agent.post(`/api/resumes/${upload}/parse`).set('Origin', ORIGIN).send({})).status).toBe(409);
    expect(db().prepare('SELECT count(*) AS n FROM resumes WHERE user_id = ?').get(me.account.id)).toEqual({ n: MAX_RESUMES_PER_ACCOUNT });

    // At 499, an upload that asks for an editable copy is kept, and says the copy has no room.
    await me.agent.delete(`/api/resumes/${last.body.id}`).set('Origin', ORIGIN);
    const kept = await uploadFile(me.agent, minimalPdf([RESUME_LINES]), 'nadia.pdf', '?parse=1');
    expect(kept.status).toBe(201);
    expect(kept.body).toMatchObject({ taskId: null, copyError: expect.stringMatching(/You can keep up to 500 resumes/) });
  });
});

// ------------------------------------------------------------------------------------- the match trigger (0301)

describe('a new reading asks for a new best match (0301 trigger)', () => {
  it("marks the owner's Saved applications that TailorIT chooses for as due; a rename does not", async () => {
    context();
    const me = await signIn(ctx!, 'trigger@example.com');
    const saved = insertApplication(db(), me.account.id, insertJob(db(), { title: 'Backend Engineer' }), 1);
    const applied = insertApplication(db(), me.account.id, insertJob(db(), { title: 'Platform Engineer' }), 2);
    const due = () =>
      (db().prepare('SELECT id FROM applications WHERE resume_match_due = 1 ORDER BY id').all() as Array<{ id: string }>).map((row) => row.id);
    const reset = () => db().prepare('UPDATE applications SET resume_match_due = 0').run();
    reset();

    const built = await me.agent.post('/api/resumes').set('Origin', ORIGIN).send({ document: { name: 'Nadia', skills: ['Go'] } });
    expect(due()).toEqual([saved]);
    reset();
    await me.agent.patch(`/api/resumes/${built.body.id}`).set('Origin', ORIGIN).send({ title: 'Renamed' });
    expect(due()).toEqual([]);

    addUpload(me.account.id);
    expect(due()).toEqual([saved]);
    reset();
    await readNext(); // Claude's reading lands
    expect(due()).toEqual([saved]);
    expect(due()).not.toContain(applied);
  });
});
