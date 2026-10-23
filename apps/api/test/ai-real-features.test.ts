// End-to-end smoke test of every AI feature through the REAL `claude` CLI (the owner's signed-in subscription).
// Skipped unless TAILORIT_REAL_CLAUDE=1, because each run spends real usage: one call per feature, five in all.
//   TAILORIT_REAL_CLAUDE=1 npx vitest run --project api test/ai-real-features.test.ts
// Uses the model configured for each feature (default claude-sonnet-5-5).
import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findPlaceholders, isAiVariable } from '@tailorit/shared';
import { requireAi } from '../src/ai/index';
import { getPdfService } from '../src/core/pdf/index';
import { seedDemoJobs } from '../src/features/ingest/seed';
import { signIn, type SignedIn } from './auth-helpers';
import { createTestContext, ORIGIN, type TestContext } from './helpers';

const REAL = process.env.TAILORIT_REAL_CLAUDE === '1';
const CALL_TIMEOUT = 300_000;
/** Optional: append each feature's output to this file to read the generated text (passing tests' logs are hidden). */
const OUTPUT_FILE = process.env.TAILORIT_REAL_CLAUDE_OUT;
const record = (label: string, value: unknown) => {
  console.log(`[real-ai] ${label}:`, typeof value === 'string' ? value : JSON.stringify(value));
  if (OUTPUT_FILE) appendFileSync(OUTPUT_FILE, `## ${label}
${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}

`);
};

let ctx: TestContext;
let me: SignedIn;

/** A believable resume to draw from (fictional person). */
const RESUME = {
  name: 'Jordan Lee',
  title: 'Senior Backend Engineer',
  totalYearsExperience: 8,
  contact: { email: 'jordan.lee@example.com', phone: '+1 555 0100', location: 'Austin, TX', linkedin: 'linkedin.com/in/jordanlee' },
  summary:
    'Backend engineer with eight years building payment and logistics platforms in Go and Python on AWS. ' +
    'I like owning services from design review to on-call.',
  experience: [
    {
      title: 'Senior Backend Engineer',
      company: 'Northwind Freight',
      startDate: '03/2021',
      endDate: 'Present',
      location: 'Remote',
      description: 'Platform team for shipment tracking.',
      achievements: [
        'Built a Go event pipeline on Kafka that tracks 2M shipments a day',
        'Cut AWS spend by 22% by right-sizing ECS services and moving batch jobs to spot instances',
        'Ran the on-call rotation for 14 services and wrote the incident runbooks',
      ],
      skills: ['Go', 'Kafka', 'AWS', 'PostgreSQL'],
    },
    {
      title: 'Software Engineer',
      company: 'Contoso Payments',
      startDate: '06/2017',
      endDate: '02/2021',
      location: 'Austin, TX',
      description: 'Card payments API.',
      achievements: ['Shipped the refunds API used by 300 merchants', 'Reduced p99 latency from 900 ms to 120 ms'],
      skills: ['Python', 'Django', 'Redis'],
    },
  ],
  skills: ['Go', 'Python', 'Kafka', 'AWS', 'PostgreSQL', 'Redis', 'Docker', 'Kubernetes', 'Terraform'],
  education: [
    { degree: 'B.S. Computer Science', institution: 'University of Texas at Austin', startDate: '2010', endDate: '2014', location: 'Austin, TX' },
  ],
};

const JOB_DESCRIPTION = `We are hiring a Senior Platform Engineer to own our shipment-tracking platform.
Requirements:
- 5+ years building backend services in Go
- Experience with Kafka and event-driven systems
- Hands-on AWS (ECS, RDS) and Terraform
Responsibilities:
- Design, build and operate services that track millions of shipments
- Lead on-call improvements and incident reviews
Nice to have:
- Kubernetes
- PostgreSQL performance tuning`;

async function waitTask(taskId: string) {
  const task = await requireAi(ctx.deps).waitFor(taskId, CALL_TIMEOUT);
  if (task.status !== 'succeeded') throw new Error(`task ${taskId} ${task.status}: ${JSON.stringify(task.error)}`);
  return task;
}

