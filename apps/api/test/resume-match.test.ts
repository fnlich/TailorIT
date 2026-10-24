import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApplicationDetailSchema,
  MatchResultSchema,
  normalizeResumeDocument,
  ResumeMatchListSchema,
  type JobKeywords,
  type ResumeDocument,
} from '@tailorit/shared';
import { JOB_ANALYSIS_PROMPT_VERSION } from '../src/features/job-analysis/prompt';
import { saveAnalysis } from '../src/features/job-analysis/store';
import { resumeMatchFeature } from '../src/features/resume-match/index';
import { AUTO_MATCH_LIMIT, RANK_LIMIT } from '../src/features/resume-match/router';
import { createResumeMatchService, EXACT_SCORED, writeAutoChoice } from '../src/features/resume-match/service';
import type { ResumeMatchService } from '../src/features/resume-match/types';
import { currentResumeAnalyses } from '../src/features/resumes/analysis/store';
import { deleteResumeRow, insertResume, updateResumeDocument } from '../src/features/resumes/repository';
import { signIn } from './auth-helpers';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';
import { insertApplication, insertJob } from './job-fixtures';

// The resume match service (work package WP5): the cooperative chooser, its tie order, the AI copy left out, the full
// write guard, the due-row worker (crash-safe, stopped before the database closes), the triggers of migration 0301
// re-matching TailorIT's choices, the agreement of the picker, Resume Score and the Jobs card, and the routes.

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

const DAY = 24 * 60 * 60_000;
const at = (ms: number) => new Date(TEST_NOW.getTime() + ms);

const BACKEND_POSTING =
  '<h3>Requirements</h3><ul><li>Go and PostgreSQL services.</li><li>Kubernetes and Docker in production.</li>' +
  '<li>Kafka pipelines and gRPC APIs.</li></ul>';
const FRONTEND_POSTING =
  '<h3>Requirements</h3><ul><li>React and TypeScript.</li><li>CSS and HTML.</li><li>Next.js and Redux.</li></ul>';

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

const BACKEND_DOCUMENT: Partial<ResumeDocument> = {
  name: 'Ada Lovelace',
  title: 'Backend Engineer',
  summary: 'Backend engineer building Go and PostgreSQL services.',
  skills: ['Go', 'PostgreSQL', 'Kubernetes', 'Docker', 'Kafka', 'gRPC'],
};
const FRONTEND_DOCUMENT: Partial<ResumeDocument> = {
  name: 'Ada Lovelace',
  title: 'Frontend Engineer',
  summary: 'Frontend engineer building React apps.',
  skills: ['React', 'TypeScript', 'CSS', 'HTML', 'Next.js', 'Redux'],
};

function matcher(c: TestContext): ResumeMatchService {
  const service = c.deps.services.resumeMatch;
  if (!service) throw new Error('the resume match service is not registered');
  return service;
}

/** An upload as the app stores it (its rules' reading included); Claude is not asked to read it. */
function upload(c: TestContext, userId: string, text: string, title = 'Uploaded'): string {
  return insertResume(c.deps, userId, { kind: 'uploaded', title, extractedText: text, aiRefine: false });
}

function built(c: TestContext, userId: string, document: Partial<ResumeDocument>, sourceResumeId?: string): string {
  return insertResume(c.deps, userId, { kind: 'built', document: normalizeResumeDocument(document), sourceResumeId });
}

function setDefault(c: TestContext, userId: string, resumeId: string | null): void {
  c.deps.db.prepare('UPDATE users SET default_resume_id = ? WHERE id = ?').run(resumeId, userId);
}

/** A Saved application of a job, waiting for its choice (as the save paths write it). */
function saved(c: TestContext, userId: string, jobId: number): string {
  const id = insertApplication(c.deps.db, userId, jobId, 1);
  c.deps.db.prepare('UPDATE applications SET resume_match_due = 1 WHERE id = ?').run(id);
  return id;
}

interface MatchState {
  resume_id: string | null;
  resume_origin: string | null;
  resume_matched_at: string | null;
  resume_match_due: number;
  updated_at: string;
}

function stateOf(c: TestContext, id: string): MatchState {
  return c.deps.db
    .prepare('SELECT resume_id, resume_origin, resume_matched_at, resume_match_due, updated_at FROM applications WHERE id = ?')
    .get(id) as MatchState;
}

function aiTaskCount(c: TestContext): number {
  return (c.deps.db.prepare('SELECT count(*) AS n FROM ai_tasks').get() as { n: number }).n;
}

function contentHashOf(c: TestContext, jobId: number): string {
  return (c.deps.db.prepare('SELECT content_hash FROM jobs WHERE id = ?').get(jobId) as { content_hash: string }).content_hash;
}

