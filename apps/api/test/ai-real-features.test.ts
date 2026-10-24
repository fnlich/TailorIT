// End-to-end smoke test of every AI feature through the REAL `claude` CLI (the owner's signed-in subscription).
// Skipped unless TAILORIT_REAL_CLAUDE=1, because each run spends real usage: one call per feature, six in all.
//   TAILORIT_REAL_CLAUDE=1 npx vitest run --project api test/ai-real-features.test.ts
// Uses the model configured for each feature (default claude-sonnet-5-5).
import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  containsTerm,
  findCertifications,
  findDomains,
  findPlaceholders,
  inferStatedYears,
  isAiVariable,
  maskFalseFriends,
  synonymKey,
  synonymsOf,
  yearsMentioned,
  yearsOf,
} from '@tailorit/shared';
import { createBackgroundGate } from '../src/ai/background';
import { requireAi } from '../src/ai/index';
import { getPdfService } from '../src/core/pdf/index';
import { createIngestService } from '../src/features/ingest/service';
import { insertSource } from '../src/features/ingest/sources';
import type { RawPosting } from '../src/features/ingest/types';
import { createJobAnalysisBacklog } from '../src/features/job-analysis/backlog';
import type { JobAnalysisServiceInternals } from '../src/features/job-analysis/service';
import { analysesFor } from '../src/features/job-analysis/store';
import { storedResumeAnalysis } from '../src/features/resumes/analysis/store';
import { signIn, type SignedIn } from './auth-helpers';
import { createTestContext, ORIGIN, type TestContext } from './helpers';

const REAL = process.env.TAILORIT_REAL_CLAUDE === '1';
const CALL_TIMEOUT = 300_000;
/** The real, signed-in CLI (AI_CLI_BIN=claude), with room for a slow answer. Everything else is the usual test app. */
const REAL_ENV = { AI_CLI_BIN: 'claude', AI_CLI_TIMEOUT_MS: String(CALL_TIMEOUT), AI_CLI_FIRST_EVENT_MS: '120000' };
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

/** A board posting (fictional company) that names soft skills, a certification, an industry and the years it asks for. */
const POSTING: RawPosting = {
  sourceJobId: 'real-ai-1',
  title: 'Senior Platform Engineer',
  company: { name: 'Litware Logistics' },
  url: 'https://jobs.example.com/litware/real-ai-1',
  locations: ['Austin, TX'],
  descriptionHtml: `
<p>Litware Logistics runs the shipment-tracking platform that freight carriers in the logistics industry rely on.</p>
<h3>Requirements</h3><ul>
<li>5+ years of experience building backend services in Go</li>
<li>Experience with Kafka and event-driven systems</li>
<li>Hands-on AWS (ECS, RDS) and Terraform</li>
<li>Clear written communication, and a habit of mentoring other engineers</li></ul>
<h3>Responsibilities</h3><ul>
<li>Design, build and operate the services that track millions of shipments a day</li>
<li>Lead on-call improvements and incident reviews in close collaboration with the support team</li></ul>
<h3>Nice to have</h3><ul>
<li>AWS Certified Solutions Architect certification</li>
<li>Kubernetes and PostgreSQL performance tuning</li></ul>`,
};

async function waitTask(taskId: string, context: TestContext = ctx) {
  const task = await requireAi(context.deps).waitFor(taskId, CALL_TIMEOUT);
  if (task.status !== 'succeeded') throw new Error(`task ${taskId} ${task.status}: ${JSON.stringify(task.error)}`);
  return task;
}

let resumePdf: Buffer | null = null;
/** RESUME printed through the PDF export, once: both upload cases send these same bytes, so their texts are the same. */
async function resumePdfBytes(): Promise<Buffer> {
  if (resumePdf) return resumePdf;
  const created = await me.agent.post('/api/resumes').set('Origin', ORIGIN).send({ document: RESUME });
  expect(created.status).toBe(201);
  const pdf = await me.agent.get(`/api/resumes/${created.body.id}/export?format=pdf`).buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  expect(pdf.status).toBe(200);
  resumePdf = pdf.body as Buffer;
  return resumePdf;
}

/**
 * Whether `text` says `phrase` as the grounding reads it: a whole word or phrase (case ignored past two characters),
 * a hyphen and a space alike ("decision-making").
 */
function says(text: string, phrase: string): boolean {
  const variants = new Set([phrase, phrase.replace(/[-‐‑]+/g, ' '), phrase.replace(/ /g, '-')]);
  return [...variants].some((variant) => containsTerm(text, variant));
}

