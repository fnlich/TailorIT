import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApplicationDetailSchema,
  JOB_SORTS,
  SAVE_ALL_LIMIT,
  SaveAllPreviewSchema,
  SaveAllResponseSchema,
  searchParamsToJobsQuery,
  type ApplicationDetail,
  type SaveAllPreview,
  type SaveAllResponse,
} from '@tailorit/shared';
import { SAVE_ALL_MATCH_BUDGET_MS } from '../src/features/applications/resume-choice';
import { jobsFeature } from '../src/features/jobs/index';
import { SAVE_ALL_BUSY_MESSAGE, createSaveAll } from '../src/features/jobs/save-all';
import { SAVE_ALL_RUNS_PER_HOUR } from '../src/features/jobs/save-all-router';
import type { ResumeMatchService } from '../src/features/resume-match/types';
import { insertResume } from '../src/features/resumes/repository';
import { signIn, type TestAgent } from './auth-helpers';
import { ORIGIN, TEST_NOW, createTestContext, type TestContext } from './helpers';
import { insertApplication, insertJob } from './job-fixtures';

// Work package WP7: Save all on the Jobs page. GET /api/jobs/save-all/preview and POST /api/jobs/save-all read the
// list's filters from the query string as GET /api/jobs reads them, and save the first 100 jobs the viewer does not
// track, in the order the list shows them, through the tracker's saveJobs: the single Save's prefill and the
// best-matched resume, never an AI call. Tracked jobs keep their status; Undo is the bulk archive with onlySaved.

let ctx: TestContext | null = null;
afterEach(() => {
  vi.restoreAllMocks();
  const current = ctx;
  ctx = null;
  current?.cleanup();
});

function context(): TestContext {
  ctx = createTestContext();
  return ctx;
}

const TODAY = TEST_NOW.toISOString().slice(0, 10);
const withQuery = (path: string, qs: string) => (qs ? `${path}?${qs}` : path);

const previewOf = (agent: TestAgent, qs = '') => agent.get(withQuery('/api/jobs/save-all/preview', qs));
const postSaveAll = (agent: TestAgent, qs = '', body: object = { occurredOn: TODAY }) =>
  agent.post(withQuery('/api/jobs/save-all', qs)).set('Origin', ORIGIN).send(body);

async function preview(agent: TestAgent, qs = ''): Promise<SaveAllPreview> {
  const res = await previewOf(agent, qs);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return SaveAllPreviewSchema.parse(res.body);
}

async function saveAll(agent: TestAgent, qs = '', body?: object): Promise<SaveAllResponse> {
  const res = await postSaveAll(agent, qs, body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return SaveAllResponseSchema.parse(res.body);
}

const jobIdsOf = (result: SaveAllResponse) => result.items.map((item) => item.jobId);

/** The list as the Jobs page loads it, page after page: the job ids in the order shown, and page 1's cursor. */
async function listed(agent: TestAgent, qs = ''): Promise<{ ids: number[]; firstCursor: string | undefined }> {
  const ids: number[] = [];
  let cursor: string | undefined;
  let firstCursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const res = await agent.get(withQuery('/api/jobs', [qs, cursor ? `cursor=${encodeURIComponent(cursor)}` : ''].filter(Boolean).join('&')));
    expect(res.status).toBe(200);
    ids.push(...(res.body.items as Array<{ id: number }>).map((item) => item.id));
    cursor = res.body.nextCursor;
    if (page === 0) firstCursor = cursor;
    if (!cursor) break;
  }
  return { ids, firstCursor };
}

interface Card {
  saved: boolean;
  appliedOn: string | null;
  applicationId: string | null;
}

/** The first page of the list's cards, by job id: the saved and applied state the Jobs page shows. */
async function cards(agent: TestAgent, qs = ''): Promise<Map<number, Card>> {
  const res = await agent.get(withQuery('/api/jobs', qs));
  expect(res.status).toBe(200);
  return new Map((res.body.items as Array<Card & { id: number }>).map(({ id, saved, appliedOn, applicationId }) => [id, { saved, appliedOn, applicationId }]));
}

type Row = Record<string, unknown>;
const rowOf = (c: TestContext, id: string) => c.deps.db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as Row;
const eventsOf = (c: TestContext, id: string) =>
  c.deps.db.prepare('SELECT * FROM application_status_events WHERE application_id = ? ORDER BY status').all(id);
const count = (c: TestContext, sql: string, ...params: unknown[]) => (c.deps.db.prepare(sql).get(...params) as { n: number }).n;
const archive = (c: TestContext, id: string) =>
  c.deps.db.prepare("UPDATE applications SET archived_at = '2026-10-20T00:00:00.000Z' WHERE id = ?").run(id);
