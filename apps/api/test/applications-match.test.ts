import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationDetailSchema, type ApplicationDetail } from '@tailorit/shared';
import { resumeChooser, SINGLE_SAVE_MATCH_BUDGET_MS } from '../src/features/applications/resume-choice';
import { createApplication, saveJobs, type ChooseResumes } from '../src/features/applications/service';
import type { ResumeMatchService } from '../src/features/resume-match/types';
import { deleteResumeRow, insertResume } from '../src/features/resumes/repository';
import { signIn, type TestAgent } from './auth-helpers';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';
import { insertApplication, insertJob } from './job-fixtures';

// Work package WP6: the tracker's writes of a saved job's resume. Saving a job at Saved with no resume named links
// TailorIT's best match (origin 'auto'), chosen before the write; a resume the person names, or "none", is theirs
// ('user'); Applied and later get none. The due flag hands unfinished choices to the match worker: set on a save
// without a choice, on restore and on a move back to Saved; cleared by archiving, moving on and the person's choice.
// Save all's writes (`saveJobs`): chunks, choices asked outside the writes, items counted only once committed.

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
const HOUR = 60 * 60_000;
const at = (ms: number) => new Date(TEST_NOW.getTime() + ms);

const BACKEND_POSTING =
  '<h3>Requirements</h3><ul><li>Go and PostgreSQL services.</li><li>Kubernetes and Docker in production.</li>' +
  '<li>Kafka pipelines and gRPC APIs.</li></ul>';
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

function backendJob(c: TestContext, title = 'Backend Engineer'): number {
  return insertJob(c.deps.db, { title, description: BACKEND_POSTING });
}

/**
 * The real chooser with time to spare: the single save allows SINGLE_SAVE_MATCH_BUDGET_MS, which a busy test
 * machine may need for a cold first choice. The budget each call asked for stays in the spy's calls.
 */
function roomyChooser(c: TestContext) {
  const service = matcher(c);
  const real = service.chooseForJobs.bind(service);
  return vi.spyOn(service, 'chooseForJobs').mockImplementation((userId, jobIds, options) =>
    real(userId, jobIds, { ...options, budgetMs: 20_000 }),
  );
}

function save(agent: TestAgent, body: object) {
  return agent.post('/api/applications').set('Origin', ORIGIN).send(body);
}

async function saved(agent: TestAgent, body: object, status = 201): Promise<ApplicationDetail> {
  const res = await save(agent, body);
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return ApplicationDetailSchema.parse(res.body);
}

interface MatchState {
  resume_id: string | null;
  resume_origin: string | null;
  resume_matched_at: string | null;
  resume_match_due: number;
  current_status: number;
  archived_at: string | null;
  updated_at: string;
}

function stateOf(c: TestContext, id: string): MatchState {
  return c.deps.db
    .prepare(
      'SELECT resume_id, resume_origin, resume_matched_at, resume_match_due, current_status, archived_at, updated_at FROM applications WHERE id = ?',
    )
    .get(id) as MatchState;
}

function count(c: TestContext, sql: string, ...params: unknown[]): number {
  return (c.deps.db.prepare(sql).get(...params) as { n: number }).n;
}

const aiTasks = (c: TestContext) => count(c, 'SELECT count(*) AS n FROM ai_tasks');

// ------------------------------------------------------------------------------------------------- single save

