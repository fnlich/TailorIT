import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AI_TASK_KINDS, RESUME_ANALYSIS_VERSION, RESUME_SKILLS_STAMP } from '@tailorit/shared';
import { requireAi } from '../src/ai/index';
import { buildConfig } from '../src/config/env';
import { openMemoryDatabase, type Db } from '../src/core/db/connection';
import { migrate, readMigrations } from '../src/core/db/migrate';
import { errorHandler } from '../src/core/http/errors';
import { createMemoryLogger } from '../src/core/log';
import { repoRoot } from '../src/core/paths';
import { getSkillLibrary } from '../src/core/skills-vocabulary';
import { aiTasksFeature } from '../src/features/ai-tasks/index';
import { signIn } from './auth-helpers';
import { createTestContext, ORIGIN, type TestContext } from './helpers';
import { insertApplication, insertJob, insertResume } from './job-fixtures';

let ctx: TestContext | null = null;
afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

describe('migrations', () => {
  it('creates every table of the initial schema and is idempotent', () => {
    const db = openMemoryDatabase();
    const first = migrate(db);
    expect(first.applied[0]).toBe('0001_init');
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name").all() as {
      name: string;
    }[]).map((r) => r.name);
    for (const table of [
      'users',
      'user_sessions',
      'login_codes',
      'user_preferences',
      'stored_files',
      'resumes',
      'user_skills',
      'cover_letters',
      'cover_letter_templates',
      'companies',
      'job_sources',
      'ingest_runs',
      'job_analyses',
      'jobs',
      'job_locations',
      'job_source_links',
      'jobs_fts',
      'user_job_state',
      'user_hidden_companies',
      'job_reports',
      'saved_searches',
      'applications',
      'application_status_events',
      'application_questions',
      'ai_tasks',
      'app_settings',
      'schema_migrations',
    ]) {
      expect(tables, table).toContain(table);
    }
    expect(migrate(db).applied).toEqual([]);
    db.close();
  });

  it('refuses to start when an applied migration file changed', () => {
    const db = openMemoryDatabase();
    const files = readMigrations();
    migrate(db, files);
    const edited = files.map((f, i) => (i === 0 ? { ...f, checksum: 'different' } : f));
    expect(() => migrate(db, edited)).toThrow(/changed after it was applied/);
    db.close();
  });

  it('supports the contentless FTS index used for job search', () => {
    const db = openMemoryDatabase();
    migrate(db);
    db.prepare(
      'INSERT INTO jobs_fts(rowid, title, company_name, locations_text, description_text) VALUES (?, ?, ?, ?, ?)',
    ).run(7, 'Site Reliability Engineer', 'Acme', 'Fremont, CA', 'Kubernetes and Docker');
    const hit = db.prepare("SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH 'kubern*'").get() as { rowid: number };
    expect(hit.rowid).toBe(7);
    db.prepare('DELETE FROM jobs_fts WHERE rowid = ?').run(7);
    expect(db.prepare("SELECT count(*) AS n FROM jobs_fts WHERE jobs_fts MATCH 'kubern*'").get()).toEqual({ n: 0 });
    db.close();
  });

  it('enforces foreign keys', () => {
    const db = openMemoryDatabase();
    migrate(db);
    expect(() =>
      db
        .prepare(
          "INSERT INTO resumes(id, user_id, kind, created_at, updated_at) VALUES ('r1', 'nobody', 'built', 'x', 'x')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
    db.close();
  });
});

// ---------------------------------------------------------------------------------- v2 migrations (0002-0403)

const V2_MIGRATIONS = [
  '0002_ai_resume_analysis_kind',
  '0101_resume_analyses',
  '0301_application_resume_match',
  '0401_job_analysis_facets',
  '0402_job_ai_attempts',
  '0403_job_ai_backlog_index',
];

const DUE_TRIGGERS = [
  'trg_job_analyses_due_insert',
  'trg_job_analyses_due_update',
  'trg_jobs_text_due',
  'trg_resume_analyses_due_insert',
  'trg_resume_analyses_due_update',
  'trg_resumes_release_matches',
  'trg_users_default_resume_due',
];

