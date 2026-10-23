import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIngestService, type IngestService } from '../src/features/ingest/service';
import { insertSource } from '../src/features/ingest/sources';
import type { FetchResult, RawPosting, SourceAdapter, SourceKind } from '../src/features/ingest/types';
import { createTestContext, TEST_NOW, type TestContext } from './helpers';

let ctx: TestContext;
beforeEach(() => {
  ctx = createTestContext();
});
afterEach(() => ctx.cleanup());

const LONG = 'You will design, build and run services with Go, Kubernetes and PostgreSQL. '.repeat(4);

function posting(id: string, overrides: Partial<RawPosting> = {}): RawPosting {
  return {
    sourceJobId: id,
    title: `Platform Engineer, Team ${id}`,
    company: { name: 'Acme Robotics, Inc.' },
    descriptionHtml: `<h3>Responsibilities</h3><ul><li>Run the platform for job ${id}</li></ul><p>${LONG}</p><h3>Requirements</h3><ul><li>5+ years of experience with Kubernetes</li></ul>`,
    url: `https://jobs.example.com/acme/${id}`,
    locations: ['Austin, TX'],
    postedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

/** A service whose adapter for `kind` answers what `next()` returns (or throws). */
function serviceWith(kind: SourceKind, next: () => FetchResult | Promise<FetchResult>): IngestService {
  const adapter: SourceAdapter = { kind, fetch: async () => next() };
  return createIngestService(ctx.deps, { adapters: { [kind]: adapter } });
}

const listing = (postings: RawPosting[], complete = true): FetchResult => ({ postings, complete, failures: [] });

function addSource(kind: SourceKind, name: string = kind) {
  return insertSource(ctx.deps.db, { kind, name, config: {} }, TEST_NOW.toISOString());
}

const count = (sql: string, ...params: unknown[]) =>
  (ctx.deps.db.prepare(sql).get(...params) as { n: number }).n;

function jobRow(id: number) {
  return ctx.deps.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown>;
}

function ftsIds(query: string): number[] {
  return (ctx.deps.db.prepare('SELECT rowid AS id FROM jobs_fts WHERE jobs_fts MATCH ? ORDER BY rowid').all(query) as Array<{ id: number }>).map(
    (row) => row.id,
  );
}

describe('upsert', () => {
  it('creates jobs, companies, locations, links, FTS rows and deterministic analyses', async () => {
    const source = addSource('greenhouse');
    const service = serviceWith('greenhouse', () => listing([posting('1'), posting('2', { company: { name: 'ACME ROBOTICS' } }), posting('3')]));
    const run = await service.run(source.id, 'manual').done;
    expect(run).toMatchObject({ status: 'succeeded', fetched: 3, created: 3, updated: 0, unchanged: 0, failed: 0 });
    expect(count('SELECT count(*) AS n FROM jobs')).toBe(3);
    expect(count('SELECT count(*) AS n FROM companies')).toBe(1);
    expect(count('SELECT count(*) AS n FROM job_source_links WHERE source_id = ?', source.id)).toBe(3);
    expect(count('SELECT count(*) AS n FROM job_locations')).toBe(3);
    const job = ctx.deps.db.prepare("SELECT * FROM jobs WHERE title = 'Platform Engineer, Team 2'").get() as Record<string, unknown>;
    expect(job).toMatchObject({
      link_key: 'https://jobs.example.com/acme/2',
      primary_location: 'Austin, TX, USA',
      location_count: 1,
      active: 1,
      category_id: 'devops-infrastructure',
      experience_levels: '["senior"]',
      last_verified_at: TEST_NOW.toISOString(),
    });
    expect(ftsIds('kubernetes')).toHaveLength(3);
    expect(ftsIds('title:"Team 2"')).toEqual([job.id]);
    expect(ftsIds('company_name:acme')).toHaveLength(3);
    expect(ftsIds('locations_text:austin')).toHaveLength(3);
    const analysis = ctx.deps.db.prepare('SELECT * FROM job_analyses WHERE id = ?').get(job.analysis_id) as Record<string, unknown>;
    expect(analysis).toMatchObject({ source: 'deterministic', content_hash: job.content_hash });
    expect(JSON.parse(String(analysis.requirements))).toEqual(['5+ years of experience with Kubernetes']);
  });

  it('is idempotent: a second run of the same listing rewrites nothing and only moves the seen times', async () => {
    const source = addSource('greenhouse');
    let postings = [posting('1'), posting('2')];
    const service = serviceWith('greenhouse', () => listing(postings));
    await service.run(source.id, 'manual').done;
    const before = jobRow(1);
    ctx.setNow(new Date(TEST_NOW.getTime() + 3_600_000));
    const again = await service.run(source.id, 'manual').done;
    expect(again).toMatchObject({ status: 'succeeded', created: 0, updated: 0, unchanged: 2 });
    expect(count('SELECT count(*) AS n FROM jobs')).toBe(2);
    expect(count('SELECT count(*) AS n FROM job_source_links')).toBe(2);
    expect(count('SELECT count(*) AS n FROM job_analyses')).toBe(2);
    const after = jobRow(1);
    expect(after.updated_at).toBe(before.updated_at);
    expect(after.last_seen_at).not.toBe(before.last_seen_at);
    expect(after.last_verified_at).toBe(new Date(TEST_NOW.getTime() + 3_600_000).toISOString());

    // A changed posting is rewritten, FTS row and all.
    postings = [posting('1', { title: 'Reliability Engineer 1' }), posting('2')];
    const changed = await service.run(source.id, 'manual').done;
    expect(changed).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
    expect(jobRow(1).title).toBe('Reliability Engineer 1');
    expect(ftsIds('title:reliability')).toEqual([1]);
    expect(ftsIds('title:"Team 1"')).toEqual([]);
    expect(count('SELECT count(*) AS n FROM jobs_fts')).toBe(2);
  });

  it('saves the rest of a batch when one posting is not a job', async () => {
    const source = addSource('lever');
    const service = serviceWith('lever', () => listing([posting('1'), posting('2', { title: '' }), posting('3')]));
    const run = await service.run(source.id, 'manual').done;
    expect(run).toMatchObject({ status: 'partial', created: 2, failed: 1 });
    expect(run.log.join('\n')).toMatch(/was not saved: The posting has no title/);
  });

  it('runs a source once at a time', async () => {
    const source = addSource('ashby');
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const service = serviceWith('ashby', async () => {
      await gate;
      return listing([posting('1')]);
    });
    const first = service.run(source.id, 'manual');
    expect(service.isRunning(source.id)).toBe(true);
    expect(() => service.run(source.id, 'manual')).toThrow(/already running/);
    release();
    await first.done;
    expect(service.isRunning(source.id)).toBe(false);
  });
});

describe('deactivation', () => {
  it('closes missing postings only after a successful, complete listing, and reopens them when they return', async () => {
    const source = addSource('greenhouse');
    let next: () => FetchResult | Promise<FetchResult> = () => listing([posting('1'), posting('2'), posting('3')]);
    const service = serviceWith('greenhouse', () => next());
    await service.run(source.id, 'manual').done;
    const live = () => count('SELECT count(*) AS n FROM jobs WHERE active = 1');

    next = () => Promise.reject(new Error('network down'));
    const failed = await service.run(source.id, 'manual').done;
    expect(failed).toMatchObject({ status: 'failed', deactivated: 0 });
    expect(failed.log.join('\n')).toMatch(/Nothing was closed/);
    expect(live()).toBe(3);

    next = () => listing([posting('1'), posting('2')], false);
    const partial = await service.run(source.id, 'manual').done;
    expect(partial).toMatchObject({ status: 'partial', deactivated: 0 });
    expect(live()).toBe(3);

    ctx.setNow(new Date('2026-10-23T08:00:00.000Z'));
    next = () => listing([posting('1'), posting('2')]);
    const complete = await service.run(source.id, 'manual').done;
    expect(complete).toMatchObject({ status: 'succeeded', deactivated: 1, unchanged: 2 });
    expect(live()).toBe(2);
    const closed = ctx.deps.db.prepare("SELECT j.active, j.closed_at, l.missing_since FROM jobs j JOIN job_source_links l ON l.job_id = j.id WHERE l.source_job_id = '3'").get();
    expect(closed).toEqual({ active: 0, closed_at: '2026-10-23T08:00:00.000Z', missing_since: '2026-10-23T08:00:00.000Z' });

    next = () => listing([posting('1'), posting('2'), posting('3')]);
    await service.run(source.id, 'manual').done;
    expect(live()).toBe(3);
    expect(ctx.deps.db.prepare("SELECT closed_at FROM jobs WHERE title = 'Platform Engineer, Team 3'").get()).toEqual({ closed_at: null });
  });

  it('keeps a job live while another source still lists it', async () => {
    const board = addSource('greenhouse');
    const sheet = addSource('csv');
    ctx.deps.db.prepare('UPDATE job_sources SET deactivate_missing = 1 WHERE id = ?').run(sheet.id);
    let boardPostings = [posting('1')];
    const service = createIngestService(ctx.deps, {
      adapters: {
        greenhouse: { kind: 'greenhouse', fetch: async () => listing(boardPostings) },
        csv: { kind: 'csv', fetch: async () => listing([posting('row-1', { url: 'https://jobs.example.com/acme/1' })]) },
      },
    });
    await service.run(board.id, 'manual').done;
    await service.run(sheet.id, 'upload').done;
    expect(count('SELECT count(*) AS n FROM jobs')).toBe(1);
    boardPostings = [];
    const run = await service.run(board.id, 'manual').done;
    expect(run.deactivated).toBe(0);
    expect(count('SELECT count(*) AS n FROM jobs WHERE active = 1')).toBe(1);
  });

  it('keeps stale postings (the lake\'s old rows) inactive from the start', async () => {
    const source = addSource('ft_lake');
    const service = serviceWith('ft_lake', () => listing([posting('7', { active: false, verified: false })]));
    const run = await service.run(source.id, 'manual').done;
    expect(run.created).toBe(1);
    expect(jobRow(1)).toMatchObject({ active: 0, last_verified_at: null, closed_at: TEST_NOW.toISOString() });
  });
});

describe('cross-source dedupe and precedence', () => {
  it('matches by link and lets the higher-precedence source own the fields', async () => {
    const seed = addSource('seed');
    const board = addSource('greenhouse');
    let seedTitle = 'Platform Engineer (demo)';
    const service = createIngestService(ctx.deps, {
      adapters: {
        seed: { kind: 'seed', fetch: async () => listing([posting('seed-1', { title: seedTitle, url: 'https://jobs.example.com/acme/1?utm_source=demo' })]) },
        greenhouse: { kind: 'greenhouse', fetch: async () => listing([posting('1', { title: 'Platform Engineer, Infrastructure' })]) },
      },
    });
    await service.run(seed.id, 'manual').done;
    const viaBoard = await service.run(board.id, 'manual').done;
    expect(viaBoard).toMatchObject({ created: 0, updated: 1 });
    expect(count('SELECT count(*) AS n FROM jobs')).toBe(1);
    expect(count('SELECT count(*) AS n FROM job_source_links')).toBe(2);
    expect(jobRow(1).title).toBe('Platform Engineer, Infrastructure');

    // The seed changes, but the board owns the job: its title stays.
    seedTitle = 'Platform Engineer (demo, edited)';
    const reseeded = await service.run(seed.id, 'manual').done;
    expect(reseeded.updated).toBe(1);
    expect(jobRow(1).title).toBe('Platform Engineer, Infrastructure');
  });

  it('matches by company, title and text across sources, never within one', async () => {
    const board = addSource('lever');
    const sheet = addSource('json');
    const same = { title: 'Administrative Business Partner', descriptionHtml: `<p>${LONG}</p>` };
    const service = createIngestService(ctx.deps, {
      adapters: {
        // One board, two postings that differ only by place: two jobs.
        lever: { kind: 'lever', fetch: async () => listing([posting('a', { ...same, locations: ['London, UK'] }), posting('b', { ...same, locations: ['Singapore'] })]) },
        json: { kind: 'json', fetch: async () => listing([posting('x', { ...same, company: { name: 'Acme Robotics' }, url: 'https://elsewhere.example/9' })]) },
      },
    });
    const first = await service.run(board.id, 'manual').done;
    expect(first.created).toBe(2);
    const second = await service.run(sheet.id, 'upload').done;
    expect(second.created).toBe(0);
    expect(count('SELECT count(*) AS n FROM jobs')).toBe(2);
    expect(count('SELECT count(*) AS n FROM job_source_links')).toBe(3);
  });

  it('fills company details a later source knows', async () => {
    const board = addSource('greenhouse');
    const seed = addSource('seed');
    const service = createIngestService(ctx.deps, {
      adapters: {
        greenhouse: { kind: 'greenhouse', fetch: async () => listing([posting('1')]) },
        seed: {
          kind: 'seed',
          fetch: async () =>
            listing([posting('s1', { company: { name: 'Acme Robotics', tagline: 'Robots that lift', employees: 300, website: 'acme.example' } })]),
        },
      },
    });
    await service.run(board.id, 'manual').done;
    await service.run(seed.id, 'manual').done;
    expect(ctx.deps.db.prepare('SELECT name, tagline, size_bucket, website FROM companies').all()).toEqual([
      { name: 'Acme Robotics, Inc.', tagline: 'Robots that lift', size_bucket: '201-500', website: 'https://acme.example/' },
    ]);
  });
});

describe('Greenhouse pay check', () => {
  it('stores a pay range fetched for an unchanged posting and marks it checked', async () => {
    const source = addSource('greenhouse');
    let supplement: RawPosting['supplement'] = undefined;
    const service = serviceWith('greenhouse', () => listing([posting('1', { salaryPending: true, supplement })]));
    await service.run(source.id, 'manual').done;
    expect(service.store.needsPayCheck(source.id, '1')).toBe(true);
    expect(jobRow(1)).toMatchObject({ salary_min: null, salary_raw: null });

    supplement = { salary: { min: 150000, max: 180000, currency: 'USD', period: 'year', raw: 'US range' } };
    const run = await service.run(source.id, 'manual').done;
    expect(run.unchanged).toBe(1);
    expect(jobRow(1)).toMatchObject({ salary_min: 150000, salary_max: 180000, salary_annual_usd_max: 180000 });
    expect(service.store.needsPayCheck(source.id, '1')).toBe(false);
    expect(service.store.needsPayCheck(source.id, 'new-one')).toBe(true);
  });
});

describe('schedule', () => {
  it('runs enabled daily sources, two at a time, and skips manual and disabled ones', async () => {
    const boards = ['a', 'b', 'c'].map((name) => addSource('greenhouse', name));
    addSource('seed');
    const off = addSource('lever');
    ctx.deps.db.prepare('UPDATE job_sources SET enabled = 0 WHERE id = ?').run(off.id);
    let active = 0;
    let peak = 0;
    const service = createIngestService(ctx.deps, {
      adapters: {
        greenhouse: {
          kind: 'greenhouse',
          fetch: async () => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 20));
            active -= 1;
            return listing([]);
          },
        },
        seed: { kind: 'seed', fetch: async () => { throw new Error('the seed is not scheduled'); } },
        lever: { kind: 'lever', fetch: async () => { throw new Error('disabled sources are not run'); } },
      },
    });
    const runs = await service.runScheduled();
    expect(runs.map((run) => run.sourceId).sort()).toEqual(boards.map((board) => board.id).sort());
    expect(runs.every((run) => run.status === 'succeeded' && run.trigger === 'schedule')).toBe(true);
    expect(peak).toBe(2);
  });

  it('marks runs a previous process left running as failed', () => {
    const source = addSource('greenhouse');
    ctx.deps.db.prepare("INSERT INTO ingest_runs(source_id, trigger, status, started_at) VALUES (?, 'manual', 'running', ?)").run(source.id, TEST_NOW.toISOString());
    const service = createIngestService(ctx.deps);
    expect(service.recoverInterrupted()).toBe(1);
    expect(ctx.deps.db.prepare('SELECT status, error FROM ingest_runs').get()).toEqual({ status: 'failed', error: 'The server stopped during this run.' });
  });

  it('trims the logs of runs older than 90 days and keeps the runs', () => {
    const source = addSource('greenhouse');
    const insert = ctx.deps.db.prepare("INSERT INTO ingest_runs(source_id, trigger, status, started_at, log) VALUES (?, 'manual', 'succeeded', ?, 'line')");
    insert.run(source.id, new Date(TEST_NOW.getTime() - 91 * 86_400_000).toISOString());
    insert.run(source.id, new Date(TEST_NOW.getTime() - 89 * 86_400_000).toISOString());
    createIngestService(ctx.deps).recoverInterrupted();
    expect(ctx.deps.db.prepare('SELECT log FROM ingest_runs ORDER BY id').all()).toEqual([{ log: null }, { log: 'line' }]);
  });
});
