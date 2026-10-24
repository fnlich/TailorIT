import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESUME_ANALYSIS_VERSION } from '@tailorit/shared';
import { requireAi } from '../src/ai/index';
import type { AiProvider } from '../src/ai/provider/types';
import { amountStated, finishAiAnalysis, grounded } from '../src/features/job-analysis/ai';
import {
  BACKLOG_SINCE_KEY,
  BACKLOG_TICK_MS,
  createJobAnalysisBacklog,
  FAILURE_STREAK,
  startJobAnalysisBacklog,
  type BacklogStep,
} from '../src/features/job-analysis/backlog';
import { DETERMINISTIC_VERSION } from '../src/features/job-analysis/deterministic';
import { jobAnalysisFeature } from '../src/features/job-analysis/index';
import { JobAnalysisOutputSchema, jobAnalysisPrompt } from '../src/features/job-analysis/prompt';
import {
  AI_ANALYSES_PER_USER_PER_HOUR,
  dedupeKeyOf,
  type JobAnalysisServiceInternals,
} from '../src/features/job-analysis/service';
import { aiAttemptsOf, saveAnalysis } from '../src/features/job-analysis/store';
import { startJobAnalysisWarmup } from '../src/features/job-analysis/warmup';
import { createIngestService } from '../src/features/ingest/service';
import { insertSource } from '../src/features/ingest/sources';
import type { RawPosting } from '../src/features/ingest/types';
import { peekAnalysisForJob } from '../src/features/jobs/analysis';
import { signIn } from './auth-helpers';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';
import { insertApplication, insertJob, insertResume } from './job-fixtures';

// The job analysis service against the fake Claude CLI (tools/fake-claude/scenarios/job_analysis.mjs): the lazy mode
// (opening a job queues its AI analysis), and the default ingest mode with its add-time backlog (./backlog.ts).