/** A database migrated up to (not including) `version`; `rest()` applies the remaining files. */
function migratedBefore(version: number): { db: Db; rest: () => { applied: string[] } } {
  const db = openMemoryDatabase();
  const files = readMigrations();
  migrate(db, files.filter((file) => file.version < version));
  return { db, rest: () => migrate(db, files) };
}

const schemaNames = (db: Db, type: 'table' | 'index' | 'trigger') =>
  (db.prepare('SELECT name FROM sqlite_master WHERE type = ? ORDER BY name').all(type) as { name: string }[]).map(
    (row) => row.name,
  );
const columnsOf = (db: Db, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name);

function addUser(db: Db, id: string): void {
  db.prepare("INSERT INTO users(id, email, name, created_at, updated_at) VALUES (?, ?, ?, 'x', 'x')").run(
    id,
    `${id}@example.com`,
    id,
  );
}

/** An application added by hand (no job). */
function insertManualApplication(db: Db, id: string, userId: string): string {
  db.prepare(
    `INSERT INTO applications(id, user_id, title, company_name, employment_type, current_status, tracked_on,
       created_at, updated_at)
     VALUES (?, ?, 'Designer', 'Initech', 'full_time', 1, '2026-10-19', '2026-10-19T00:00:00.000Z',
       '2026-10-19T00:00:00.000Z')`,
  ).run(id, userId);
  return id;
}

/** An application's resume link and match columns. */
const matchOf = (db: Db, id: string) =>
  db
    .prepare('SELECT resume_id, resume_origin, resume_matched_at, resume_match_due FROM applications WHERE id = ?')
    .get(id);
/** No resume, chosen by nobody. */
const UNLINKED = { resume_id: null, resume_origin: null, resume_matched_at: null };

