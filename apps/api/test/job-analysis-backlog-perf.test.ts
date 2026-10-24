import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type Db } from '../src/core/db/connection';
import { migrate } from '../src/core/db/migrate';
import { createIngestService } from '../src/features/ingest/service';
import { insertSource } from '../src/features/ingest/sources';
import type { RawPosting } from '../src/features/ingest/types';
import {
  backlogCandidatesSql,
  CANDIDATES_PER_STEP,
  createJobAnalysisBacklog,
  SET_ASIDE_ROUNDS,
  type JobAnalysisBacklog,
} from '../src/features/job-analysis/backlog';
import { JOB_ANALYSIS_PROMPT_VERSION } from '../src/features/job-analysis/prompt';
import { MIN_TEXT_FOR_AI, readableForAi, type JobAnalysisServiceInternals } from '../src/features/job-analysis/service';
import { AI_SET_ASIDE_UNTIL, saveAnalysis } from '../src/features/job-analysis/store';
import { createTestContext, TEST_NOW, type TestContext } from './helpers';
import { insertApplication, insertCompany, insertJob } from './job-fixtures';

// What a step of the add-time job AI backlog (src/features/job-analysis/backlog.ts) reads: its candidates through
// idx_jobs_ai_backlog (migration 0403), in the order the one sorted query before it answered, and after a step that
// found nothing, no jobs at all until something is written to the database or a backoff ends.

const contexts: TestContext[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const context of contexts.splice(0)) context.cleanup();
});

const MINUTE = 60_000;
/** TEST_NOW plus `minutes`. */
const at = (minutes: number) => new Date(TEST_NOW.getTime() + minutes * MINUTE);
const STAMP = TEST_NOW.toISOString();
const NONE = { status: 'waiting', reason: 'none' } as const;

/** Stands in for the job analysis service: it answers a task for any job and writes nothing. */
const service: Pick<JobAnalysisServiceInternals, 'enqueueTask'> = { enqueueTask: () => ({ taskId: 'stand-in', deduped: false }) };

/** Counts the candidate queries run: the statements made from backlogCandidatesSql, told apart by their SQL. */
function countScans(db: Db): () => number {
  const statements = Object.getPrototypeOf(db.prepare('SELECT 1')) as { all(...params: unknown[]): unknown[] };
  const all = vi.spyOn(statements, 'all');
  return () => all.mock.contexts.filter((statement) => (statement as { source: string }).source.includes('idx_jobs_ai_backlog')).length;
}

