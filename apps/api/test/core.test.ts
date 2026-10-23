import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildConfig } from '../src/config/env';
import { openMemoryDatabase } from '../src/core/db/connection';
import { migrate, readMigrations } from '../src/core/db/migrate';
import { createTestContext, ORIGIN, type TestContext } from './helpers';

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
});
