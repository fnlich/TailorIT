import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lakePosting } from '../src/features/ingest/adapters/ftLake';
import { readLake } from '../src/features/ingest/lake';
import { createIngestService } from '../src/features/ingest/service';
import { insertSource } from '../src/features/ingest/sources';
import { createTestContext, TEST_NOW, type TestContext } from './helpers';

// free_tailor's Job Data Lake is only ever read. These tests read a synthetic lake built in a temp folder, and a COPY
// of the live free_tailor.db (when this machine has one), and check that the original file is untouched.

let ctx: TestContext;
let dir: string;
beforeEach(() => {
  ctx = createTestContext();
  dir = mkdtempSync(join(tmpdir(), 'tailorit-lake-'));
});
afterEach(() => {
  ctx.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const DESCRIPTION = [
  'About the job',
  'Location: Pittsburgh, PA (Hybrid)',
  '',
  'Responsibilities:',
  '• Build Terraform modules for our AWS accounts',
  '• Run Kubernetes clusters with Helm',
  '',
  'Requirements:',
  '• 5+ years of experience with AWS and Terraform',
  '• Experience with Python',
].join('\n');

const ANALYSIS = {
  jobMeta: { title: 'Senior DevOps Engineer', seniority: 'senior', industry: 'technology', department: 'platform' },
  skills: { technical: ['infrastructure automation'], tools: ['Helm', 'Datadog'], soft: ['ownership'] },
  technologies: ['AWS', 'Kubernetes', 'Python'],
  responsibilities: ['terraform module development', 'cluster operations'],
  keywords: { actionVerbs: ['built'], buzzwords: [], mustInclude: ['Terraform', 'AWS', 'Haskell'] },
  filter: { jobType: 'hybrid', region: 'us', usState: 'PA', seniority: 'senior', clearanceRequired: 'none' },
};

/** A lake with the columns free_tailor's job_lake and job_analyses have (the ones TailorIT reads). */
function buildLake(path: string): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE job_analyses (id TEXT PRIMARY KEY, content_hash TEXT NOT NULL, analysis_json TEXT NOT NULL, model_id TEXT NOT NULL DEFAULT '');
    CREATE TABLE job_lake (id INTEGER PRIMARY KEY AUTOINCREMENT, job_hash TEXT NOT NULL, hash_version INTEGER NOT NULL,
      company TEXT NOT NULL DEFAULT '', company_key TEXT NOT NULL DEFAULT '', job_field_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
      salary_min REAL, salary_max REAL, salary_currency TEXT, salary_period TEXT, salary_raw TEXT, job_url TEXT NOT NULL DEFAULT '',
      job_description TEXT NOT NULL DEFAULT '', analysis_id TEXT, requested_by TEXT, source TEXT NOT NULL DEFAULT 'report',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, seen_count INTEGER NOT NULL DEFAULT 1, last_seen_at TEXT,
      job_type TEXT, clearance INTEGER, industry TEXT);
  `);
  db.prepare("INSERT INTO job_analyses VALUES ('a1', 'h1', ?, 'claude-cli-sonnet')").run(JSON.stringify(ANALYSIS));
  const insert = db.prepare(
    'INSERT INTO job_lake(job_hash, hash_version, company, job_field_id, title, salary_min, salary_max, salary_currency, salary_period, ' +
      'salary_raw, job_url, job_description, analysis_id, created_at, updated_at, last_seen_at, job_type, clearance, industry) ' +
      'VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  insert.run('h1', 'Northwind Grid', 'devops', 'Senior DevOps Engineer', 140000, 170000, 'USD', 'annual', '$140k-$170k', 'https://jobs.example.org/nw/1', DESCRIPTION, 'a1', '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z', '2026-10-05T10:00:00.000Z', 'hybrid', 0, 'energy_utilities');
  insert.run('h2', 'Old Co', 'frontend', 'Frontend Developer', null, null, null, null, null, 'https://jobs.example.org/old/2', 'Build React apps.', null, '2026-06-01T10:00:00.000Z', '2026-06-01T10:00:00.000Z', null, 'remote', null, 'not_specified');
  insert.run('h3', 'No Link Ltd', 'backend', 'Backend Engineer', null, null, null, null, null, '', 'Go services.', null, '2026-10-10T10:00:00.000Z', '2026-10-10T10:00:00.000Z', null, '', null, null);
  db.close();
}

describe('free_tailor lake (synthetic)', () => {
  it('reads every row with its analysis in one read-only transaction', () => {
    const path = join(dir, 'free_tailor.db');
    buildLake(path);
    const snapshot = readLake(path);
    expect(snapshot.total).toBe(3);
    expect(snapshot.withAnalysis).toBe(1);
    expect(snapshot.rows[0]).toMatchObject({ id: 1, company: 'Northwind Grid', job_type: 'hybrid', model_id: 'claude-cli-sonnet' });
    expect(() => readLake(join(dir, 'missing.db'))).toThrow(/There is no free_tailor database/);
  });

  it('maps a lake row: arrangement, category, levels, salary, place, clearance, freshness and the stored analysis', () => {
    const path = join(dir, 'free_tailor.db');
    buildLake(path);
    const [fresh, stale, unlinked] = readLake(path).rows.map((row) => lakePosting(row, TEST_NOW, 45));
    expect(fresh).toMatchObject({
      sourceJobId: '1',
      workArrangement: 'hybrid',
      categoryId: 'devops-infrastructure',
      subcategoryIds: ['devops'],
      experienceLevels: ['senior'],
      leadership: 'ic',
      salary: { min: 140000, max: 170000, currency: 'USD', period: 'year', raw: '$140k-$170k' },
      requiresClearance: false,
      industry: 'energy_utilities',
      locations: ['Pittsburgh, PA (Hybrid)'],
      verified: false,
      active: true,
      postedAt: '2026-10-01T10:00:00.000Z',
    });
    expect(fresh!.places).toEqual([{ raw: 'Pennsylvania, US', city: null, region: 'PA', countryCode: 'US', isRemote: false }]);
    expect(fresh!.analysis!.keywords.high.map((group) => group.term)).toEqual(['Terraform', 'AWS']);
    expect(fresh!.analysis!.keywords.low.map((group) => group.term)).toEqual(['Kubernetes', 'Python', 'Helm']);
    expect(stale).toMatchObject({ active: false, analysis: null, workArrangement: 'remote', categoryId: 'software-engineering' });
    expect(unlinked).toBeNull();
  });

  it('imports the lake: stale rows inactive, the stored analysis as source ft_lake, nothing verified', async () => {
    const path = join(dir, 'free_tailor.db');
    buildLake(path);
    const before = statSync(path);
    const source = insertSource(ctx.deps.db, { kind: 'ft_lake', name: 'lake', config: { path } }, TEST_NOW.toISOString());
    const run = await createIngestService(ctx.deps).run(source.id, 'manual').done;
    expect(run).toMatchObject({ status: 'partial', fetched: 3, created: 2, failed: 1 });
    const jobs = ctx.deps.db.prepare('SELECT title, active, last_verified_at, primary_location, work_arrangement, salary_annual_usd_min, analysis_id FROM jobs ORDER BY id').all() as Array<Record<string, unknown>>;
    expect(jobs[0]).toMatchObject({ title: 'Senior DevOps Engineer', active: 1, last_verified_at: null, primary_location: 'Pittsburgh, PA, USA', work_arrangement: 'hybrid', salary_annual_usd_min: 140000 });
    expect(jobs[1]).toMatchObject({ title: 'Frontend Developer', active: 0 });
    const analysis = ctx.deps.db.prepare('SELECT source, keywords, requirements FROM job_analyses WHERE id = ?').get(jobs[0]!.analysis_id) as { source: string; keywords: string; requirements: string };
    expect(analysis.source).toBe('ft_lake');
    expect(JSON.parse(analysis.keywords).high.map((group: { term: string }) => group.term)).toEqual(['Terraform', 'AWS']);
    expect(JSON.parse(analysis.requirements)).toEqual(['5+ years of experience with AWS and Terraform', 'Experience with Python']);
    const after = statSync(path);
    expect([after.size, after.mtimeMs]).toEqual([before.size, before.mtimeMs]);
  });
});

const LIVE_LAKE = join(process.env.LOCALAPPDATA ?? join(process.env.HOME ?? '', 'AppData', 'Local'), 'free_tailor', 'db', 'free_tailor.db');
const hasLiveLake = existsSync(LIVE_LAKE);
if (!hasLiveLake) console.log(`[ingest-lake] skipping the live-lake copy test: no free_tailor database at ${LIVE_LAKE}`);

describe('free_tailor lake (a copy of the live database)', () => {
  it.skipIf(!hasLiveLake)('imports from a temp copy and leaves the original file untouched', async () => {
    const before = statSync(LIVE_LAKE);
    const copy = join(dir, 'free_tailor.db');
    copyFileSync(LIVE_LAKE, copy);
    if (existsSync(`${LIVE_LAKE}-wal`)) copyFileSync(`${LIVE_LAKE}-wal`, `${copy}-wal`);
    const snapshot = readLake(copy);
    const source = insertSource(ctx.deps.db, { kind: 'ft_lake', name: 'lake copy', config: { path: copy } }, TEST_NOW.toISOString());
    const run = await createIngestService(ctx.deps).run(source.id, 'manual').done;
    expect(run.status).not.toBe('failed');
    expect(run.fetched).toBe(snapshot.total);
    expect(run.created + run.updated + run.unchanged + run.failed).toBe(snapshot.total);
    const lakeAnalyses = (ctx.deps.db.prepare("SELECT count(*) AS n FROM job_analyses WHERE source = 'ft_lake'").get() as { n: number }).n;
    console.log(
      `[ingest-lake] copy of ${LIVE_LAKE}: ${snapshot.total} lake rows (${snapshot.withAnalysis} with an analysis) -> ` +
        `${run.created} jobs created, ${run.failed} failed, ${lakeAnalyses} ft_lake analyses stored`,
    );
    const after = statSync(LIVE_LAKE);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });
});