/** Claude's analysis of a posting lands (with these keywords). */
function landAiAnalysis(c: TestContext, jobId: number, keywords: JobKeywords): void {
  saveAnalysis(
    c.deps.db,
    {
      contentHash: contentHashOf(c, jobId),
      source: 'ai',
      version: JOB_ANALYSIS_PROMPT_VERSION,
      model: 'claude-sonnet-5-5',
      promptHash: 'test',
      requirements: [],
      responsibilities: [],
      desired: [],
      keywords,
      experienceLevels: [],
      leadership: null,
      minYears: null,
      categoryId: null,
      subcategoryIds: [],
      extras: {},
      softSkills: [],
      terms: { certifications: [], domains: [] },
      requiredYears: null,
    },
    c.deps.now().toISOString(),
  );
}

const terms = (...names: string[]) => names.map((term) => ({ term, synonyms: [] }));

// ------------------------------------------------------------------------------------------------- choosing

describe('chooseForJobs', () => {
  it('picks the backend resume for a backend job and the frontend one for a frontend job, read-only', async () => {
    const c = context();
    const { account } = await signIn(c, 'chooser@example.com');
    const frontend = upload(c, account.id, FRONTEND_TEXT, 'Frontend');
    const backend = upload(c, account.id, BACKEND_TEXT, 'Backend');
    // The first resume is the default: the default only breaks ties.
    const backendJob = insertJob(c.deps.db, { title: 'Backend Engineer', description: BACKEND_POSTING });
    const frontendJob = insertJob(c.deps.db, { title: 'Frontend Engineer', description: FRONTEND_POSTING });
    const before = c.deps.db.prepare('SELECT count(*) AS n FROM job_analyses').get() as { n: number };

    const { choices, unfinished } = await matcher(c).chooseForJobs(account.id, [backendJob, frontendJob, 424242, backendJob], {
      budgetMs: 10_000,
    });
    expect(unfinished).toEqual([]);
    expect([...choices.keys()]).toEqual([backendJob, frontendJob]);
    expect(choices.get(backendJob)).toMatchObject({ jobId: backendJob, resumeId: backend, reason: 'best' });
    expect(choices.get(frontendJob)).toMatchObject({ jobId: frontendJob, resumeId: frontend, reason: 'best' });
    expect(choices.get(backendJob)!.fit).toBeGreaterThan(choices.get(frontendJob)!.fit! / 2);

    // Read-only: no application, no stored analysis, no AI task.
    expect((c.deps.db.prepare('SELECT count(*) AS n FROM applications').get() as { n: number }).n).toBe(0);
    expect(c.deps.db.prepare('SELECT count(*) AS n FROM job_analyses').get()).toEqual(before);
    expect(aiTaskCount(c)).toBe(0);
  });

  it("says 'none' without a resume and 'only' with one; a spent budget or an abort leaves jobs unfinished", async () => {
    const c = context();
    const { account } = await signIn(c, 'few@example.com');
    const job = insertJob(c.deps.db, { title: 'Backend Engineer', description: BACKEND_POSTING });
    const other = insertJob(c.deps.db, { title: 'Frontend Engineer', description: FRONTEND_POSTING });

    const none = await matcher(c).chooseForJobs(account.id, [job, 424242], { budgetMs: 5_000 });
    expect([...none.choices.values()]).toEqual([{ jobId: job, resumeId: null, fit: null, reason: 'none' }]);

    const only = upload(c, account.id, FRONTEND_TEXT);
    const one = await matcher(c).chooseForJobs(account.id, [job], { budgetMs: 5_000 });
    expect(one.choices.get(job)).toMatchObject({ resumeId: only, reason: 'only' });

    expect(await matcher(c).chooseForJobs(account.id, [job, other], { budgetMs: 0 })).toEqual({
      choices: new Map(),
      unfinished: [job, other],
    });
    const aborted = new AbortController();
    aborted.abort();
    const stopped = await matcher(c).chooseForJobs(account.id, [job, other], { budgetMs: 5_000, signal: aborted.signal });
    expect(stopped.unfinished).toEqual([job, other]);
  });

  it('breaks ties by the default resume, then precision, then the newer last edit, then the id', async () => {
    const c = context();
    const job = insertJob(c.deps.db, { title: 'Backend Engineer', description: BACKEND_POSTING });
    const choose = async (userId: string) => (await matcher(c).chooseForJobs(userId, [job], { budgetMs: 10_000 })).choices.get(job)!;

    // The default resume wins a tie.
    const first = (await signIn(c, 'tie-default@example.com')).account.id;
    const a = upload(c, first, BACKEND_TEXT);
    const b = upload(c, first, BACKEND_TEXT);
    setDefault(c, first, b);
    expect(await choose(first)).toMatchObject({ resumeId: b, reason: 'tie' });
    setDefault(c, first, a);
    expect(await choose(first)).toMatchObject({ resumeId: a, reason: 'tie' });

    // Then precision: the share of the resume's own hard skills the job names (here 7 of 11 against 7 of 7).
    const second = (await signIn(c, 'tie-precision@example.com')).account.id;
    const broad = upload(c, second, `${BACKEND_TEXT}\nAlso wrote Python and Terraform for Redis on AWS.`);
    const focused = upload(c, second, BACKEND_TEXT);
    setDefault(c, second, null);
    const readings = currentResumeAnalyses(c.deps, second, { computeLimit: 0 });
    expect(readings.get(broad)!.data.hardSkills.length).toBeGreaterThan(readings.get(focused)!.data.hardSkills.length);
    const focusedChoice = await choose(second);
    expect(focusedChoice).toMatchObject({ resumeId: focused, reason: 'tie' });
    expect(focusedChoice.resumeId).not.toBe(broad);

    // Then the newer COALESCE(last_edited_at, created_at).
    const third = (await signIn(c, 'tie-edited@example.com')).account.id;
    const older = upload(c, third, BACKEND_TEXT);
    c.setNow(at(DAY));
    const newer = upload(c, third, BACKEND_TEXT);
    setDefault(c, third, null);
    expect(await choose(third)).toMatchObject({ resumeId: newer, reason: 'tie' });
    c.deps.db.prepare('UPDATE resumes SET last_edited_at = ? WHERE id = ?').run(at(2 * DAY).toISOString(), older);
    expect(await choose(third)).toMatchObject({ resumeId: older, reason: 'tie' });

    // Then the lower id.
    const fourth = (await signIn(c, 'tie-id@example.com')).account.id;
    const ids = [upload(c, fourth, BACKEND_TEXT), upload(c, fourth, BACKEND_TEXT)];
    setDefault(c, fourth, null);
    expect(await choose(fourth)).toMatchObject({ resumeId: [...ids].sort()[0], reason: 'tie' });
  });

  it("leaves out an unedited AI copy so its upload wins; once edited, the copy competes", async () => {
    const c = context();
    const { account, agent } = await signIn(c, 'copy@example.com');
    const job = insertJob(c.deps.db, { title: 'Backend Engineer', description: BACKEND_POSTING });
    const original = upload(c, account.id, 'Ada Lovelace\nBackend Engineer\nExperience\nBuilt Go services and PostgreSQL schemas for payments.');
    // The AI editable copy names every keyword: it would win if it took part.
    const copy = built(c, account.id, BACKEND_DOCUMENT, original);
    const choose = async () => (await matcher(c).chooseForJobs(account.id, [job], { budgetMs: 10_000 })).choices.get(job)!;
    expect(await choose()).toMatchObject({ resumeId: original, reason: 'only' });

    // The picker lists the copy (it can be picked), after every resume TailorIT may choose.
    const application = saved(c, account.id, job);
    const list = ResumeMatchListSchema.parse((await agent.get(`/api/applications/${application}/resume-matches`)).body);
    expect(list.items.map((item) => item.resumeId)).toEqual([original, copy]);
    expect(list.items[1]!.matchedCount).toBeGreaterThan(list.items[0]!.matchedCount);

    // An edit makes it the person's own resume.
    updateResumeDocument(c.deps, account.id, copy, normalizeResumeDocument(BACKEND_DOCUMENT));
    expect(await choose()).toMatchObject({ resumeId: copy, reason: 'best' });
  });

  it(`pre-ranks by stored hard skills and scores the top ${EXACT_SCORED} exactly`, async () => {
    const c = context();
    const { account } = await signIn(c, 'many@example.com');
    const job = insertJob(c.deps.db, { title: 'Backend Engineer', description: BACKEND_POSTING });
    for (let index = 0; index < EXACT_SCORED + 5; index += 1) upload(c, account.id, `${FRONTEND_TEXT}\nProject ${index}.`);
    const best = upload(c, account.id, BACKEND_TEXT);
    const choice = (await matcher(c).chooseForJobs(account.id, [job], { budgetMs: 20_000 })).choices.get(job)!;
    expect(choice).toMatchObject({ resumeId: best, reason: 'best' });
  });
});

