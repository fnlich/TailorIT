import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_RESUMES_PER_ACCOUNT,
  ResumeCopiesResponseSchema,
  ResumeDetailSchema,
  ResumeUploadResponseSchema,
  type ResumeCopiesResponse,
} from '@tailorit/shared';
import { AI_ERROR_MESSAGES, requireAi } from '../src/ai/index';
import { getPdfService } from '../src/core/pdf/index';
import { COPY_INTERRUPTED } from '../src/features/resumes/copies/backlog';
import { resumesFeature } from '../src/features/resumes/index';
import { UNREADABLE_TEXT } from '../src/features/resumes/upload';
import { signIn, type SignedIn } from './auth-helpers';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';

// Editable copies of several uploads (the owner's request of 2026-10-24): each upload of a run of several files with
// parse=1&batch= gets its row in resume_copy_backlog, written with the upload, and the copy line
// (features/resumes/copies/) makes the copies one at a time per account, on the template chosen, while
// GET /api/resumes/copies says how far it got. The fake Claude CLI answers resume_import with
// tools/fake-claude/scenarios/resume_import.json. Uploads are never changed by any of it.

let ctx: TestContext | null = null;
beforeEach(() => {
  vi.stubEnv('FAKE_CLAUDE_MODE', '');
  vi.stubEnv('FAKE_CLAUDE_SCENARIOS', '');
});
afterEach(async () => {
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
/** One Upload dialog's batch id, as the browser makes it (32 hex characters). */
const BATCH = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const BATCH_QUERY = `?parse=1&batch=${BATCH}`;
const NO_ROOM = `You can keep up to ${MAX_RESUMES_PER_ACCOUNT} resumes. Delete resumes you no longer need, then try again.`;

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

/** A resume's lines, under a name of its own. */
const resumeLines = (name: string) => [
  name,
  'Backend Engineer, Raleigh NC, nadia.fl@example.com',
  'Experience: Pinecrest Freight Software, 2021 to present, rates and billing services in Go and PostgreSQL',
];

function context(env: Record<string, string> = {}): TestContext {
  ctx = createTestContext({ env });
  return ctx;
}

const db = () => ctx!.deps.db;
const line = () => ctx!.deps.services.resumeCopies!;
const ai = () => requireAi(ctx!.deps);

interface CopyRow {
  id: string;
  user_id: string;
  source_resume_id: string;
  batch_id: string;
  label: string;
  template_id: string | null;
  state: string;
  task_id: string | null;
  resume_id: string | null;
  retries: number;
  next_attempt_at: string;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
}

/** The copy rows, in the order they were asked for. */
function rows(): CopyRow[] {
  return db().prepare('SELECT * FROM resume_copy_backlog ORDER BY created_at, rowid').all() as CopyRow[];
}

const rowOf = (uploadId: string) => rows().find((row) => row.source_resume_id === uploadId);
const states = () => rows().map((row) => row.state);

interface ImportTask {
  id: string;
  user_id: string | null;
  status: string;
  priority: number;
  dedupe_key: string | null;
}

function importTasks(): ImportTask[] {
  return db()
    .prepare("SELECT id, user_id, status, priority, dedupe_key FROM ai_tasks WHERE kind = 'resume_import' ORDER BY rowid")
    .all() as ImportTask[];
}

function uploadFile(agent: SignedIn['agent'], buffer: Buffer, name: string, query = '') {
  return agent.post(`/api/resumes/upload${query}`).set('Origin', ORIGIN).attach('file', buffer, name);
}

/**
 * One run of several files with "Make an editable copy with AI": a PDF per name, the clock a second on for each (so
 * they are asked for in this order). Every answer is 201 with no task and no copyError. Returns the uploads' ids.
 */
async function uploadSeveral(me: SignedIn, names: string[], query = BATCH_QUERY): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    ctx!.setNow(new Date(ctx!.deps.now().getTime() + 1000));
    const res = await uploadFile(me.agent, minimalPdf([resumeLines(name)]), `${name}.pdf`, query);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(ResumeUploadResponseSchema.parse(res.body)).toMatchObject({ taskId: null, copyError: null });
    ids.push(res.body.resume.id as string);
  }
  return ids;
}

async function copiesView(me: SignedIn): Promise<ResumeCopiesResponse> {
  const res = await me.agent.get('/api/resumes/copies');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return ResumeCopiesResponseSchema.parse(res.body);
}

function press(me: SignedIn, action: 'stop' | 'retry' | 'dismiss', batchId = BATCH) {
  return me.agent.post(`/api/resumes/copies/${batchId}/${action}`).set('Origin', ORIGIN).send({});
}

/**
 * Ticks, waits for every copy being made, and again until none is (the clock `stepMs` on after each step). Returns the
 * uploads in the order their copies started, and the most copies that were ever being made at once.
 */