let ctx: TestContext | null = null;
const scenarioDirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  ctx?.cleanup();
  ctx = null;
  for (const dir of scenarioDirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** The tests of the mode in which opening a job queues its AI analysis. */
const LAZY = { AI_JOB_ANALYSIS: 'lazy' };

const DESCRIPTION = `
<h3>About the role</h3><p>Join the platform team that runs the services behind our product.</p>
<h3>Responsibilities</h3><ul>
<li>Design, build and operate the services behind the platform in Go</li>
<li>Own CI/CD pipelines and deployment tooling</li>
<li>Improve reliability, observability and on-call practices</li></ul>
<h3>Requirements</h3><ul>
<li>5+ years of experience building backend services in Go</li>
<li>Hands-on experience running Kubernetes in production</li>
<li>Experience with Terraform and infrastructure as code</li>
<li>Solid knowledge of PostgreSQL and SQL</li></ul>
<h3>Nice to have</h3><ul><li>Experience with AWS</li><li>Contributions to open source projects</li></ul>
<p>Base salary: $180,000 - $220,000 per year.</p>`;

function posting(id: string, overrides: Partial<RawPosting> = {}): RawPosting {
  return {
    sourceJobId: id,
    title: 'Senior Platform Engineer',
    company: { name: 'Acme Robotics' },
    descriptionHtml: DESCRIPTION,
    url: `https://jobs.example.com/acme/${id}`,
    locations: ['Remote - US'],
    ...overrides,
  };
}

/** A context whose greenhouse source lists `postings` (a function: re-runs may list something else). */
async function setup(env: Record<string, string> = {}, postings: RawPosting[] | (() => RawPosting[]) = [posting('1')]) {
  ctx = createTestContext({ env });
  const context = ctx;
  const source = insertSource(context.deps.db, { kind: 'greenhouse', name: 'acme', config: {} }, TEST_NOW.toISOString());
  const list = typeof postings === 'function' ? postings : () => postings;
  const service = createIngestService(context.deps, {
    adapters: { greenhouse: { kind: 'greenhouse', fetch: async () => ({ postings: list(), complete: true, failures: [] }) } },
  });
  const ingest = () => service.run(source.id, 'manual').done;
  await ingest();
  const analysis = context.deps.services.jobAnalysis as JobAnalysisServiceInternals;
  return { ctx: context, analysis, ingest };
}

function analysisTasks(context: TestContext) {
  return context.deps.db.prepare("SELECT id, status, priority, user_id, dedupe_key, input, error_code FROM ai_tasks WHERE kind = 'job_analysis' ORDER BY created_at, rowid").all() as Array<{
    id: string;
    status: string;
    priority: number;
    user_id: string | null;
    dedupe_key: string;
    input: string;
    error_code: string | null;
  }>;
}

/** The fake model answers `answer` for every job analysis (FAKE_CLAUDE_SCENARIOS, tools/fake-claude/scenarios/README.md). */
function fakeAnswer(answer: unknown): void {
  const dir = mkdtempSync(join(tmpdir(), 'tailorit-scenario-'));
  scenarioDirs.push(dir);
  writeFileSync(join(dir, 'job_analysis.json'), JSON.stringify(answer));
  vi.stubEnv('FAKE_CLAUDE_SCENARIOS', dir);
}

const EMPTY_ANSWER = { summary: { requirements: [], responsibilities: [], desiredQualifications: [] }, keywords: { high: [], low: [] } };

/** Waits for the task a backlog step queued; answers its status. */
async function finish(context: TestContext, step: BacklogStep): Promise<string> {
  if (step.status !== 'queued') throw new Error(`expected a queued step, got ${JSON.stringify(step)}`);
  return (await requireAi(context.deps).waitFor(step.taskId)).status;
}

const jobIdByTitle = (context: TestContext, title: string) =>
  (context.deps.db.prepare('SELECT id FROM jobs WHERE title = ?').get(title) as { id: number }).id;

/** What the test context's memory logger kept (helpers.ts: createMemoryLogger). */
const logLines = (context: TestContext): string[] => (context.deps.log as unknown as { lines: string[] }).lines;

describe('JobAnalysisService (lazy mode)', () => {
  it('answers the deterministic analysis at once, queues an AI one, and swaps when it lands', async () => {
    const { ctx: context, analysis } = await setup(LAZY);
    const job = context.deps.db.prepare('SELECT id, content_hash FROM jobs').get() as { id: number; content_hash: string };

    const first = analysis.ensure(job.id, { interactive: true })!;
    expect(first.refining).toBe(true);
    expect(first.analysis).toMatchObject({ source: 'deterministic', refining: true, experienceLevels: ['senior'], categoryId: 'devops-infrastructure' });
    expect(first.analysis.requirements).toContain('Hands-on experience running Kubernetes in production');

    const tasks = analysisTasks(context);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ user_id: null, priority: 1, dedupe_key: `-:${dedupeKeyOf(job.content_hash)}` });
    expect(JSON.parse(tasks[0]!.input)).toEqual({ jobId: job.id, contentHash: job.content_hash, version: jobAnalysisPrompt.version });

    // Asking again while it runs queues nothing new.
    expect(analysis.ensure(job.id, { interactive: true })!.refining).toBe(true);
    expect(analysis.get(job.id)!.refining).toBe(true);
    expect(analysisTasks(context)).toHaveLength(1);

    const done = await requireAi(context.deps).waitFor(tasks[0]!.id);
    expect(done.status).toBe('succeeded');

    const after = analysis.ensure(job.id, { interactive: true })!;
    expect(after.refining).toBe(false);
    expect(after.analysis.source).toBe('ai');
    // Keywords: only what the posting carries, each once ("Haskell" is not in it; "Kubernetes" was listed twice).
    expect(after.analysis.keywords.high.map((group) => group.term)).toEqual(['Go', 'Kubernetes', 'Terraform', 'PostgreSQL']);
    expect(after.analysis.keywords.low.map((group) => group.term)).toEqual(['CI/CD', 'AWS', 'observability']);
    expect(after.analysis.keywords.high[1]).toEqual({ term: 'Kubernetes', synonyms: ['K8s'] });
    // A bullet with none of the posting's words is dropped.
    expect(after.analysis.requirements).toHaveLength(4);
    expect(after.analysis.requirements.join(' ')).not.toMatch(/Sumerian/);
    expect(after.analysis.desired).toEqual(['Experience with AWS', 'Contributions to open source projects']);
    expect(after.analysis.categoryId).toBe('devops-infrastructure');
    expect(after.analysis.subcategoryIds).toEqual(['platform-engineering']);
    expect(analysisTasks(context)).toHaveLength(1);

    const row = context.deps.db.prepare('SELECT analysis_id, salary_min, salary_max FROM jobs WHERE id = ?').get(job.id) as Record<string, number>;
    const stored = context.deps.db.prepare('SELECT source, model, prompt_hash, extras FROM job_analyses WHERE id = ?').get(row.analysis_id) as {
      source: string;
      model: string;
      prompt_hash: string;
      extras: string;
    };
    expect(stored.source).toBe('ai');
    expect(stored.model).toBe(context.deps.config.ai.features.job_analysis.model);
    expect(stored.prompt_hash).toMatch(/^[0-9a-f]{16}$/);
    // The model's salary (999,999) is not in the posting: the stated one stays.
    expect(JSON.parse(stored.extras).salary).toBeNull();
    expect(row).toMatchObject({ salary_min: 180000, salary_max: 220000 });
  });

  it('prefers AI over the lake over deterministic', async () => {
    const { ctx: context, analysis } = await setup({ AI_JOB_ANALYSIS: 'off' });
    const job = context.deps.db.prepare('SELECT id, content_hash FROM jobs').get() as { id: number; content_hash: string };
    expect(analysis.ensure(job.id)!.analysis.source).toBe('deterministic');
    const draft = {
      requirements: ['From the lake'],
      responsibilities: [],
      desired: [],
      keywords: { high: [{ term: 'Go', synonyms: [] }], low: [] },
      experienceLevels: [],
      leadership: null,
      minYears: null,
      categoryId: null,
      subcategoryIds: [],
      extras: {},
    };
    saveAnalysis(context.deps.db, { ...draft, contentHash: job.content_hash, source: 'ft_lake', version: 1 }, TEST_NOW.toISOString());
    expect(analysis.get(job.id)!.analysis).toMatchObject({ source: 'ft_lake', requirements: ['From the lake'], experienceLevels: ['senior'] });
    saveAnalysis(context.deps.db, { ...draft, requirements: ['From AI'], contentHash: job.content_hash, source: 'ai', version: 1 }, TEST_NOW.toISOString());
    expect(analysis.get(job.id)!.analysis).toMatchObject({ source: 'ai', requirements: ['From AI'] });
    expect((context.deps.db.prepare('SELECT a.source FROM jobs j JOIN job_analyses a ON a.id = j.analysis_id').get() as { source: string }).source).toBe('ai');
    // AI_JOB_ANALYSIS=off: nothing was ever queued.
    expect(analysisTasks(context)).toEqual([]);
  });

  it('queues one task for postings that share a text, and none for a missing job', async () => {
    const { ctx: context, analysis } = await setup(LAZY, [posting('1'), posting('2', { title: 'Platform Engineer II', url: 'https://jobs.example.com/acme/other' })]);
    const ids = (context.deps.db.prepare('SELECT id FROM jobs ORDER BY id').all() as Array<{ id: number }>).map((row) => row.id);
    expect(ids).toHaveLength(2);
    analysis.ensure(ids[0]!, { interactive: false });
    analysis.ensure(ids[1]!, { interactive: false });
    const tasks = analysisTasks(context);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.priority).toBe(0);
    await requireAi(context.deps).waitFor(tasks[0]!.id);
    expect(analysis.get(ids[1]!)!.analysis.source).toBe('ai');
    expect(analysis.ensure(999_999)).toBeNull();
    expect(analysis.get(999_999)).toBeNull();
    expect(analysis.peek(999_999)).toBeNull();
  });

  it('keeps at most three AI analyses pending; further views show the deterministic one', async () => {
    const postings = ['1', '2', '3', '4', '5'].map((id) =>
      posting(id, {
        title: `Platform Engineer, Team ${id}`,
        descriptionHtml: `${DESCRIPTION}<p>Team ${id} owns its own corner of the platform.</p>`,
        url: `https://jobs.example.com/acme/team-${id}`,
      }),
    );
    const { ctx: context, analysis } = await setup(LAZY, postings);
    vi.stubEnv('FAKE_CLAUDE_MODE', 'slow');
    vi.stubEnv('FAKE_CLAUDE_SLOW_MS', '1500');
    const ids = (context.deps.db.prepare('SELECT id FROM jobs ORDER BY id').all() as Array<{ id: number }>).map((row) => row.id);
    const refining = ids.map((id) => analysis.ensure(id, { interactive: true })!.refining);
    expect(refining).toEqual([true, true, true, false, false]);
    const tasks = analysisTasks(context);
    expect(tasks).toHaveLength(3);
    await Promise.all(tasks.map((task) => requireAi(context.deps).waitFor(task.id)));
    // Room again: the next view of a waiting job queues it.
    expect(analysis.ensure(ids[3]!, { interactive: true })!.refining).toBe(true);
    await requireAi(context.deps).waitFor(analysisTasks(context)[3]!.id);
  });

  it('does not ask again for a while after an AI analysis failed', async () => {
    const { ctx: context, analysis } = await setup(LAZY);
    vi.stubEnv('FAKE_CLAUDE_MODE', 'auth');
    const job = context.deps.db.prepare('SELECT id FROM jobs').get() as { id: number };
    expect(analysis.ensure(job.id, { interactive: true })!.refining).toBe(true);
    const [task] = analysisTasks(context);
    const done = await requireAi(context.deps).waitFor(task!.id);
    expect(done.status).toBe('failed');
    vi.unstubAllEnvs();
    const again = analysis.ensure(job.id, { interactive: true })!;
    expect(again).toMatchObject({ refining: false, analysis: { source: 'deterministic' } });
    expect(analysisTasks(context)).toHaveLength(1);
  });

  it('makes a current deterministic analysis for a job that has none', async () => {
    const { ctx: context, analysis } = await setup({ AI_JOB_ANALYSIS: 'off' });
    context.deps.db.prepare('UPDATE jobs SET analysis_id = NULL').run();
    context.deps.db.prepare('DELETE FROM job_analyses').run();
    const job = context.deps.db.prepare('SELECT id FROM jobs').get() as { id: number };
    const view = analysis.get(job.id)!;
    expect(view.analysis.source).toBe('deterministic');
    expect(view.analysis.keywords.high.length).toBeGreaterThan(0);
    const stored = context.deps.db.prepare('SELECT version FROM job_analyses').get() as { version: number };
    expect(stored.version).toBe(DETERMINISTIC_VERSION);
  });

  it('warms up the most viewed jobs on the background slot when asked to', async () => {
    const { ctx: context, analysis } = await setup({ ...LAZY, AI_JOB_ANALYSIS_WARMUP_PER_HOUR: '6' }, [
      posting('1'),
      posting('2', { title: 'Data Engineer', descriptionHtml: `${DESCRIPTION}<p>Also Spark and Airflow.</p>`, url: 'https://jobs.example.com/acme/2' }),
    ]);
    context.deps.db.prepare("UPDATE jobs SET view_count = 9 WHERE title = 'Data Engineer'").run();
    const warmup = startJobAnalysisWarmup(context.deps, analysis, { timers: false });
    const picked = warmup.tick();
    expect(picked).toBe((context.deps.db.prepare("SELECT id FROM jobs WHERE title = 'Data Engineer'").get() as { id: number }).id);
    expect(analysisTasks(context)).toMatchObject([{ priority: 0 }]);
    // One at a time: nothing else while that one waits.
    expect(warmup.tick()).toBeNull();
    await requireAi(context.deps).waitFor(analysisTasks(context)[0]!.id);
  });
});