// ------------------------------------------------------------------------------------------------- the guard

describe('the full write guard', () => {
  it('never touches an Applied, archived or person-chosen application, and refuses another account\'s resume', async () => {
    const c = context();
    const db = c.deps.db;
    const { account } = await signIn(c, 'guard@example.com');
    const other = (await signIn(c, 'someone-else@example.com')).account.id;
    const frontend = upload(c, account.id, FRONTEND_TEXT);
    const backend = upload(c, account.id, BACKEND_TEXT);
    const foreign = upload(c, other, BACKEND_TEXT);
    const jobs = [0, 1, 2, 3].map((index) => insertJob(db, { title: `Backend Engineer ${index}`, description: BACKEND_POSTING }));

    const savedRow = saved(c, account.id, jobs[0]!);
    const applied = insertApplication(db, account.id, jobs[1]!, 2);
    const archived = saved(c, account.id, jobs[2]!);
    db.prepare('UPDATE applications SET archived_at = ? WHERE id = ?').run(TEST_NOW.toISOString(), archived);
    const chosen = saved(c, account.id, jobs[3]!);
    db.prepare("UPDATE applications SET resume_id = ?, resume_origin = 'user' WHERE id = ?").run(frontend, chosen);
    db.prepare('UPDATE applications SET resume_match_due = 1').run();
    const before = Object.fromEntries([applied, archived, chosen].map((id) => [id, stateOf(c, id)]));

    expect(await matcher(c).runDue()).toBe(4);
    expect(stateOf(c, savedRow)).toMatchObject({
      resume_id: backend,
      resume_origin: 'auto',
      resume_matched_at: TEST_NOW.toISOString(),
      resume_match_due: 0,
      updated_at: '2026-10-19T00:00:00.000Z',
    });
    // The others are let go (no longer due) and otherwise untouched.
    for (const id of [applied, archived, chosen]) expect(stateOf(c, id)).toEqual({ ...before[id], resume_match_due: 0 });

    // The guard itself: another account's resume is refused, the account's own is written.
    const target = { id: savedRow, userId: account.id, jobId: jobs[0]! };
    expect(writeAutoChoice(db, target, foreign, at(DAY).toISOString())).toBe(false);
    expect(stateOf(c, savedRow).resume_id).toBe(backend);
    expect(writeAutoChoice(db, { ...target, jobId: jobs[1]! }, frontend, at(DAY).toISOString())).toBe(false);
    expect(writeAutoChoice(db, { id: chosen, userId: account.id, jobId: jobs[3]! }, backend, at(DAY).toISOString())).toBe(false);
    expect(writeAutoChoice(db, target, frontend, at(DAY).toISOString())).toBe(true);
    expect(stateOf(c, savedRow)).toMatchObject({ resume_id: frontend, resume_origin: 'auto', updated_at: '2026-10-19T00:00:00.000Z' });
    expect(aiTaskCount(c)).toBe(0);
  });

  it('skips disabled accounts until they are enabled again', async () => {
    const c = context();
    const { account } = await signIn(c, 'disabled@example.com');
    upload(c, account.id, BACKEND_TEXT);
    const job = insertJob(c.deps.db, { title: 'Backend Engineer', description: BACKEND_POSTING });
    const application = saved(c, account.id, job);
    c.deps.db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(TEST_NOW.toISOString(), account.id);
    expect(await matcher(c).runDue()).toBe(0);
    expect(stateOf(c, application).resume_match_due).toBe(1);
    c.deps.db.prepare('UPDATE users SET disabled_at = NULL WHERE id = ?').run(account.id);
    expect(await matcher(c).runDue()).toBe(1);
    expect(stateOf(c, application)).toMatchObject({ resume_origin: 'auto', resume_match_due: 0 });
  });
});