describe('saving one job (POST /api/applications with a jobId)', () => {
  it('{jobId, status:1} links the best match (auto), also when it is not the default resume', async () => {
    const c = context();
    const { account, agent } = await signIn(c, 'save@example.com');
    const frontend = upload(c, account.id, FRONTEND_TEXT, 'Frontend');
    const backend = upload(c, account.id, BACKEND_TEXT, 'Backend');
    c.deps.db.prepare('UPDATE users SET default_resume_id = ? WHERE id = ?').run(frontend, account.id);
    const job = backendJob(c);
    const chooser = roomyChooser(c);
    const nudge = vi.spyOn(matcher(c), 'nudge');

    const detail = await saved(agent, { jobId: job, status: 1 });
    expect(detail).toMatchObject({
      jobId: job,
      currentStatus: 1,
      resumeId: backend,
      resumeOrigin: 'auto',
      resumeMatchedAt: TEST_NOW.toISOString(),
      resumeMatchPending: false,
    });
    // Asked once, before the write, within the single save's budget; read-only, no AI.
    expect(chooser.mock.calls).toEqual([[account.id, [job], { budgetMs: SINGLE_SAVE_MATCH_BUDGET_MS }]]);
    expect(stateOf(c, detail.id)).toMatchObject({ resume_id: backend, resume_origin: 'auto', resume_match_due: 0 });
    expect(nudge).not.toHaveBeenCalled();
    expect(aiTasks(c)).toBe(0);

    // Saving it again returns the same application, untouched, without asking.
    const again = await saved(agent, { jobId: job, status: 1 }, 200);
    expect(again).toMatchObject({ id: detail.id, resumeId: backend, resumeOrigin: 'auto', resumeMatchedAt: TEST_NOW.toISOString() });
    expect(chooser).toHaveBeenCalledTimes(1);

    // A resume named in the request is the person's choice, kept as named and never changed automatically.
    const named = await saved(agent, { jobId: backendJob(c, 'Platform Engineer'), status: 1, resumeId: frontend });
    expect(named).toMatchObject({ resumeId: frontend, resumeOrigin: 'user', resumeMatchedAt: TEST_NOW.toISOString(), resumeMatchPending: false });
    expect(chooser).toHaveBeenCalledTimes(1);
    c.deps.db.prepare('UPDATE applications SET resume_match_due = 1 WHERE id = ?').run(named.id);
    await matcher(c).runDue();
    expect(stateOf(c, named.id)).toMatchObject({ resume_id: frontend, resume_origin: 'user', resume_match_due: 0 });

    // Another account's resume is refused, as before.
    const stranger = await signIn(c, 'stranger@example.com');
    const theirs = upload(c, stranger.account.id, BACKEND_TEXT, 'Theirs');
    const refused = await save(agent, { jobId: backendJob(c, 'Site Reliability Engineer'), status: 1, resumeId: theirs });
    expect(refused.status).toBe(404);
    expect(refused.body.error.message).toBe('That resume was not found.');
  });

  it("null and '' mean the person's none (origin user); without a job, no resume named is nobody's choice", async () => {
    const c = context();
    const { account, agent } = await signIn(c, 'none@example.com');
    upload(c, account.id, BACKEND_TEXT, 'Backend');
    const chooser = roomyChooser(c);

    const ids: string[] = [];
    for (const resumeId of [null, '']) {
      const detail = await saved(agent, { jobId: backendJob(c, `Backend Engineer ${ids.length}`), status: 1, resumeId });
      expect(detail).toMatchObject({ resumeId: null, resumeOrigin: 'user', resumeMatchedAt: TEST_NOW.toISOString(), resumeMatchPending: false });
      ids.push(detail.id);
    }
    expect(chooser).not.toHaveBeenCalled();
    // The worker leaves the person's "none" alone even when asked to look again.
    c.deps.db.prepare('UPDATE applications SET resume_match_due = 1').run();
    await matcher(c).runDue();
    for (const id of ids) expect(stateOf(c, id)).toMatchObject({ resume_id: null, resume_origin: 'user', resume_match_due: 0 });

    // Added by hand (the Add sheet): untouched, nothing is sent and nobody chose; an explicit None is the person's.
    const manual = { title: 'Data Engineer', companyName: 'Initech', employmentType: 'full_time', status: 1 };
    expect(await saved(agent, manual)).toMatchObject({ jobId: null, resumeId: null, resumeOrigin: null, resumeMatchedAt: null, resumeMatchPending: false });
    expect(await saved(agent, { ...manual, resumeId: null })).toMatchObject({ resumeId: null, resumeOrigin: 'user', resumeMatchPending: false });
    expect(chooser).not.toHaveBeenCalled();
  });

  it('status 2 gets none: Applied and later are never matched; a saved job applied to keeps its resume', async () => {
    const c = context();
    const { account, agent } = await signIn(c, 'applied@example.com');
    const backend = upload(c, account.id, BACKEND_TEXT, 'Backend');
    const chooser = roomyChooser(c);

    for (const body of [{ status: 2 }, {}, { status: 12 }]) {
      const detail = await saved(agent, { jobId: backendJob(c, `Applied ${JSON.stringify(body)}`), ...body });
      expect(detail.currentStatus).toBeGreaterThanOrEqual(2);
      expect(detail).toMatchObject({ resumeId: null, resumeOrigin: null, resumeMatchPending: false });
      expect(stateOf(c, detail.id).resume_match_due).toBe(0);
    }
    expect(chooser).not.toHaveBeenCalled();

    // Saved first (matched), then applied to: the resume TailorIT chose stays, and it is no longer TailorIT's to change.
    const job = backendJob(c);
    const first = await saved(agent, { jobId: job, status: 1 });
    expect(first.resumeId).toBe(backend);
    const moved = await saved(agent, { jobId: job, status: 2 }, 200);
    expect(moved).toMatchObject({ id: first.id, currentStatus: 2, resumeId: backend, resumeOrigin: 'auto', resumeMatchPending: false });
    expect(chooser).toHaveBeenCalledTimes(1);
    upload(c, account.id, `${BACKEND_TEXT}\nAlso Terraform and Redis.`, 'Backend 2');
    expect(stateOf(c, first.id).resume_match_due).toBe(0);
    expect(aiTasks(c)).toBe(0);
  });

  it('a brought-back Saved-only application is filled; one with a resume keeps it', async () => {
    const c = context();
    const { account, agent } = await signIn(c, 'back@example.com');
    const job = backendJob(c);
    const chooser = roomyChooser(c);
    const post = (path: string, body?: object) => agent.post(path).set('Origin', ORIGIN).send(body);

    // Saved while the account had no resume (TailorIT chose none), noted, then un-saved.
    const first = await saved(agent, { jobId: job, status: 1 });
    expect(first).toMatchObject({ resumeId: null, resumeOrigin: null, resumeMatchPending: false });
    await agent.patch(`/api/applications/${first.id}`).set('Origin', ORIGIN).send({ notesHtml: '<p>Ask about the team</p>' }).expect(200);
    await post(`/api/applications/${first.id}/archive`).expect(200);

    // Resumes arrive; saving the job again brings the application back with the best of them.
    const frontend = upload(c, account.id, FRONTEND_TEXT, 'Frontend');
    const backend = upload(c, account.id, BACKEND_TEXT, 'Backend');
    c.setNow(at(HOUR));
    const back = await saved(agent, { jobId: job, status: 1 }, 200);
    expect(back).toMatchObject({
      id: first.id,
      archivedAt: null,
      notesHtml: '<p>Ask about the team</p>',
      events: first.events,
      resumeId: backend,
      resumeOrigin: 'auto',
      resumeMatchedAt: at(HOUR).toISOString(),
      resumeMatchPending: false,
    });
    expect(chooser).toHaveBeenCalledTimes(2);

    // Un-saved again: TailorIT's resume is kept without asking; the worker looks again (it may have changed).
    await post(`/api/applications/${first.id}/archive`).expect(200);
    const kept = await saved(agent, { jobId: job, status: 1 }, 200);
    expect(kept).toMatchObject({ id: first.id, archivedAt: null, resumeId: backend, resumeOrigin: 'auto', resumeMatchPending: true });
    expect(chooser).toHaveBeenCalledTimes(2);
    await matcher(c).runDue();
    expect(stateOf(c, first.id)).toMatchObject({ resume_id: backend, resume_origin: 'auto', resume_match_due: 0 });

    // The person's choice comes back as it was: a resume, or none.
    for (const resumeId of [backend, null]) {
      await agent.patch(`/api/applications/${first.id}`).set('Origin', ORIGIN).send({ resumeId }).expect(200);
      await post(`/api/applications/${first.id}/archive`).expect(200);
      const theirs = await saved(agent, { jobId: job, status: 1 }, 200);
      expect(theirs).toMatchObject({ id: first.id, archivedAt: null, resumeId, resumeOrigin: 'user', resumeMatchPending: false });
    }
    // Saved again with a resume named: the person's choice, as for a new application.
    await post(`/api/applications/${first.id}/archive`).expect(200);
    c.setNow(at(2 * HOUR));
    const renamed = await saved(agent, { jobId: job, status: 1, resumeId: frontend }, 200);
    expect(renamed).toMatchObject({ id: first.id, resumeId: frontend, resumeOrigin: 'user', resumeMatchedAt: at(2 * HOUR).toISOString() });
    // An application already tracked keeps its resume whatever a save names (the detail's Documents tab changes it).
    expect(await saved(agent, { jobId: job, status: 1, resumeId: null }, 200)).toMatchObject({ resumeId: frontend, resumeOrigin: 'user' });
    expect(chooser).toHaveBeenCalledTimes(2);

    // An archived application that reached Applied comes back (the single save restores any status), with no resume.
    const appliedJob = backendJob(c, 'Applied, then archived');
    const applied = insertApplication(c.deps.db, account.id, appliedJob, 2);
    c.deps.db.prepare('UPDATE applications SET archived_at = ? WHERE id = ?').run(TEST_NOW.toISOString(), applied);
    const restored = await saved(agent, { jobId: appliedJob, status: 1 }, 200);
    expect(restored).toMatchObject({ id: applied, archivedAt: null, currentStatus: 2, resumeId: null, resumeMatchPending: false });
    expect(chooser).toHaveBeenCalledTimes(2);
  });

  it('a chooser that does not finish saves the job due and wakes the worker; runDue links the best match', async () => {
    const c = context();
    const { account, agent } = await signIn(c, 'slow@example.com');
    upload(c, account.id, FRONTEND_TEXT, 'Frontend');
    const backend = upload(c, account.id, BACKEND_TEXT, 'Backend');
    const service = matcher(c);
    const real = service.chooseForJobs.bind(service);
    // The budget is spent before the first job is reached.
    const chooser = vi
      .spyOn(service, 'chooseForJobs')
      .mockImplementation((userId, jobIds, options) => real(userId, jobIds, { ...options, budgetMs: 0 }));
    const nudge = vi.spyOn(service, 'nudge');

    const slow = await saved(agent, { jobId: backendJob(c), status: 1 });
    expect(slow).toMatchObject({ resumeId: null, resumeOrigin: null, resumeMatchedAt: null, resumeMatchPending: true });
    expect(chooser).toHaveBeenCalledTimes(1);
    expect(nudge).toHaveBeenCalledTimes(1);
    expect(stateOf(c, slow.id).resume_match_due).toBe(1);
    expect(await service.runDue()).toBe(1);
    expect(ApplicationDetailSchema.parse((await agent.get(`/api/applications/${slow.id}`)).body)).toMatchObject({
      resumeId: backend,
      resumeOrigin: 'auto',
      resumeMatchPending: false,
    });

    // A chooser that throws never fails the save: it is logged, and the job is saved due.
    chooser.mockRejectedValueOnce(new Error('the matcher fell over'));
    const failed = await saved(agent, { jobId: backendJob(c, 'Platform Engineer'), status: 1 });
    expect(failed).toMatchObject({ resumeId: null, resumeMatchPending: true });
    const lines = (c.deps.log as unknown as { lines: string[] }).lines;
    expect(lines.some((line) => line.includes('could not choose resumes') && line.includes('the matcher fell over'))).toBe(true);

    // A choice whose resume was deleted before the write is not linked: the guard refuses it, the job stays due.
    const late = backendJob(c, 'Site Reliability Engineer');
    const gone = upload(c, account.id, BACKEND_TEXT, 'Soon gone');
    chooser.mockImplementationOnce(async () => {
      deleteResumeRow(c.deps, account.id, gone);
      return { choices: new Map([[late, { jobId: late, resumeId: gone, fit: 90, reason: 'best' as const }]]), unfinished: [] };
    });
    const refused = await saved(agent, { jobId: late, status: 1 });
    expect(refused).toMatchObject({ resumeId: null, resumeOrigin: null, resumeMatchPending: true });

    // A save that comes with no choice at all (the demo seed calls the service directly) is due as well.
    const direct = createApplication(c.deps, account.id, { jobId: backendJob(c, 'Data Engineer'), status: 1 });
    expect(direct.detail).toMatchObject({ resumeId: null, resumeOrigin: null, resumeMatchPending: true });
    await service.runDue();
    for (const id of [failed.id, refused.id, direct.detail.id]) {
      expect(stateOf(c, id)).toMatchObject({ resume_id: backend, resume_origin: 'auto', resume_match_due: 0 });
    }
    expect(aiTasks(c)).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------- other writes

describe('the other writes of the resume choice', () => {
  it("PATCH sets the person's choice: origin user, chosen now, never due or changed by TailorIT", async () => {
    const c = context();
    const { account, agent } = await signIn(c, 'patch@example.com');
    const frontend = upload(c, account.id, FRONTEND_TEXT, 'Frontend');
    const backend = upload(c, account.id, BACKEND_TEXT, 'Backend');
    roomyChooser(c);
    const first = await saved(agent, { jobId: backendJob(c), status: 1 });
    expect(first).toMatchObject({ resumeId: backend, resumeOrigin: 'auto' });
    const patch = (body: object) => agent.patch(`/api/applications/${first.id}`).set('Origin', ORIGIN).send(body);

    // An edit that names no resume leaves TailorIT's choice as it is.
    expect((await patch({ notesHtml: '<p>Recruiter: Sam</p>' })).body).toMatchObject({ resumeId: backend, resumeOrigin: 'auto' });

    c.deps.db.prepare('UPDATE applications SET resume_match_due = 1 WHERE id = ?').run(first.id);
    c.setNow(at(HOUR));
    const picked = await patch({ resumeId: frontend });
    expect(picked.status).toBe(200);
    expect(ApplicationDetailSchema.parse(picked.body)).toMatchObject({
      resumeId: frontend,
      resumeOrigin: 'user',
      resumeMatchedAt: at(HOUR).toISOString(),
      resumeMatchPending: false,
      updatedAt: at(HOUR).toISOString(),
    });
    // Nothing TailorIT notices later changes it: a new resume, the worker.
    upload(c, account.id, `${BACKEND_TEXT}\nAlso Terraform and Redis.`, 'Backend 2');
    expect(stateOf(c, first.id).resume_match_due).toBe(0);
    await matcher(c).runDue();
    expect(stateOf(c, first.id)).toMatchObject({ resume_id: frontend, resume_origin: 'user', resume_match_due: 0 });

    // Removing it is the person's "none"; another account's resume is refused.
    c.setNow(at(2 * HOUR));
    expect((await patch({ resumeId: null })).body).toMatchObject({
      resumeId: null,
      resumeOrigin: 'user',
      resumeMatchedAt: at(2 * HOUR).toISOString(),
    });
    const stranger = await signIn(c, 'stranger@example.com');
    const refused = await patch({ resumeId: upload(c, stranger.account.id, BACKEND_TEXT, 'Theirs') });
    expect(refused.status).toBe(404);
    expect(stateOf(c, first.id)).toMatchObject({ resume_id: null, resume_origin: 'user' });
  });

  it('restoring, or moving back to Saved, marks the job due again; archiving or moving on clears it', async () => {
    const c = context();
    const db = c.deps.db;
    const { account, agent } = await signIn(c, 'due@example.com');
    upload(c, account.id, FRONTEND_TEXT, 'Frontend');
    const backend = upload(c, account.id, BACKEND_TEXT, 'Backend');
    roomyChooser(c);
    const nudge = vi.spyOn(matcher(c), 'nudge');
    const post = (path: string, body?: object) => agent.post(path).set('Origin', ORIGIN).send(body);
    const status = (id: string, value: number) => agent.put(`/api/applications/${id}/status`).set('Origin', ORIGIN).send({ status: value });
    const bulk = (body: object) => post('/api/applications/bulk', body);
    const id = (await saved(agent, { jobId: backendJob(c), status: 1 })).id;
    const due = () => stateOf(c, id).resume_match_due;
    expect(due()).toBe(0);

    // Un-saved (archived), then Undo (restored): due again, and the worker is woken.
    db.prepare('UPDATE applications SET resume_match_due = 1 WHERE id = ?').run(id);
    await post(`/api/applications/${id}/archive`).expect(200);
    expect(due()).toBe(0);
    const restored = await post(`/api/applications/${id}/restore`).expect(200);
    expect(restored.body).toMatchObject({ archivedAt: null, resumeId: backend, resumeOrigin: 'auto', resumeMatchPending: true });
    expect(nudge).toHaveBeenCalledTimes(1);
    await matcher(c).runDue();
    expect(stateOf(c, id)).toMatchObject({ resume_id: backend, resume_origin: 'auto', resume_match_due: 0 });

    // Moved on: no longer TailorIT's to choose (the resume stays). Moved back to Saved: due again.
    db.prepare('UPDATE applications SET resume_match_due = 1 WHERE id = ?').run(id);
    expect((await status(id, 2)).body.currentStatus).toBe(2);
    expect(stateOf(c, id)).toMatchObject({ resume_id: backend, resume_match_due: 0 });
    expect((await status(id, 1)).body.currentStatus).toBe(1);
    expect(due()).toBe(1);
    await matcher(c).runDue();
    // Clearing the Applied date moves it back to Saved as well.
    await status(id, 2).expect(200);
    expect(due()).toBe(0);
    expect((await agent.delete(`/api/applications/${id}/events/2`).set('Origin', ORIGIN)).body.currentStatus).toBe(1);
    expect(due()).toBe(1);
    // Manage jobs does the same.
    await bulk({ ids: [id], action: 'status', status: 11 }).expect(200);
    expect(due()).toBe(0);
    await bulk({ ids: [id], action: 'status', status: 1 }).expect(200);
    expect(due()).toBe(1);
    await bulk({ ids: [id], action: 'archive' }).expect(200);
    expect(due()).toBe(0);
    await bulk({ ids: [id], action: 'unarchive' }).expect(200);
    expect(due()).toBe(1);
    // Moved back to Saved while archived: due only once it is restored.
    await bulk({ ids: [id], action: 'status', status: 2 }).expect(200);
    await post(`/api/applications/${id}/archive`).expect(200);
    await status(id, 1).expect(200);
    expect(stateOf(c, id)).toMatchObject({ current_status: 1, resume_match_due: 0 });
    await post(`/api/applications/${id}/restore`).expect(200);
    expect(due()).toBe(1);
    expect(nudge.mock.calls.length).toBeGreaterThan(1);

    // Never for the person's choice, or an application added by hand.
    await agent.patch(`/api/applications/${id}`).set('Origin', ORIGIN).send({ resumeId: backend }).expect(200);
    const manual = await saved(agent, { title: 'Data Engineer', companyName: 'Initech', employmentType: 'full_time', status: 1 });
    for (const other of [id, manual.id]) {
      await post(`/api/applications/${other}/archive`).expect(200);
      await post(`/api/applications/${other}/restore`).expect(200);
      await status(other, 2).expect(200);
      await status(other, 1).expect(200);
      expect(stateOf(c, other).resume_match_due).toBe(0);
    }
    expect(aiTasks(c)).toBe(0);
  });

  it("bulk archive with onlySaved (Save all's Undo) archives only what is still Saved", async () => {
    const c = context();
    const { agent } = await signIn(c, 'undo@example.com');
    const bulk = (body: object) => agent.post('/api/applications/bulk').set('Origin', ORIGIN).send(body);
    const ids: string[] = [];
    for (const title of ['One', 'Two', 'Three']) ids.push((await saved(agent, { jobId: backendJob(c, title), status: 1 })).id);
    // One of them was applied to in the meantime.
    await agent.put(`/api/applications/${ids[1]}/status`).set('Origin', ORIGIN).send({ status: 2 }).expect(200);

    expect((await bulk({ ids: [...ids, 'not-mine'], action: 'archive', onlySaved: true })).body).toEqual({ affected: 2 });
    expect(ids.map((id) => stateOf(c, id).archived_at !== null)).toEqual([true, false, true]);
    expect(stateOf(c, ids[1]!)).toMatchObject({ current_status: 2, archived_at: null });
    // Without the flag, archiving takes every one, as before.
    expect((await bulk({ ids, action: 'archive' })).body).toEqual({ affected: 3 });
    expect(stateOf(c, ids[1]!).archived_at).not.toBeNull();
    // The flag is for archiving only.
    const refused = await bulk({ ids, action: 'unarchive', onlySaved: true });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields).toEqual({ onlySaved: 'Only archiving can be limited to Saved jobs' });
  });
});

// ------------------------------------------------------------------------------------------------- Save all's writes

describe('saveJobs (Save all)', () => {
  const noChoices: ChooseResumes = async () => ({ choices: new Map() });

  it('saves in chunks of 25 (fewer once preparing takes its time), asking the chooser outside the writes', async () => {
    const c = context();
    const db = c.deps.db;
    const { account } = await signIn(c, 'chunks@example.com');
    const jobs = Array.from({ length: 60 }, (_, index) => insertJob(db, { title: `Role ${index}` }));
    const asked: number[][] = [];
    const inTransaction: boolean[] = [];
    const chooseResumes: ChooseResumes = async (jobIds) => {
      asked.push([...jobIds]);
      inTransaction.push(db.inTransaction);
      return { choices: new Map() };
    };
    const nudge = vi.spyOn(matcher(c), 'nudge');

    const result = await saveJobs(c.deps, account.id, [...jobs, jobs[0]!, jobs[7]!], {
      occurredOn: TODAY,
      chooseResumes,
      chunkMs: 60_000,
    });
    expect(asked.map((chunk) => chunk.length)).toEqual([25, 25, 10]);
    expect(asked.flat()).toEqual(jobs);
    expect(inTransaction).toEqual([false, false, false]);
    expect(result).toMatchObject({ skipped: 0, pendingMatches: 60 });
    expect(result.error).toBeUndefined();
    expect(result.items.map((item) => item.jobId)).toEqual(jobs);
    expect(result.items.every((item) => item.created && item.resumeId === null)).toBe(true);
    // Saved on the day asked, with no resume yet: the worker chooses (woken once).
    expect(count(c, "SELECT count(*) AS n FROM applications WHERE current_status = 1 AND tracked_on = ? AND resume_match_due = 1", TODAY)).toBe(60);
    expect(count(c, 'SELECT count(*) AS n FROM application_status_events WHERE status = 1 AND occurred_on = ?', TODAY)).toBe(60);
    expect(nudge).toHaveBeenCalledTimes(1);

    // With no time to spare, each chunk takes one job.
    const more = Array.from({ length: 3 }, (_, index) => insertJob(db, { title: `Later ${index}` }));
    asked.length = 0;
    const one = await saveJobs(c.deps, account.id, more, { occurredOn: TODAY, chooseResumes, chunkMs: 0 });
    expect(asked).toEqual(more.map((jobId) => [jobId]));
    expect(one.items.map((item) => item.jobId)).toEqual(more);
  });

  it('links the best match, brings back un-saved jobs, and leaves tracked ones untouched', async () => {
    const c = context();
    const db = c.deps.db;
    const { account, agent } = await signIn(c, 'mixed@example.com');
    const frontend = upload(c, account.id, FRONTEND_TEXT, 'Frontend');
    const backend = upload(c, account.id, BACKEND_TEXT, 'Backend');
    const fresh = backendJob(c, 'Fresh');
    const active = backendJob(c, 'Saved already');
    const applied = backendJob(c, 'Applied');
    const appliedArchived = backendJob(c, 'Applied, archived');
    const unsaved = backendJob(c, 'Un-saved');
    const unsavedKept = backendJob(c, 'Un-saved with a resume');
    const archive = (id: string) => db.prepare('UPDATE applications SET archived_at = ? WHERE id = ?').run('2026-10-20T00:00:00.000Z', id);
    const activeId = insertApplication(db, account.id, active, 1);
    const appliedId = insertApplication(db, account.id, applied, 2);
    const appliedArchivedId = insertApplication(db, account.id, appliedArchived, 2);
    archive(appliedArchivedId);
    const unsavedId = insertApplication(db, account.id, unsaved, 1);
    db.prepare("UPDATE applications SET notes_html = '<p>Ask about the team</p>' WHERE id = ?").run(unsavedId);
    archive(unsavedId);
    const keptId = insertApplication(db, account.id, unsavedKept, 1);
    db.prepare("UPDATE applications SET resume_id = ?, resume_origin = 'auto' WHERE id = ?").run(frontend, keptId);
    archive(keptId);
    db.prepare('UPDATE applications SET resume_match_due = 0').run();
    const untouched = [activeId, appliedId, appliedArchivedId].map((id) => stateOf(c, id));
    const chooser = vi.spyOn(matcher(c), 'chooseForJobs');

    const result = await saveJobs(c.deps, account.id, [fresh, active, applied, appliedArchived, unsaved, unsavedKept, 424242], {
      occurredOn: TODAY,
      chooseResumes: resumeChooser(c.deps, account.id, 20_000),
    });
    expect(result.error).toBeUndefined();
    expect(result.items).toEqual([
      { jobId: fresh, applicationId: expect.any(String), resumeId: backend, created: true },
      { jobId: unsaved, applicationId: unsavedId, resumeId: backend, created: false },
      { jobId: unsavedKept, applicationId: keptId, resumeId: frontend, created: false },
    ]);
    // Already tracked (active, Applied, Applied and archived) or unknown: skipped. The kept resume is looked at again.
    expect(result).toMatchObject({ skipped: 4, pendingMatches: 1 });
    // Only the jobs written with no resume were asked about.
    expect(chooser.mock.calls.map((call) => call[1])).toEqual([[fresh, unsaved]]);
    expect([activeId, appliedId, appliedArchivedId].map((id) => stateOf(c, id))).toEqual(untouched);
    expect(stateOf(c, keptId)).toMatchObject({ archived_at: null, resume_id: frontend, resume_origin: 'auto', resume_match_due: 1 });
    const brought = ApplicationDetailSchema.parse((await agent.get(`/api/applications/${unsavedId}`)).body);
    expect(brought).toMatchObject({ archivedAt: null, notesHtml: '<p>Ask about the team</p>', trackedOn: '2026-10-19', resumeOrigin: 'auto' });
    expect(brought.events).toEqual([{ status: 1, occurredOn: '2026-10-19' }]);
    expect(aiTasks(c)).toBe(0);

    // The same prefill as a single save from the Jobs page.
    const single = await saved(agent, { jobId: backendJob(c, 'Twin'), status: 1 });
    const other = await signIn(c, 'other@example.com');
    const [twin] = (await saveJobs(c.deps, other.account.id, [single.jobId!], { occurredOn: TODAY, chooseResumes: noChoices })).items;
    const prefill = ({ id: _id, resumeId: _r, resumeOrigin: _o, resumeMatchedAt: _m, resumeMatchPending: _p, ...rest }: ApplicationDetail) => rest;
    expect(prefill(ApplicationDetailSchema.parse((await other.agent.get(`/api/applications/${twin!.applicationId}`)).body))).toEqual(
      prefill(single),
    );
  });

  it('a choice whose resume is gone by the write is not linked; a chooser that throws is logged; both stay due', async () => {
    const c = context();
    const { account } = await signIn(c, 'vanished@example.com');
    const job = backendJob(c);
    const late = backendJob(c, 'Later');
    const result = await saveJobs(c.deps, account.id, [job], {
      occurredOn: TODAY,
      chooseResumes: async () => ({ choices: new Map([[job, { jobId: job, resumeId: 'deleted-resume', fit: 90, reason: 'best' as const }]]) }),
    });
    expect(result.items).toEqual([{ jobId: job, applicationId: expect.any(String), resumeId: null, created: true }]);
    expect(result.pendingMatches).toBe(1);

    const thrown = await saveJobs(c.deps, account.id, [late], {
      occurredOn: TODAY,
      chooseResumes: async () => {
        throw new Error('the matcher fell over');
      },
    });
    expect(thrown).toMatchObject({ skipped: 0, pendingMatches: 1 });
    expect(thrown.items).toHaveLength(1);
    const lines = (c.deps.log as unknown as { lines: string[] }).lines;
    expect(lines.some((line) => line.includes('choosing resumes') && line.includes('the matcher fell over'))).toBe(true);
    expect(count(c, 'SELECT count(*) AS n FROM applications WHERE resume_id IS NULL AND resume_match_due = 1')).toBe(2);
  });

  it('leaves no application ids behind after a chunk rolls back; a failing first chunk throws and saves nothing', async () => {
    const c = context();
    const db = c.deps.db;
    const { account } = await signIn(c, 'rollback@example.com');
    const jobs = Array.from({ length: 30 }, (_, index) => insertJob(db, { title: `Role ${index}` }));
    // The 30th insert fails (a trigger stands in for a full disk), so the second chunk rolls back.
    db.exec(
      `CREATE TEMP TRIGGER fail_30th BEFORE INSERT ON applications WHEN (SELECT count(*) FROM applications) >= 29
       BEGIN SELECT RAISE(ABORT, 'the disk is full'); END`,
    );
    const result = await saveJobs(c.deps, account.id, jobs, { occurredOn: TODAY, chooseResumes: noChoices, chunkMs: 60_000 });
    expect(String(result.error)).toContain('the disk is full');
    expect(result.items.map((item) => item.jobId)).toEqual(jobs.slice(0, 25));
    const stored = new Set((db.prepare('SELECT id FROM applications').all() as Array<{ id: string }>).map((row) => row.id));
    expect(stored.size).toBe(25);
    expect(result.items.every((item) => stored.has(item.applicationId))).toBe(true);
    expect(result.pendingMatches).toBe(25);
    expect(count(c, 'SELECT count(*) AS n FROM application_status_events')).toBe(25);

    db.exec('DROP TRIGGER fail_30th');
    db.exec(`CREATE TEMP TRIGGER fail_all BEFORE INSERT ON applications BEGIN SELECT RAISE(ABORT, 'the disk is full'); END`);
    await expect(
      saveJobs(c.deps, account.id, jobs.slice(25), { occurredOn: TODAY, chooseResumes: noChoices }),
    ).rejects.toThrow('the disk is full');
    expect(count(c, 'SELECT count(*) AS n FROM applications')).toBe(25);
  });

  it('refuses to run inside an open transaction, and checks the day', async () => {
    const c = context();
    const db = c.deps.db;
    const { account } = await signIn(c, 'nested@example.com');
    const job = insertJob(db, { title: 'Role' });
    const chooseResumes = vi.fn<ChooseResumes>(async () => ({ choices: new Map() }));

    db.exec('BEGIN');
    try {
      await expect(saveJobs(c.deps, account.id, [job], { occurredOn: TODAY, chooseResumes })).rejects.toThrow(/open transaction/);
    } finally {
      db.exec('ROLLBACK');
    }
    let inside: Promise<unknown> | undefined;
    db.transaction(() => {
      inside = saveJobs(c.deps, account.id, [job], { occurredOn: TODAY, chooseResumes });
    })();
    await expect(inside).rejects.toThrow(/open transaction/);
    await expect(saveJobs(c.deps, account.id, [job], { occurredOn: '2026-02-30', chooseResumes })).rejects.toThrow(
      'Enter a real date (YYYY-MM-DD).',
    );
    expect(chooseResumes).not.toHaveBeenCalled();
    expect(count(c, 'SELECT count(*) AS n FROM applications')).toBe(0);

    // Outside one, it saves.
    expect((await saveJobs(c.deps, account.id, [job], { occurredOn: TODAY, chooseResumes })).items).toHaveLength(1);
    expect(chooseResumes).toHaveBeenCalledTimes(1);
  });
});