async function makeAll(options: { stepMs?: number } = {}): Promise<{ order: string[]; most: number }> {
  const order: string[] = [];
  let most = 0;
  for (let step = 0; step < 50; step += 1) {
    for (const taskId of line().tick()) order.push(rows().find((row) => row.task_id === taskId)!.source_resume_id);
    // A step starts all it may: one more right after it starts nothing.
    expect(line().tick()).toEqual([]);
    const making = rows().filter((row) => row.state === 'making');
    most = Math.max(most, making.length);
    if (making.length === 0) return { order, most };
    for (const row of making) await ai().waitFor(row.task_id!, 20_000);
    if (options.stepMs) ctx!.setNow(new Date(ctx!.deps.now().getTime() + options.stepMs));
  }
  throw new Error('the copies were not all made');
}

/** Built resumes written straight to the table, until the account keeps `total` resumes. */
function fillTo(userId: string, total: number): void {
  const { n } = db().prepare('SELECT count(*) AS n FROM resumes WHERE user_id = ?').get(userId) as { n: number };
  const insert = db().prepare(
    "INSERT INTO resumes(id, user_id, kind, title, data, created_at, updated_at) VALUES (?, ?, 'built', ?, '{}', ?, ?)",
  );
  db().transaction(() => {
    for (let index = n; index < total; index += 1) {
      insert.run(randomUUID(), userId, `Resume ${index}`, TEST_NOW.toISOString(), TEST_NOW.toISOString());
    }
  })();
}

// ------------------------------------------------------------------------------------------------------- tests