const companyOf = (c: TestContext, jobId: number) =>
  (c.deps.db.prepare('SELECT company_id FROM jobs WHERE id = ?').get(jobId) as { company_id: number }).company_id;
const aiTasks = (c: TestContext) => count(c, 'SELECT count(*) AS n FROM ai_tasks');

// ------------------------------------------------------------------------------------------------- resumes

const BACKEND_POSTING =
  '<h3>Requirements</h3><ul><li>Go and PostgreSQL services.</li><li>Kubernetes and Docker in production.</li>' +
  '<li>Kafka pipelines and gRPC APIs.</li></ul>';
const FRONTEND_POSTING =
  '<h3>Requirements</h3><ul><li>React and TypeScript apps.</li><li>CSS and HTML that scale.</li>' +
  '<li>Next.js and Redux in production.</li></ul>';
const BACKEND_TEXT = [
  'Grace Hopper',
  'Backend Engineer',
  'Experience',
  'Backend Engineer, Initech | 03/2018 - Present',
  'Runs Go and PostgreSQL services on Kubernetes and Docker.',
  'Built gRPC APIs and Kafka pipelines.',
].join('\n');
const FRONTEND_TEXT = [
  'Grace Hopper',
  'Frontend Engineer',
  'Experience',
  'Frontend Engineer, Initech | 03/2018 - Present',
  'Builds React and TypeScript apps with CSS and HTML.',
  'Ships Next.js and Redux.',
].join('\n');

function matcher(c: TestContext): ResumeMatchService {
  const service = c.deps.services.resumeMatch;
  if (!service) throw new Error('the resume match service is not registered');
  return service;
}

/** An upload as the app stores it (its rules' reading included); Claude is not asked to read it. */
function upload(c: TestContext, userId: string, text: string, title: string): string {
  return insertResume(c.deps, userId, { kind: 'uploaded', title, extractedText: text, aiRefine: false });
}

/** The real chooser with time to spare (a busy test machine may need more than a click's budget for a cold choice). */
function roomyChooser(c: TestContext) {
  const service = matcher(c);
  const real = service.chooseForJobs.bind(service);
  return vi.spyOn(service, 'chooseForJobs').mockImplementation((userId, jobIds, options) =>
    real(userId, jobIds, { ...options, budgetMs: 20_000 }),
  );
}

// ------------------------------------------------------------------------------------------------- preview

describe('GET /api/jobs/save-all/preview', () => {
  it('counts the matches, those Save all can save, and what one click saves', async () => {
    const c = context();
    const db = c.deps.db;
    const me = await signIn(c, 'preview@example.com');
    const other = await signIn(c, 'other@example.com');
    const [fresh, , saved, applied, appliedArchived, unsaved] = ['Fresh', 'Fresh too', 'Saved', 'Applied', 'Applied, archived', 'Un-saved'].map(
      (title) => insertJob(db, { title }),
    );
    insertApplication(db, me.account.id, saved!, 1);
    insertApplication(db, me.account.id, applied!, 2);
    archive(c, insertApplication(db, me.account.id, appliedArchived!, 11));
    archive(c, insertApplication(db, me.account.id, unsaved!, 1));
    // Another account's applications are its own.
    insertApplication(db, other.account.id, fresh!, 2);

    // Saveable: the two never tracked, and the un-saved one (archived while only Saved).
    expect(await preview(me.agent)).toEqual({ matched: 6, saveable: 3, willSave: 3 });
    expect(await preview(other.agent)).toEqual({ matched: 6, saveable: 5, willSave: 5 });
    // The list's own filters: a search; "Hide jobs I've applied to" leaves out the applied ones, archived too.
    expect(await preview(me.agent, 'q=fresh')).toEqual({ matched: 2, saveable: 2, willSave: 2 });
    expect(await preview(me.agent, 'hideApplied=1')).toEqual({ matched: 4, saveable: 3, willSave: 3 });
    expect(await preview(me.agent, 'q=nothing+like+it')).toEqual({ matched: 0, saveable: 0, willSave: 0 });
    // Counting writes nothing.
    expect(count(c, 'SELECT count(*) AS n FROM applications')).toBe(5);
  });
});

// ------------------------------------------------------------------------------------------------- the save