describe.runIf(REAL)('AI features against the real claude CLI', () => {
  beforeAll(async () => {
    // The default modes: AI_JOB_ANALYSIS=ingest, AI_RESUME_ANALYSIS=auto. No feature is started, so the background
    // backlogs run only when a case ticks them.
    ctx = createTestContext({ env: REAL_ENV });
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

  it("reads an uploaded resume's skills, roles and years, grounded in its text (resume_analysis)", async () => {
    // The run's first upload. The resume_import case below uploads the same bytes, and gets this reading copied
    // (the same text in the same account is never asked about twice). The bytes come first: a request built before
    // other requests of the agent finish would be sent to the agent's server after it closed.
    const pdf = await resumePdfBytes();
    const upload = await me.agent.post('/api/resumes/upload').set('Origin', ORIGIN).attach('file', pdf, 'Jordan_Lee_resume.pdf');
    expect(upload.status).toBe(201);
    expect(upload.body.taskId).toBeNull();
    const resumeId = upload.body.resume.id as string;
    const db = ctx.deps.db;
    const { extracted_text: text } = db.prepare('SELECT extracted_text FROM resumes WHERE id = ?').get(resumeId) as {
      extracted_text: string;
    };
    const inLine = () =>
      db.prepare('SELECT content_hash, state FROM resume_analysis_backlog WHERE resume_id = ?').get(resumeId) as {
        content_hash: string;
        state: string;
      };
    expect(inLine().state).toBe('waiting');
    // One call: no other text is waiting for Claude.
    expect(db.prepare("SELECT DISTINCT content_hash FROM resume_analysis_backlog WHERE state IN ('waiting', 'failed')").all()).toEqual([
      { content_hash: inLine().content_hash },
    ]);

    // The backlog starts the reading on the background slot, owned by the uploader, while background AI may run (no
    // AI hold, and the seat's usage window is not nearly used up).
    expect(createBackgroundGate(ctx.deps).allowed()).toEqual({ ok: true });
    const backlog = ctx.deps.services.resumeAnalysis!.backlog;
    const taskId = backlog.tick();
    expect(taskId, 'the backlog starts a reading').toEqual(expect.any(String));
    const task = await waitTask(taskId!);
    expect(task.result).toMatchObject({ resumeId, stored: true });
    // The next step settles the finished reading and finds nothing else in line.
    expect(backlog.tick()).toBeNull();
    expect(inLine().state).toBe('done');

    const reading = storedResumeAnalysis(ctx.deps, me.account.id, resumeId, { compute: false })?.ai;
    if (!reading) throw new Error("Claude's reading of the upload was not stored");
    const { model } = db.prepare("SELECT model FROM resume_analyses WHERE resume_id = ? AND source = 'ai'").get(resumeId) as {
      model: string | null;
    };
    record('resume reading', { model, ...reading });

    // Grounded: every item is in the upload's text. Hard skills are stored in the skill library's spelling ("Kafka"
    // as "Apache Kafka"), so they are compared by synonym and found in the text in one of their spellings.
    const hardKeys = new Set(reading.hardSkills.map(synonymKey));
    for (const skill of ['Go', 'Kafka', 'PostgreSQL']) expect(hardKeys.has(synonymKey(skill)), skill).toBe(true);
    for (const skill of reading.hardSkills) expect(synonymsOf(skill).some((spelling) => says(text, spelling)), skill).toBe(true);
    for (const skill of reading.softSkills) expect(says(text, skill), skill).toBe(true);
    const roles = reading.keywords.roles.map((role) => role.toLowerCase());
    expect(roles[0]).toBe('senior backend engineer');
    expect(roles).toContain('software engineer');
    for (const role of reading.keywords.roles) expect(says(text, role), role).toBe(true);
    expect(reading.personName?.toLowerCase()).toBe('jordan lee');
    // Years: the two roles' dates, each a year the text writes (the 2010-2014 degree is not work), 06/2017 to now.
    const written = new Set(text.match(/(?<!\d)(?:19|20)\d{2}(?!\d)/g) ?? []);
    expect(reading.experience.length).toBeGreaterThan(0);
    for (const [start, end] of reading.experience) {
      for (const month of end === null ? [start] : [start, end]) expect(written.has(String(Math.floor(month / 12))), String(month)).toBe(true);
      expect(Math.floor(start / 12)).toBeGreaterThanOrEqual(2017);
    }
    if (reading.yearsStated !== null) expect(text.split(/\r?\n/).map(inferStatedYears)).toContain(reading.yearsStated);
    const { years } = yearsOf(reading, ctx.deps.now());
    expect(years).toBeGreaterThanOrEqual(8);
    expect(years).toBeLessThanOrEqual(10);

    // The file page's "What TailorIT read from this resume": Claude's reading merged over the rules' one.
    const view = await me.agent.get(`/api/resumes/${resumeId}/analysis`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ source: 'ai', refining: false, aiFailed: false });
    expect(view.body.hardSkills).toEqual(expect.arrayContaining(reading.hardSkills));
  }, CALL_TIMEOUT);

  it('imports an uploaded PDF resume into an editable one (resume_import)', async () => {
    const pdf = await resumePdfBytes();
    const upload = await me.agent.post('/api/resumes/upload?parse=1').set('Origin', ORIGIN).attach('file', pdf, 'Jordan_Lee_resume.pdf');
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

  it('analyses an added job once, in the background, grounding its soft skills, terms and years (job_analysis)', async () => {
    // An app of its own: the job backlog lets resume readings go first, and this one has no uploads in line.
    const jobs = createTestContext({ env: REAL_ENV });
    try {
      const db = jobs.deps.db;
      const source = insertSource(db, { kind: 'greenhouse', name: 'litware', config: {} }, jobs.deps.now().toISOString());
      const ingest = createIngestService(jobs.deps, {
        adapters: { greenhouse: { kind: 'greenhouse', fetch: async () => ({ postings: [POSTING], complete: true, failures: [] }) } },
      });
      await ingest.run(source.id, 'manual').done;
      const job = db.prepare('SELECT id, title, content_hash, description_text FROM jobs').get() as {
        id: number;
        title: string;
        content_hash: string;
        description_text: string;
      };

      // Added: the rules' analysis at once. Opening and saving the job queue nothing.
      const viewer = await signIn(jobs, 'real-ai-jobs@example.com');
      const opened = await viewer.agent.get(`/api/jobs/${job.id}/analysis`);
      expect(opened.status).toBe(200);
      expect(opened.body).toMatchObject({ source: 'deterministic', refining: false });
      const saved = await viewer.agent.post('/api/applications').set('Origin', ORIGIN).send({ jobId: job.id, status: 1 });
      expect(saved.status).toBe(201);
      const analysisTasks = () => db.prepare("SELECT user_id, priority FROM ai_tasks WHERE kind = 'job_analysis'").all();
      expect(analysisTasks()).toEqual([]);

      // The add-time backlog has Claude read it: one system-owned task on the background slot.
      const step = createJobAnalysisBacklog(jobs.deps, jobs.deps.services.jobAnalysis as JobAnalysisServiceInternals).tick();
      if (step.status !== 'queued') throw new Error(`the backlog queued nothing: ${JSON.stringify(step)}`);
      expect(step.jobId).toBe(job.id);
      expect(analysisTasks()).toEqual([{ user_id: null, priority: 0 }]);
      await waitTask(step.taskId, jobs);

      const ai = analysesFor(db, job.content_hash).find((analysis) => analysis.source === 'ai');
      if (!ai) throw new Error("Claude's analysis of the job was not stored");
      record(`analysis of ${job.title}`, {
        model: ai.model,
        requirements: ai.requirements.slice(0, 3),
        high: ai.keywords.high.map((keyword) => keyword.term),
        softSkills: ai.softSkills,
        terms: ai.terms,
        requiredYears: ai.requiredYears,
      });
      expect(ai.keywords.high.length + ai.keywords.low.length).toBeGreaterThan(0);
      // Claude answered the soft skills and terms (null would mean its answer left them out); every item is the
      // posting's own: a soft skill it says, a certification and an industry it names, years it writes as years.
      const postingText = `${job.title}\n${job.description_text}`;
      const named = maskFalseFriends(postingText);
      const softSkills = ai.softSkills ?? [];
      const terms = ai.terms ?? { certifications: [], domains: [] };
      expect(ai.softSkills).not.toBeNull();
      expect(ai.terms).not.toBeNull();
      expect(softSkills.length).toBeGreaterThan(0);
      for (const skill of softSkills) expect(says(postingText, skill), skill).toBe(true);
      expect(terms.certifications.length + terms.domains.length).toBeGreaterThan(0);
      const certifications = findCertifications(named, { max: 100 });
      for (const name of terms.certifications) expect(certifications, name).toContain(name);
      const domains = findDomains(named, 100);
      for (const id of terms.domains) expect(domains, id).toContain(id);
      expect(ai.requiredYears).toBe(5);
      expect(yearsMentioned(postingText)).toContain(ai.requiredYears);

      // The job page now shows Claude's analysis with those facets.
      const analysed = await viewer.agent.get(`/api/jobs/${job.id}/analysis`);
      expect(analysed.body).toMatchObject({ source: 'ai', refining: false, softSkills, requiredYears: 5 });
    } finally {
      jobs.cleanup();
    }
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