describe('analyses started by opening jobs (lazy mode)', () => {
  /** The analysis task queued for one job (created_at is the frozen clock, so order by it says nothing). */
  const taskFor = (context: TestContext, jobId: number) =>
    analysisTasks(context).find((task) => (JSON.parse(task.input) as { jobId: number }).jobId === jobId);

  it('run on the background slot, owned by no one, when a person opens a job', async () => {
    const { ctx: context } = await setup(LAZY);
    const viewer = await signIn(context, 'viewer@example.com');
    const job = context.deps.db.prepare('SELECT id FROM jobs').get() as { id: number };
    const first = await viewer.agent.get(`/api/jobs/${job.id}/analysis`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ source: 'deterministic', refining: true });
    const task = taskFor(context, job.id)!;
    expect(task).toMatchObject({ priority: 0, user_id: null });
    await requireAi(context.deps).waitFor(task.id);
    expect((await viewer.agent.get(`/api/jobs/${job.id}/analysis`)).body).toMatchObject({ source: 'ai', refining: false });
  });

  it(`are limited to ${AI_ANALYSES_PER_USER_PER_HOUR} new ones per account per hour`, async () => {
    const count = AI_ANALYSES_PER_USER_PER_HOUR + 2;
    const postings = Array.from({ length: count }, (_, index) =>
      posting(String(index + 1), {
        title: `Platform Engineer, Team ${index + 1}`,
        descriptionHtml: `${DESCRIPTION}<p>Team ${index + 1} owns its own corner of the platform.</p>`,
        url: `https://jobs.example.com/acme/team-${index + 1}`,
      }),
    );
    const { ctx: context, analysis } = await setup(LAZY, postings);
    const ids = (context.deps.db.prepare('SELECT id FROM jobs ORDER BY id').all() as Array<{ id: number }>).map((row) => row.id);
    expect(ids).toHaveLength(count);
    const open = (jobId: number, userId: string) => analysis.ensure(jobId, { requestedBy: userId })!;
    const finishTask = (jobId: number) => requireAi(context.deps).waitFor(taskFor(context, jobId)!.id);

    // One at a time, so the global cap on pending analyses never decides.
    for (const id of ids.slice(0, AI_ANALYSES_PER_USER_PER_HOUR)) {
      expect(open(id, 'sweeper').refining).toBe(true);
      await finishTask(id);
    }
    const spent = analysisTasks(context).length;
    expect(spent).toBe(AI_ANALYSES_PER_USER_PER_HOUR);

    // Over budget: the deterministic analysis, without "Refining...", and nothing queued.
    const refused = open(ids[AI_ANALYSES_PER_USER_PER_HOUR]!, 'sweeper');
    expect(refused).toMatchObject({ refining: false, analysis: { source: 'deterministic', refining: false } });
    expect(analysisTasks(context)).toHaveLength(spent);
    // What is already analysed costs nothing; another account has its own budget; and a job someone else had queued
    // shows as refining to the sweeper too, without spending anything.
    expect(open(ids[0]!, 'sweeper')).toMatchObject({ refining: false, analysis: { source: 'ai' } });
    expect(open(ids[AI_ANALYSES_PER_USER_PER_HOUR]!, 'someone-else').refining).toBe(true);
    expect(open(ids[AI_ANALYSES_PER_USER_PER_HOUR]!, 'sweeper').refining).toBe(true);
    await finishTask(ids[AI_ANALYSES_PER_USER_PER_HOUR]!);
    expect(open(ids[AI_ANALYSES_PER_USER_PER_HOUR + 1]!, 'sweeper').refining).toBe(false);

    // A sliding hour: once the first ones are an hour old, the account may start new ones again.
    context.setNow(new Date(TEST_NOW.getTime() + 60 * 60_000 + 1_000));
    expect(open(ids[AI_ANALYSES_PER_USER_PER_HOUR + 1]!, 'sweeper').refining).toBe(true);
    await finishTask(ids[AI_ANALYSES_PER_USER_PER_HOUR + 1]!);
  }, 60_000);
});

// ------------------------------------------------------------------------------------- the default: ingest mode

