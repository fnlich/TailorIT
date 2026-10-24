import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiBackgroundWorkSchema, RESUME_ANALYSIS_VERSION } from '@tailorit/shared';
import { requireAi } from '../src/ai/index';
import type { AiProvider, ProviderHold } from '../src/ai/provider/types';
import { jobBacklogSql } from '../src/features/admin-ai/router';
import { JOB_ANALYSIS_PROMPT_VERSION } from '../src/features/job-analysis/prompt';
import { MIN_TEXT_FOR_AI } from '../src/features/job-analysis/service';
import { AI_FAILURES_BEFORE_GIVING_UP, saveAnalysis } from '../src/features/job-analysis/store';
import { signIn } from './auth-helpers';
import { createTestContext, TEST_NOW, type TestContext } from './helpers';
import { insertApplication, insertCompany, insertJob, insertResume } from './job-fixtures';

// Admin › AI › Background work (GET /api/admin/ai/background): what the background AI workers still have to do,
// counted from the database: the add-time job backlog, Claude's backlog of uploaded resumes, the resume match worker's
// due rows, and the background gate.

const contexts: TestContext[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const context of contexts.splice(0)) context.cleanup();
});

type Db = TestContext['deps']['db'];

const MINUTE = 60_000;
/** TEST_NOW plus `minutes`, as an ISO time. */
const at = (minutes: number) => new Date(TEST_NOW.getTime() + minutes * MINUTE).toISOString();
const STAMP = TEST_NOW.toISOString();

/** A server with `env`, an administrator, and Background work as that administrator reads it. */
async function setup(env: Record<string, string> = {}) {
  const ctx = createTestContext({ env });
  contexts.push(ctx);
  const admin = await signIn(ctx, 'admin@tailorit.dev', { admin: true });
  const read = async () => {
    const res = await admin.agent.get('/api/admin/ai/background');
    expect(res.status).toBe(200);
    return AiBackgroundWorkSchema.parse(res.body);
  };
  return { ctx, db: ctx.deps.db, read };
}

const accountId = async (ctx: TestContext, email: string) => (await signIn(ctx, email)).account.id;
const disable = (db: Db, userId: string) => db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(STAMP, userId);

const hashOf = (db: Db, jobId: number) =>
  (db.prepare('SELECT content_hash FROM jobs WHERE id = ?').get(jobId) as { content_hash: string }).content_hash;

/** A posting long enough for Claude, unless `extra` says otherwise. */
function addJob(db: Db, title: string, extra: Partial<Parameters<typeof insertJob>[1]> = {}): number {
  return insertJob(db, {
    description: `<p>Build ${title} services in Go and PostgreSQL, and run them on Kubernetes in production.</p>`,
    ...extra,
    title,
  });
}

const DRAFT = {
  requirements: [],
  responsibilities: [],
  desired: [],
  keywords: { high: [], low: [] },
  experienceLevels: [],
  leadership: null,
  minYears: null,
  categoryId: null,
  subcategoryIds: [],
  extras: {},
};

/** A stored analysis of a job's text. */
function analyse(db: Db, jobId: number, source: 'ai' | 'ft_lake', version: number): void {
  saveAnalysis(db, { ...DRAFT, contentHash: hashOf(db, jobId), source, version }, STAMP);
}

