import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiTaskAcceptedSchema, BulletsResultSchema } from '@tailorit/shared';
import { requireAi } from '../src/ai/index';
import { cleanBullet, finishBullets } from '../src/features/resumes/ai/entryBullets';
import { ImportedResumeSchema, importedDocument } from '../src/features/resumes/ai/resumeImport';
import { signIn, type TestAgent } from './auth-helpers';
import { createTestContext, ORIGIN, type TestContext } from './helpers';

// Write with AI / Improve with AI (`entry_bullets`) through the fake Claude CLI
// (tools/fake-claude/scenarios/entry_bullets.json), and the answer clean-up both AI tasks rely on.

let ctx: TestContext | null = null;
beforeEach(() => {
  vi.stubEnv('FAKE_CLAUDE_MODE', '');
  vi.stubEnv('FAKE_CLAUDE_SCENARIOS', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  ctx?.cleanup();
  ctx = null;
});

async function setup(): Promise<TestAgent> {
  ctx = createTestContext();
  return (await signIn(ctx, 'writer@example.com')).agent;
}

const ENTRY = {
  title: 'Backend Engineer',
  company: 'Pinecrest Freight Software',
  startDate: '2021',
  endDate: 'Present',
  description: 'Rates and billing services.',
  achievements: [],
  skills: ['Go', 'Kafka'],
};

describe('Write with AI', () => {
  it('202 then the task answers clean bullets', async () => {
    const agent = await setup();
    const res = await agent
      .post('/api/resumes/bullets')
      .set('Origin', ORIGIN)
      .send({ kind: 'experience', task: 'write', entry: ENTRY, resume: { name: 'Nadia', title: 'Engineer', skills: ['Go'] }, instructions: 'the cost savings' });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const { taskId } = AiTaskAcceptedSchema.parse(res.body);
    const task = await requireAi(ctx!.deps).waitFor(taskId, 20_000);
    expect(task.status, JSON.stringify(task.error)).toBe('succeeded');
    const { bullets } = BulletsResultSchema.parse(task.result);
    expect(bullets).toEqual([
      'Rebuilt the invoice pipeline on a Kafka stream, so invoices land within 2 minutes of an order',
      'Cut p95 checkout latency from 1.4s to 380ms, by caching tax tables in Redis',
      'Wrote the failover runbook the team uses, and ran 6 game days with it',
      'Moved 12 cron jobs onto Kubernetes, cutting infrastructure cost by 31%',
    ]);
    const polled = await agent.get(`/api/ai/tasks/${taskId}`);
    expect(polled.body).toMatchObject({ kind: 'entry_bullets', status: 'succeeded', result: { bullets } });
  });

  it('is also served at /api/ai/resume-bullets (Improve with AI)', async () => {
    const agent = await setup();
    const res = await agent
      .post('/api/ai/resume-bullets')
      .set('Origin', ORIGIN)
      .send({ kind: 'project', task: 'improve', entry: { name: 'kubelint', achievements: ['wrote a linter'] } });
    expect(res.status).toBe(202);
    expect((await requireAi(ctx!.deps).waitFor(res.body.taskId, 20_000)).status).toBe('succeeded');
  });

  it('refuses an entry with nothing to write from, or nothing to improve', async () => {
    const agent = await setup();
    const blank = await agent.post('/api/resumes/bullets').set('Origin', ORIGIN).send({ kind: 'experience', task: 'write', entry: {} });
    expect(blank.status).toBe(400);
    expect(blank.body.error.message).toBe('Give the role a title or a company before asking for bullets.');
    const project = await agent.post('/api/resumes/bullets').set('Origin', ORIGIN).send({ kind: 'project', task: 'write', entry: { role: 'Lead' } });
    expect(project.body.error.message).toBe('Give the project a name before asking for bullets.');
    const improve = await agent.post('/api/resumes/bullets').set('Origin', ORIGIN).send({ kind: 'experience', task: 'improve', entry: ENTRY });
    expect(improve.status).toBe(400);
    expect(improve.body.error.message).toMatch(/no bullets to improve/);
    const badKind = await agent.post('/api/resumes/bullets').set('Origin', ORIGIN).send({ kind: 'award', task: 'write', entry: ENTRY });
    expect(badKind.status).toBe(400);
  });

  it('fails the task with a readable sentence when the AI is unavailable', async () => {
    const agent = await setup();
    vi.stubEnv('FAKE_CLAUDE_MODE', 'auth');
    const res = await agent.post('/api/resumes/bullets').set('Origin', ORIGIN).send({ kind: 'volunteering', task: 'write', entry: { role: 'Mentor' } });
    const task = await requireAi(ctx!.deps).waitFor(res.body.taskId, 20_000);
    expect(task.status).toBe('failed');
    expect(task.error).toMatchObject({ code: 'ai_unavailable' });
    expect(task.error?.message).toMatch(/sign the Claude CLI in again/);
  });

  it('two at once per account is the limit (409)', async () => {
    const agent = await setup();
    vi.stubEnv('FAKE_CLAUDE_MODE', 'slow');
    vi.stubEnv('FAKE_CLAUDE_SLOW_MS', '1500');
    const send = () => agent.post('/api/resumes/bullets').set('Origin', ORIGIN).send({ kind: 'experience', task: 'write', entry: ENTRY });
    const first = await send();
    const second = await send();
    const third = await send();
    expect([first.status, second.status, third.status]).toEqual([202, 202, 409]);
    expect(third.body.error.code).toBe('ai_busy');
    await requireAi(ctx!.deps).waitFor(first.body.taskId, 20_000);
    await requireAi(ctx!.deps).waitFor(second.body.taskId, 20_000);
  });
});

describe('answer clean-up', () => {
  it('strips markers and markup, makes dashes plain, drops the full stop, cuts long lines', () => {
    expect(cleanBullet('  • **Shipped** the 2019–2021 migration — on time.  ')).toBe('Shipped the 2019-2021 migration, on time');
    expect(cleanBullet('1. Ran <b>it</b> -- weekly')).toBe('Ran it, weekly');
    expect(cleanBullet(`Built ${'x '.repeat(200)}`).length).toBeLessThanOrEqual(300);
    expect(finishBullets(['A thing', 'a thing', '', '- ', ...Array.from({ length: 10 }, (_, i) => `Bullet ${i}`)])).toHaveLength(8);
  });

  it('reads a lenient import answer: numbers as text, skills as a heading map', () => {
    const answer = ImportedResumeSchema.parse({ name: 'X', contact: { phone: 5550100 }, skills: { Languages: ['Go'], Cloud: ['AWS'] } });
    const document = importedDocument(answer);
    expect(document.contact.phone).toBe('5550100');
    expect(document.skills).toEqual(['Go', 'AWS']);
    expect(document.skillCategories).toEqual([
      { category: 'Languages', skills: ['Go'] },
      { category: 'Cloud', skills: ['AWS'] },
    ]);
  });

  it("turns an imported resume's extra sections into custom sections with fresh keys", () => {
    const document = importedDocument({
      name: 'X',
      contact: null,
      otherSections: [
        { title: 'Patents', entries: [{ heading: 'One' }] },
        { title: 'Talks', entries: [{ heading: 'Two' }] },
      ],
      experience: null,
    });
    expect(document.customSections?.map((section) => section.title)).toEqual(['Patents', 'Talks']);
    expect(new Set(document.customSections?.map((section) => section.key)).size).toBe(2);
    expect(document.contact.email).toBe('');
  });
});