describe('v2 migrations', () => {
  it('applies 0002 to 0403 after 0001, in order', () => {
    const db = openMemoryDatabase();
    const { applied } = migrate(db);
    expect(applied[0]).toBe('0001_init');
    expect(applied.filter((name) => V2_MIGRATIONS.includes(name))).toEqual(V2_MIGRATIONS);
    expect([...applied].sort()).toEqual(applied);

    expect(schemaNames(db, 'table')).toEqual(
      expect.arrayContaining(['resume_analyses', 'resume_analysis_backlog', 'job_ai_attempts', 'ai_tasks']),
    );
    expect(columnsOf(db, 'resume_analyses')).toEqual(
      expect.arrayContaining(['content_hash', 'version', 'experience', 'years_stated', 'person_name']),
    );
    expect(columnsOf(db, 'resume_analysis_backlog')).toEqual(
      expect.arrayContaining(['user_id', 'content_hash', 'version', 'state', 'attempts', 'next_attempt_at']),
    );
    expect(columnsOf(db, 'resume_analysis_backlog')).toContain('last_error');
    expect(columnsOf(db, 'applications')).toEqual(
      expect.arrayContaining(['resume_origin', 'resume_matched_at', 'resume_match_due']),
    );
    expect(columnsOf(db, 'applications')).not.toContain('resume_score');
    expect(columnsOf(db, 'job_analyses')).toEqual(expect.arrayContaining(['soft_skills', 'terms', 'required_years']));
    expect(columnsOf(db, 'job_ai_attempts')).toEqual([
      'content_hash',
      'version',
      'attempts',
      'next_attempt_at',
      'last_error',
      'updated_at',
    ]);
    expect(schemaNames(db, 'index')).toEqual(
      expect.arrayContaining([
        'idx_ai_queue',
        'idx_ai_user',
        'idx_ai_dedupe',
        'idx_resume_analyses_hash',
        'idx_resume_backlog_next',
        'idx_resume_backlog_user',
        'idx_app_saved_job',
        'idx_app_resume',
        'idx_app_match_due',
      ]),
    );
    expect(schemaNames(db, 'trigger')).toEqual(DUE_TRIGGERS);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(migrate(db).applied).toEqual([]);
    db.close();
  });

  it('0002 keeps the tasks of known owners in queue order, drops orphans, and keeps idx_ai_dedupe unique', () => {
    const { db, rest } = migratedBefore(2);
    addUser(db, 'u1');
    const insert = db.prepare(
      `INSERT INTO ai_tasks(id, user_id, kind, status, priority, input, result, error_code, error_message, model,
         attempts, dedupe_key, created_at, started_at, finished_at)
       VALUES (@id, @user, @kind, @status, @priority, @input, @result, @code, @message, @model, @attempts, @key,
         @created, @started, @finished)`,
    );
    const task = (id: string, extra: Record<string, unknown> = {}) =>
      insert.run({
        id,
        user: 'u1',
        kind: 'job_analysis',
        status: 'queued',
        priority: 0,
        input: '{"jobId":1}',
        result: null,
        code: null,
        message: null,
        model: null,
        attempts: 0,
        key: null,
        created: '2026-10-22T12:00:00.000Z',
        started: null,
        finished: null,
        ...extra,
      });
    // The same created_at everywhere: only rowid orders them, and it disagrees with the ids' order.
    task('t-3', { key: 'u1:job_analysis:abc' });
    task('t-1', { user: null, kind: 'cover_letter', priority: 1, input: '{"letter":"x"}' });
    task('t-2', {
      status: 'succeeded',
      result: '{"ok":true}',
      model: 'claude-sonnet-5-5',
      attempts: 1,
      key: 'u1:job_analysis:abc',
      started: '2026-10-22T12:00:01.000Z',
      finished: '2026-10-22T12:00:09.000Z',
    });
    task('t-0', { kind: 'resume_import', status: 'failed', code: 'ai_failed', message: 'The AI request failed.' });
    db.pragma('foreign_keys = OFF');
    task('t-orphan', { user: 'deleted-account' });
    db.pragma('foreign_keys = ON');
    const kept = db.prepare("SELECT * FROM ai_tasks WHERE id <> 't-orphan' ORDER BY rowid").all();
    expect(kept).toHaveLength(4);

    expect(rest().applied[0]).toBe('0002_ai_resume_analysis_kind');
    expect(db.prepare('SELECT * FROM ai_tasks ORDER BY rowid').all()).toEqual(kept);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    // The queue's own order (priority, created_at, rowid) is the one it had.
    const queued = "SELECT id FROM ai_tasks WHERE status = 'queued' ORDER BY priority DESC, created_at, rowid";
    expect(db.prepare(queued).all()).toEqual([{ id: 't-1' }, { id: 't-3' }]);

    const duplicate = /UNIQUE constraint failed: ai_tasks\.dedupe_key/;
    expect(() => task('t-again', { key: 'u1:job_analysis:abc' })).toThrow(duplicate);
    expect(() => task('t-running', { key: 'u1:job_analysis:abc', status: 'running' })).toThrow(duplicate);
    task('t-later', { key: 'u1:job_analysis:abc', status: 'cancelled' }); // a finished task may share the key
    db.prepare("UPDATE ai_tasks SET status = 'succeeded' WHERE id = 't-3'").run();
    task('t-next', { key: 'u1:job_analysis:abc' }); // ...and the key is free again once its task is done
    db.close();
  });

  it('accepts resume_analysis tasks and refuses an unknown kind', async () => {
    const db = openMemoryDatabase();
    migrate(db);
    addUser(db, 'u1');
    const insert = db.prepare(
      "INSERT INTO ai_tasks(id, user_id, kind, status, input, created_at) VALUES (?, 'u1', ?, 'queued', '{}', 'x')",
    );
    insert.run('t1', 'resume_analysis');
    expect(() => insert.run('t2', 'resume_tailoring')).toThrow(/CHECK constraint failed/);
    db.close();

    expect(AI_TASK_KINDS).toContain('resume_analysis');
    ctx = createTestContext({ features: [aiTasksFeature] });
    addUser(ctx.deps.db, 'u1');
    const ai = requireAi(ctx.deps);
    ai.registerHandler('resume_analysis', async (input) => ({ read: input }));
    const { taskId } = ai.enqueue({
      kind: 'resume_analysis',
      userId: 'u1',
      input: { resumeId: 'r1' },
      priority: 'background',
    });
    expect(await ai.waitFor(taskId, 10_000)).toMatchObject({
      kind: 'resume_analysis',
      status: 'succeeded',
      result: { read: { resumeId: 'r1' } },
    });
  });

  it('0301 marks earlier links as chosen by the person, and Saved job rows without a resume as due', () => {
    const { db, rest } = migratedBefore(301);
    addUser(db, 'u1');
    const resume = insertResume(db, 'u1', 'Go, PostgreSQL and Kubernetes');
    const job = () => insertJob(db, { title: 'Backend Engineer' });
    const savedLinked = insertApplication(db, 'u1', job(), 1);
    const savedNone = insertApplication(db, 'u1', job(), 1);
    const appliedNone = insertApplication(db, 'u1', job(), 2);
    const appliedLinked = insertApplication(db, 'u1', job(), 2);
    const archivedSaved = insertApplication(db, 'u1', job(), 1);
    const manual = insertManualApplication(db, 'manual', 'u1');
    db.prepare('UPDATE applications SET resume_id = ? WHERE id IN (?, ?)').run(resume, savedLinked, appliedLinked);
    db.prepare("UPDATE applications SET archived_at = '2026-10-20T00:00:00.000Z' WHERE id = ?").run(archivedSaved);

    rest();
    const byHand = { resume_id: resume, resume_origin: 'user', resume_matched_at: null, resume_match_due: 0 };
    expect(matchOf(db, savedLinked)).toEqual(byHand);
    expect(matchOf(db, appliedLinked)).toEqual(byHand);
    expect(matchOf(db, savedNone)).toEqual({ ...UNLINKED, resume_match_due: 1 });
    for (const id of [appliedNone, archivedSaved, manual]) {
      expect(matchOf(db, id)).toEqual({ ...UNLINKED, resume_match_due: 0 });
    }
    db.close();
  });
});