describe('AI_JOB_ANALYSIS=ingest (the default): views never queue', () => {
  it('ingest mode: viewing and saving queue nothing, and leave the backlog order as it was', async () => {
    const { ctx: context, analysis } = await setup({}, [posting('1'), posting('2', { title: 'Data Engineer', descriptionHtml: `${DESCRIPTION}<p>Spark too.</p>` })]);
    expect(context.deps.config.ai.jobAnalysis).toBe('ingest');
    // Ingest itself queued nothing either: the backlog only runs on its timers, after start().
    expect(analysisTasks(context)).toEqual([]);
    const older = jobIdByTitle(context, 'Senior Platform Engineer');
    const newer = jobIdByTitle(context, 'Data Engineer');
    expect(newer).toBeGreaterThan(older);

    const viewer = await signIn(context, 'viewer@example.com');
    for (const path of [`/api/jobs/${older}`, `/api/jobs/${older}/analysis`, `/api/jobs/${older}/insights`, `/api/jobs/${older}/match`]) {
      expect((await viewer.agent.get(path)).status).toBe(200);
    }
    expect((await viewer.agent.get(`/api/jobs/${older}/analysis`)).body).toMatchObject({ source: 'deterministic', refining: false });
    expect(analysis.ensure(older, { interactive: true, requestedBy: viewer.account.id })).toMatchObject({ refining: false });
    expect(analysis.get(older)!.refining).toBe(false);
    expect(analysis.peek(older)!.refining).toBe(false);
    const saved = await viewer.agent.post('/api/applications').set('Origin', ORIGIN).send({ jobId: older, status: 1 });
    expect(saved.status).toBe(201);
    expect(analysisTasks(context)).toEqual([]);

    // Opened and saved, the older job still waits its turn: the newest is read first.
    const step = createJobAnalysisBacklog(context.deps, analysis).tick();
    expect(step).toMatchObject({ status: 'queued', jobId: newer, deduped: false });
    // While the backlog reads a job, its page says "Refining..." (and still queues nothing).
    expect(analysis.ensure(newer)!.refining).toBe(true);
    expect(await finish(context, step)).toBe('succeeded');
    expect(analysisTasks(context)).toHaveLength(1);
  });

  it('saved mode reads only saved jobs, in the same order; lazy and off leave the backlog off', async () => {
    const { ctx: context, analysis } = await setup({ AI_JOB_ANALYSIS: 'saved' }, [
      posting('1'),
      posting('2', { title: 'Data Engineer', descriptionHtml: `${DESCRIPTION}<p>Spark too.</p>` }),
    ]);
    const backlog = createJobAnalysisBacklog(context.deps, analysis);
    expect(backlog.tick()).toMatchObject({ status: 'waiting', reason: 'none' });
    const viewer = await signIn(context, 'saver@example.com');
    const older = jobIdByTitle(context, 'Senior Platform Engineer');
    insertApplication(context.deps.db, viewer.account.id, older, 1);
    expect((await viewer.agent.get(`/api/jobs/${older}/analysis`)).body.refining).toBe(false);
    const step = backlog.tick();
    expect(step).toMatchObject({ status: 'queued', jobId: older });
    expect(await finish(context, step)).toBe('succeeded');
    expect(backlog.tick()).toMatchObject({ status: 'waiting', reason: 'none' });

    const offs: Array<Record<string, string>> = [LAZY, { AI_JOB_ANALYSIS: 'off' }, { AI_ENABLED: 'false' }, { AI_CLI_BACKGROUND_SLOTS: '0' }];
    for (const env of offs) {
      const other = createTestContext({ env });
      try {
        const service = other.deps.services.jobAnalysis as JobAnalysisServiceInternals;
        insertJob(other.deps.db, { title: 'Backend Engineer', description: `<p>${'Build services in Go and Kubernetes. '.repeat(5)}</p>` });
        const off = createJobAnalysisBacklog(other.deps, service);
        expect(off.enabled).toBe(false);
        expect(off.tick()).toEqual({ status: 'off' });
      } finally {
        other.cleanup();
      }
    }
  });
});

