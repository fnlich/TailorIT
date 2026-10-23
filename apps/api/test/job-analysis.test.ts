import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireAi } from '../src/ai/index';
import { amountStated, finishAiAnalysis, grounded } from '../src/features/job-analysis/ai';
import { DETERMINISTIC_VERSION } from '../src/features/job-analysis/deterministic';
import { JobAnalysisOutputSchema, jobAnalysisPrompt } from '../src/features/job-analysis/prompt';
import {
  AI_ANALYSES_PER_USER_PER_HOUR,
  dedupeKeyOf,
  type JobAnalysisServiceInternals,
} from '../src/features/job-analysis/service';
import { saveAnalysis } from '../src/features/job-analysis/store';
import { startJobAnalysisWarmup } from '../src/features/job-analysis/warmup';
import { createIngestService } from '../src/features/ingest/service';
import { insertSource } from '../src/features/ingest/sources';
import type { RawPosting } from '../src/features/ingest/types';
import { signIn } from './auth-helpers';
import { createTestContext, TEST_NOW, type TestContext } from './helpers';

// The job analysis service against the fake Claude CLI (tools/fake-claude/scenarios/job_analysis.json).

let ctx: TestContext | null = null;
afterEach(() => {
  vi.unstubAllEnvs();
  ctx?.cleanup();
  ctx = null;
});

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

async function setup(env: Record<string, string> = {}, postings: RawPosting[] = [posting('1')]) {
  ctx = createTestContext({ env });
  const source = insertSource(ctx.deps.db, { kind: 'greenhouse', name: 'acme', config: {} }, TEST_NOW.toISOString());
  const service = createIngestService(ctx.deps, {
    adapters: { greenhouse: { kind: 'greenhouse', fetch: async () => ({ postings, complete: true, failures: [] }) } },
  });
  await service.run(source.id, 'manual').done;
  const analysis = ctx.deps.services.jobAnalysis as JobAnalysisServiceInternals;
  return { ctx, analysis };
}

function analysisTasks(context: TestContext) {
  return context.deps.db.prepare("SELECT id, status, priority, user_id, dedupe_key, input FROM ai_tasks WHERE kind = 'job_analysis' ORDER BY created_at").all() as Array<{
    id: string;
    status: string;
    priority: number;
    user_id: string | null;
    dedupe_key: string;
    input: string;
  }>;
}

describe('JobAnalysisService', () => {
  it('answers the deterministic analysis at once, queues an AI one, and swaps when it lands', async () => {
    const { ctx: context, analysis } = await setup();
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
    const { ctx: context, analysis } = await setup({}, [posting('1'), posting('2', { title: 'Platform Engineer II', url: 'https://jobs.example.com/acme/other' })]);
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
  });

  it('keeps at most three AI analyses pending; further views show the deterministic one', async () => {
    const postings = ['1', '2', '3', '4', '5'].map((id) =>
      posting(id, {
        title: `Platform Engineer, Team ${id}`,
        descriptionHtml: `${DESCRIPTION}<p>Team ${id} owns its own corner of the platform.</p>`,
        url: `https://jobs.example.com/acme/team-${id}`,
      }),
    );
    const { ctx: context, analysis } = await setup({}, postings);
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
    const { ctx: context, analysis } = await setup();
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
    const { ctx: context, analysis } = await setup({ AI_JOB_ANALYSIS_WARMUP_PER_HOUR: '6' }, [
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

describe('analyses started by opening jobs', () => {
  /** The analysis task queued for one job (created_at is the frozen clock, so order by it says nothing). */
  const taskFor = (context: TestContext, jobId: number) =>
    analysisTasks(context).find((task) => (JSON.parse(task.input) as { jobId: number }).jobId === jobId);

  it('run on the background slot, owned by no one, when a person opens a job', async () => {
    const { ctx: context } = await setup();
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
    const { ctx: context, analysis } = await setup({}, postings);
    const ids = (context.deps.db.prepare('SELECT id FROM jobs ORDER BY id').all() as Array<{ id: number }>).map((row) => row.id);
    expect(ids).toHaveLength(count);
    const open = (jobId: number, userId: string) => analysis.ensure(jobId, { requestedBy: userId })!;
    const finish = (jobId: number) => requireAi(context.deps).waitFor(taskFor(context, jobId)!.id);

    // One at a time, so the global cap on pending analyses never decides.
    for (const id of ids.slice(0, AI_ANALYSES_PER_USER_PER_HOUR)) {
      expect(open(id, 'sweeper').refining).toBe(true);
      await finish(id);
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
    await finish(ids[AI_ANALYSES_PER_USER_PER_HOUR]!);
    expect(open(ids[AI_ANALYSES_PER_USER_PER_HOUR + 1]!, 'sweeper').refining).toBe(false);

    // A sliding hour: once the first ones are an hour old, the account may start new ones again.
    context.setNow(new Date(TEST_NOW.getTime() + 60 * 60_000 + 1_000));
    expect(open(ids[AI_ANALYSES_PER_USER_PER_HOUR + 1]!, 'sweeper').refining).toBe(true);
    await finish(ids[AI_ANALYSES_PER_USER_PER_HOUR + 1]!);
  }, 60_000);
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
    });
    const finished = finishAiAnalysis(output, { title: 'Backend Engineer', text: 'We use Rust. Pay: $120k - $150,000 a year.' }, {
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
    expect(finished.facts).toMatchObject({
      workArrangement: 'onsite',
      employmentType: 'full_time',
      salary: { min: 120000, max: 150000, currency: 'USD', period: 'year' },
      sponsorsH1b: true,
      degree: "Bachelor's",
    });
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