/**
 * A migrated database with two accounts and an application of every kind. Only `auto` and `fresh` (u1), and `other`
 * and `twin` (u2), are rows TailorIT may choose for: linked to a job, Saved, not archived, automatic or not chosen yet.
 * `twin`'s job has the same text as `auto`'s and `other`'s.
 */
function matchWorld() {
  const db = openMemoryDatabase();
  migrate(db);
  addUser(db, 'u1');
  addUser(db, 'u2');
  const r1 = insertResume(db, 'u1', 'Go and PostgreSQL');
  const r2 = insertResume(db, 'u1', 'React and TypeScript');
  const r3 = insertResume(db, 'u2', 'Rust');
  const job = (title: string) => insertJob(db, { title });
  const [j1, j2, j3, j4, j5, j6] = [job('A'), job('B'), job('C'), job('D'), job('E'), job('F')];
  db.prepare('UPDATE jobs SET content_hash = (SELECT content_hash FROM jobs WHERE id = ?) WHERE id = ?').run(j1, j6);
  const link = db.prepare(
    'UPDATE applications SET resume_id = ?, resume_origin = ?, resume_matched_at = ?, archived_at = ? WHERE id = ?',
  );
  const app = (
    userId: string,
    jobId: number,
    status: 1 | 2,
    set: { resume?: string; origin?: 'auto' | 'user'; archived?: boolean } = {},
  ) => {
    const id = insertApplication(db, userId, jobId, status);
    const at = '2026-10-21T00:00:00.000Z';
    link.run(set.resume ?? null, set.origin ?? null, set.origin ? at : null, set.archived ? at : null, id);
    return id;
  };
  const apps = {
    auto: app('u1', j1, 1, { resume: r1, origin: 'auto' }),
    fresh: app('u1', j2, 1),
    chosen: app('u1', j3, 1, { resume: r2, origin: 'user' }),
    applied: app('u1', j4, 2, { resume: r1, origin: 'auto' }),
    archived: app('u1', j5, 1, { origin: 'auto', archived: true }),
    manual: insertManualApplication(db, 'manual', 'u1'),
    other: app('u2', j1, 1, { resume: r3, origin: 'auto' }),
    twin: app('u2', j6, 1),
  };
  const reset = () => db.prepare('UPDATE applications SET resume_match_due = 0').run();
  reset();
  const dueFlag = db.prepare<[string], { due: number }>(
    'SELECT resume_match_due AS due FROM applications WHERE id = ?',
  );
  /** The applications now due, by name. */
  const due = () =>
    Object.entries(apps)
      .filter(([, id]) => dueFlag.get(id)?.due === 1)
      .map(([name]) => name)
      .sort();
  const contentHash = (jobId: number) =>
    (db.prepare('SELECT content_hash AS hash FROM jobs WHERE id = ?').get(jobId) as { hash: string }).hash;
  return { db, r1, r2, r3, jobs: { j1, j2, j3, j4 }, apps, due, reset, contentHash };
}