/** The backlog's memory of a job's text (job_ai_attempts): `attempts` failures, tried again at `next`. */
function rest(db: Db, jobId: number, attempts: number, next: string, version = JOB_ANALYSIS_PROMPT_VERSION): void {
  db.prepare(
    'INSERT INTO job_ai_attempts(content_hash, version, attempts, next_attempt_at, last_error, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(hashOf(db, jobId), version, attempts, next, 'Claude answered something unreadable.', STAMP);
}

/** An upload's row in Claude's resume backlog (resume_analysis_backlog), in `state`. */
function backlogRow(db: Db, userId: string, state: 'waiting' | 'queued' | 'done' | 'failed' | 'skipped'): void {
  const resumeId = insertResume(db, userId, 'Platform engineer with Go, Kubernetes and PostgreSQL.');
  db.prepare(
    `INSERT INTO resume_analysis_backlog(resume_id, user_id, content_hash, version, state, attempts, task_id, next_attempt_at,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    resumeId,
    userId,
    `hash-${resumeId}`,
    RESUME_ANALYSIS_VERSION,
    state,
    state === 'failed' ? 3 : 0,
    state === 'queued' ? `task-${resumeId}` : null,
    STAMP,
    STAMP,
    STAMP,
  );
}

describe('GET /api/admin/ai/background', () => {
  it('is for administrators only: 401 signed out, 403 for an account that is not an admin', async () => {
    const { ctx } = await setup();
    const signedOut = await request(ctx.app).get('/api/admin/ai/background');
    expect(signedOut.status).toBe(401);
    expect(signedOut.body.error.code).toBe('not_signed_in');
    const member = await signIn(ctx, 'member@example.com');
    const forbidden = await member.agent.get('/api/admin/ai/background');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toMatchObject({ code: 'forbidden', message: 'That is an administrator-only part of TailorIT.' });
  });

  it('answers zeros, the default modes and caps, and an open gate on a fresh server', async () => {
    const { read } = await setup();
    expect(await read()).toEqual({
      jobs: { mode: 'ingest', waiting: 0, backingOff: 0, gaveUp: 0, perHourCap: 0 },
      resumes: { mode: 'auto', waiting: 0, queued: 0, failed: 0, perHourCap: 20 },
      matches: { due: 0 },
      gate: { open: true, reason: null, retryAt: null },
    });
  });
});

describe('jobs', () => {
  it('counts the jobs the add-time backlog would still read, and those backing off or given up', async () => {
    const { db, read } = await setup({ AI_JOB_ANALYSIS_PER_HOUR: '40' });
    // Waiting: no Claude analysis of the current prompt version, and no wait in job_ai_attempts.
    addJob(db, 'Never read');
    analyse(db, addJob(db, 'Read by the lake only'), 'ft_lake', 1);
    analyse(db, addJob(db, 'Read with an older prompt'), 'ai', JOB_ANALYSIS_PROMPT_VERSION - 1);
    rest(db, addJob(db, 'Failed with an older prompt'), 1, at(30), JOB_ANALYSIS_PROMPT_VERSION - 1);
    rest(db, addJob(db, 'Given up, its day over'), AI_FAILURES_BEFORE_GIVING_UP, at(-1));
    // Backing off: one or two failures, or an outage (which counts no failure), until a later time.
    const failedOnce = addJob(db, 'Failed once');
    rest(db, failedOnce, 1, at(30));
    rest(db, addJob(db, 'Failed twice'), 2, at(60));
    rest(db, addJob(db, 'Waits out an outage'), 0, at(5));
    // Given up: three failures, tried again a day later.
    rest(db, addJob(db, 'Given up'), AI_FAILURES_BEFORE_GIVING_UP, at(24 * 60));
    // Not counted: closed, too short for Claude, or read by Claude already.
    addJob(db, 'Closed', { active: false });
    rest(db, addJob(db, 'Closed and resting', { active: false }), 1, at(30));
    addJob(db, 'Short', { description: '<p>Go.</p>' });
    analyse(db, addJob(db, 'Read by Claude'), 'ai', JOB_ANALYSIS_PROMPT_VERSION);
    const readAfterFailing = addJob(db, 'Read by Claude, with a failure on record');
    analyse(db, readAfterFailing, 'ai', JOB_ANALYSIS_PROMPT_VERSION);
    rest(db, readAfterFailing, 1, at(30));

    expect((await read()).jobs).toEqual({ mode: 'ingest', waiting: 5, backingOff: 3, gaveUp: 1, perHourCap: 40 });

    // Jobs are counted, not texts: a repost of a resting text rests with it.
    const repost = addJob(db, 'Failed once, reposted');
    db.prepare('UPDATE jobs SET content_hash = ? WHERE id = ?').run(hashOf(db, failedOnce), repost);
    expect((await read()).jobs).toMatchObject({ waiting: 5, backingOff: 4, gaveUp: 1 });
  });

  it('a job whose wait is over is waiting for Claude again', async () => {
    const { ctx, db, read } = await setup();
    rest(db, addJob(db, 'Failed once'), 1, at(30));
    rest(db, addJob(db, 'Given up'), AI_FAILURES_BEFORE_GIVING_UP, at(24 * 60));
    expect((await read()).jobs).toMatchObject({ waiting: 0, backingOff: 1, gaveUp: 1 });
    ctx.setNow(new Date(at(30)));
    expect((await read()).jobs).toMatchObject({ waiting: 1, backingOff: 0, gaveUp: 1 });
    ctx.setNow(new Date(at(24 * 60)));
    expect((await read()).jobs).toMatchObject({ waiting: 2, backingOff: 0, gaveUp: 0 });
  });

  it('saved mode counts only the jobs someone has saved', async () => {
    const { ctx, db, read } = await setup({ AI_JOB_ANALYSIS: 'saved' });
    const member = await accountId(ctx, 'member@example.com');
    insertApplication(db, member, addJob(db, 'Saved'), 1);
    const savedAndFailed = addJob(db, 'Saved, failed once');
    insertApplication(db, member, savedAndFailed, 1);
    rest(db, savedAndFailed, 1, at(30));
    insertApplication(db, member, addJob(db, 'Applied'), 2);
    const archived = insertApplication(db, member, addJob(db, 'Saved, then archived'), 1);
    db.prepare('UPDATE applications SET archived_at = ? WHERE id = ?').run(STAMP, archived);
    addJob(db, 'Not saved');
    rest(db, addJob(db, 'Not saved, failed once'), 1, at(30));
    expect((await read()).jobs).toEqual({ mode: 'saved', waiting: 1, backingOff: 1, gaveUp: 0, perHourCap: 0 });
  });

  it.each(['lazy', 'off'] as const)('%s mode has no backlog: nothing is counted', async (mode) => {
    const { db, read } = await setup({ AI_JOB_ANALYSIS: mode, AI_JOB_ANALYSIS_PER_HOUR: '10' });
    addJob(db, 'Never read');
    rest(db, addJob(db, 'Failed once'), 1, at(30));
    expect((await read()).jobs).toEqual({ mode, waiting: 0, backingOff: 0, gaveUp: 0, perHourCap: 10 });
  });
});

describe('resumes', () => {
  it("counts the uploads waiting, queued and failed for Claude's reading, leaving out disabled accounts", async () => {
    const { ctx, db, read } = await setup({ AI_RESUME_ANALYSIS_PER_HOUR: '5' });
    const owner = await accountId(ctx, 'uploader@example.com');
    const disabled = await accountId(ctx, 'disabled@example.com');
    for (const state of ['waiting', 'waiting', 'queued', 'failed', 'done', 'skipped'] as const) backlogRow(db, owner, state);
    for (const state of ['waiting', 'queued', 'failed'] as const) backlogRow(db, disabled, state);
    disable(db, disabled);
    expect((await read()).resumes).toEqual({ mode: 'auto', waiting: 2, queued: 1, failed: 1, perHourCap: 5 });
  });

  it('AI_RESUME_ANALYSIS=off has no backlog: nothing is counted', async () => {
    const { ctx, db, read } = await setup({ AI_RESUME_ANALYSIS: 'off' });
    backlogRow(db, await accountId(ctx, 'uploader@example.com'), 'waiting');
    expect((await read()).resumes).toEqual({ mode: 'off', waiting: 0, queued: 0, failed: 0, perHourCap: 20 });
  });
});

describe('resume matches', () => {
  it('counts the applications due for a new best match (resume_match_due), leaving out disabled accounts', async () => {
    const { ctx, db, read } = await setup();
    const member = await accountId(ctx, 'member@example.com');
    const disabled = await accountId(ctx, 'disabled@example.com');
    const [first, second, third] = ['One', 'Two', 'Three'].map((title) => addJob(db, `Engineer ${title}`)) as [number, number, number];
    const saved = (userId: string, jobId: number, due: 0 | 1) => {
      const id = insertApplication(db, userId, jobId, 1);
      db.prepare('UPDATE applications SET resume_match_due = ? WHERE id = ?').run(due, id);
    };
    saved(member, first, 1);
    saved(member, second, 1);
    saved(member, third, 0);
    saved(disabled, first, 1);
    disable(db, disabled);
    expect((await read()).matches).toEqual({ due: 2 });
  });
});

describe('the gate', () => {
  it('is shut by an AI hold until it ends', async () => {
    const { ctx, read } = await setup();
    const provider = requireAi(ctx.deps).provider;
    // A stall held for one feature shuts it too: background work waits whenever the seat needs a rest.
    const hold: ProviderHold = {
      scope: 'cover_letter',
      until: TEST_NOW.getTime() + 20 * MINUTE,
      kind: 'stalled',
      reason: 'the CLI gave no output within 30 s',
    };
    vi.spyOn(provider, 'activeHolds').mockReturnValue([hold]);
    expect((await read()).gate).toEqual({ open: false, reason: 'the CLI gave no output within 30 s', retryAt: at(20) });
    ctx.setNow(new Date(at(20)));
    expect((await read()).gate).toEqual({ open: true, reason: null, retryAt: null });
  });

  it('is shut by a usage warning until the window resets', async () => {
    const { ctx, read } = await setup();
    const provider = requireAi(ctx.deps).provider as Required<AiProvider>;
    vi.spyOn(provider, 'lastRateLimit').mockReturnValue({
      status: 'allowed_warning',
      resetsAtMs: TEST_NOW.getTime() + 90 * MINUTE,
      usingOverage: false,
      seenAtMs: TEST_NOW.getTime(),
    });
    expect((await read()).gate).toEqual({ open: false, reason: 'the Claude usage limit is close', retryAt: at(90) });
  });

  const OFF: Array<{ setting: string; env: Record<string, string>; reason: string }> = [
    { setting: 'AI_ENABLED=false', env: { AI_ENABLED: 'false' }, reason: 'AI is turned off (AI_ENABLED=false)' },
    {
      setting: 'AI_CLI_BACKGROUND_SLOTS=0',
      env: { AI_CLI_BACKGROUND_SLOTS: '0' },
      reason: 'background AI work is turned off (AI_CLI_BACKGROUND_SLOTS=0)',
    },
  ];
  it.each(OFF)('is off, with no end time, while $setting; the backlog keeps its count', async ({ env, reason }) => {
    const { db, read } = await setup(env);
    addJob(db, 'Never read');
    const work = await read();
    expect(work.gate).toEqual({ open: false, reason, retryAt: null });
    expect(work.jobs).toMatchObject({ mode: 'ingest', waiting: 1 });
  });
});

describe('with 50,000 jobs', () => {
  it('reads the jobs from indexes, not from their rows, and answers in well under a second', async () => {
    const { db, read } = await setup();
    const params = {
      minText: MIN_TEXT_FOR_AI,
      version: JOB_ANALYSIS_PROMPT_VERSION,
      now: STAMP,
      givenUpAt: AI_FAILURES_BEFORE_GIVING_UP,
    };
    for (const savedOnly of [false, true]) {
      const plan = (db.prepare(`EXPLAIN QUERY PLAN ${jobBacklogSql(savedOnly)}`).all(params) as Array<{ detail: string }>).map(
        (row) => row.detail,
      );
      // content_hash from idx_jobs_hash alone, `active` from an index on it, and a job row only for a text's length.
      expect(plan).toContain('SCAN j USING COVERING INDEX idx_jobs_hash');
      expect(plan.some((line) => /^SEARCH jobs USING COVERING INDEX \w+ \(active=\?\)$/.test(line))).toBe(true);
      expect(plan).toContain('SEARCH d USING INTEGER PRIMARY KEY (rowid=?)');
    }

    // Job n is closed when n is a multiple of 10, and read by Claude unless it is a multiple of 5. Of the 5,000 live
    // ones left, 500 back off (n % 100 = 5) and 500 are given up (n % 100 = 15).
    const company = insertCompany(db, { name: 'Bulk Robotics' });
    const text = 'Build services in Go and PostgreSQL, and run them on Kubernetes in production. '.repeat(3);
    db.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 50000)
       INSERT INTO jobs(company_id, title, description_html, description_text, content_hash, first_seen_at, last_seen_at,
         active, created_at, updated_at)
       SELECT ?, 'Job ' || i, '<p>' || ? || '</p>', ?, 'bulk-' || i, ?, ?, i % 10 <> 0, ?, ? FROM n`,
    ).run(company, text, text, STAMP, STAMP, STAMP, STAMP);
    const number = 'CAST(substr(content_hash, 6) AS INTEGER)';
    db.prepare(
      `INSERT INTO job_analyses(content_hash, source, version, created_at)
       SELECT content_hash, 'ai', ?, ? FROM jobs WHERE ${number} % 5 <> 0`,
    ).run(JOB_ANALYSIS_PROMPT_VERSION, STAMP);
    db.prepare(
      `INSERT INTO job_ai_attempts(content_hash, version, attempts, next_attempt_at, updated_at)
       SELECT content_hash, ?, CASE WHEN ${number} % 100 = 5 THEN 1 ELSE ? END, ?, ? FROM jobs WHERE ${number} % 100 IN (5, 15)`,
    ).run(JOB_ANALYSIS_PROMPT_VERSION, AI_FAILURES_BEFORE_GIVING_UP, at(30), STAMP);

    const started = performance.now();
    const work = await read();
    const ms = performance.now() - started;
    expect(work.jobs).toEqual({ mode: 'ingest', waiting: 4000, backingOff: 500, gaveUp: 500, perHourCap: 0 });
    expect(ms).toBeLessThan(1000);
  }, 60_000);
});