describe('editable copies of several uploads (resume_copy_backlog)', () => {
  it('several uploads with parse=1&batch= are each copied on the chosen template, one at a time, and the uploads stay as they were', async () => {
    context();
    vi.stubEnv('FAKE_CLAUDE_MODE', 'slow');
    vi.stubEnv('FAKE_CLAUDE_SLOW_MS', '400');
    const me = await signIn(ctx!, 'several@example.com');
    const names = ['Ann Lee', 'Bob Diaz', 'Cy Park'];
    const uploads = await uploadSeveral(me, names, `${BATCH_QUERY}&templateId=navy-rule`);

    // Each waits in line, labelled by its file's name, written with its upload.
    expect(rows().map((row) => [row.source_resume_id, row.user_id, row.batch_id, row.label, row.template_id, row.state])).toEqual(
      uploads.map((id, index) => [id, me.account.id, BATCH, names[index], 'navy-rule', 'waiting']),
    );
    expect(await copiesView(me)).toEqual({
      items: names.map((label) => ({ id: expect.any(String), batchId: BATCH, label, state: 'waiting', resumeId: null, error: null, retryable: false })),
      paused: null,
    });
    expect(importTasks()).toEqual([]);
    const snapshot = () =>
      uploads.map((id) => db().prepare('SELECT file_id, extracted_text, updated_at FROM resumes WHERE id = ?').get(id));
    const before = snapshot();

    // One at a time, in the order they were asked for: a step never leaves two of them being made.
    const { order, most } = await makeAll();
    expect(order).toEqual(uploads);
    expect(most).toBe(1);

    for (const id of uploads) {
      const row = rowOf(id)!;
      expect(row).toMatchObject({ state: 'ready', retries: 0, error_code: null, error_message: null });
      const copy = ResumeDetailSchema.parse((await me.agent.get(`/api/resumes/${row.resume_id}`)).body);
      expect(copy).toMatchObject({ kind: 'built', templateId: 'navy-rule', nameOnResume: 'Nadia Ferreira-Lund' });
      expect(db().prepare('SELECT source_resume_id FROM resumes WHERE id = ?').get(row.resume_id)).toEqual({ source_resume_id: id });
    }
    // The tasks a copy asked for alone runs too: interactive, owned by the uploader, one per upload.
    expect(importTasks()).toEqual(
      uploads.map((id) => ({
        id: expect.any(String),
        user_id: me.account.id,
        status: 'succeeded',
        priority: 1,
        dedupe_key: `${me.account.id}:resume_import:${id}`,
      })),
    );
    const view = await copiesView(me);
    expect(view.items.map((item) => [item.state, item.resumeId])).toEqual(uploads.map((id) => ['ready', rowOf(id)!.resume_id]));
    expect(snapshot()).toEqual(before);
  });

  it('a copy refused when asked keeps its upload and is a failed row: unreadable (not retryable), no room (retryable), AI off', async () => {
    context();
    const me = await signIn(ctx!, 'refused@example.com');
    const scan = await uploadFile(me.agent, minimalPdf([['Too short']]), 'scan.pdf', BATCH_QUERY);
    expect(scan.status, JSON.stringify(scan.body)).toBe(201);
    expect(scan.body).toMatchObject({ taskId: null, copyError: null });
    // At 499 resumes, the upload is the 500th: stored, with no room for its copy.
    fillTo(me.account.id, MAX_RESUMES_PER_ACCOUNT - 1);
    const full = await uploadFile(me.agent, minimalPdf([resumeLines('Nadia')]), 'nadia.pdf', BATCH_QUERY);
    expect(full.status, JSON.stringify(full.body)).toBe(201);
    expect(full.body).toMatchObject({ taskId: null, copyError: null });

    expect(line().tick()).toEqual([]);
    expect((await copiesView(me)).items).toEqual([
      { id: expect.any(String), batchId: BATCH, label: 'scan', state: 'failed', resumeId: null, error: UNREADABLE_TEXT, retryable: false },
      { id: expect.any(String), batchId: BATCH, label: 'nadia', state: 'failed', resumeId: null, error: NO_ROOM, retryable: true },
    ]);
    expect(rows().map((row) => row.error_code)).toEqual(['unreadable', 'no_room']);
    for (const upload of [scan, full]) expect((await me.agent.get(`/api/resumes/${upload.body.resume.id}`)).status).toBe(200);
    expect(db().prepare('SELECT count(*) AS n FROM resumes WHERE user_id = ?').get(me.account.id)).toEqual({ n: MAX_RESUMES_PER_ACCOUNT });
    expect(importTasks()).toEqual([]);
    await getPdfService(ctx!.deps).close();
    ctx!.cleanup();

    context({ AI_ENABLED: 'false' });
    const off = await signIn(ctx!, 'refused-off@example.com');
    const [upload] = await uploadSeveral(off, ['Nadia']);
    expect(line().enabled).toBe(false);
    expect(line().tick()).toEqual([]);
    expect(await copiesView(off)).toEqual({
      items: [
        {
          id: expect.any(String),
          batchId: BATCH,
          label: 'Nadia',
          state: 'failed',
          resumeId: null,
          error: 'AI features are turned off on this server.',
          retryable: true,
        },
      ],
      paused: { reason: 'off', until: null },
    });
    expect(rowOf(upload!)).toMatchObject({ error_code: 'ai_off' });
    expect((await off.agent.get(`/api/resumes/${upload}`)).status).toBe(200);
    expect(importTasks()).toEqual([]);
  });

  it('a copy row that cannot be written keeps the upload and answers copyError', async () => {
    context();
    const me = await signIn(ctx!, 'no-row@example.com');
    db().exec('DROP TABLE resume_copy_backlog');
    const res = await uploadFile(me.agent, minimalPdf([resumeLines('Nadia')]), 'nadia.pdf', BATCH_QUERY);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(ResumeUploadResponseSchema.parse(res.body)).toMatchObject({
      taskId: null,
      copyError: 'The editable copy could not be started. Try again with "Make editable copy" on the uploaded resume.',
    });
    const items = (await me.agent.get('/api/resumes')).body.items as Array<{ id: string }>;
    expect(items.map((item) => item.id)).toEqual([res.body.resume.id]);
    const logged = (ctx!.deps.log as unknown as { lines: string[] }).lines;
    expect(logged.filter((entry) => entry.startsWith('error [resumes] could not put an editable copy in line'))).toHaveLength(1);
    expect(importTasks()).toEqual([]);
  });

  it('a copy asked for alone starts at once beside a batch copy, and the batch copy it covers is not made twice', async () => {
    context();
    vi.stubEnv('FAKE_CLAUDE_MODE', 'slow');
    vi.stubEnv('FAKE_CLAUDE_SLOW_MS', '400');
    const me = await signIn(ctx!, 'alone@example.com');
    const [first, second] = await uploadSeveral(me, ['First', 'Second']);
    const [lined] = line().tick();
    expect(rowOf(first!)).toMatchObject({ state: 'making', task_id: lined });

    // "Make editable copy" on the second upload: the account's other place, at once.
    const alone = await me.agent.post(`/api/resumes/${second}/parse`).set('Origin', ORIGIN).send({});
    expect(alone.status, JSON.stringify(alone.body)).toBe(202);
    expect(alone.body.taskId).not.toBe(lined);
    // Its row follows that task, so the line has nothing left to start.
    expect(rowOf(second!)).toMatchObject({ state: 'making', task_id: alone.body.taskId, retries: 0 });
    expect(line().tick()).toEqual([]);

    for (const taskId of [lined!, alone.body.taskId as string]) {
      expect((await ai().waitFor(taskId, 20_000)).status).toBe('succeeded');
    }
    expect(line().tick()).toEqual([]);
    expect(states()).toEqual(['ready', 'ready']);
    const copies = db().prepare("SELECT id, source_resume_id FROM resumes WHERE kind = 'built'").all() as Array<{ id: string; source_resume_id: string }>;
    expect(copies.map((copy) => copy.source_resume_id).sort()).toEqual([first, second].sort());
    expect(rowOf(second!)!.resume_id).toBe(copies.find((copy) => copy.source_resume_id === second)!.id);
    expect(importTasks()).toHaveLength(2);
  });

  it('a copy asked for alone that takes over a copy in line starts on the template picked for its batch, unless it names its own', async () => {
    context();
    const me = await signIn(ctx!, 'adopt-template@example.com');
    const [first, second] = await uploadSeveral(me, ['First', 'Second'], `${BATCH_QUERY}&templateId=navy-rule`);

    // "Make editable copy" (the ⋮ menu, the file page) names no template: the copy starts on its batch's.
    const alone = await me.agent.post(`/api/resumes/${first}/parse`).set('Origin', ORIGIN).send({});
    expect(alone.status, JSON.stringify(alone.body)).toBe(202);
    expect(rowOf(first!)).toMatchObject({ state: 'making', task_id: alone.body.taskId });
    // A template the request names wins.
    const named = await me.agent.post(`/api/resumes/${second}/parse`).set('Origin', ORIGIN).send({ templateId: 'navy-gold' });
    expect(named.status, JSON.stringify(named.body)).toBe(202);
    for (const taskId of [alone.body.taskId, named.body.taskId] as string[]) {
      expect((await ai().waitFor(taskId, 20_000)).status).toBe('succeeded');
    }
    expect(line().tick()).toEqual([]);
    expect(states()).toEqual(['ready', 'ready']);
    const templateOf = async (upload: string) =>
      ResumeDetailSchema.parse((await me.agent.get(`/api/resumes/${rowOf(upload)!.resume_id}`)).body).templateId;
    expect([await templateOf(first!), await templateOf(second!)]).toEqual(['navy-rule', 'navy-gold']);
  });

  it('batch copies hold at most half the AI slots, the account served least recently first', async () => {
    context({ AI_CLI_CONCURRENCY: '2' });
    const a = await signIn(ctx!, 'first@example.com');
    const b = await signIn(ctx!, 'second@example.com');
    const [a1, a2] = await uploadSeveral(a, ['A one', 'A two']);
    const [b1, b2] = await uploadSeveral(b, ['B one', 'B two']);
    // One slot of two: B's first copy goes before A's second, older one, as A was served last.
    const { order, most } = await makeAll({ stepMs: MINUTE });
    expect(order).toEqual([a1, b1, a2, b2]);
    expect(most).toBe(1);
    expect(importTasks().map((task) => task.user_id)).toEqual([a.account.id, b.account.id, a.account.id, b.account.id]);
    await getPdfService(ctx!.deps).close();
    ctx!.cleanup();

    // Two slots of four: two accounts' copies are made at once, never two of one account.
    context();
    const c = await signIn(ctx!, 'third@example.com');
    const d = await signIn(ctx!, 'fourth@example.com');
    const [c1, c2] = await uploadSeveral(c, ['C one', 'C two']);
    const [d1, d2] = await uploadSeveral(d, ['D one', 'D two']);
    const both = await makeAll();
    expect(both.order).toEqual([c1, d1, c2, d2]);
    expect(both.most).toBe(2);
  });

  it('an account does not jump the line by removing the rows of the copies it was served: after Dismiss it keeps its turn', async () => {
    context({ AI_CLI_CONCURRENCY: '2' });
    const y = await signIn(ctx!, 'why@example.com');
    const z = await signIn(ctx!, 'zed@example.com');
    const x = await signIn(ctx!, 'ex@example.com');
    const [y1, y2] = await uploadSeveral(y, ['Y one', 'Y two']);
    const [z1, z2] = await uploadSeveral(z, ['Z one', 'Z two']);
    const [x1, x2] = await uploadSeveral(x, ['X one', 'X two']);
    const order: string[] = [];
    for (let step = 0; step < 10 && rows().some((row) => row.state === 'waiting' || row.state === 'making'); step += 1) {
      for (const taskId of line().tick()) order.push(rows().find((row) => row.task_id === taskId)!.source_resume_id);
      for (const row of rows().filter((row) => row.state === 'making')) await ai().waitFor(row.task_id!, 20_000);
      ctx!.setNow(new Date(ctx!.deps.now().getTime() + MINUTE));
      // X dismisses its copies made at once, while its other copy still waits (the server takes it).
      expect((await press(x, 'dismiss')).status).toBe(200);
    }
    // One slot: each account in turn, X too, though the rows of the copies it was served are gone.
    expect(order).toEqual([y1, z1, x1, y2, z2, x2]);
  });

  it('an AI pause or a usage warning holds batch copies without counting; GET /copies says why and until when', async () => {
    context();
    const me = await signIn(ctx!, 'paused@example.com');
    const [upload] = await uploadSeveral(me, ['Nadia']);
    const provider = ai().provider;

    // A spent usage window: the copy waits for the AI pause to end, uncounted.
    vi.stubEnv('FAKE_CLAUDE_MODE', 'ratelimit');
    const [first] = line().tick();
    expect((await ai().waitFor(first!, 20_000)).error?.code).toBe('ai_unavailable');
    expect(line().tick()).toEqual([]);
    const hold = provider.holdFor('resume_import');
    expect(hold?.kind).toBe('rateLimited');
    expect(rowOf(upload!)).toMatchObject({ state: 'waiting', retries: 0, next_attempt_at: new Date(hold!.until).toISOString() });
    expect(rowOf(upload!)!.error_message).toBe(AI_ERROR_MESSAGES.rateLimited);
    const limited = await copiesView(me);
    expect(limited.items).toMatchObject([{ state: 'waiting', error: null }]);
    expect(limited.paused).toEqual({ reason: 'limit', until: expect.any(String) });
    expect(Date.parse(limited.paused!.until!)).toBeGreaterThanOrEqual(hold!.until);

    // Another AI pause (a stalled CLI): 'hold', until it ends.
    vi.stubEnv('FAKE_CLAUDE_MODE', '');
    provider.clearHolds();
    const reading = vi.spyOn(provider, 'lastRateLimit').mockReturnValue(null);
    const stalled = vi.spyOn(provider, 'activeHolds').mockReturnValue([
      { scope: 'resume_import', until: at(40 * MINUTE).getTime(), kind: 'stalled', reason: 'the CLI gave no output within 90 s' },
    ]);
    expect((await copiesView(me)).paused).toEqual({ reason: 'hold', until: at(40 * MINUTE).toISOString() });
    stalled.mockRestore();

    // A usage warning: the copies wait until the window resets, and nothing starts before.
    reading.mockReturnValue({ status: 'allowed_warning', resetsAtMs: at(90 * MINUTE).getTime(), usingOverage: false, seenAtMs: TEST_NOW.getTime() });
    expect((await copiesView(me)).paused).toEqual({ reason: 'warning', until: at(90 * MINUTE).toISOString() });
    expect(line().tick()).toEqual([]);
    ctx!.setNow(at(89 * MINUTE));
    expect(line().tick()).toEqual([]);
    expect(importTasks()).toHaveLength(1);
    ctx!.setNow(at(90 * MINUTE));
    expect((await copiesView(me)).paused).toBeNull();
    const [later] = line().tick();
    expect(later).toEqual(expect.any(String));
    expect((await ai().waitFor(later!, 20_000)).status).toBe('succeeded');
    expect(line().tick()).toEqual([]);
    expect(rowOf(upload!)).toMatchObject({ state: 'ready', retries: 0 });
    const logged = (ctx!.deps.log as unknown as { lines: string[] }).lines;
    // Once per reason (the limit's reason names the CLI's status when its reset, on the real clock, is the later one).
    expect(logged.filter((entry) => entry.startsWith('[resume-copies] editable copies wait: '))).toEqual([
      expect.stringMatching(/^\[resume-copies\] editable copies wait: the Claude usage limit was reached/),
      '[resume-copies] editable copies wait: the Claude usage limit is close',
    ]);
  });

  it('a usage limit reached outlasts its AI pause: GET /copies says the limit until the window resets, not a warning', async () => {
    context();
    const me = await signIn(ctx!, 'spent@example.com');
    await uploadSeveral(me, ['Nadia']);
    const provider = ai().provider;
    expect(provider.activeHolds()).toEqual([]);
    const reading = vi.spyOn(provider, 'lastRateLimit');
    const nowMs = ctx!.deps.now().getTime();
    const until = (minutes: number) => new Date(nowMs + minutes * MINUTE).toISOString();

    // A spent window whose AI pause (30 minutes at most) is over: the copies still wait for the reset, for the limit.
    reading.mockReturnValue({ status: 'rejected', resetsAtMs: nowMs + 180 * MINUTE, usingOverage: false, seenAtMs: nowMs - 40 * MINUTE });
    expect((await copiesView(me)).paused).toEqual({ reason: 'limit', until: until(180) });
    expect(line().tick()).toEqual([]);
    // With no reset time it waits 30 minutes from when it was seen; paid overage is the limit too.
    reading.mockReturnValue({ status: 'rejected', resetsAtMs: null, usingOverage: false, seenAtMs: nowMs - 10 * MINUTE });
    expect((await copiesView(me)).paused).toEqual({ reason: 'limit', until: until(20) });
    reading.mockReturnValue({ status: 'allowed', resetsAtMs: nowMs + 60 * MINUTE, usingOverage: true, seenAtMs: nowMs });
    expect((await copiesView(me)).paused).toEqual({ reason: 'limit', until: until(60) });
    // Only a window nearly used up is a warning.
    reading.mockReturnValue({ status: 'allowed_warning', resetsAtMs: nowMs + 60 * MINUTE, usingOverage: false, seenAtMs: nowMs });
    expect((await copiesView(me)).paused).toEqual({ reason: 'warning', until: until(60) });
    expect(importTasks()).toEqual([]);
  });

  it('a restart puts a copy back in line; the third time it fails', async () => {
    context();
    const me = await signIn(ctx!, 'restart@example.com');
    const [first, second] = await uploadSeveral(me, ['First', 'Second']);
    // Tasks the previous run left running, as ai.start() leaves them.
    const interrupted = db().prepare(
      `INSERT INTO ai_tasks(id, user_id, kind, status, priority, input, error_code, error_message, created_at, finished_at)
       VALUES (?, ?, 'resume_import', 'failed', 1, '{}', 'interrupted', ?, ?, ?)`,
    );
    const making = db().prepare("UPDATE resume_copy_backlog SET state = 'making', task_id = ?, retries = ? WHERE source_resume_id = ?");
    for (const [taskId, upload, retries] of [['t-cut-1', first, 0], ['t-cut-2', second, 2]] as const) {
      interrupted.run(taskId, me.account.id, 'The server restarted while this AI request was running. Please try again.', TEST_NOW.toISOString(), TEST_NOW.toISOString());
      making.run(taskId, retries, upload);
    }

    // The first time, the copy is put back in line and made again at once; the third time, it fails.
    const [again] = line().tick();
    expect(again).toEqual(expect.any(String));
    expect(rowOf(first!)).toMatchObject({ state: 'making', task_id: again, retries: 1 });
    expect(rowOf(second!)).toMatchObject({ state: 'failed', retries: 3, error_code: 'ai', error_message: COPY_INTERRUPTED });
    expect((await copiesView(me)).items).toMatchObject([
      { state: 'making', error: null, retryable: false },
      { state: 'failed', error: COPY_INTERRUPTED, retryable: true },
    ]);
    expect((await ai().waitFor(again!, 20_000)).status).toBe('succeeded');
    expect(line().tick()).toEqual([]);
    expect(states()).toEqual(['ready', 'failed']);
  });

  it("an outage with no AI pause is tried three times, then the copy fails with the AI's sentence and can be tried again", async () => {
    context();
    const me = await signIn(ctx!, 'outage@example.com');
    const [upload] = await uploadSeveral(me, ['Nadia']);
    vi.stubEnv('FAKE_CLAUDE_MODE', 'auth');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      ctx!.setNow(at(attempt * 5 * MINUTE));
      const [taskId] = line().tick();
      expect(taskId, `try ${attempt}`).toEqual(expect.any(String));
      expect((await ai().waitFor(taskId!, 20_000)).error?.code).toBe('ai_unavailable');
      expect(line().tick()).toEqual([]);
      expect(ai().provider.holdFor('resume_import')).toBeNull();
      if (attempt < 3) {
        expect(rowOf(upload!)).toMatchObject({ state: 'waiting', retries: attempt, next_attempt_at: at((attempt + 1) * 5 * MINUTE).toISOString() });
      }
    }
    expect(rowOf(upload!)).toMatchObject({ state: 'failed', retries: 3, error_code: 'ai' });
    expect((await copiesView(me)).items).toMatchObject([{ state: 'failed', error: AI_ERROR_MESSAGES.auth, retryable: true }]);
    expect(importTasks()).toHaveLength(3);

    // Try again: in line from the start, and made.
    vi.stubEnv('FAKE_CLAUDE_MODE', '');
    const retried = await press(me, 'retry');
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(ResumeCopiesResponseSchema.parse(retried.body).items).toMatchObject([{ state: 'waiting', error: null, retryable: false }]);
    expect(rowOf(upload!)).toMatchObject({ retries: 0, task_id: null, error_code: null, error_message: null });
    expect((await makeAll()).order).toEqual([upload]);
    expect(rowOf(upload!)).toMatchObject({ state: 'ready' });
  });

  it('a copy whose first two tries met an outage and whose third a restart does not say the server restarted three times', async () => {
    context();
    const me = await signIn(ctx!, 'mixed@example.com');
    const [upload] = await uploadSeveral(me, ['Nadia']);
    // Two outages with no AI pause (a CLI signed out)...
    vi.stubEnv('FAKE_CLAUDE_MODE', 'auth');
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      ctx!.setNow(at(attempt * 5 * MINUTE));
      const [taskId] = line().tick();
      expect((await ai().waitFor(taskId!, 20_000)).error?.code, `try ${attempt}`).toBe('ai_unavailable');
      expect(line().tick()).toEqual([]);
    }
    expect(rowOf(upload!)).toMatchObject({ state: 'waiting', retries: 2, error_message: AI_ERROR_MESSAGES.auth });
    // ...then a restart cuts off the third try (its task as ai.start() leaves it).
    ctx!.setNow(at(15 * MINUTE));
    db()
      .prepare(
        `INSERT INTO ai_tasks(id, user_id, kind, status, priority, input, error_code, error_message, created_at, finished_at)
         VALUES ('t-cut', ?, 'resume_import', 'failed', 1, '{}', 'interrupted', ?, ?, ?)`,
      )
      .run(me.account.id, 'The server restarted while this AI request was running. Please try again.', at(15 * MINUTE).toISOString(), at(15 * MINUTE).toISOString());
    db().prepare("UPDATE resume_copy_backlog SET state = 'making', task_id = 't-cut' WHERE source_resume_id = ?").run(upload);

    expect(line().tick()).toEqual([]);
    expect(rowOf(upload!)).toMatchObject({ state: 'failed', retries: 3, error_code: 'ai' });
    const [item] = (await copiesView(me)).items;
    expect(item).toMatchObject({
      state: 'failed',
      error: 'The server restarted while this copy was being made, on its third try. Try again.',
      retryable: true,
    });
    expect(item!.error).not.toMatch(/three times/);
  });

  it("Stop the rest, Try again and Dismiss act on the caller's own batch only; Try again refuses while AI is off", async () => {
    context();
    vi.stubEnv('FAKE_CLAUDE_MODE', 'slow');
    vi.stubEnv('FAKE_CLAUDE_SLOW_MS', '400');
    const me = await signIn(ctx!, 'buttons@example.com');
    const other = await signIn(ctx!, 'buttons-other@example.com');
    await uploadSeveral(me, ['One', 'Two', 'Three']);
    const [first] = line().tick();

    // Another account's buttons change nothing (and answer that account's own view).
    for (const action of ['stop', 'retry', 'dismiss'] as const) {
      const res = await press(other, action);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(ResumeCopiesResponseSchema.parse(res.body).items).toEqual([]);
    }
    expect(states()).toEqual(['making', 'waiting', 'waiting']);

    // Stop the rest: the copy being made finishes; the rest are stopped.
    const stopped = ResumeCopiesResponseSchema.parse((await press(me, 'stop')).body);
    expect(stopped.items.map((item) => [item.state, item.retryable])).toEqual([
      ['making', false],
      ['stopped', true],
      ['stopped', true],
    ]);
    expect((await ai().waitFor(first!, 20_000)).status).toBe('succeeded');
    expect(line().tick()).toEqual([]);
    expect(states()).toEqual(['ready', 'stopped', 'stopped']);

    // Try again: the stopped ones wait in line again, and are made.
    const retried = ResumeCopiesResponseSchema.parse((await press(me, 'retry')).body);
    expect(retried.items.map((item) => item.state)).toEqual(['ready', 'waiting', 'waiting']);
    expect((await makeAll()).order).toHaveLength(2);
    expect(states()).toEqual(['ready', 'ready', 'ready']);

    // Dismiss: the rows go; the copies made stay resumes.
    await press(other, 'dismiss');
    expect(rows()).toHaveLength(3);
    const dismissed = ResumeCopiesResponseSchema.parse((await press(me, 'dismiss')).body);
    expect(dismissed.items).toEqual([]);
    expect(rows()).toEqual([]);
    expect(db().prepare("SELECT count(*) AS n FROM resumes WHERE user_id = ? AND kind = 'built'").get(me.account.id)).toEqual({ n: 3 });

    // A batch id that is not one.
    for (const bad of ['short', 'not%20a%20batch', 'x'.repeat(65)]) {
      const res = await press(me, 'stop', bad);
      expect(res.status, bad).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
    }
    await getPdfService(ctx!.deps).close();
    ctx!.cleanup();

    // AI off: Try again is refused; Stop the rest and Dismiss still work.
    context({ AI_ENABLED: 'false' });
    const off = await signIn(ctx!, 'buttons-off@example.com');
    await uploadSeveral(off, ['Nadia']);
    const refused = await press(off, 'retry');
    expect(refused.status).toBe(503);
    expect(refused.body.error).toMatchObject({ code: 'ai_unavailable', message: 'AI features are turned off on this server.' });
    expect(states()).toEqual(['failed']);
    expect((await press(off, 'dismiss')).body).toEqual({ items: [], paused: { reason: 'off', until: null } });
  });

  it('deleting an upload takes its copy request with it; a copy already made stays a resume', async () => {
    context();
    const me = await signIn(ctx!, 'deletes@example.com');
    const [kept, deleted, never] = await uploadSeveral(me, ['Copy deleted', 'Upload deleted', 'Never made']);
    const remove = (id: string) => me.agent.delete(`/api/resumes/${id}`).set('Origin', ORIGIN);

    const [firstTask] = line().tick();
    await ai().waitFor(firstTask!, 20_000);
    const [secondTask] = line().tick();
    expect(rowOf(kept!)).toMatchObject({ state: 'ready' });
    // An upload whose copy still waits: deleted with its row.
    expect((await remove(never!)).status).toBe(200);
    expect(rowOf(never!)).toBeUndefined();
    await ai().waitFor(secondTask!, 20_000);
    expect(line().tick()).toEqual([]);
    expect(states()).toEqual(['ready', 'ready']);

    // The copy deleted: its row stays, with no copy to open.
    const keptCopy = rowOf(kept!)!.resume_id!;
    expect((await remove(keptCopy)).status).toBe(200);
    expect(rowOf(kept!)).toMatchObject({ state: 'ready', resume_id: null });
    expect((await copiesView(me)).items).toMatchObject([{ label: 'Copy deleted', state: 'ready', resumeId: null }, { label: 'Upload deleted' }]);

    // The upload deleted: its row goes, and its copy stays a resume.
    const deletedCopy = rowOf(deleted!)!.resume_id!;
    expect((await remove(deleted!)).status).toBe(200);
    expect(rowOf(deleted!)).toBeUndefined();
    expect((await me.agent.get(`/api/resumes/${deletedCopy}`)).body).toMatchObject({ id: deletedCopy, kind: 'built' });
    expect(rows().map((row) => row.source_resume_id)).toEqual([kept]);
  });

  it('a copy whose upload is deleted while it is made keeps its batch slot until its task ends, and still counts as served', async () => {
    context({ AI_CLI_CONCURRENCY: '2' });
    vi.stubEnv('FAKE_CLAUDE_MODE', 'slow');
    vi.stubEnv('FAKE_CLAUDE_SLOW_MS', '1500');
    const a = await signIn(ctx!, 'deletes-early@example.com');
    const b = await signIn(ctx!, 'waits-its-turn@example.com');
    const [a1, a2] = await uploadSeveral(a, ['A one', 'A two']);
    const [b1] = await uploadSeveral(b, ['B one']);
    const [first] = line().tick();
    expect(rowOf(a1!)).toMatchObject({ state: 'making', task_id: first });
    // Deleted once its task has read it: the row goes with the upload, and the copy is still made.
    await vi.waitFor(() => expect(ai().getTask(first!, null)?.status).toBe('running'), { timeout: 10_000, interval: 20 });
    expect((await a.agent.delete(`/api/resumes/${a1}`).set('Origin', ORIGIN)).status).toBe(200);
    expect(rowOf(a1!)).toBeUndefined();

    // The one batch slot (of two AI slots) stays taken while that task runs.
    expect(line().tick()).toEqual([]);
    expect((await ai().waitFor(first!, 20_000)).status).toBe('succeeded');
    // Then B, never served, goes before A's second copy.
    const { order, most } = await makeAll({ stepMs: MINUTE });
    expect(order).toEqual([b1, a2]);
    expect(most).toBe(1);
    expect(db().prepare("SELECT count(*) AS n FROM resumes WHERE user_id = ? AND kind = 'built'").get(a.account.id)).toEqual({ n: 2 });
  });

  it('the copy line starts only on start(), makes copies by itself, and stops cleanly', async () => {
    context();
    const me = await signIn(ctx!, 'timers@example.com');
    await uploadSeveral(me, ['One', 'Two']);
    // Before start(), no timer exists: a nudge does nothing.
    line().nudge();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(states()).toEqual(['waiting', 'waiting']);

    const stop = resumesFeature.start!(ctx!.deps);
    if (typeof stop !== 'function') throw new Error('the resumes feature returns a stop function');
    line().nudge();
    await vi.waitFor(() => expect(states()).toEqual(['ready', 'ready']), { timeout: 20_000, interval: 100 });
    await stop();

    // Stopped: a copy put in line waits.
    const [later] = await uploadSeveral(me, ['Later']);
    line().nudge();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(rowOf(later!)).toMatchObject({ state: 'waiting', task_id: null });
    expect(importTasks()).toHaveLength(2);
    const logged = (ctx!.deps.log as unknown as { lines: string[] }).lines;
    expect(logged).toContain('[resume-copies] editable copies of several uploads are made one at a time per account, at most 2 at once');
    // Claude's readings of the uploads (started with the line) finish before the database closes.
    await vi.waitFor(
      () => expect(db().prepare("SELECT count(*) AS n FROM ai_tasks WHERE status IN ('queued', 'running')").get()).toEqual({ n: 0 }),
      { timeout: 20_000, interval: 100 },
    );
  });

  it('while AI is off, the timer still settles the copies a previous run left being made: made, or not made for AI being off', async () => {
    context({ AI_ENABLED: 'false' });
    const me = await signIn(ctx!, 'off-making@example.com');
    const [cut, away, made] = await uploadSeveral(me, ['Cut off', 'Turned away', 'Made']);
    const copy = await me.agent.post('/api/resumes').set('Origin', ORIGIN).send({ document: { name: 'Nadia' } });
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    // As a run with AI on left them, after a restart with AI off: ai.start() fails a running task as interrupted and a
    // queued one as turned away; a task that finished just before stays as it ended.
    const task = db().prepare(
      `INSERT INTO ai_tasks(id, user_id, kind, status, priority, input, result, error_code, error_message, created_at, finished_at)
       VALUES (?, ?, 'resume_import', ?, 1, '{}', ?, ?, ?, ?, ?)`,
    );
    const now = TEST_NOW.toISOString();
    task.run('t-cut', me.account.id, 'failed', null, 'interrupted', 'The server restarted while this AI request was running. Please try again.', now, now);
    task.run('t-away', me.account.id, 'failed', null, 'ai_unavailable', 'AI features are turned off on this server.', now, now);
    task.run('t-made', me.account.id, 'succeeded', JSON.stringify({ resumeId: copy.body.id }), null, null, now, now);
    const making = db().prepare(
      "UPDATE resume_copy_backlog SET state = 'making', task_id = ?, error_code = NULL, error_message = NULL, finished_at = NULL WHERE source_resume_id = ?",
    );
    for (const [taskId, upload] of [['t-cut', cut], ['t-away', away], ['t-made', made]] as const) making.run(taskId, upload);
    expect(line().enabled).toBe(false);

    const stop = resumesFeature.start!(ctx!.deps);
    if (typeof stop !== 'function') throw new Error('the resumes feature returns a stop function');
    await vi.waitFor(() => expect(states()).toEqual(['failed', 'failed', 'ready']), { timeout: 10_000, interval: 100 });
    await stop();
    const off = 'AI features are turned off on this server.';
    expect(rows().map((row) => [row.error_code, row.error_message, row.resume_id])).toEqual([
      ['ai_off', off, null],
      ['ai_off', off, null],
      [null, null, copy.body.id],
    ]);
    // The batch has ended: Try again once AI is on, or Dismiss.
    const view = await copiesView(me);
    expect(view.items.map((item) => [item.state, item.error, item.retryable])).toEqual([
      ['failed', off, true],
      ['failed', off, true],
      ['ready', null, false],
    ]);
    expect(view.paused).toEqual({ reason: 'off', until: null });
    expect((await press(me, 'dismiss')).body).toEqual({ items: [], paused: { reason: 'off', until: null } });
    // Off, it never says it makes copies.
    const logged = (ctx!.deps.log as unknown as { lines: string[] }).lines;
    expect(logged.filter((entry) => entry.startsWith('[resume-copies]'))).toEqual([]);
  });
});