describe('POST /api/jobs/save-all', () => {
  it('saves in the order the list shows them, for every sort and for a search; the cursor is ignored', async () => {
    const c = context();
    const db = c.deps.db;
    const jobs: number[] = [];
    for (let index = 0; index < 130; index += 1) {
      jobs.push(
        insertJob(db, {
          title: `${['Data Engineer', 'Senior Data Platform Engineer', 'Product Designer'][index % 3]} ${index}`,
          // Many jobs share a date and a salary, so ties are broken by id, as the list's pages are.
          postedAt: `2026-10-${String(1 + (index % 9)).padStart(2, '0')}T00:00:00.000Z`,
          updatedAt: index % 4 === 0 ? null : `2026-10-${String(10 + (index % 7)).padStart(2, '0')}T00:00:00.000Z`,
          salary: index % 5 === 0 ? undefined : { min: 50000, max: 100000 + (index % 6) * 10000, currency: 'USD', period: 'year' },
        }),
      );
    }
    const queries = [...JOB_SORTS.map((sort) => `sort=${sort}`), 'q=data+engineer'];
    for (const [index, qs] of queries.entries()) {
      // A fresh account per list: two saved, one applied, one applied and archived, one un-saved (saveable again).
      const viewer = await signIn(c, `order-${index}@example.com`);
      const uid = viewer.account.id;
      insertApplication(db, uid, jobs[3]!, 1);
      insertApplication(db, uid, jobs[40]!, 1);
      insertApplication(db, uid, jobs[7]!, 2);
      archive(c, insertApplication(db, uid, jobs[11]!, 2));
      const unsavedId = insertApplication(db, uid, jobs[16]!, 1);
      archive(c, unsavedId);
      const tracked = new Set([jobs[3], jobs[40], jobs[7], jobs[11]]);

      const list = await listed(viewer.agent, qs);
      const saveable = list.ids.filter((id) => !tracked.has(id));
      expect(list.firstCursor, qs).toBeTruthy();
      // Page 2's cursor changes nothing: Save all starts at the top of the list.
      const result = await saveAll(viewer.agent, `${qs}&cursor=${encodeURIComponent(list.firstCursor!)}`);
      expect(jobIdsOf(result), qs).toEqual(saveable.slice(0, SAVE_ALL_LIMIT));
      expect(result, qs).toMatchObject({
        alreadyTracked: list.ids.length - saveable.length,
        remaining: Math.max(0, saveable.length - SAVE_ALL_LIMIT),
        incomplete: false,
      });
      const broughtBack = result.items.filter((item) => !item.created);
      expect(broughtBack, qs).toEqual(
        saveable.slice(0, SAVE_ALL_LIMIT).includes(jobs[16]!) ? [expect.objectContaining({ jobId: jobs[16], applicationId: unsavedId })] : [],
      );
    }
  });

  it('saves at most 100 per click; the next click saves the next ones', async () => {
    const c = context();
    const me = await signIn(c, 'cap@example.com');
    for (let index = 0; index < 105; index += 1) {
      insertJob(c.deps.db, { title: `Role ${index}`, postedAt: `2026-10-${String(1 + (index % 20)).padStart(2, '0')}T00:00:00.000Z` });
    }
    expect(await preview(me.agent)).toEqual({ matched: 105, saveable: 105, willSave: SAVE_ALL_LIMIT });
    const list = (await listed(me.agent)).ids;

    const first = await saveAll(me.agent);
    expect(jobIdsOf(first)).toEqual(list.slice(0, SAVE_ALL_LIMIT));
    expect(first).toMatchObject({ alreadyTracked: 0, remaining: 5, incomplete: false });
    expect(first.items.every((item) => item.created)).toBe(true);
    expect(await preview(me.agent)).toEqual({ matched: 105, saveable: 5, willSave: 5 });

    const second = await saveAll(me.agent);
    expect(jobIdsOf(second)).toEqual(list.slice(SAVE_ALL_LIMIT));
    expect(second).toMatchObject({ alreadyTracked: 100, remaining: 0, incomplete: false });

    expect(await saveAll(me.agent)).toEqual({ items: [], alreadyTracked: 105, remaining: 0, pendingMatches: 0, incomplete: false });
    expect(
      count(c, 'SELECT count(*) AS n FROM applications WHERE user_id = ? AND current_status = 1 AND archived_at IS NULL', me.account.id),
    ).toBe(105);
  });

  it('leaves tracked jobs as they are and brings back an un-saved one, notes and all', async () => {
    const c = context();
    const db = c.deps.db;
    const me = await signIn(c, 'tracked@example.com');
    const uid = me.account.id;
    const resume = upload(c, uid, BACKEND_TEXT, 'Backend');
    const [fresh, saved, applied, appliedArchived, unsaved] = ['Fresh', 'Saved already', 'Applied', 'Applied, archived', 'Un-saved'].map(
      (title) => insertJob(db, { title }),
    );
    const savedId = insertApplication(db, uid, saved!, 1);
    const appliedId = insertApplication(db, uid, applied!, 2);
    const appliedArchivedId = insertApplication(db, uid, appliedArchived!, 23);
    archive(c, appliedArchivedId);
    const unsavedId = insertApplication(db, uid, unsaved!, 1);
    db.prepare("UPDATE applications SET notes_html = '<p>Ask about the team</p>', favorite = 1 WHERE id = ?").run(unsavedId);
    archive(c, unsavedId);
    // A resume the person chose, and one TailorIT chose: both stay.
    db.prepare("UPDATE applications SET resume_id = ?, resume_origin = 'user' WHERE id = ?").run(resume, savedId);
    db.prepare("UPDATE applications SET resume_id = ?, resume_origin = 'auto' WHERE id = ?").run(resume, appliedId);
    db.prepare('UPDATE applications SET resume_match_due = 0').run();
    const untouched = [savedId, appliedId, appliedArchivedId];
    const before = untouched.map((id) => ({ row: rowOf(c, id), events: eventsOf(c, id) }));
    const unsavedBefore = { row: rowOf(c, unsavedId), events: eventsOf(c, unsavedId) };
    const order = (await listed(me.agent)).ids.filter((id) => id === fresh || id === unsaved);
    roomyChooser(c);

    const later = new Date(TEST_NOW.getTime() + 60 * 60_000);
    c.setNow(later);
    const result = await saveAll(me.agent);
    const expected = {
      [fresh!]: { jobId: fresh, applicationId: expect.any(String), resumeId: resume, created: true },
      [unsaved!]: { jobId: unsaved, applicationId: unsavedId, resumeId: resume, created: false },
    };
    expect(result.items).toEqual(order.map((id) => expected[id]));
    expect(result).toMatchObject({ alreadyTracked: 3, remaining: 0, pendingMatches: 0, incomplete: false });

    // Saved already, Applied, Applied and archived: every column and event as it was.
    expect(untouched.map((id) => ({ row: rowOf(c, id), events: eventsOf(c, id) }))).toEqual(before);
    // The un-saved one comes back as it was (events, tracked day, notes, favourite), with the best match.
    expect(eventsOf(c, unsavedId)).toEqual(unsavedBefore.events);
    expect(rowOf(c, unsavedId)).toEqual({
      ...unsavedBefore.row,
      archived_at: null,
      updated_at: later.toISOString(),
      resume_id: resume,
      resume_origin: 'auto',
      resume_matched_at: later.toISOString(),
      resume_match_due: 0,
    });
    const detail = ApplicationDetailSchema.parse((await me.agent.get(`/api/applications/${unsavedId}`)).body);
    expect(detail).toMatchObject({ archivedAt: null, notesHtml: '<p>Ask about the team</p>', favorite: true, trackedOn: '2026-10-19' });

    // The list reads them as the tracker has them.
    const shown = await cards(me.agent);
    expect(shown.get(fresh!)).toMatchObject({ saved: true, appliedOn: null });
    expect(shown.get(unsaved!)).toEqual({ saved: true, appliedOn: null, applicationId: unsavedId });
    expect(shown.get(saved!)).toEqual({ saved: true, appliedOn: null, applicationId: savedId });
    expect(shown.get(applied!)).toMatchObject({ saved: false, applicationId: appliedId, appliedOn: '2026-10-20' });
    expect(shown.get(appliedArchived!)).toMatchObject({ saved: false, applicationId: appliedArchivedId, appliedOn: '2026-10-20' });
  });

  it('gives each job the same prefill as a single Save from the Jobs page', async () => {
    const c = context();
    const job = insertJob(c.deps.db, {
      title: 'Staff Platform Engineer',
      company: 'Globex',
      location: 'Austin, TX',
      // No job type: full-time, as the single Save falls back to.
      type: null,
      salary: { min: 60, max: 80, currency: 'USD', period: 'hour' },
      description: '<h3>About</h3><p>Run <strong>Kubernetes</strong> for us.</p><script>alert(1)</script>',
      applyUrl: 'https://jobs.example.com/globex/1',
    });
    const single = await signIn(c, 'single@example.com');
    const bulk = await signIn(c, 'bulk@example.com');
    const res = await single.agent.post('/api/applications').set('Origin', ORIGIN).send({ jobId: job, status: 1, occurredOn: TODAY });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const one = ApplicationDetailSchema.parse(res.body);

    const [item] = (await saveAll(bulk.agent, `company=${companyOf(c, job)}`)).items;
    expect(item).toMatchObject({ jobId: job, created: true });
    const many = ApplicationDetailSchema.parse((await bulk.agent.get(`/api/applications/${item!.applicationId}`)).body);
    const prefill = ({ id: _id, resumeId: _r, resumeOrigin: _o, resumeMatchedAt: _m, resumeMatchPending: _p, ...rest }: ApplicationDetail) => rest;
    expect(prefill(many)).toEqual(prefill(one));
    expect(many).toMatchObject({
      jobId: job,
      title: 'Staff Platform Engineer',
      companyName: 'Globex',
      employmentType: 'full_time',
      postingUrl: 'https://jobs.example.com/globex/1',
      currentStatus: 1,
      trackedOn: TODAY,
      events: [{ status: 1, occurredOn: TODAY }],
    });
    expect(many.descriptionHtml).not.toContain('<script');
  });

  it('saves only the jobs the list shows: its filters, never hidden or inactive ones; accounts are separate', async () => {
    const c = context();
    const db = c.deps.db;
    const me = await signIn(c, 'filters@example.com');
    const other = await signIn(c, 'neighbour@example.com');
    const intern = insertJob(db, { title: 'Intern', type: 'internship' });
    const internToo = insertJob(db, { title: 'Intern too', type: 'internship' });
    insertJob(db, { title: 'Engineer', type: 'full_time' });
    insertJob(db, { title: 'Closed internship', type: 'internship', active: false });
    const hidden = insertJob(db, { title: 'Hidden internship', type: 'internship' });
    const spam = insertJob(db, { title: 'Spam internship', type: 'internship', company: 'Spam Corp' });
    await me.agent.post(`/api/jobs/${hidden}/hide`).set('Origin', ORIGIN).expect(200);
    await me.agent.post(`/api/companies/${companyOf(c, spam)}/hide`).set('Origin', ORIGIN).expect(200);
    // The neighbour applied to one and saved the other: theirs, and it changes nothing for me.
    const theirs = [insertApplication(db, other.account.id, intern, 2), insertApplication(db, other.account.id, internToo, 1)];
    const theirRows = theirs.map((id) => rowOf(c, id));
    const shown = (await listed(me.agent, 'type=internship')).ids;
    expect(new Set(shown)).toEqual(new Set([intern, internToo]));

    const result = await saveAll(me.agent, 'type=internship');
    expect(jobIdsOf(result)).toEqual(shown);
    expect(result).toMatchObject({ alreadyTracked: 0, remaining: 0, incomplete: false });
    expect(count(c, 'SELECT count(*) AS n FROM applications WHERE user_id = ?', me.account.id)).toBe(2);
    expect(theirs.map((id) => rowOf(c, id))).toEqual(theirRows);
    // The neighbour's Save all reads their own list: the hidden jobs are theirs to see, the tracked ones are not saveable.
    expect(await preview(other.agent, 'type=internship')).toEqual({ matched: 4, saveable: 2, willSave: 2 });
  });

  it("links each job's best-matched resume within one budget per click, and never queues AI work", async () => {
    const c = context();
    const db = c.deps.db;
    const me = await signIn(c, 'resumes@example.com');
    const frontend = upload(c, me.account.id, FRONTEND_TEXT, 'Frontend');
    const backend = upload(c, me.account.id, BACKEND_TEXT, 'Backend');
    db.prepare('UPDATE users SET default_resume_id = ? WHERE id = ?').run(frontend, me.account.id);
    const backendJobs = ['Backend Engineer', 'Platform Engineer'].map((title) => insertJob(db, { title, description: BACKEND_POSTING }));
    const frontendJob = insertJob(db, { title: 'Frontend Engineer', description: FRONTEND_POSTING });
    const chooser = roomyChooser(c);

    const result = await saveAll(me.agent);
    expect(new Map(result.items.map((item) => [item.jobId, item.resumeId]))).toEqual(
      new Map([...backendJobs.map((id) => [id, backend] as const), [frontendJob, frontend] as const]),
    );
    expect(result.pendingMatches).toBe(0);
    // Asked once (one chunk), before the writes, within Save all's budget for the click.
    expect(chooser).toHaveBeenCalledTimes(1);
    const [userId, asked, options] = chooser.mock.calls[0]!;
    expect(userId).toBe(me.account.id);
    expect([...asked].sort((a, b) => a - b)).toEqual([...backendJobs, frontendJob].sort((a, b) => a - b));
    expect(options.budgetMs).toBeGreaterThan(0);
    expect(options.budgetMs).toBeLessThanOrEqual(SAVE_ALL_MATCH_BUDGET_MS);
    for (const item of result.items) {
      const detail = ApplicationDetailSchema.parse((await me.agent.get(`/api/applications/${item.applicationId}`)).body);
      expect(detail).toMatchObject({ resumeId: item.resumeId, resumeOrigin: 'auto', resumeMatchPending: false });
    }

    // A choice not ready within the budget: the job is saved due, and the match worker links its best resume.
    const later = insertJob(db, { title: 'Backend Engineer II', description: BACKEND_POSTING });
    chooser.mockImplementation(async (_userId, jobIds) => ({ choices: new Map(), unfinished: [...jobIds] }));
    const pending = await saveAll(me.agent);
    expect(pending.items).toEqual([{ jobId: later, applicationId: expect.any(String), resumeId: null, created: true }]);
    expect(pending.pendingMatches).toBe(1);
    chooser.mockRestore();
    await matcher(c).runDue();
    expect(rowOf(c, pending.items[0]!.applicationId)).toMatchObject({ resume_id: backend, resume_origin: 'auto', resume_match_due: 0 });

    // An account with no resume: nothing to link.
    const bare = await signIn(c, 'no-resume@example.com');
    expect((await saveAll(bare.agent, 'q=frontend')).items.map((item) => item.resumeId)).toEqual([null]);
    expect(aiTasks(c)).toBe(0);
  });

  it('Undo (bulk archive with onlySaved) un-saves exactly what the click saved', async () => {
    const c = context();
    const db = c.deps.db;
    const me = await signIn(c, 'undo@example.com');
    const uid = me.account.id;
    const [first, second, third, saved, unsaved] = ['First', 'Second', 'Third', 'Saved before', 'Un-saved before'].map((title) =>
      insertJob(db, { title }),
    );
    const savedId = insertApplication(db, uid, saved!, 1);
    const unsavedId = insertApplication(db, uid, unsaved!, 1);
    db.prepare("UPDATE applications SET notes_html = '<p>Keep me</p>' WHERE id = ?").run(unsavedId);
    archive(c, unsavedId);

    const result = await saveAll(me.agent);
    expect(new Set(jobIdsOf(result))).toEqual(new Set([first, second, third, unsaved]));
    // While the toast is up, the second job is applied to.
    const secondId = result.items.find((item) => item.jobId === second)!.applicationId;
    await me.agent.put(`/api/applications/${secondId}/status`).set('Origin', ORIGIN).send({ status: 2 }).expect(200);

    const undo = await me.agent
      .post('/api/applications/bulk')
      .set('Origin', ORIGIN)
      .send({ ids: result.items.map((item) => item.applicationId), action: 'archive', onlySaved: true });
    expect(undo.status).toBe(200);
    expect(undo.body).toEqual({ affected: 3 });

    const shown = await cards(me.agent);
    for (const jobId of [first, third, unsaved]) expect(shown.get(jobId!), String(jobId)).toEqual({ saved: false, appliedOn: null, applicationId: null });
    expect(shown.get(second!)).toEqual({ saved: false, appliedOn: TODAY, applicationId: secondId });
    expect(shown.get(saved!)).toEqual({ saved: true, appliedOn: null, applicationId: savedId });
    // The brought-back one is in the archive again, notes and all; nothing was deleted.
    expect(rowOf(c, unsavedId)).toMatchObject({ notes_html: '<p>Keep me</p>', current_status: 1 });
    expect(rowOf(c, unsavedId).archived_at).not.toBeNull();
    expect(count(c, 'SELECT count(*) AS n FROM applications WHERE user_id = ?', uid)).toBe(5);
    // Save all can save them again.
    expect(await preview(me.agent)).toEqual({ matched: 5, saveable: 3, willSave: 3 });
  });

  it('checks the day: the format, a real day, not in the future; today (UTC) by default', async () => {
    const c = context();
    const db = c.deps.db;
    const me = await signIn(c, 'dates@example.com');
    const job = insertJob(db, { title: 'Dated' });

    const malformed = await postSaveAll(me.agent, '', { occurredOn: '2026-1-1' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toMatchObject({
      code: 'validation_failed',
      message: 'The request is not valid. occurredOn: Use the format YYYY-MM-DD',
      fields: { occurredOn: 'Use the format YYYY-MM-DD' },
    });
    const unreal = await postSaveAll(me.agent, '', { occurredOn: '2026-02-30' });
    expect(unreal.status).toBe(400);
    expect(unreal.body.error).toMatchObject({
      code: 'validation_failed',
      message: 'Enter a real date (YYYY-MM-DD).',
      fields: { occurredOn: 'Enter a real date (YYYY-MM-DD).' },
    });
    // TEST_NOW is noon UTC on 22 October: the 23rd is already today at UTC+14, the 24th is the future everywhere.
    const future = await postSaveAll(me.agent, '', { occurredOn: '2026-10-24' });
    expect(future.status).toBe(400);
    expect(future.body.error).toMatchObject({ code: 'validation_failed', message: "Dates can't be in the future." });
    expect(count(c, 'SELECT count(*) AS n FROM applications')).toBe(0);

    // Without a day: today (UTC).
    const [item] = (await saveAll(me.agent, '', {})).items;
    expect(item?.jobId).toBe(job);
    expect(ApplicationDetailSchema.parse((await me.agent.get(`/api/applications/${item!.applicationId}`)).body)).toMatchObject({
      trackedOn: TODAY,
      events: [{ status: 1, occurredOn: TODAY }],
    });
    // The browser's own day, ahead of UTC.
    const ahead = insertJob(db, { title: 'Dated ahead' });
    const [next] = (await saveAll(me.agent, '', { occurredOn: '2026-10-23' })).items;
    expect(next?.jobId).toBe(ahead);
    expect(rowOf(c, next!.applicationId)).toMatchObject({ tracked_on: '2026-10-23' });
  });

  it('runs one Save all per account at a time (409), from its first check to the end of the run', async () => {
    const c = context();
    const db = c.deps.db;
    const me = await signIn(c, 'busy@example.com');
    const other = await signIn(c, 'busy-other@example.com');
    for (let index = 0; index < 3; index += 1) insertJob(db, { title: `Role ${index}` });
    const query = searchParamsToJobsQuery('');

    // The guard is taken before the run's first wait, and a refused call never releases it.
    const service = createSaveAll(c.deps);
    const first = service.run(me.account.id, query, TODAY);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(service.run(me.account.id, query, TODAY)).rejects.toMatchObject({
        code: 'conflict',
        status: 409,
        message: SAVE_ALL_BUSY_MESSAGE,
      });
    }
    // A day that is not real is refused as such.
    await expect(service.run(me.account.id, query, '2026-02-30')).rejects.toMatchObject({ code: 'validation_failed' });
    // Other accounts are not held up.
    expect((await service.run(other.account.id, query, TODAY)).items).toHaveLength(3);
    expect((await first).items).toHaveLength(3);
    // Once it ended, the account can run again; a run that fails lets go too.
    expect(await service.run(me.account.id, query, TODAY)).toMatchObject({ items: [], alreadyTracked: 3 });
    insertJob(db, { title: 'Role 3' });
    db.exec(`CREATE TEMP TRIGGER refuse_all BEFORE INSERT ON applications BEGIN SELECT RAISE(ABORT, 'the disk is full'); END`);
    await expect(service.run(me.account.id, query, TODAY)).rejects.toThrow('the disk is full');
    db.exec('DROP TRIGGER refuse_all');
    expect((await service.run(me.account.id, query, TODAY)).items).toHaveLength(1);

    // Over HTTP: a second click while the first is still choosing resumes answers 409.
    insertJob(db, { title: 'Role 4' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const choosing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(matcher(c), 'chooseForJobs').mockImplementation(async (_userId, jobIds) => {
      entered();
      await gate;
      return { choices: new Map(), unfinished: [...jobIds] };
    });
    const firstClick = postSaveAll(me.agent).then((res) => res);
    await choosing;
    const secondClick = await postSaveAll(me.agent);
    expect(secondClick.status).toBe(409);
    expect(secondClick.body.error).toMatchObject({ code: 'conflict', message: SAVE_ALL_BUSY_MESSAGE });
    release();
    const done = await firstClick;
    expect(done.status).toBe(200);
    expect(SaveAllResponseSchema.parse(done.body)).toMatchObject({ items: [expect.objectContaining({ created: true })], pendingMatches: 1 });
  });

  it('keeps what was saved when it stops part-way (200, incomplete, logged); a failing first chunk saves nothing (500)', async () => {
    const c = context();
    const db = c.deps.db;
    const me = await signIn(c, 'partway@example.com');
    for (let index = 0; index < 30; index += 1) insertJob(db, { title: `Role ${index}` });
    const list = (await listed(me.agent)).ids;

    // The 30th insert fails (a trigger stands in for a full disk), so the second chunk of 25 rolls back.
    db.exec(
      `CREATE TEMP TRIGGER fail_30th BEFORE INSERT ON applications WHEN (SELECT count(*) FROM applications) >= 29
       BEGIN SELECT RAISE(ABORT, 'the disk is full'); END`,
    );
    const result = await saveAll(me.agent);
    expect(result).toMatchObject({ incomplete: true, alreadyTracked: 0, remaining: 5 });
    expect(jobIdsOf(result)).toEqual(list.slice(0, 25));
    const stored = db.prepare('SELECT id FROM applications WHERE user_id = ?').all(me.account.id) as Array<{ id: string }>;
    expect(new Set(stored.map((row) => row.id))).toEqual(new Set(result.items.map((item) => item.applicationId)));
    const lines = (c.deps.log as unknown as { lines: string[] }).lines;
    expect(
      lines.some((line) => line.startsWith('error [jobs] Save all stopped part-way') && line.includes('25 of 30') && line.includes('the disk is full')),
    ).toBe(true);

    // The first chunk fails: nothing is saved, and the answer is the generic 500.
    db.exec('DROP TRIGGER fail_30th');
    db.exec(`CREATE TEMP TRIGGER fail_all BEFORE INSERT ON applications BEGIN SELECT RAISE(ABORT, 'the disk is full'); END`);
    const failed = await postSaveAll(me.agent);
    expect(failed.status).toBe(500);
    expect(failed.body.error).toMatchObject({ code: 'internal', message: 'Something went wrong on our side. Please try again.' });
    expect(count(c, 'SELECT count(*) AS n FROM applications')).toBe(25);

    // Save all again saves the rest.
    db.exec('DROP TRIGGER fail_all');
    const rest = await saveAll(me.agent);
    expect(jobIdsOf(rest)).toEqual(list.slice(25));
    expect(rest).toMatchObject({ incomplete: false, alreadyTracked: 25, remaining: 0 });
  });

  it('allows 20 runs per account per hour (429 with retryAfterSeconds); refusals do not count', async () => {
    const c = context();
    const me = await signIn(c, 'limit@example.com');
    const other = await signIn(c, 'limit-other@example.com');
    insertJob(c.deps.db, { title: 'The only job' });

    // A refused request is not a run.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await postSaveAll(me.agent, '', { occurredOn: '2026-02-30' })).status).toBe(400);
    }
    for (let run = 1; run <= SAVE_ALL_RUNS_PER_HOUR; run += 1) {
      const res = await postSaveAll(me.agent);
      expect(res.status, `run ${run}: ${JSON.stringify(res.body)}`).toBe(200);
    }
    const refused = await postSaveAll(me.agent);
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe('rate_limited');
    expect(refused.body.error.message).toMatch(/^Save all can run 20 times an hour\. Please wait \d+ minutes? and try again\.$/);
    expect(refused.body.error.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.body.error.retryAfterSeconds).toBeLessThanOrEqual(60 * 60);
    expect(refused.headers['retry-after']).toBe(String(refused.body.error.retryAfterSeconds));
    // The preview still answers, and another account still runs.
    expect((await previewOf(me.agent)).status).toBe(200);
    expect((await postSaveAll(other.agent)).status).toBe(200);
  });
});

// ------------------------------------------------------------------------------------------------- routing

describe('the Save all routes', () => {
  it("are mounted ahead of the jobs router, so its /:id never captures them; they need a session and the app's Origin", async () => {
    const paths = (jobsFeature.routes ?? []).map((route) => route.path);
    expect(paths.indexOf('/api/jobs/save-all')).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf('/api/jobs/save-all')).toBeLessThan(paths.indexOf('/api/jobs'));

    const c = context();
    const me = await signIn(c, 'routes@example.com');
    insertJob(c.deps.db, { title: 'Routed' });
    const previewRes = await previewOf(me.agent);
    expect(previewRes.status).toBe(200);
    expect(SaveAllPreviewSchema.strict().parse(previewRes.body)).toEqual({ matched: 1, saveable: 1, willSave: 1 });
    const saved = await postSaveAll(me.agent);
    expect(saved.status).toBe(200);
    expect(SaveAllResponseSchema.strict().parse(saved.body)).toMatchObject({ alreadyTracked: 0, remaining: 0, incomplete: false });
    expect(saved.body.items).toHaveLength(1);
    // Paths of their own under /api/jobs/save-all that Save all does not answer still reach the jobs router.
    expect((await me.agent.get('/api/jobs/save-all')).body.error).toMatchObject({ code: 'not_found', message: 'That job was not found.' });

    for (const res of [
      await request(c.app).get('/api/jobs/save-all/preview'),
      await request(c.app).post('/api/jobs/save-all').set('Origin', ORIGIN).send({}),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('not_signed_in');
    }
    const foreign = await me.agent.post('/api/jobs/save-all').set('Origin', 'https://elsewhere.example.com').send({});
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe('bad_origin');
    expect(count(c, 'SELECT count(*) AS n FROM applications')).toBe(1);
  });
});