describe('resume match triggers (0301)', () => {
  it('a deleted resume releases its applications before its link is cleared; the Saved ones become due', () => {
    const w = matchWorld();
    w.db.prepare('DELETE FROM resumes WHERE id = ?').run(w.r1);
    expect(matchOf(w.db, w.apps.auto)).toEqual({ ...UNLINKED, resume_match_due: 1 });
    expect(matchOf(w.db, w.apps.applied)).toEqual({ ...UNLINKED, resume_match_due: 0 });
    expect(w.due()).toEqual(['auto']);
    // A resume the person chose goes the same way: the choice no longer exists.
    w.db.prepare('DELETE FROM resumes WHERE id = ?').run(w.r2);
    expect(matchOf(w.db, w.apps.chosen)).toEqual({ ...UNLINKED, resume_match_due: 1 });
    expect(w.due()).toEqual(['auto', 'chosen']);
    w.db.close();
  });

  it("a new or changed reading of a resume marks its owner's rows due, and an unchanged one does not", () => {
    const w = matchWorld();
    const upsert = w.db.prepare(
      `INSERT INTO resume_analyses(resume_id, source, version, content_hash, model, created_at)
       VALUES (@resume, @source, @version, @hash, @model, '2026-10-22T12:00:00.000Z')
       ON CONFLICT(resume_id, source) DO UPDATE SET version = excluded.version, content_hash = excluded.content_hash,
         model = excluded.model`,
    );
    const reading = { resume: w.r1, source: 'deterministic', version: 1001, hash: 'h1', model: null as string | null };
    const read = (extra: Partial<typeof reading>) => upsert.run({ ...reading, ...extra });

    read({});
    expect(w.due()).toEqual(['auto', 'fresh']);
    w.reset();
    read({ model: 'claude-sonnet-5-5' }); // the same reading again
    expect(w.due()).toEqual([]);
    read({ hash: 'h2' });
    expect(w.due()).toEqual(['auto', 'fresh']);
    w.reset();
    read({ hash: 'h2', version: 1002 });
    expect(w.due()).toEqual(['auto', 'fresh']);
    w.reset();
    w.db.prepare("UPDATE resume_analyses SET hard_skills = '[\"Go\"]' WHERE resume_id = ?").run(w.r1);
    expect(w.due()).toEqual([]);
    read({ source: 'ai', model: 'claude-sonnet-5-5' }); // Claude's reading of the same upload
    expect(w.due()).toEqual(['auto', 'fresh']);
    w.reset();
    read({ resume: w.r3 }); // another account's resume
    expect(w.due()).toEqual(['other', 'twin']);
    w.db.close();
  });

  it("a new default resume marks that account's rows due, also when deleting the default clears it", () => {
    const w = matchWorld();
    const setDefault = w.db.prepare('UPDATE users SET default_resume_id = ? WHERE id = ?');
    setDefault.run(w.r2, 'u1');
    expect(w.due()).toEqual(['auto', 'fresh']);
    w.reset();
    setDefault.run(w.r2, 'u1'); // the same default again
    w.db.prepare("UPDATE users SET name = 'Renamed' WHERE id = 'u1'").run();
    expect(w.due()).toEqual([]);
    w.db.prepare('DELETE FROM resumes WHERE id = ?').run(w.r2); // the foreign key clears the default
    expect(w.due()).toEqual(['auto', 'chosen', 'fresh']);
    w.db.close();
  });

  it("a posting's new text marks its Saved rows due, for every account", () => {
    const w = matchWorld();
    const setHash = w.db.prepare('UPDATE jobs SET content_hash = ? WHERE id = ?');
    setHash.run('new text', w.jobs.j1);
    expect(w.due()).toEqual(['auto', 'other']);
    w.reset();
    setHash.run('new text', w.jobs.j1); // unchanged
    w.db.prepare("UPDATE jobs SET title = 'Renamed' WHERE id = ?").run(w.jobs.j2);
    setHash.run('newer text', w.jobs.j3); // the person's own choice
    setHash.run('newer text', w.jobs.j4); // applied
    expect(w.due()).toEqual([]);
    w.db.close();
  });

  it("Claude's or the job lake's reading of a posting marks due the Saved rows of every job with that text", () => {
    const w = matchWorld();
    const insert = w.db.prepare(
      `INSERT INTO job_analyses(content_hash, source, version, keywords, created_at)
       VALUES (?, ?, 1, '{"high":[],"low":[]}', '2026-10-22T12:00:00.000Z')`,
    );
    insert.run(w.contentHash(w.jobs.j1), 'deterministic');
    expect(w.due()).toEqual([]);
    const ai = Number(insert.run(w.contentHash(w.jobs.j1), 'ai').lastInsertRowid);
    expect(w.due()).toEqual(['auto', 'other', 'twin']);
    w.reset();
    insert.run(w.contentHash(w.jobs.j2), 'ft_lake');
    expect(w.due()).toEqual(['fresh']);
    w.reset();

    const update = (sql: string, id: number) => w.db.prepare(`UPDATE job_analyses SET ${sql} WHERE id = ?`).run(id);
    update("model = 'claude-sonnet-5-5'", ai);
    update(`keywords = '{"high":[],"low":[]}'`, ai); // the same keywords
    expect(w.due()).toEqual([]);
    update(`keywords = '{"high":[{"term":"Go","synonyms":[]}],"low":[]}'`, ai);
    expect(w.due()).toEqual(['auto', 'other', 'twin']);
    w.reset();
    update('version = 2', ai);
    expect(w.due()).toEqual(['auto', 'other', 'twin']);
    w.reset();
    const deterministic = (
      w.db.prepare("SELECT id FROM job_analyses WHERE source = 'deterministic'").get() as { id: number }
    ).id;
    update(`keywords = '{"high":[{"term":"Go","synonyms":[]}],"low":[]}'`, deterministic);
    expect(w.due()).toEqual([]);
    w.db.close();
  });
});