// ------------------------------------------------------------------------------------------------- the worker

describe('the worker', () => {
  const fast = { sliceMs: 2, firstRunMs: 0, pollMs: 20, nudgeMs: 0, retryFailedMs: 80 };

  it('logs a throwing slice or row and carries on; the failed ones are tried again later', async () => {
    const c = context();
    const db = c.deps.db;
    const { account } = await signIn(c, 'crash@example.com');
    upload(c, account.id, FRONTEND_TEXT);
    const backend = upload(c, account.id, BACKEND_TEXT);
    const apps = [0, 1, 2].map((index) =>
      saved(c, account.id, insertJob(db, { title: `Backend Engineer ${index}`, description: BACKEND_POSTING })),
    );
    // One row's write fails (a trigger stands in for a disk error) ...
    db.exec(
      `CREATE TEMP TRIGGER fail_one BEFORE UPDATE ON applications WHEN OLD.id = '${apps[0]}'
       BEGIN SELECT RAISE(ABORT, 'the disk is on fire'); END`,
    );
    // ... and the first slice for the account fails while reading its resumes.
    const prepare = db.prepare.bind(db);
    let broken = true;
    vi.spyOn(db, 'prepare').mockImplementation(((source: string) => {
      if (broken && source.includes('resume_analysis_backlog')) {
        broken = false;
        throw new Error('the readings could not be read');
      }
      return prepare(source);
    }) as typeof db.prepare);

    const service = createResumeMatchService(c.deps, { timing: fast });
    const stop = service.start();
    try {
      await vi.waitFor(() => {
        expect(stateOf(c, apps[1]!)).toMatchObject({ resume_id: backend, resume_match_due: 0 });
        expect(stateOf(c, apps[2]!)).toMatchObject({ resume_id: backend, resume_match_due: 0 });
      }, { timeout: 5_000, interval: 20 });
      const lines = (c.deps.log as unknown as { lines: string[] }).lines;
      expect(lines.some((line) => line.includes('[resume-match] a slice for account') && line.includes('could not be read'))).toBe(true);
      expect(lines.some((line) => line.includes(`application ${apps[0]}`) && line.includes('the disk is on fire'))).toBe(true);
      expect(stateOf(c, apps[0]!).resume_match_due).toBe(1);

      // Once the cause is gone, the failed row is chosen on a later pass.
      db.exec('DROP TRIGGER fail_one');
      await vi.waitFor(() => expect(stateOf(c, apps[0]!)).toMatchObject({ resume_id: backend, resume_match_due: 0 }), {
        timeout: 5_000,
        interval: 20,
      });
    } finally {
      await stop();
    }
  });

  it('runs no timer before start, and stop() ends a running pass and waits for it before the database closes', async () => {
    const c = context();
    const db = c.deps.db;
    const { account } = await signIn(c, 'stop@example.com');
    upload(c, account.id, FRONTEND_TEXT);
    upload(c, account.id, BACKEND_TEXT);
    const apps = Array.from({ length: 120 }, (_, index) =>
      saved(c, account.id, insertJob(db, { title: `Backend Engineer ${index}`, description: BACKEND_POSTING })),
    );
    const settled = () => (db.prepare('SELECT count(*) AS n FROM applications WHERE resume_match_due = 0').get() as { n: number }).n;

    const service = createResumeMatchService(c.deps, { timing: { ...fast, sliceMs: 1 } });
    service.nudge();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(settled()).toBe(0);

    const stop = service.start();
    expect(service.start()).toBe(stop);
    await vi.waitFor(() => expect(settled()).toBeGreaterThan(0), { timeout: 5_000, interval: 1 });
    await stop();
    const afterStop = settled();
    expect(afterStop).toBeLessThan(apps.length);
    // Closing the database now is safe: no slice runs after stop resolved.
    ctx = null;
    c.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const lines = (c.deps.log as unknown as { lines: string[] }).lines;
    expect(lines.filter((line) => line.startsWith('warn [resume-match]') || line.startsWith('error'))).toEqual([]);
  });

  it("the feature's start hook returns an awaitable stop", async () => {
    const c = context();
    const stop = resumeMatchFeature.start?.(c.deps);
    expect(typeof stop).toBe('function');
    await (stop as () => Promise<void>)();
  });
});