describe.runIf(REAL)('AI features against the real claude CLI', () => {
  beforeAll(async () => {
    // AI_CLI_BIN=claude: the real, signed-in CLI. Everything else is the usual temporary test app.
    ctx = createTestContext({ env: { AI_CLI_BIN: 'claude', AI_CLI_TIMEOUT_MS: String(CALL_TIMEOUT), AI_CLI_FIRST_EVENT_MS: '120000' } });
    me = await signIn(ctx, 'real-ai@example.com', { name: 'Jordan Lee' });
    const health = await requireAi(ctx.deps).health(true);
    record('health', JSON.stringify(health));
    expect(health.available).toBe(true);
  }, CALL_TIMEOUT);

  afterAll(async () => {
    await getPdfService(ctx.deps).close();
    ctx.cleanup();
  });

  it('writes resume bullets (entry_bullets)', async () => {
    const res = await me.agent
      .post('/api/resumes/bullets')
      .set('Origin', ORIGIN)
      .send({
        kind: 'experience',
        task: 'write',
        entry: {
          title: 'Platform Engineer',
          company: 'Fabrikam',
          description: 'Kept a fleet of 40 Go services healthy; moved deploys to Terraform; built Kafka consumers.',
        },
        resume: { name: RESUME.name, title: RESUME.title, summary: RESUME.summary, skills: RESUME.skills },
      });
    expect(res.status).toBe(202);
    const task = await waitTask(res.body.taskId);
    const bullets = (task.result as { bullets: string[] }).bullets;
    record('bullets', bullets);
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.length).toBeLessThanOrEqual(8);
    for (const b of bullets) expect(b).not.toMatch(/—|--/);
  }, CALL_TIMEOUT);

  it('imports an uploaded PDF resume into an editable one (resume_import)', async () => {
    const created = await me.agent.post('/api/resumes').set('Origin', ORIGIN).send({ document: RESUME });
    expect(created.status).toBe(201);
    const pdf = await me.agent.get(`/api/resumes/${created.body.id}/export?format=pdf`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    const upload = await me.agent
      .post('/api/resumes/upload?parse=1')
      .set('Origin', ORIGIN)
      .attach('file', pdf.body as Buffer, 'Jordan_Lee_resume.pdf');
    expect(upload.status).toBe(201);
    expect(upload.body.taskId).toBeTruthy();
    const task = await waitTask(upload.body.taskId);
    const { resumeId } = task.result as { resumeId: string };
    const imported = await me.agent.get(`/api/resumes/${resumeId}`);
    const doc = imported.body.document;
    record('imported', { name: doc.name, title: doc.title, roles: doc.experience?.length, skills: doc.skills });
    expect(doc.name).toMatch(/Jordan Lee/);
    expect(doc.experience.length).toBe(2);
    expect(doc.experience[0].company).toMatch(/Northwind/);
    expect(doc.skills).toEqual(expect.arrayContaining(['Go', 'Kafka']));
  }, CALL_TIMEOUT);

  it('analyses a job posting lazily (job_analysis)', async () => {
    await seedDemoJobs(ctx.deps);
    const job = ctx.deps.db.prepare("SELECT id, title FROM jobs WHERE active = 1 ORDER BY id LIMIT 1").get() as {
      id: number;
      title: string;
    };
    const first = await me.agent.get(`/api/jobs/${job.id}/analysis`);
    expect(first.status).toBe(200);
    expect(first.body.refining).toBe(true);
    const task = ctx.deps.db
      .prepare("SELECT id FROM ai_tasks WHERE kind = 'job_analysis' ORDER BY created_at DESC LIMIT 1")
      .get() as { id: string };
    await waitTask(task.id);
    const second = await me.agent.get(`/api/jobs/${job.id}/analysis`);
    const analysis = second.body.analysis ?? second.body;
    record(`analysis of ${job.title}`, {
      source: analysis.source,
      requirements: analysis.requirements?.slice(0, 3),
      high: analysis.keywords?.high?.map((k: { term: string }) => k.term),
      levels: analysis.experienceLevels,
    });
    expect(analysis.source).toBe('ai');
    expect(analysis.keywords.high.length + analysis.keywords.low.length).toBeGreaterThan(0);
  }, CALL_TIMEOUT);

  it('generates a cover letter without a template (cover_letter)', async () => {
    const letter = await me.agent.post('/api/cover-letters').set('Origin', ORIGIN).send({});
    expect(letter.status).toBe(201);
    const gen = await me.agent
      .post(`/api/cover-letters/${letter.body.id}/generate`)
      .set('Origin', ORIGIN)
      .send({ companyName: 'Litware Logistics', jobTitle: 'Senior Platform Engineer', jobDescription: JOB_DESCRIPTION });
    expect(gen.status).toBe(202);
    const task = await waitTask(gen.body.taskId);
    const { html, placeholders } = task.result as { html: string; placeholders: string[] };
    record('letter', html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 600));
    expect(html).toMatch(/Dear Hiring Manager/);
    expect(html).toMatch(/Sincerely/);
    expect(html).toMatch(/Jordan Lee/);
    expect(placeholders).toEqual([]);
    expect(html).not.toMatch(/—/);
  }, CALL_TIMEOUT);

  it('fills a starter template, including its AI variables (template_fill)', async () => {
    const templates = await me.agent.get('/api/cover-letter-templates');
    const starter = (templates.body.items as Array<{ id: string; isSystem: boolean; name: string }>).find(
      (t) => t.isSystem && t.name === 'Software Engineering',
    ) ?? (templates.body.items as Array<{ id: string; isSystem: boolean }>).find((t) => t.isSystem)!;
    const detail = await me.agent.get(`/api/cover-letter-templates/${starter.id}`);
    const aiVars = findPlaceholders(detail.body.contentHtml).filter(isAiVariable);
    expect(aiVars.length).toBeGreaterThan(0);

    const letter = await me.agent.post('/api/cover-letters').set('Origin', ORIGIN).send({});
    const gen = await me.agent
      .post(`/api/cover-letters/${letter.body.id}/generate`)
      .set('Origin', ORIGIN)
      .send({
        companyName: 'Litware Logistics',
        jobTitle: 'Senior Platform Engineer',
        jobDescription: JOB_DESCRIPTION,
        templateId: starter.id,
      });
    expect(gen.status).toBe(202);
    const task = await waitTask(gen.body.taskId);
    const { html, placeholders } = task.result as { html: string; placeholders: string[] };
    record('template', { starter, aiVars, left: placeholders });
    record('filled', html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 600));
    for (const v of aiVars) expect(placeholders).not.toContain(v);
    expect(html).toMatch(/Litware Logistics/);
  }, CALL_TIMEOUT);
});