describe('http core', () => {
  it('answers health', async () => {
    ctx = createTestContext();
    const res = await request(ctx.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, service: 'tailorit-api' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('gives unknown endpoints the standard error body with a request id', async () => {
    ctx = createTestContext();
    const res = await request(ctx.app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
    expect(res.body.error.requestId).toMatch(/^r_/);
    expect(res.headers['x-request-id']).toBe(res.body.error.requestId);
  });

  it('refuses state-changing requests from another origin', async () => {
    ctx = createTestContext();
    const bad = await request(ctx.app).post('/api/nope').set('Origin', 'https://evil.example').send({});
    expect(bad.status).toBe(403);
    expect(bad.body.error.code).toBe('bad_origin');
    const good = await request(ctx.app).post('/api/nope').set('Origin', ORIGIN).send({});
    expect(good.status).toBe(404);
    const loopbackAlias = await request(ctx.app).post('/api/nope').set('Origin', 'http://127.0.0.1:3100').send({});
    expect(loopbackAlias.status).toBe(404);
  });

  it('turns malformed JSON into a validation error', async () => {
    ctx = createTestContext();
    const res = await request(ctx.app)
      .post('/api/nope')
      .set('Origin', ORIGIN)
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('keeps client errors that libraries raise as client errors, not 500s', async () => {
    ctx = createTestContext();
    // Express cannot decode these path parameters: a URIError carrying status 400.
    const font = await request(ctx.app).get('/api/cover-letters/fonts/%E0%A4%A');
    expect(font.status).toBe(400);
    expect(font.body.error).toMatchObject({ code: 'validation_failed', message: 'The request is not valid.' });
    const me = await signIn(ctx, 'decoder@example.com');
    const letter = await me.agent.get('/api/cover-letters/%E0%A4%A');
    expect(letter.status).toBe(400);
    expect(letter.body.error.code).toBe('validation_failed');
    expect(letter.body.error.message).not.toMatch(/decode|%E0/);
    // body-parser refuses a charset it cannot read with 415.
    const charset = await request(ctx.app)
      .post('/api/nope')
      .set('Origin', ORIGIN)
      .set('Content-Type', 'application/json; charset=koi8-r')
      .send('{"a":1}');
    expect(charset.status).toBe(415);
    expect(charset.body.error.code).toBe('validation_failed');
    // None of them is logged as a server error.
    expect((ctx.deps.log as unknown as { lines: string[] }).lines.filter((line) => line.startsWith('error '))).toEqual([]);
  });

  it('answers a library 404 as not_found, other 4xx with their status, and anything else as internal', async () => {
    const log = createMemoryLogger();
    const app = express();
    app.get('/gone', (_req, _res, next) => next(Object.assign(new Error('ENOENT: /srv/private/file'), { status: 404 })));
    app.get('/method', (_req, _res, next) => next(Object.assign(new Error('nope'), { statusCode: 405 })));
    app.get('/boom', (_req, _res, next) => next(new Error('the database is on fire')));
    app.use(errorHandler(log));

    const gone = await request(app).get('/gone');
    expect(gone.status).toBe(404);
    expect(gone.body.error.code).toBe('not_found');
    expect(gone.body.error.message).not.toMatch(/private/);
    const method = await request(app).get('/method');
    expect(method.status).toBe(405);
    expect(method.body.error).toMatchObject({ code: 'validation_failed', message: 'The request is not valid.' });
    const boom = await request(app).get('/boom');
    expect(boom.status).toBe(500);
    expect(boom.body.error.code).toBe('internal');
    expect(log.lines.filter((line) => line.startsWith('error '))).toHaveLength(1);
  });
});

describe('config', () => {
  it('defaults the AI model to claude-sonnet-5-5 and honours per-feature overrides', () => {
    const config = buildConfig({ AI_MODEL_JOB_ANALYSIS: 'claude-haiku-5-5', AI_EFFORT_COVER_LETTER: 'medium' });
    expect(config.ai.model).toBe('claude-sonnet-5-5');
    expect(config.ai.features.resume_import).toEqual({ model: 'claude-sonnet-5-5', effort: 'low' });
    expect(config.ai.features.job_analysis.model).toBe('claude-haiku-5-5');
    expect(config.ai.features.cover_letter.effort).toBe('medium');
  });

  it('never enables development sign-in shortcuts in production', () => {
    const config = buildConfig({ NODE_ENV: 'production', AUTH_DEV_LOG_CODES: 'true', AUTH_DEV_FIXED_CODE: '123456' });
    expect(config.auth.devLogCodes).toBe(false);
    expect(config.auth.devFixedCode).toBeNull();
  });

  it('builds SMTP settings only when host, user and password are all set', () => {
    expect(buildConfig({ SMTP_HOST: 'smtp.example.com' }).auth.smtp).toBeNull();
    const smtp = buildConfig({ SMTP_HOST: 'h', SMTP_USER: 'u@x.com', SMTP_PASS: 'p' }).auth.smtp;
    expect(smtp).toMatchObject({ port: 465, secure: true, from: 'u@x.com' });
  });

  it('explains bad values', () => {
    expect(() => buildConfig({ API_PORT: 'abc' })).toThrow(/API_PORT/);
  });

  it('reads when Claude analyses jobs (lazy until the add-time backlog lands) and caps the background backlog', () => {
    expect(buildConfig({}).ai).toMatchObject({ jobAnalysis: 'ingest', jobAnalysisPerHour: 0 });
    for (const mode of ['ingest', 'saved', 'lazy', 'off'] as const) {
      expect(buildConfig({ AI_JOB_ANALYSIS: mode }).ai.jobAnalysis).toBe(mode);
    }
    expect(() => buildConfig({ AI_JOB_ANALYSIS: 'always' })).toThrow(/AI_JOB_ANALYSIS/);
    expect(buildConfig({ AI_JOB_ANALYSIS_PER_HOUR: '120' }).ai.jobAnalysisPerHour).toBe(120);
    expect(buildConfig({ AI_JOB_ANALYSIS_PER_HOUR: ' ' }).ai.jobAnalysisPerHour).toBe(0);
    expect(() => buildConfig({ AI_JOB_ANALYSIS_PER_HOUR: '-1' })).toThrow(/AI_JOB_ANALYSIS_PER_HOUR/);
  });

  it('reads whether Claude reads uploaded resumes, its hourly cap, and its model and effort', () => {
    const defaults = buildConfig({});
    expect(defaults.ai).toMatchObject({ resumeAnalysis: 'auto', resumeAnalysisPerHour: 20 });
    expect(defaults.ai.features.resume_analysis).toEqual({ model: 'claude-sonnet-5-5', effort: 'low' });
    expect(buildConfig({ AI_RESUME_ANALYSIS: 'off' }).ai.resumeAnalysis).toBe('off');
    expect(() => buildConfig({ AI_RESUME_ANALYSIS: 'sometimes' })).toThrow(/AI_RESUME_ANALYSIS/);
    expect(buildConfig({ AI_RESUME_ANALYSIS_PER_HOUR: '0' }).ai.resumeAnalysisPerHour).toBe(0);
    expect(() => buildConfig({ AI_RESUME_ANALYSIS_PER_HOUR: '2.5' })).toThrow(/AI_RESUME_ANALYSIS_PER_HOUR/);
    const tuned = buildConfig({ AI_MODEL_RESUME_ANALYSIS: 'claude-haiku-5-5', AI_EFFORT_RESUME_ANALYSIS: 'medium' });
    expect(tuned.ai.features.resume_analysis).toEqual({ model: 'claude-haiku-5-5', effort: 'medium' });
  });

  it('finds the Google service account key in the repository root, or where the setting says', () => {
    const keyFile = (value?: string) => {
      const env = value === undefined ? {} : { GOOGLE_SERVICE_ACCOUNT_KEY_FILE: value };
      return buildConfig(env).ingest.googleServiceAccountKeyFile;
    };
    const inRoot = join(repoRoot(), 'service-account-key.json');
    expect(keyFile()).toBe(inRoot);
    expect(keyFile('  ')).toBe(inRoot);
    expect(keyFile('keys/sheets.json')).toBe(resolve(repoRoot(), 'keys', 'sheets.json'));
    const absolute = join(tmpdir(), 'tailorit-keys', 'sheets.json');
    expect(keyFile(absolute)).toBe(absolute);
  });

  it('points test contexts at a Google key that does not exist, never the real one', () => {
    ctx = createTestContext();
    const keyFile = ctx.deps.config.ingest.googleServiceAccountKeyFile;
    expect(keyFile.startsWith(ctx.dataDir)).toBe(true);
    expect(existsSync(keyFile)).toBe(false);
  });
});

/** The skill library each RESUME_SKILLS_STAMP was cut from: sha256 of its hard and soft names, first 16 hex. */
const SKILLS_FINGERPRINTS: Record<number, string> = { 1: '5dee88dc2f65b717' };

describe('resume analysis version', () => {
  it('names the shipped skill library, so a new skills.json reads every resume again', () => {
    const library = getSkillLibrary();
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([library.vocabulary, library.soft]))
      .digest('hex')
      .slice(0, 16);
    expect(
      fingerprint,
      'skills.json changed: bump RESUME_SKILLS_STAMP in packages/shared/src/resume/analysis.ts and add its fingerprint here',
    ).toBe(SKILLS_FINGERPRINTS[RESUME_SKILLS_STAMP]);
    expect(RESUME_ANALYSIS_VERSION % 1000).toBe(RESUME_SKILLS_STAMP);
  });
});