/** A server in `env` (ingest mode unless it says otherwise), and the count of candidate queries run on it. */
function setup(env: Record<string, string> = {}) {
  const ctx = createTestContext({ env });
  contexts.push(ctx);
  return { ctx, db: ctx.deps.db, scans: countScans(ctx.deps.db) };
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

const hashOf = (db: Db, jobId: number) =>
  (db.prepare('SELECT content_hash FROM jobs WHERE id = ?').get(jobId) as { content_hash: string }).content_hash;

/** A posting long enough for Claude. */
const addJob = (db: Db, title: string) =>
  insertJob(db, { title, description: `<p>Build ${title} services in Go and PostgreSQL, and run them on Kubernetes in production.</p>` });

/** Claude's analysis of a job's text, of the current prompt version. */
function read(db: Db, jobId: number): void {
  saveAnalysis(db, { ...DRAFT, contentHash: hashOf(db, jobId), source: 'ai', version: JOB_ANALYSIS_PROMPT_VERSION }, STAMP);
}

/** One failure of Claude on a job's text, tried again at `next`. */
function rest(db: Db, jobId: number, next: Date): void {
  db.prepare(
    'INSERT INTO job_ai_attempts(content_hash, version, attempts, next_attempt_at, last_error, updated_at) VALUES (?, ?, 1, ?, ?, ?)',
  ).run(hashOf(db, jobId), JOB_ANALYSIS_PROMPT_VERSION, next.toISOString(), 'Claude answered something unreadable.', STAMP);
}

function addUser(db: Db, id: string): void {
  db.prepare('INSERT INTO users(id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, `${id}@example.com`, id, STAMP, STAMP);
}

const DESCRIPTION =
  '<h3>Requirements</h3><ul><li>Experience building backend services in Go and PostgreSQL</li>' +
  '<li>Running workloads on Kubernetes in production</li></ul>';

/** A Greenhouse posting as a source lists it. */
function posting(id: string, overrides: Partial<RawPosting> = {}): RawPosting {
  return {
    sourceJobId: id,
    title: `Platform Engineer, Team ${id}`,
    company: { name: 'Acme Robotics' },
    descriptionHtml: `${DESCRIPTION}<p>Team ${id} owns its own corner of the platform.</p>`,
    url: `https://jobs.example.com/acme/${id}`,
    locations: ['Remote - US'],
    ...overrides,
  };
}

/** 96 bytes, so the candidate query keeps it; 32 characters, so a step does not ask Claude about it. */
const SHORT = '<p>職務内容職務内容職務内容職務内容職務内容職務内容職務内容職務内容</p>';

describe('a step', () => {
  it('passes over newer texts too short once counted in characters, to the older jobs in the room they leave', () => {
    const { ctx, db } = setup();
    const backlog = createJobAnalysisBacklog(ctx.deps, service);
    for (const minutes of [10, 20]) insertJob(db, { title: `Newer ${minutes}`, description: SHORT, firstSeenAt: at(minutes).toISOString() });
    const older = addJob(db, 'Older');
    expect(backlog.tick()).toMatchObject({ status: 'queued', jobId: older });
  });

  /** `count` newer jobs whose texts (each its own) are too short for Claude once counted in characters. */
  const addShortJobs = (db: Db, count: number) => {
    for (let n = 1; n <= count; n += 1) insertJob(db, { title: `Newer ${n}`, description: SHORT, firstSeenAt: at(n).toISOString() });
  };
  const setAside = (db: Db) =>
    (db.prepare('SELECT count(*) AS n FROM job_ai_attempts WHERE next_attempt_at = ?').get(AI_SET_ASIDE_UNTIL) as { n: number }).n;

  it('sets those texts aside for good, so more of them than a round reads never keep it from the jobs after them', () => {
    const { ctx, db } = setup();
    const backlog = createJobAnalysisBacklog(ctx.deps, service);
    addShortJobs(db, CANDIDATES_PER_STEP + 5);
    const older = addJob(db, 'Older');
    expect(backlog.tick()).toMatchObject({ status: 'queued', jobId: older });
    expect(setAside(db)).toBe(CANDIDATES_PER_STEP + 5);
    // Read, the older one leaves nothing: the texts set aside are no longer candidates.
    read(db, older);
    expect(backlog.tick()).toMatchObject(NONE);
    // A new prompt version reads them again.
    expect(
      db.prepare(backlogCandidatesSql('newer', false)).all({ ...paramsAt(TEST_NOW, at(0), 50), version: JOB_ANALYSIS_PROMPT_VERSION + 1 }),
    ).toHaveLength(CANDIDATES_PER_STEP + 5);
  });

  it('a step sets aside SET_ASIDE_ROUNDS rounds of them at most, and the next one carries on', () => {
    const { ctx, db } = setup();
    const backlog = createJobAnalysisBacklog(ctx.deps, service);
    addShortJobs(db, SET_ASIDE_ROUNDS * CANDIDATES_PER_STEP + 10);
    const older = addJob(db, 'Older');
    expect(backlog.tick()).toMatchObject(NONE);
    expect(setAside(db)).toBe(SET_ASIDE_ROUNDS * CANDIDATES_PER_STEP);
    expect(backlog.tick()).toMatchObject({ status: 'queued', jobId: older });
    expect(setAside(db)).toBe(SET_ASIDE_ROUNDS * CANDIDATES_PER_STEP + 10);
  });
});

describe('after a step that found nothing', () => {
  it('reads no jobs while nothing is written; a backoff ending or a job added makes it look again', () => {
    const { ctx, db, scans } = setup();
    read(db, addJob(db, 'Read by Claude'));
    const resting = addJob(db, 'Failed once');
    rest(db, resting, at(5));
    const backlog = createJobAnalysisBacklog(ctx.deps, service);
    expect(backlog.tick()).toMatchObject(NONE);
    const looked = scans();
    expect(looked).toBeGreaterThan(0);
    // Nothing written, the backoff still on: the next steps read no jobs.
    for (const minutes of [0, 1, 4]) {
      ctx.setNow(at(minutes));
      expect(backlog.tick()).toMatchObject(NONE);
    }
    expect(scans()).toBe(looked);
    // The backoff ends: the step looks again, on time.
    ctx.setNow(at(5));
    expect(backlog.tick()).toMatchObject({ status: 'queued', jobId: resting });

    read(db, resting);
    expect(backlog.tick()).toMatchObject(NONE);
    const again = scans();
    expect(backlog.tick()).toMatchObject(NONE);
    expect(scans()).toBe(again);
    const added = addJob(db, 'Added');
    expect(backlog.tick()).toMatchObject({ status: 'queued', jobId: added });
  });

  it('ingest adding, rewriting or reopening a job makes the next step look again', async () => {
    const { ctx, db, scans } = setup();
    const backlog = createJobAnalysisBacklog(ctx.deps, service);
    const source = insertSource(db, { kind: 'greenhouse', name: 'acme', config: {} }, STAMP);
    let listing: RawPosting[] = [];
    const ingest = createIngestService(ctx.deps, {
      adapters: { greenhouse: { kind: 'greenhouse', fetch: async () => ({ postings: listing, complete: true, failures: [] }) } },
    });
    /** Ingests `postings` as the source's whole listing: a posting it leaves out is closed. */
    const run = async (...postings: RawPosting[]) => {
      listing = postings;
      await ingest.run(source.id, 'manual').done;
    };
    const jobOf = (sourceJobId: string) =>
      (db.prepare('SELECT job_id FROM job_source_links WHERE source_job_id = ?').get(sourceJobId) as { job_id: number }).job_id;
    /** The next step finds nothing, and the one after reads no jobs. */
    const settled = () => {
      expect(backlog.tick()).toMatchObject(NONE);
      const looked = scans();
      expect(backlog.tick()).toMatchObject(NONE);
      expect(scans()).toBe(looked);
    };

    await run(posting('1'), posting('2'));
    read(db, jobOf('1'));
    // The second is no longer listed: closed before Claude read it.
    await run(posting('1'));
    settled();

    await run(posting('1'), posting('3'));
    expect(backlog.tick()).toMatchObject({ status: 'queued', jobId: jobOf('3') });
    read(db, jobOf('3'));
    settled();

    const rewritten = posting('1', { descriptionHtml: `${DESCRIPTION}<p>Team 1 also shares the on-call rotation.</p>` });
    await run(rewritten, posting('3'));
    expect(backlog.tick()).toMatchObject({ status: 'queued', jobId: jobOf('1') });
    read(db, jobOf('1'));
    settled();

    await run(rewritten, posting('2'), posting('3'));
    expect(backlog.tick()).toMatchObject({ status: 'queued', jobId: jobOf('2') });
  });

  it('in saved mode, a save makes the next step look again', () => {
    const { ctx, db, scans } = setup({ AI_JOB_ANALYSIS: 'saved' });
    addUser(db, 'u1');
    const job = addJob(db, 'Platform Engineer');
    const backlog = createJobAnalysisBacklog(ctx.deps, service);
    expect(backlog.tick()).toMatchObject(NONE);
    const looked = scans();
    expect(backlog.tick()).toMatchObject(NONE);
    expect(scans()).toBe(looked);
    insertApplication(db, 'u1', job, 1);
    expect(backlog.tick()).toMatchObject({ status: 'queued', jobId: job });
  });

  it('a job another connection adds (a command-line run, say) makes the next step look again', () => {
    const { ctx, scans } = setup();
    // The database as a file, as the server keeps it, and a second connection to it.
    const server = openDatabase(ctx.dataDir);
    migrate(server);
    const other = openDatabase(ctx.dataDir);
    try {
      const backlog = createJobAnalysisBacklog({ ...ctx.deps, db: server }, service);
      expect(backlog.tick()).toMatchObject(NONE);
      const looked = scans();
      expect(backlog.tick()).toMatchObject(NONE);
      expect(scans()).toBe(looked);
      const added = addJob(other, 'Added elsewhere');
      expect(backlog.tick()).toMatchObject({ status: 'queued', jobId: added });
    } finally {
      other.close();
      server.close();
    }
  });
});

// ------------------------------------------------------------------------------------------------ 50,000 jobs

/** A job's number in bulkJobs, from its text hash. */
const NUMBER = 'CAST(substr(content_hash, 6) AS INTEGER)';

/**
 * 50,000 jobs: job n first seen (n / 200) minutes after TEST_NOW less 125 (200 to a minute; jobs 1 to 24,999 before
 * TEST_NOW, the release) and closed when n % 10 = 0. Claude has read every text unless n % 5 = 0, so 5,000 live jobs
 * wait, some of them backing off (n % 100 = 5), no longer (n % 100 = 15) or for another prompt version (n % 100 = 35),
 * some read by the lake (n % 50 = 25) or with an older prompt (n % 50 = 45), which leaves them waiting, some too short
 * (n % 1000 = 75) or long enough in bytes but blank once trimmed (n % 1000 = 995, the newest of them all). Two accounts
 * have saved n % 250 = 5; one applied to n % 250 = 55 and archived its save of n % 250 = 105.
 */
function bulkJobs(db: Db): void {
  const company = insertCompany(db, { name: 'Bulk Robotics' });
  const text = 'Build services in Go and PostgreSQL, and run them on Kubernetes in production. '.repeat(3);
  db.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 50000)
     INSERT INTO jobs(company_id, title, description_html, description_text, content_hash, first_seen_at, last_seen_at,
       active, created_at, updated_at)
     SELECT @company, 'Job ' || i, '<p>' || @text || '</p>',
       CASE i % 1000 WHEN 75 THEN 'Go and SQL.' WHEN 995 THEN printf('%100s', 'Go.') ELSE @text END, 'bulk-' || i,
       strftime('%Y-%m-%dT%H:%M:%fZ', @start, '+' || (i / 200) || ' minutes'), @stamp, i % 10 <> 0, @stamp, @stamp
     FROM n`,
  ).run({ company, text, start: at(-125).toISOString(), stamp: STAMP });
  const analyses = (where: string, source: string, version: number) =>
    db
      .prepare(`INSERT INTO job_analyses(content_hash, source, version, created_at) SELECT content_hash, ?, ?, ? FROM jobs WHERE ${where}`)
      .run(source, version, STAMP);
  analyses(`${NUMBER} % 5 <> 0`, 'ai', JOB_ANALYSIS_PROMPT_VERSION);
  analyses(`${NUMBER} % 50 = 25`, 'ft_lake', 1);
  analyses(`${NUMBER} % 50 = 45`, 'ai', JOB_ANALYSIS_PROMPT_VERSION - 1);
  db.prepare(
    `INSERT INTO job_ai_attempts(content_hash, version, attempts, next_attempt_at, updated_at)
     SELECT content_hash, CASE ${NUMBER} % 100 WHEN 35 THEN @version - 1 ELSE @version END, 1,
       CASE ${NUMBER} % 100 WHEN 15 THEN @over ELSE @later END, @stamp
     FROM jobs WHERE ${NUMBER} % 100 IN (5, 15, 35)`,
  ).run({ version: JOB_ANALYSIS_PROMPT_VERSION, over: at(-1).toISOString(), later: at(30).toISOString(), stamp: STAMP });
  addUser(db, 'u1');
  addUser(db, 'u2');
  db.prepare(
    `INSERT INTO applications(id, user_id, job_id, title, company_name, employment_type, current_status, archived_at,
       tracked_on, created_at, updated_at)
     SELECT u.id || '-' || j.id, u.id, j.id, j.title, 'Bulk Robotics', 'full_time', CASE ${NUMBER} % 250 WHEN 55 THEN 2 ELSE 1 END,
       CASE ${NUMBER} % 250 WHEN 105 THEN @stamp END, '2026-10-19', @stamp, @stamp
     FROM jobs j JOIN users u ON u.id = 'u1' OR (u.id = 'u2' AND ${NUMBER} % 250 = 5)
     WHERE ${NUMBER} % 250 IN (5, 55, 105)`,
  ).run({ stamp: STAMP });
}

/** The backlog's candidate query before migration 0403: one query over every live job, sorted in full. */
const oneQuerySql = (savedOnly: boolean) =>
  'SELECT j.id FROM jobs j WHERE j.active = 1 AND octet_length(j.description_text) >= @minText ' +
  "AND NOT EXISTS (SELECT 1 FROM job_analyses a WHERE a.content_hash = j.content_hash AND a.source = 'ai' AND a.version = @version) " +
  'AND NOT EXISTS (SELECT 1 FROM job_ai_attempts t WHERE t.content_hash = j.content_hash AND t.version = @version ' +
  'AND t.next_attempt_at > @now) ' +
  (savedOnly ? 'AND EXISTS (SELECT 1 FROM applications p WHERE p.job_id = j.id AND p.current_status = 1 AND p.archived_at IS NULL) ' : '') +
  'ORDER BY (j.first_seen_at >= @since) DESC, j.first_seen_at DESC, j.id DESC LIMIT @limit';

const paramsAt = (now: Date, since: Date, limit: number) => ({
  minText: MIN_TEXT_FOR_AI,
  version: JOB_ANALYSIS_PROMPT_VERSION,
  now: now.toISOString(),
  since: since.toISOString(),
  limit,
});

/** A step and how long it took. */
function timedTick(backlog: JobAnalysisBacklog) {
  const started = performance.now();
  const step = backlog.tick();
  return { step, ms: performance.now() - started };
}

describe('with 50,000 jobs', () => {
  it('walks idx_jobs_ai_backlog in order: no scan of jobs, no sort, and a job row opened last, for a length', () => {
    const { db } = setup();
    bulkJobs(db);
    for (const savedOnly of [false, true]) {
      for (const part of ['newer', 'older'] as const) {
        const sql = backlogCandidatesSql(part, savedOnly);
        const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(paramsAt(TEST_NOW, TEST_NOW, 25)) as Array<{ detail: string }>).map(
          (row) => row.detail,
        );
        expect(plan[0]).toBe(`SEARCH j USING COVERING INDEX idx_jobs_ai_backlog (active=? AND first_seen_at${part === 'newer' ? '>' : '<'}?)`);
        expect(plan.filter((line) => line.startsWith('SCAN') || line.includes('TEMP B-TREE'))).toEqual([]);
        // The subqueries in the order they run: the saved check, the two lookups (indexes only), the text's length.
        expect(plan.filter((line) => line.startsWith('SEARCH')).slice(1)).toEqual([
          ...(savedOnly ? ['SEARCH p USING INDEX idx_app_saved_job (job_id=?)'] : []),
          'SEARCH a USING COVERING INDEX sqlite_autoindex_job_analyses_1 (content_hash=? AND source=? AND version=?)',
          'SEARCH t USING INDEX sqlite_autoindex_job_ai_attempts_1 (content_hash=? AND version=?)',
          'SEARCH d USING INTEGER PRIMARY KEY (rowid=?)',
        ]);
      }
    }
  }, 60_000);

  it('finds the jobs the one sorted query found, in its order; a step queues the first readable one', () => {
    const { ctx, db } = setup();
    bulkJobs(db);
    const ids = (sql: string, params: object) => (db.prepare(sql).all(params) as Array<{ id: number }>).map((row) => row.id);
    // The release before every job, in the middle (TEST_NOW), among the newest 200, and after every job.
    const releases = [at(-1440), at(0), at(124), at(1440)];
    let spanned = false;
    for (const savedOnly of [false, true]) {
      for (const now of [at(0), at(31)]) {
        for (const since of releases) {
          const all = ids(oneQuerySql(savedOnly), paramsAt(now, since, 50_000));
          expect(all.length).toBeGreaterThan(savedOnly ? 50 : 3000);
          const newer = (limit: number) => ids(backlogCandidatesSql('newer', savedOnly), paramsAt(now, since, limit));
          const older = (limit: number) => ids(backlogCandidatesSql('older', savedOnly), paramsAt(now, since, limit));
          expect([...newer(50_000), ...older(50_000)]).toEqual(all);
          // A step's 25 candidates: the older ones in the room the newer ones leave.
          const first = newer(25);
          const rest = first.length < 25 ? older(25 - first.length) : [];
          if (first.length > 0 && rest.length > 0) spanned = true;
          expect([...first, ...rest]).toEqual(ids(oneQuerySql(savedOnly), paramsAt(now, since, 25)));
        }
      }
    }
    expect(spanned).toBe(true);

    // The step's own candidates (the release at TEST_NOW): the newest is blank once trimmed, so it takes the next.
    const top = ids(oneQuerySql(false), paramsAt(TEST_NOW, TEST_NOW, 25));
    const readable = (id: number) =>
      readableForAi((db.prepare('SELECT description_text FROM jobs WHERE id = ?').get(id) as { description_text: string }).description_text);
    expect(readable(top[0]!)).toBe(false);
    const backlog = createJobAnalysisBacklog(ctx.deps, service);
    expect(backlog.tick()).toMatchObject({ status: 'queued', jobId: top.find(readable) });
  }, 60_000);

  it('takes milliseconds a step: with jobs to read, with none, and with none again', { retry: 2, timeout: 60_000 }, () => {
    const { ctx, db, scans } = setup();
    bulkJobs(db);
    const backlog = createJobAnalysisBacklog(ctx.deps, service);
    // Jobs to read near the top: the step reads a few index entries.
    const busy = timedTick(backlog);
    expect(busy.step).toMatchObject({ status: 'queued' });
    // None left (every text read, or backing off): every live job's entry, the newer ones and then the older ones.
    db.prepare(
      `INSERT OR IGNORE INTO job_analyses(content_hash, source, version, created_at)
       SELECT content_hash, 'ai', ?, ? FROM jobs WHERE ${NUMBER} % 100 <> 5`,
    ).run(JOB_ANALYSIS_PROMPT_VERSION, STAMP);
    const idle = timedTick(backlog);
    expect(idle.step).toMatchObject(NONE);
    const looked = scans();
    // And again, nothing written since: no job read.
    const again = timedTick(backlog);
    expect(again.step).toMatchObject(NONE);
    expect(scans()).toBe(looked);
    expect(busy.ms).toBeLessThan(100);
    expect(idle.ms).toBeLessThan(100);
    expect(again.ms).toBeLessThan(10);
  });
});