describe('the add-time backlog', () => {
  const LONG = (topic: string) =>
    `<h3>Requirements</h3><ul><li>Experience building ${topic} services in Go and PostgreSQL</li>` +
    `<li>Running ${topic} workloads on Kubernetes in production</li></ul>`;

  it('newest first, pre-existing jobs last; skips closed, short and Claude-read jobs, and reads lake-read ones', async () => {
    ctx = createTestContext();
    const context = ctx;
    const service = context.deps.services.jobAnalysis as JobAnalysisServiceInternals;
    const db = context.deps.db;
    // The release starts now (TEST_NOW): every job first seen before it goes after every newer one.
    const backlog = createJobAnalysisBacklog(context.deps, service);
    expect(backlog.since).toBe(TEST_NOW.toISOString());
    context.setNow(new Date('2026-10-24T12:00:00.000Z'));
    const job = (title: string, firstSeenAt: string, extra: Parameters<typeof insertJob>[1] = { title }) =>
      insertJob(db, { description: LONG(title), ...extra, title, firstSeenAt });
    const oldest = job('Oldest', '2026-09-01T00:00:00.000Z');
    const newest = job('Newest', '2026-10-23T08:00:00.000Z');
    const recentOld = job('Recent but older than the release', '2026-10-22T11:59:00.000Z');
    const lake = job('Read by the lake', '2026-10-22T18:00:00.000Z');
    const newer = job('Newer', '2026-10-22T13:00:00.000Z');
    job('Closed', '2026-10-23T10:00:00.000Z', { title: 'Closed', active: false });
    job('Short', '2026-10-23T09:00:00.000Z', { title: 'Short', description: '<p>Go.</p>' });
    const read = job('Read by Claude', '2026-10-23T11:00:00.000Z');
    const hashOf = (id: number) => (db.prepare('SELECT content_hash FROM jobs WHERE id = ?').get(id) as { content_hash: string }).content_hash;
    const draft = {
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
    saveAnalysis(db, { ...draft, contentHash: hashOf(read), source: 'ai', version: jobAnalysisPrompt.version }, TEST_NOW.toISOString());
    // A free_tailor lake analysis is not Claude's: that job is read too.
    saveAnalysis(db, { ...draft, contentHash: hashOf(lake), source: 'ft_lake', version: 1 }, TEST_NOW.toISOString());

    const order: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const step = backlog.tick();
      if (step.status !== 'queued') throw new Error(`step ${index}: ${JSON.stringify(step)}`);
      order.push(step.jobId);
      // One at a time.
      expect(backlog.tick()).toMatchObject({ status: 'waiting', reason: 'in_flight' });
      expect(await finish(context, step)).toBe('succeeded');
    }
    expect(order).toEqual([newest, lake, newer, recentOld, oldest]);
    expect(backlog.tick()).toMatchObject({ status: 'waiting', reason: 'none' });
    // Each task: system-owned, on the background slot.
    expect(analysisTasks(context).every((task) => task.user_id === null && task.priority === 0)).toBe(true);
    expect(analysisTasks(context)).toHaveLength(5);

    // The release time is recorded once.
    const since = () => (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(BACKLOG_SINCE_KEY) as { value: string }).value;
    expect(JSON.parse(since())).toBe(TEST_NOW.toISOString());
    createJobAnalysisBacklog(context.deps, service);
    expect(JSON.parse(since())).toBe(TEST_NOW.toISOString());
  }, 60_000);

  it('each content hash analysed once', async () => {
    const { ctx: context, analysis } = await setup({}, [
      posting('1'),
      posting('2', { title: 'Platform Engineer II', url: 'https://jobs.example.com/acme/other', company: { name: 'Globex' } }),
    ]);
    const ids = (context.deps.db.prepare('SELECT id, content_hash FROM jobs ORDER BY id').all() as Array<{ id: number; content_hash: string }>);
    expect(ids).toHaveLength(2);
    expect(ids[0]!.content_hash).toBe(ids[1]!.content_hash);
    const backlog = createJobAnalysisBacklog(context.deps, analysis);
    const step = backlog.tick();
    expect(step).toMatchObject({ status: 'queued', jobId: ids[1]!.id });
    expect(await finish(context, step)).toBe('succeeded');
    expect(backlog.tick()).toMatchObject({ status: 'waiting', reason: 'none' });
    const [task] = analysisTasks(context);
    expect(analysisTasks(context)).toHaveLength(1);
    expect(task).toMatchObject({ user_id: null, priority: 0, dedupe_key: `-:${dedupeKeyOf(ids[0]!.content_hash)}` });
    for (const { id } of ids) expect(analysis.get(id)!.analysis.source).toBe('ai');
    // Asking again for a text that has its analysis queues nothing.
    expect(analysis.enqueueTask(ids[0]!.id, 'background')).toBeNull();
  });

  it('backoff from job_ai_attempts; only ai_failed counts', async () => {
    const { ctx: context, analysis } = await setup();
    const job = context.deps.db.prepare('SELECT id, content_hash FROM jobs').get() as { id: number; content_hash: string };
    const backlog = createJobAnalysisBacklog(context.deps, analysis);
    const attempts = () => aiAttemptsOf(context.deps.db, job.content_hash, jobAnalysisPrompt.version);
    const at = (minutes: number) => new Date(TEST_NOW.getTime() + minutes * 60_000);

    // Claude answers what can never be read (twice: the one repair round too): ai_failed, an attempt.
    fakeAnswer({ summary: 'none' });
    expect(await finish(context, backlog.tick())).toBe('failed');
    expect(analysisTasks(context).at(-1)!.error_code).toBe('ai_failed');
    expect(attempts()).toMatchObject({ attempts: 1, nextAttemptAt: at(30).toISOString() });
    expect(backlog.tick()).toMatchObject({ status: 'waiting', reason: 'none' });

    context.setNow(at(31));
    expect(await finish(context, backlog.tick())).toBe('failed');
    expect(attempts()).toMatchObject({ attempts: 2, nextAttemptAt: at(31 + 60).toISOString() });
    context.setNow(at(31 + 59));
    expect(backlog.tick()).toMatchObject({ status: 'waiting', reason: 'none' });

    // The third failure gives up for a day.
    context.setNow(at(92));
    expect(await finish(context, backlog.tick())).toBe('failed');
    expect(attempts()).toMatchObject({ attempts: 3, nextAttemptAt: at(92 + 24 * 60).toISOString() });
    context.setNow(at(92 + 23 * 60));
    expect(backlog.tick()).toMatchObject({ status: 'waiting', reason: 'none' });

    // A day later it is tried again. Claude is signed out now: ai_unavailable, which is no attempt; the text only
    // waits, and the backlog rests too (an outage is the seat's: the next job would find Claude signed out as well).
    context.setNow(at(92 + 24 * 60 + 1));
    vi.stubEnv('FAKE_CLAUDE_MODE', 'auth');
    expect(await finish(context, backlog.tick())).toBe('failed');
    expect(analysisTasks(context).at(-1)!.error_code).toBe('ai_unavailable');
    expect(attempts()).toMatchObject({ attempts: 3, nextAttemptAt: at(92 + 24 * 60 + 1 + 5).toISOString() });
    expect(backlog.tick()).toMatchObject({ status: 'waiting', reason: 'unavailable', retryAtMs: at(92 + 24 * 60 + 1 + 5).getTime() });

    // Back to normal: it lands, and the memory of failures goes.
    vi.unstubAllEnvs();
    context.setNow(at(92 + 24 * 60 + 7));
    expect(await finish(context, backlog.tick())).toBe('succeeded');
    expect(attempts()).toBeNull();
    expect(analysis.get(job.id)!.analysis.source).toBe('ai');
  }, 60_000);

  it(`rests half an hour after failing on ${FAILURE_STREAK} texts in a row`, async () => {
    const postings = Array.from({ length: FAILURE_STREAK + 1 }, (_, index) =>
      posting(String(index + 1), { title: `Platform Engineer, Team ${index + 1}`, descriptionHtml: `${DESCRIPTION}<p>Team ${index + 1}.</p>` }),
    );
    const { ctx: context, analysis } = await setup({}, postings);
    const backlog = createJobAnalysisBacklog(context.deps, analysis);
    fakeAnswer({ summary: 'none' });
    for (let index = 0; index < FAILURE_STREAK; index += 1) expect(await finish(context, backlog.tick())).toBe('failed');
    // Every one failed: the next text would most likely fail too, on real usage.
    expect(backlog.tick()).toMatchObject({ status: 'waiting', reason: 'unavailable', retryAtMs: TEST_NOW.getTime() + 30 * 60_000 });
    expect(logLines(context).some((line) => line.includes(`failed for ${FAILURE_STREAK} jobs in a row`))).toBe(true);
    vi.unstubAllEnvs();
    context.setNow(new Date(TEST_NOW.getTime() + 30 * 60_000));
    expect(await finish(context, backlog.tick())).toBe('succeeded');
  }, 60_000);

  it('per-hour cap and allowed_warning pause', async () => {
    const { ctx: context, analysis } = await setup({ AI_JOB_ANALYSIS_PER_HOUR: '1' }, [
      posting('1'),
      posting('2', { title: 'Data Engineer', descriptionHtml: `${DESCRIPTION}<p>Spark too.</p>` }),
      posting('3', { title: 'Site Reliability Engineer', descriptionHtml: `${DESCRIPTION}<p>On-call too.</p>` }),
    ]);
    const backlog = createJobAnalysisBacklog(context.deps, analysis);
    expect(await finish(context, backlog.tick())).toBe('succeeded');
    const capped = backlog.tick();
    expect(capped).toMatchObject({ status: 'waiting', reason: 'hourly_cap', retryAtMs: TEST_NOW.getTime() + 60 * 60_000 });
    context.setNow(new Date(TEST_NOW.getTime() + 60 * 60_000));

    // The CLI says the usage window is nearly used up: background work waits until it resets.
    const provider = requireAi(context.deps).provider as Required<AiProvider>;
    const resetsAtMs = TEST_NOW.getTime() + 150 * 60_000;
    vi.spyOn(provider, 'lastRateLimit').mockReturnValue({ status: 'allowed_warning', resetsAtMs, usingOverage: false, seenAtMs: TEST_NOW.getTime() });
    expect(backlog.tick()).toMatchObject({ status: 'waiting', reason: 'paused', retryAtMs: resetsAtMs });
    expect(analysisTasks(context)).toHaveLength(1);
    context.setNow(new Date(resetsAtMs));
    expect(await finish(context, backlog.tick())).toBe('succeeded');
    expect(analysisTasks(context)).toHaveLength(2);
    expect(logLines(context).some((line) => /AI backlog paused: the Claude usage limit is close/.test(line))).toBe(true);
  });

  it('yields while a resume refine is due', async () => {
    const { ctx: context, analysis } = await setup();
    const db = context.deps.db;
    const backlog = createJobAnalysisBacklog(context.deps, analysis);
    const owner = await signIn(context, 'uploader@example.com');
    const now = TEST_NOW.toISOString();
    const later = '2026-10-22T13:00:00.000Z';
    /** A row of the resume backlog (WP3 keeps them), for a fresh upload of `userId`. */
    const reading = (userId: string, state: string, nextAttemptAt: string, version = RESUME_ANALYSIS_VERSION) => {
      const resumeId = insertResume(db, userId, 'Platform engineer with Go and Kubernetes.');
      db.prepare(
        `INSERT INTO resume_analysis_backlog(resume_id, user_id, content_hash, version, state, attempts, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      ).run(resumeId, userId, `hash-${resumeId}`, version, state, nextAttemptAt, now, now);
      return resumeId;
    };
    const first = reading(owner.account.id, 'waiting', now);
    // A due resume reading goes first.
    expect(backlog.tick()).toMatchObject({ status: 'waiting', reason: 'resume_first' });
    // So does one that is queued, while its task runs.
    db.prepare("UPDATE resume_analysis_backlog SET state = 'queued', task_id = 'resume-task' WHERE resume_id = ?").run(first);
    db.prepare(
      "INSERT INTO ai_tasks(id, user_id, kind, status, priority, input, created_at) VALUES ('resume-task', ?, 'resume_analysis', 'running', 0, '{}', ?)",
    ).run(owner.account.id, now);
    expect(backlog.tick()).toMatchObject({ status: 'waiting', reason: 'resume_first' });
    // Its task done, the next try a while off: no longer due.
    db.prepare("UPDATE ai_tasks SET status = 'succeeded', finished_at = ? WHERE id = 'resume-task'").run(now);
    db.prepare("UPDATE resume_analysis_backlog SET state = 'waiting', next_attempt_at = ? WHERE resume_id = ?").run(later, first);
    // A failed reading whose day's wait is over is due again.
    const failed = reading(owner.account.id, 'failed', now);
    expect(backlog.tick()).toMatchObject({ status: 'waiting', reason: 'resume_first' });
    db.prepare('UPDATE resume_analysis_backlog SET next_attempt_at = ? WHERE resume_id = ?').run(later, failed);
    // Rows the resume backlog would not start hold nothing up: a disabled account's, or one of an older version.
    const other = await signIn(context, 'disabled@example.com');
    reading(other.account.id, 'waiting', now);
    db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(now, other.account.id);
    reading(owner.account.id, 'waiting', now, RESUME_ANALYSIS_VERSION - 1);
    expect(await finish(context, backlog.tick())).toBe('succeeded');

    // With Claude's resume reading off (AI_RESUME_ANALYSIS=off), its waiting rows wait for nothing: no yield.
    const off = createTestContext({ env: { AI_RESUME_ANALYSIS: 'off' } });
    try {
      const user = await signIn(off, 'off@example.com');
      const resumeId = insertResume(off.deps.db, user.account.id, 'Go engineer.');
      off.deps.db
        .prepare(
          `INSERT INTO resume_analysis_backlog(resume_id, user_id, content_hash, version, state, attempts, next_attempt_at, created_at, updated_at)
           VALUES (?, ?, 'h', ?, 'waiting', 0, ?, ?, ?)`,
        )
        .run(resumeId, user.account.id, RESUME_ANALYSIS_VERSION, now, now, now);
      insertJob(off.deps.db, { title: 'Backend Engineer', description: `<p>${'Build services in Go and Kubernetes. '.repeat(5)}</p>` });
      const step = createJobAnalysisBacklog(off.deps, off.deps.services.jobAnalysis as JobAnalysisServiceInternals).tick();
      expect(step).toMatchObject({ status: 'queued' });
      expect(await finish(off, step)).toBe('succeeded');
    } finally {
      off.cleanup();
    }
  });

  it('peek writes nothing, and answers what get then stores', async () => {
    const { ctx: context, analysis } = await setup(LAZY);
    const db = context.deps.db;
    const job = db.prepare('SELECT id FROM jobs').get() as { id: number };
    const count = () => (db.prepare('SELECT count(*) AS n FROM job_analyses').get() as { n: number }).n;

    // No analysis stored at all.
    db.prepare('UPDATE jobs SET analysis_id = NULL').run();
    db.prepare('DELETE FROM job_analyses').run();
    const peeked = analysis.peek(job.id)!;
    expect(peeked.analysis).toMatchObject({ source: 'deterministic', refining: false, requiredYears: 5 });
    expect(peeked.analysis.keywords.high.length).toBeGreaterThan(0);
    expect(count()).toBe(0);
    expect(db.prepare('SELECT analysis_id FROM jobs').get()).toEqual({ analysis_id: null });
    // Not even lazy mode queues from a peek.
    expect(analysisTasks(context)).toEqual([]);
    expect(analysis.get(job.id)).toEqual(peeked);
    expect(count()).toBe(1);

    // A row stored before its facets were read: peek computes them, get stores them.
    db.prepare('UPDATE job_analyses SET soft_skills = NULL, terms = NULL, required_years = NULL').run();
    const facets = analysis.peek(job.id)!;
    expect(facets.analysis.requiredYears).toBe(5);
    expect(db.prepare('SELECT soft_skills, terms, required_years FROM job_analyses').get()).toEqual({ soft_skills: null, terms: null, required_years: null });
    expect(analysis.get(job.id)).toEqual(facets);
    expect(db.prepare('SELECT required_years FROM job_analyses').get()).toEqual({ required_years: 5 });
  });

  it("the feature's start runs it: each added job is read, one after another, until none is left", async () => {
    const { ctx: context } = await setup({}, [
      posting('1'),
      posting('2', { title: 'Data Engineer', descriptionHtml: `${DESCRIPTION}<p>Spark too.</p>` }),
      posting('3', { title: 'Site Reliability Engineer', descriptionHtml: `${DESCRIPTION}<p>On-call too.</p>` }),
    ]);
    const stop = jobAnalysisFeature.start!(context.deps) as () => Promise<void>;
    try {
      const read = () => (context.deps.db.prepare("SELECT count(*) AS n FROM job_analyses WHERE source = 'ai'").get() as { n: number }).n;
      // Its task finishing starts the next one (no 30 s wait between them).
      await vi.waitFor(() => expect(read()).toBe(3), { timeout: 20_000, interval: 100 });
      expect(analysisTasks(context).map((task) => task.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
      expect(logLines(context)).toContain('[job-analysis] AI backlog: Claude reads each added job once, newest first');
    } finally {
      await stop();
    }
  }, 30_000);

  it('runs on timers only after start: a failing step is logged, the next one carries on, and stop ends them', async () => {
    ctx = createTestContext();
    const context = ctx;
    insertJob(context.deps.db, { title: 'Backend Engineer', description: LONG('payments') });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    let calls = 0;
    const backlog = startJobAnalysisBacklog(context.deps, {
      enqueueTask: () => {
        calls += 1;
        throw new Error('boom');
      },
    });
    expect(backlog.enabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(1);
    expect(logLines(context).some((line) => line.startsWith('warn [job-analysis] an AI backlog step failed') && line.includes('boom'))).toBe(true);
    await vi.advanceTimersByTimeAsync(BACKLOG_TICK_MS);
    expect(calls).toBe(2);
    await backlog.stop();
    await vi.advanceTimersByTimeAsync(BACKLOG_TICK_MS * 3);
    expect(calls).toBe(2);
    expect(backlog.tick()).toEqual({ status: 'off' });
  });
});

describe('facets in the view', () => {
  const FACETS_POSTING = `<h3>Requirements</h3><ul>
<li>5+ years of experience building backend services in Go</li>
<li>Strong communication skills and collaboration across teams</li>
<li>Mentoring junior engineers</li>
<li>CKA certification preferred</li></ul>
<p>We build payment systems for fintech companies.</p>`;

  it('the view exposes softSkills, terms, requiredYears; Claude\'s are grounded (its invented soft skill goes)', async () => {
    const { ctx: context, analysis } = await setup({}, [posting('1', { descriptionHtml: FACETS_POSTING })]);
    const viewer = await signIn(context, 'viewer@example.com');
    const job = context.deps.db.prepare('SELECT id FROM jobs').get() as { id: number };
    const before = (await viewer.agent.get(`/api/jobs/${job.id}/analysis`)).body;
    expect(before).toMatchObject({
      source: 'deterministic',
      softSkills: ['Communication', 'Collaboration', 'Mentoring'],
      terms: { certifications: ['Certified Kubernetes Administrator (CKA)'], domains: [] },
      requiredYears: 5,
    });
    // Stored at ingest, with the deterministic analysis.
    const stored = context.deps.db.prepare("SELECT soft_skills, terms, required_years FROM job_analyses WHERE source = 'deterministic'").get() as Record<string, unknown>;
    expect(JSON.parse(String(stored.soft_skills))).toEqual(['Communication', 'Collaboration', 'Mentoring']);
    expect(stored.required_years).toBe(5);

    const step = createJobAnalysisBacklog(context.deps, analysis).tick();
    expect(await finish(context, step)).toBe('succeeded');
    const after = (await viewer.agent.get(`/api/jobs/${job.id}/analysis`)).body;
    // The fake also named "Diplomacy", which the posting never asks for. The industry the posting states outside its
    // sections ("fintech companies") is Claude's to read.
    expect(after).toMatchObject({
      source: 'ai',
      softSkills: ['Communication', 'Collaboration', 'Mentoring'],
      terms: { certifications: ['Certified Kubernetes Administrator (CKA)'], domains: ['finance'] },
      requiredYears: 5,
    });
    const ai = context.deps.db.prepare("SELECT soft_skills, terms, required_years FROM job_analyses WHERE source = 'ai'").get() as Record<string, unknown>;
    expect(String(ai.soft_skills)).not.toMatch(/Diplomacy/);
    expect(JSON.parse(String(ai.terms))).toEqual({ certifications: ['Certified Kubernetes Administrator (CKA)'], domains: ['finance'] });
  });

  it('peekAnalysisForJob (the read-only seam): the service\'s peek, else the stored or computed analysis, facets and all', async () => {
    const { ctx: context } = await setup(LAZY, [posting('1', { descriptionHtml: FACETS_POSTING })]);
    const db = context.deps.db;
    const job = db.prepare('SELECT id FROM jobs').get() as { id: number };
    const facets = { softSkills: ['Communication', 'Collaboration', 'Mentoring'], requiredYears: 5 };
    db.prepare('UPDATE jobs SET analysis_id = NULL').run();
    db.prepare('DELETE FROM job_analyses').run();
    expect(peekAnalysisForJob(context.deps, job.id)).toMatchObject({ source: 'deterministic', refining: false, ...facets });
    expect(db.prepare('SELECT count(*) AS n FROM job_analyses').get()).toEqual({ n: 0 });
    expect(analysisTasks(context)).toEqual([]);
    expect(peekAnalysisForJob(context.deps, 999_999)).toBeNull();
    // Without the job-analysis service, the analysis is computed from the posting, with its facets too.
    delete context.deps.services.jobAnalysis;
    expect(peekAnalysisForJob(context.deps, job.id)).toMatchObject({
      source: 'deterministic',
      ...facets,
      terms: { certifications: ['Certified Kubernetes Administrator (CKA)'], domains: [] },
    });
    expect(db.prepare('SELECT count(*) AS n FROM job_analyses').get()).toEqual({ n: 0 });
  });
});

describe("Claude's facts on the job", () => {
  const AUSTIN = { locations: ['Austin, TX'] };
  const QUIET = `<h3>Requirements</h3><ul><li>Experience building backend services in Go and PostgreSQL</li>
<li>Running workloads on Kubernetes in production</li></ul><p>We hold on-site interviews at our Austin office.</p>`;
  const OPTIONS = `<h3>Requirements</h3><ul><li>Experience building backend services in Go and PostgreSQL</li>
<li>Running workloads on Kubernetes in production</li></ul><p>We offer remote work options and hybrid options.</p>`;

  it("AI 'remote' with no remote wording gives NULL", async () => {
    const { ctx: context, analysis } = await setup({}, [
      posting('quiet', { ...AUSTIN, title: 'Backend Engineer', descriptionHtml: QUIET }),
      posting('says', { ...AUSTIN, title: 'Platform Engineer', descriptionHtml: QUIET.replace('on-site interviews', 'remote work options') }),
    ]);
    const arrangement = (title: string) =>
      (context.deps.db.prepare('SELECT work_arrangement FROM jobs WHERE title = ?').get(title) as { work_arrangement: string | null }).work_arrangement;
    // Ingest read neither description as stating an arrangement.
    expect([arrangement('Backend Engineer'), arrangement('Platform Engineer')]).toEqual([null, null]);
    fakeAnswer({ ...EMPTY_ANSWER, workArrangement: 'remote' });
    const backlog = createJobAnalysisBacklog(context.deps, analysis);
    expect(await finish(context, backlog.tick())).toBe('succeeded');
    expect(await finish(context, backlog.tick())).toBe('succeeded');
    // "remote" from a posting that never says remote is a guess: it stays empty, in the job and in the analysis.
    expect(arrangement('Backend Engineer')).toBeNull();
    expect(arrangement('Platform Engineer')).toBe('remote');
    const facts = (context.deps.db.prepare("SELECT a.extras FROM jobs j JOIN job_analyses a ON a.id = j.analysis_id WHERE j.title = 'Backend Engineer'").get() as { extras: string }).extras;
    expect(JSON.parse(facts).workArrangement).toBeNull();
  });

  it('a v1 AI arrangement that contradicts the posting is not re-applied', async () => {
    let postedAt = '2026-10-01T00:00:00.000Z';
    const { ctx: context, ingest } = await setup({ AI_JOB_ANALYSIS: 'off' }, () => [
      posting('quiet', { ...AUSTIN, title: 'Backend Engineer', descriptionHtml: QUIET, postedAt }),
      posting('says', { ...AUSTIN, title: 'Platform Engineer', descriptionHtml: OPTIONS, postedAt }),
    ]);
    const db = context.deps.db;
    const jobs = db.prepare('SELECT title, content_hash FROM jobs').all() as Array<{ title: string; content_hash: string }>;
    // Answers stored before this release: version 1, their work arrangement never checked against the posting.
    for (const [title, workArrangement] of [['Backend Engineer', 'remote'], ['Platform Engineer', 'hybrid']] as const) {
      saveAnalysis(
        db,
        {
          requirements: [],
          responsibilities: [],
          desired: [],
          keywords: { high: [], low: [] },
          experienceLevels: [],
          leadership: null,
          minYears: null,
          categoryId: null,
          subcategoryIds: [],
          extras: { workArrangement, employmentType: null, salary: null, sponsorsH1b: null, requiresClearance: null, degree: null },
          contentHash: jobs.find((job) => job.title === title)!.content_hash,
          source: 'ai',
          version: 1,
        },
        TEST_NOW.toISOString(),
      );
    }
    // The posting changes (not its text), so ingest rewrites both jobs and puts Claude's facts back.
    postedAt = '2026-10-02T00:00:00.000Z';
    expect(await ingest()).toMatchObject({ updated: 2 });
    const arrangement = (title: string) =>
      (db.prepare('SELECT work_arrangement FROM jobs WHERE title = ?').get(title) as { work_arrangement: string | null }).work_arrangement;
    // "On-site interviews" reads as on-site at most: "remote" contradicts it and stays off.
    expect(arrangement('Backend Engineer')).toBeNull();
    // "Remote work options and hybrid options" reads as hybrid (loosely): the stored "hybrid" goes back.
    expect(arrangement('Platform Engineer')).toBe('hybrid');
  });

  it('AI facts survive a same-text rewrite', async () => {
    let postedAt = '2026-10-01T00:00:00.000Z';
    const { ctx: context, analysis, ingest } = await setup({}, () => [
      posting('1', { ...AUSTIN, title: 'Platform Engineer', descriptionHtml: OPTIONS, postedAt }),
    ]);
    const db = context.deps.db;
    const facts = () =>
      db.prepare('SELECT experience_levels, work_arrangement, degree, sponsors_h1b, requires_clearance FROM jobs').get() as Record<string, unknown>;
    expect(facts()).toEqual({ experience_levels: '[]', work_arrangement: null, degree: null, sponsors_h1b: null, requires_clearance: null });
    fakeAnswer({
      ...EMPTY_ANSWER,
      experienceLevels: ['senior'],
      workArrangement: 'hybrid',
      degree: "Bachelor's",
      sponsorsH1b: true,
      requiresClearance: false,
    });
    expect(await finish(context, createJobAnalysisBacklog(context.deps, analysis).tick())).toBe('succeeded');
    const filled = { experience_levels: '["senior"]', work_arrangement: 'hybrid', degree: "Bachelor's", sponsors_h1b: 1, requires_clearance: 0 };
    expect(facts()).toEqual(filled);

    // A rewrite with the same text writes the posting's own (empty) values, then Claude's come back.
    postedAt = '2026-10-02T00:00:00.000Z';
    expect(await ingest()).toMatchObject({ updated: 1 });
    expect(facts()).toEqual(filled);
    expect(analysisTasks(context)).toHaveLength(1);
  });
});

describe('AI analysis post-processing', () => {
  it('validates the model output leniently and keeps only grounded content', () => {
    const output = JobAnalysisOutputSchema.parse({
      summary: { requirements: ['Know Rust'], responsibilities: [], desiredQualifications: [] },
      keywords: { high: [{ term: 'Rust' }, { term: 'COBOL', synonyms: [] }], low: [] },
      experienceLevels: ['Senior', 'staff', 'wizard'],
      leadership: 'IC',
      minYears: '4',
      category: { id: 'not-a-category', subcategoryIds: ['backend'] },
      workArrangement: 'On-site',
      employmentType: 'Full-Time',
      salary: { min: '120k', max: 150000, currency: 'usd', period: 'yearly' },
      sponsorsH1b: 'yes',
      requiresClearance: null,
      degree: "Bachelor's",
      // Lists added after version 1 are read as leniently as can be: a wrong shape is "not given".
      softSkills: 'communication',
      terms: { certifications: [{ name: 'CKA' }], domains: null },
    });
    expect(output.softSkills).toBeUndefined();
    const text = 'We use Rust. You need 4+ years of experience. This role is on-site in Austin. Pay: $120k - $150,000 a year.';
    const finished = finishAiAnalysis(output, { title: 'Backend Engineer', text }, {
      requirements: ['fallback'],
      responsibilities: ['fallback duty'],
      desired: [],
    });
    expect(finished.keywords.high).toEqual([{ term: 'Rust', synonyms: [] }]);
    expect(finished.experienceLevels).toEqual(['senior', 'expert']);
    expect(finished.leadership).toBe('ic');
    expect(finished.minYears).toBe(4);
    expect(finished.categoryId).toBeNull();
    expect(finished.subcategoryIds).toEqual([]);
    expect(finished.responsibilities).toEqual(['fallback duty']);
    expect(finished).toMatchObject({ softSkills: null, terms: { certifications: [], domains: [] } });
    expect(finished.facts).toMatchObject({
      workArrangement: 'onsite',
      employmentType: 'full_time',
      salary: { min: 120000, max: 150000, currency: 'USD', period: 'year' },
      sponsorsH1b: true,
      degree: "Bachelor's",
    });
    // Without the posting's word for it, neither the years nor the arrangement stand.
    const unstated = finishAiAnalysis(output, { title: 'Backend Engineer', text: 'We use Rust. Pay: $120k - $150,000 a year.' }, {
      requirements: [],
      responsibilities: [],
      desired: [],
      minYears: 2,
    });
    expect(unstated.minYears).toBe(2);
    expect(unstated.facts.workArrangement).toBeNull();
  });

  it('checks pay figures and bullet grounding', () => {
    expect(amountStated('Pay: $120,000 - $150,000', 120000)).toBe(true);
    expect(amountStated('Pay: 120k', 120000)).toBe(true);
    expect(amountStated('Pay: $1,120,000', 120000)).toBe(false);
    const words = new Set(['kubernetes', 'production', 'running', 'experience']);
    expect(grounded('Experience running Kubernetes in production', words)).toBe(true);
    expect(grounded('Fluency in ancient Sumerian poetry traditions', words)).toBe(false);
    expect(grounded('Go', words)).toBe(true);
  });
});