// ------------------------------------------------------------------------------------------------- re-matching

describe('re-matching through the 0301 triggers', () => {
  it("a resume added, edited or deleted, a default change and a landed AI analysis re-match TailorIT's choices only", async () => {
    const c = context();
    const db = c.deps.db;
    const { account } = await signIn(c, 'rematch@example.com');
    const job = insertJob(db, { title: 'Backend Engineer', description: BACKEND_POSTING });
    const frontend = upload(c, account.id, FRONTEND_TEXT, 'Frontend');
    const application = saved(c, account.id, job);
    // Rows TailorIT must never re-choose.
    const applied = insertApplication(db, account.id, insertJob(db, { title: 'Applied', description: BACKEND_POSTING }), 2);
    const chosen = saved(c, account.id, insertJob(db, { title: 'Chosen', description: BACKEND_POSTING }));
    db.prepare("UPDATE applications SET resume_id = ?, resume_origin = 'user', resume_match_due = 0 WHERE id = ?").run(frontend, chosen);
    const archived = saved(c, account.id, insertJob(db, { title: 'Archived', description: BACKEND_POSTING }));
    db.prepare('UPDATE applications SET archived_at = ?, resume_match_due = 0 WHERE id = ?').run(TEST_NOW.toISOString(), archived);
    const untouched = Object.fromEntries([applied, chosen, archived].map((id) => [id, stateOf(c, id)]));
    const due = () => stateOf(c, application).resume_match_due;
    const linked = async () => {
      await matcher(c).runDue();
      const state = stateOf(c, application);
      expect(state).toMatchObject({ resume_origin: 'auto', resume_match_due: 0, updated_at: '2026-10-19T00:00:00.000Z' });
      return state.resume_id;
    };

    expect(await linked()).toBe(frontend);

    // A resume added (it names four of the job's six keywords).
    const partial = BACKEND_TEXT.replace('\nDesigned gRPC APIs and Kafka pipelines.', '');
    const backend = upload(c, account.id, partial, 'Backend');
    expect(due()).toBe(1);
    expect(await linked()).toBe(backend);

    // A resume edited (a built one: uploads never change).
    const edited = built(c, account.id, FRONTEND_DOCUMENT);
    expect(due()).toBe(1);
    expect(await linked()).toBe(backend);
    updateResumeDocument(c.deps, account.id, edited, normalizeResumeDocument({ ...BACKEND_DOCUMENT, summary: 'Go, PostgreSQL, Kubernetes, Docker, Kafka and gRPC.' }));
    expect(due()).toBe(1);
    expect(await linked()).toBe(edited);

    // A resume deleted: the choice is let go, then made again.
    deleteResumeRow(c.deps, account.id, edited);
    expect(stateOf(c, application)).toMatchObject({ resume_id: null, resume_origin: null, resume_match_due: 1 });
    expect(await linked()).toBe(backend);

    // The default resume breaks a tie: a second copy of the backend upload ties with it.
    const twin = upload(c, account.id, partial, 'Backend twin');
    expect(await linked()).toBe(twin < backend ? twin : backend);
    const notChosen = stateOf(c, application).resume_id === twin ? backend : twin;
    await request(c.app)
      .put('/api/me/default-resume')
      .set('Origin', ORIGIN)
      .set('Cookie', (await signIn(c, 'rematch@example.com')).cookie)
      .send({ resumeId: notChosen })
      .expect(200);
    expect(due()).toBe(1);
    expect(await linked()).toBe(notChosen);

    // Claude's analysis of the posting lands: it names frontend skills.
    landAiAnalysis(c, job, { high: terms('React', 'TypeScript', 'CSS'), low: terms('Redux') });
    expect(due()).toBe(1);
    expect(await linked()).toBe(frontend);

    for (const id of [applied, chosen, archived]) {
      expect(stateOf(c, id)).toMatchObject({
        resume_id: untouched[id]!.resume_id,
        resume_origin: untouched[id]!.resume_origin,
        resume_matched_at: untouched[id]!.resume_matched_at,
        updated_at: untouched[id]!.updated_at,
      });
    }
    expect(aiTaskCount(c)).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------- agreement

describe('agreement', () => {
  it('for a tracked job the picker, Resume Score and the Jobs card show the same numbers for the linked resume', async () => {
    const c = context();
    const db = c.deps.db;
    const { account, agent } = await signIn(c, 'agree@example.com');
    const frontend = upload(c, account.id, FRONTEND_TEXT, 'Frontend');
    const backend = upload(c, account.id, BACKEND_TEXT, 'Backend');
    setDefault(c, account.id, frontend);
    const job = insertJob(db, { title: 'Backend Engineer', description: BACKEND_POSTING });
    const created = await agent.post('/api/applications').set('Origin', ORIGIN).send({ jobId: job, status: 1 }).expect(201);
    const application = created.body.id as string;
    db.prepare('UPDATE applications SET resume_match_due = 1 WHERE id = ?').run(application);
    await matcher(c).runDue();
    expect(stateOf(c, application)).toMatchObject({ resume_id: backend, resume_origin: 'auto' });

    const list = ResumeMatchListSchema.parse((await agent.get(`/api/applications/${application}/resume-matches`)).body);
    expect(list).toMatchObject({ basis: 'job', scored: true, chosen: { resumeId: backend, origin: 'auto' } });
    expect(list.items.map((item) => item.resumeId)).toEqual([backend, frontend]);
    const picked = list.items[0]!;
    const score = MatchResultSchema.parse((await agent.get(`/api/applications/${application}/resume-score`)).body);
    const card = MatchResultSchema.parse((await agent.get(`/api/jobs/${job}/insights`)).body.match);
    const numbers = (value: { matchedCount: number; total: number; percentage: number }) => [value.matchedCount, value.total, value.percentage];
    expect(score.resumeId).toBe(backend);
    expect(numbers(score)).toEqual(numbers(picked));
    expect(card).toMatchObject({ resumeId: backend, resumeBasis: 'linked', resumeLabel: 'Backend' });
    expect(numbers(card)).toEqual(numbers(picked));
    expect(picked.total).toBeGreaterThan(0);
    // The default resume's numbers are its own (the best match is not the default).
    expect(numbers(list.items[1]!)).not.toEqual(numbers(picked));

    // A job that is not tracked is scored with the default resume; so is an un-saved one.
    const untracked = insertJob(db, { title: 'Backend Engineer', description: BACKEND_POSTING });
    expect((await agent.get(`/api/jobs/${untracked}/insights`)).body.match).toMatchObject({
      resumeId: frontend,
      resumeBasis: 'default',
      resumeLabel: 'Frontend',
    });
    const unsaved = insertJob(db, { title: 'Backend Engineer', description: BACKEND_POSTING });
    const archived = insertApplication(db, account.id, unsaved, 1);
    db.prepare('UPDATE applications SET resume_id = ?, archived_at = ? WHERE id = ?').run(backend, TEST_NOW.toISOString(), archived);
    expect((await agent.get(`/api/jobs/${unsaved}/insights`)).body.match).toMatchObject({ resumeId: frontend, resumeBasis: 'default' });
    // The card's own route keeps its shape and scores the same resume.
    expect((await agent.get(`/api/jobs/${job}/match`)).body).toMatchObject({ resumeId: backend, matchedCount: picked.matchedCount });
  });
});

// ------------------------------------------------------------------------------------------------- the routes

describe('GET /api/applications/:id/resume-matches and POST /api/applications/:id/resume-match', () => {
  it("ranks every resume, lets TailorIT choose again after the person's pick, and 404s another account's", async () => {
    const c = context();
    const db = c.deps.db;
    const { account, agent } = await signIn(c, 'routes@example.com');
    const stranger = await signIn(c, 'stranger@example.com');
    const frontend = upload(c, account.id, FRONTEND_TEXT, 'Frontend');
    const backend = upload(c, account.id, BACKEND_TEXT, 'Backend');
    const job = insertJob(db, { title: 'Backend Engineer', description: BACKEND_POSTING });
    const application = saved(c, account.id, job);
    // The person picked the frontend resume.
    db.prepare("UPDATE applications SET resume_id = ?, resume_origin = 'user', resume_match_due = 0 WHERE id = ?").run(frontend, application);

    const list = ResumeMatchListSchema.parse((await agent.get(`/api/applications/${application}/resume-matches`)).body);
    expect(list).toMatchObject({
      applicationId: application,
      basis: 'job',
      scored: true,
      requiredYears: null,
      chosen: { resumeId: frontend, origin: 'user', matchedAt: null },
    });
    expect(list.items.map((item) => [item.resumeId, item.label, item.kind])).toEqual([
      [backend, 'Backend', 'uploaded'],
      [frontend, 'Frontend', 'uploaded'],
    ]);
    expect(list.items[0]!.fit).toBeGreaterThan(list.items[1]!.fit);
    expect(list.items[0]!.isDefault).toBe(false);
    expect(list.items[1]!.isDefault).toBe(true);

    // "Let TailorIT choose".
    const chosen = await agent.post(`/api/applications/${application}/resume-match`).set('Origin', ORIGIN).send({});
    expect(chosen.status).toBe(200);
    expect(ApplicationDetailSchema.parse(chosen.body)).toMatchObject({
      id: application,
      resumeId: backend,
      resumeOrigin: 'auto',
      resumeMatchedAt: TEST_NOW.toISOString(),
      resumeMatchPending: false,
    });
    expect(stateOf(c, application)).toMatchObject({ resume_id: backend, resume_origin: 'auto', updated_at: '2026-10-19T00:00:00.000Z' });

    // Another account's application does not exist; a foreign Origin is refused.
    for (const response of [
      await stranger.agent.get(`/api/applications/${application}/resume-matches`),
      await stranger.agent.post(`/api/applications/${application}/resume-match`).set('Origin', ORIGIN).send({}),
      await agent.get('/api/applications/no-such-application/resume-matches'),
    ]) {
      expect(response.status).toBe(404);
      expect(response.body.error).toMatchObject({ code: 'not_found', message: 'That application was not found.' });
    }
    expect((await agent.post(`/api/applications/${application}/resume-match`).set('Origin', 'https://evil.example').send({})).status).toBe(403);
    expect((await request(c.app).get(`/api/applications/${application}/resume-matches`)).status).toBe(401);

    // Only a Saved job is TailorIT's to choose for; an application added by hand is ranked on its own description.
    const applied = insertApplication(db, account.id, insertJob(db, { title: 'Applied', description: BACKEND_POSTING }), 2);
    const refused = await agent.post(`/api/applications/${applied}/resume-match`).set('Origin', ORIGIN).send({});
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/^TailorIT chooses a resume only for a job you saved from the Jobs page/);
    expect(refused.body.error.message).not.toContain('—');
    const manual = await agent
      .post('/api/applications')
      .set('Origin', ORIGIN)
      .send({ title: 'Frontend Engineer', companyName: 'Acme', employmentType: 'full_time', status: 1 })
      .expect(201);
    await agent.patch(`/api/applications/${manual.body.id}`).set('Origin', ORIGIN).send({ descriptionHtml: FRONTEND_POSTING }).expect(200);
    const byHand = ResumeMatchListSchema.parse((await agent.get(`/api/applications/${manual.body.id}/resume-matches`)).body);
    expect(byHand).toMatchObject({ basis: 'description', scored: true });
    expect(byHand.items[0]!.resumeId).toBe(frontend);
    const byHandScore = (await agent.get(`/api/applications/${manual.body.id}/resume-score`)).body;
    const frontendItem = byHand.items.find((item) => item.resumeId === frontend)!;
    expect([byHandScore.matchedCount, byHandScore.total]).toEqual([frontendItem.matchedCount, frontendItem.total]);
    expect((await agent.post(`/api/applications/${manual.body.id}/resume-match`).set('Origin', ORIGIN).send({})).status).toBe(409);

    // With no resume, TailorIT links none.
    const empty = await signIn(c, 'no-resume@example.com');
    const lonely = saved(c, empty.account.id, insertJob(db, { title: 'Backend Engineer', description: BACKEND_POSTING }));
    const none = await empty.agent.post(`/api/applications/${lonely}/resume-match`).set('Origin', ORIGIN).send({});
    expect(none.status).toBe(200);
    expect(none.body).toMatchObject({ resumeId: null, resumeOrigin: null, resumeMatchPending: false });
    expect((await empty.agent.get(`/api/applications/${lonely}/resume-matches`)).body).toMatchObject({ items: [] });
    expect(aiTaskCount(c)).toBe(0);
  });

  it('limits each account per minute', async () => {
    const c = context();
    const { account, agent } = await signIn(c, 'limits@example.com');
    const other = await signIn(c, 'unlimited@example.com');
    upload(c, account.id, BACKEND_TEXT);
    const application = saved(c, account.id, insertJob(c.deps.db, { title: 'Backend Engineer', description: BACKEND_POSTING }));
    for (let index = 0; index < RANK_LIMIT; index += 1) {
      expect((await agent.get(`/api/applications/${application}/resume-matches`)).status).toBe(200);
    }
    const limited = await agent.get(`/api/applications/${application}/resume-matches`);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(limited.body.error.retryAfterSeconds).toBeGreaterThan(0);
    expect(limited.headers['retry-after']).toBeDefined();
    // Another account has its own allowance.
    expect((await other.agent.get(`/api/applications/${application}/resume-matches`)).status).toBe(404);

    for (let index = 0; index < AUTO_MATCH_LIMIT; index += 1) {
      expect((await agent.post(`/api/applications/${application}/resume-match`).set('Origin', ORIGIN).send({})).status).toBe(200);
    }
    expect((await agent.post(`/api/applications/${application}/resume-match`).set('Origin', ORIGIN).send({})).status).toBe(429);
  });
});

// ------------------------------------------------------------------------------------------------- the ZIP's choices

describe('ensureChoices', () => {
  it("chooses the due rows among the ids first, within its budget, and maps each of the account's applications", async () => {
    const c = context();
    const db = c.deps.db;
    const { account } = await signIn(c, 'zip@example.com');
    const other = (await signIn(c, 'zip-other@example.com')).account.id;
    const frontend = upload(c, account.id, FRONTEND_TEXT);
    const backend = upload(c, account.id, BACKEND_TEXT);
    const due = saved(c, account.id, insertJob(db, { title: 'Backend Engineer', description: BACKEND_POSTING }));
    const later = saved(c, account.id, insertJob(db, { title: 'Backend Engineer', description: BACKEND_POSTING }));
    const chosen = saved(c, account.id, insertJob(db, { title: 'Chosen', description: BACKEND_POSTING }));
    db.prepare("UPDATE applications SET resume_id = ?, resume_origin = 'user', resume_match_due = 0 WHERE id = ?").run(frontend, chosen);
    const foreign = saved(c, other, insertJob(db, { title: 'Theirs', description: BACKEND_POSTING }));

    const spent = await matcher(c).ensureChoices(account.id, [due, chosen], { budgetMs: 0 });
    expect(spent).toEqual({ resumeByApplication: new Map([[due, null], [chosen, frontend]]), pending: 1 });

    const result = await matcher(c).ensureChoices(account.id, [due, chosen, foreign, 'unknown', due], { budgetMs: 10_000 });
    expect(result.pending).toBe(0);
    expect(result.resumeByApplication).toEqual(new Map([[due, backend], [chosen, frontend]]));
    expect(stateOf(c, due)).toMatchObject({ resume_id: backend, resume_origin: 'auto', resume_match_due: 0 });
    // Only the ids asked for: another due row waits for the worker; another account's row is never touched.
    expect(stateOf(c, later).resume_match_due).toBe(1);
    expect(stateOf(c, foreign)).toMatchObject({ resume_id: null, resume_match_due: 1 });
  });
});
