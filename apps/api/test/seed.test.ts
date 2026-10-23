import { afterEach, describe, expect, it } from 'vitest';
import { loadSeedData, seedPosting } from '../src/features/ingest/adapters/seed';
import { ingestFeature } from '../src/features/ingest/index';
import { normalizePosting } from '../src/features/ingest/normalize';
import { SEED_SOURCE_NAME, seedDemoJobs, seedOnStartup } from '../src/features/ingest/seed';
import { createTestContext, TEST_NOW, type TestContext } from './helpers';

let ctx: TestContext | null = null;
afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

describe('demo seed data', () => {
  const data = loadSeedData();
  const companies = new Map(data.companies.map((company) => [company.key, company]));
  const normalized = data.jobs.map((job, index) => normalizePosting(seedPosting(job, companies.get(job.company)!, TEST_NOW, index)));

  it('has about 15 fictional companies and about 120 postings, every one valid and unique', () => {
    expect(data.companies.length).toBeGreaterThanOrEqual(14);
    expect(data.jobs.length).toBeGreaterThanOrEqual(110);
    expect(new Set(data.jobs.map((job) => job.id)).size).toBe(data.jobs.length);
    expect(new Set(data.companies.map((company) => company.name)).size).toBe(data.companies.length);
    for (const company of data.companies) {
      expect(data.jobs.some((job) => job.company === company.key)).toBe(true);
      expect(company.tagline.length).toBeGreaterThan(10);
    }
    // Every link is on a reserved example domain: no real company's site.
    expect(normalized.every((job) => /^https:\/\/careers\.[a-z0-9-]+\.example\//.test(job.applyUrl))).toBe(true);
  });

  it('spreads across categories, levels, arrangements, types, places and pay', () => {
    expect(new Set(normalized.map((job) => job.categoryId)).size).toBeGreaterThanOrEqual(14);
    expect(normalized.filter((job) => job.categoryId === 'other')).toEqual([]);
    const levels = new Set(normalized.flatMap((job) => job.experienceLevels));
    expect([...levels].sort()).toEqual(['entry', 'expert', 'junior', 'mid', 'senior']);
    expect(new Set(normalized.map((job) => job.workArrangement))).toEqual(new Set(['remote', 'hybrid', 'onsite']));
    expect(new Set(normalized.map((job) => job.employmentType)).size).toBeGreaterThanOrEqual(3);
    expect(normalized.filter((job) => job.locations.some((place) => place.countryCode && place.countryCode !== 'US')).length).toBeGreaterThan(5);
    expect(normalized.filter((job) => job.salary === null).length).toBeGreaterThan(10);
    expect(normalized.filter((job) => job.salary?.period === 'hour').length).toBeGreaterThan(2);
    expect(normalized.every((job) => job.deterministic.requirements.length > 0 && job.deterministic.responsibilities.length > 0)).toBe(true);
  });

  it('dates postings over about five months, some within the last week', () => {
    const ages = data.jobs.map((job) => job.postedDaysAgo);
    expect(ages.filter((days) => days < 7).length).toBeGreaterThanOrEqual(10);
    expect(Math.max(...ages)).toBeGreaterThanOrEqual(120);
    expect(Math.max(...ages)).toBeLessThanOrEqual(160);
  });
});

describe('seeding', () => {
  it('loads the demo jobs once; a re-run changes nothing; --refresh re-dates them', async () => {
    ctx = createTestContext();
    const data = loadSeedData();
    const first = await seedDemoJobs(ctx.deps);
    expect(first).toMatchObject({ status: 'succeeded', created: data.jobs.length, failed: 0 });
    const count = (sql: string) => (ctx!.deps.db.prepare(sql).get() as { n: number }).n;
    expect(count('SELECT count(*) AS n FROM jobs')).toBe(data.jobs.length);
    expect(count('SELECT count(*) AS n FROM companies')).toBe(data.companies.length);
    expect(count('SELECT count(*) AS n FROM jobs WHERE active = 0')).toBe(data.jobs.filter((job) => job.closed).length);
    expect(count("SELECT count(*) AS n FROM job_sources WHERE kind = 'seed'")).toBe(1);
    const company = ctx.deps.db.prepare("SELECT * FROM companies WHERE name = 'Lumenwave Analytics'").get() as Record<string, unknown>;
    expect(company).toMatchObject({ size_bucket: '201-500', industry: 'technology', headquarters: 'Austin, TX', founded_year: 2016 });

    const again = await seedDemoJobs(ctx.deps);
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: data.jobs.length });

    ctx.setNow(new Date(TEST_NOW.getTime() + 3 * 86_400_000));
    const refreshed = await seedDemoJobs(ctx.deps, { refresh: true });
    expect(refreshed).toMatchObject({ created: 0, updated: data.jobs.length });
    const newest = ctx.deps.db.prepare('SELECT max(posted_at) AS at FROM jobs').get() as { at: string };
    expect(Date.parse(newest.at)).toBeGreaterThan(TEST_NOW.getTime());
    const source = ctx.deps.db.prepare("SELECT name, schedule FROM job_sources WHERE kind = 'seed'").get();
    expect(source).toEqual({ name: SEED_SOURCE_NAME, schedule: 'manual' });
  });

  it('seeds on startup only with SEED_DEMO=true and an empty jobs table', async () => {
    ctx = createTestContext({ env: { SEED_DEMO: 'true' } });
    await seedOnStartup(ctx.deps);
    const jobs = () => (ctx!.deps.db.prepare('SELECT count(*) AS n FROM jobs').get() as { n: number }).n;
    expect(jobs()).toBe(loadSeedData().jobs.length);
    ctx.deps.db.prepare("UPDATE job_sources SET config = '{}' WHERE kind = 'seed'").run();
    await seedOnStartup(ctx.deps);
    expect((ctx.deps.db.prepare('SELECT count(*) AS n FROM ingest_runs').get() as { n: number }).n).toBe(1);
  });

  it('offers the seed:jobs command', () => {
    expect(Object.keys(ingestFeature.commands ?? {})).toContain('seed:jobs');
  });
});
