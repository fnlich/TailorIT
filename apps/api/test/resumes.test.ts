import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RESUME_EXPORT_FORMAT,
  ResumeBulkDeleteResponseSchema,
  ResumeDetailSchema,
  ResumeImportJsonResponseSchema,
  ResumeListResponseSchema,
  ResumePreviewResponseSchema,
  ResumeThumbnailSchema,
} from '@tailorit/shared';
import { PREVIEW_CONTENT_SECURITY_POLICY } from '@tailorit/render';
import { signIn, type TestAgent } from './auth-helpers';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';

let ctx: TestContext | null = null;
afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

const DOCUMENT = {
  name: 'Ines Halvorsen',
  title: 'Platform Engineer',
  contact: { email: 'ines.h@example.com', phone: '+1 555 0100', location: 'Oslo' },
  summary: 'Platform engineer.',
  skills: ['Go', 'Kubernetes', 'PostgreSQL'],
  experience: [
    { title: 'Engineer', company: 'Fjordline Data', startDate: '2020', endDate: 'Present', location: 'Oslo', achievements: ['Shipped it'] },
  ],
  preferredTemplate: 'navy-gold',
};

async function setup(): Promise<{ agent: TestAgent; other: TestAgent; userId: string }> {
  ctx = createTestContext();
  const me = await signIn(ctx, 'owner@example.com');
  const other = await signIn(ctx, 'someone-else@example.com');
  return { agent: me.agent, other: other.agent, userId: me.account.id };
}

async function create(agent: TestAgent, document: object = DOCUMENT, title?: string) {
  const res = await agent.post('/api/resumes').set('Origin', ORIGIN).send({ document, ...(title !== undefined ? { title } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return ResumeDetailSchema.parse(res.body);
}

describe('resume CRUD', () => {
  it('creates a built resume, normalised, and makes the first one the default', async () => {
    const { agent } = await setup();
    const first = await create(agent);
    expect(first).toMatchObject({
      kind: 'built',
      label: 'Platform Engineer',
      title: null,
      templateId: 'navy-gold',
      templateName: 'Navy Gold',
      isDefault: true,
      fileKind: null,
      nameOnResume: 'Ines Halvorsen',
      createdAt: TEST_NOW.toISOString(),
      lastEditedAt: null,
      file: null,
    });
    expect(first.document?.resumeSettings).toEqual({ technicalSkillsLayout: 'categorized', includeSoftSkills: false, includeStrengths: false });
    const second = await create(agent, { name: 'Second' }, 'My second');
    expect(second).toMatchObject({ isDefault: false, label: 'My second', templateId: 'default' });
  });

  it('lists newest first, filtered by source', async () => {
    const { agent } = await setup();
    await create(agent, { name: 'Older' });
    ctx!.setNow(new Date(TEST_NOW.getTime() + 60_000));
    await create(agent, { name: 'Newer' });
    const all = ResumeListResponseSchema.parse((await agent.get('/api/resumes')).body);
    expect(all.items.map((item) => item.label)).toEqual(['Newer', 'Older']);
    expect((await agent.get('/api/resumes?source=uploaded')).body.items).toEqual([]);
    expect((await agent.get('/api/resumes?source=built')).body.items).toHaveLength(2);
  });

  it('updates over the stored document, keeps omitted fields and records the edit', async () => {
    const { agent } = await setup();
    const created = await create(agent);
    ctx!.setNow(new Date(TEST_NOW.getTime() + 3_600_000));
    const res = await agent
      .put(`/api/resumes/${created.id}`)
      .set('Origin', ORIGIN)
      .send({ document: { summary: '  New summary  ', resumeSettings: { includeStrengths: true } }, title: 'Renamed' });
    expect(res.status).toBe(200);
    const updated = ResumeDetailSchema.parse(res.body);
    expect(updated.document).toMatchObject({ name: 'Ines Halvorsen', summary: 'New summary', skills: ['Go', 'Kubernetes', 'PostgreSQL'] });
    expect(updated.document?.resumeSettings.includeStrengths).toBe(true);
    expect(updated.title).toBe('Renamed');
    expect(updated.lastEditedAt).toBe(new Date(TEST_NOW.getTime() + 3_600_000).toISOString());
  });

  it('renames with PATCH and goes back to the label rule on an empty title', async () => {
    const { agent } = await setup();
    const created = await create(agent);
    const renamed = await agent.patch(`/api/resumes/${created.id}`).set('Origin', ORIGIN).send({ title: '  Backend CV  ' });
    expect(renamed.body).toMatchObject({ title: 'Backend CV', label: 'Backend CV', lastEditedAt: null });
    const cleared = await agent.patch(`/api/resumes/${created.id}`).set('Origin', ORIGIN).send({ title: '' });
    expect(cleared.body).toMatchObject({ title: null, label: 'Platform Engineer' });
  });

  it('duplicates as "{label} (Copy)" and never as the default', async () => {
    const { agent } = await setup();
    const created = await create(agent);
    const copy = await agent.post(`/api/resumes/${created.id}/duplicate`).set('Origin', ORIGIN).send({});
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ label: 'Platform Engineer (Copy)', isDefault: false, templateId: 'navy-gold' });
    expect(copy.body.id).not.toBe(created.id);
  });

  it('refuses a body without a document, and a request from another origin', async () => {
    const { agent } = await setup();
    expect((await agent.post('/api/resumes').set('Origin', ORIGIN).send({})).status).toBe(400);
    expect((await agent.post('/api/resumes').set('Origin', 'https://evil.example').send({ document: {} })).status).toBe(403);
    expect((await request(ctx!.app).get('/api/resumes')).status).toBe(401);
  });
});

describe('ownership', () => {
  it("answers 404 for another account's resume on every route", async () => {
    const { agent, other } = await setup();
    const mine = await create(agent);
    const id = mine.id;
    const checks = [
      () => other.get(`/api/resumes/${id}`),
      () => other.put(`/api/resumes/${id}`).set('Origin', ORIGIN).send({ document: { name: 'x' } }),
      () => other.patch(`/api/resumes/${id}`).set('Origin', ORIGIN).send({ title: 'x' }),
      () => other.delete(`/api/resumes/${id}`).set('Origin', ORIGIN),
      () => other.post(`/api/resumes/${id}/duplicate`).set('Origin', ORIGIN).send({}),
      () => other.post(`/api/resumes/${id}/parse`).set('Origin', ORIGIN).send({}),
      () => other.get(`/api/resumes/${id}/thumbnail`),
      () => other.get(`/api/resumes/${id}/export?format=json`),
      () => other.get(`/api/resumes/${id}/file`),
      () => other.post('/api/resumes/preview').set('Origin', ORIGIN).send({ resumeId: id }),
    ];
    for (const [index, check] of checks.entries()) {
      const res = await check();
      expect(res.status, `check ${index + 1}`).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    }
    const bulk = await other.post('/api/resumes/bulk-delete').set('Origin', ORIGIN).send({ ids: [id] });
    expect(bulk.body).toEqual({ deleted: 0, skippedIds: [] });
    expect((await agent.get(`/api/resumes/${id}`)).status).toBe(200);
  });
});

describe('the default resume', () => {
  it('moves to the newest remaining resume when the default is deleted, and to none after the last', async () => {
    const { agent, userId } = await setup();
    const first = await create(agent, { name: 'First' });
    ctx!.setNow(new Date(TEST_NOW.getTime() + 1000));
    const second = await create(agent, { name: 'Second' });
    ctx!.setNow(new Date(TEST_NOW.getTime() + 2000));
    const third = await create(agent, { name: 'Third' });
    expect(first.isDefault).toBe(true);

    const deleted = await agent.delete(`/api/resumes/${first.id}`).set('Origin', ORIGIN);
    expect(deleted.body).toEqual({ deleted: true, defaultResumeId: third.id });
    const row = ctx!.deps.db.prepare('SELECT default_resume_id FROM users WHERE id = ?').get(userId) as { default_resume_id: string };
    expect(row.default_resume_id).toBe(third.id);

    expect((await agent.delete(`/api/resumes/${second.id}`).set('Origin', ORIGIN)).body).toEqual({ deleted: true, defaultResumeId: third.id });
    expect((await agent.delete(`/api/resumes/${third.id}`).set('Origin', ORIGIN)).body).toEqual({ deleted: true, defaultResumeId: null });
    expect((await agent.delete(`/api/resumes/${third.id}`).set('Origin', ORIGIN)).status).toBe(404);
  });

  it('bulk delete skips the default resume and says so', async () => {
    const { agent } = await setup();
    const first = await create(agent, { name: 'Default one' });
    const second = await create(agent, { name: 'Two' });
    const third = await create(agent, { name: 'Three' });
    const res = await agent
      .post('/api/resumes/bulk-delete')
      .set('Origin', ORIGIN)
      .send({ ids: [first.id, second.id, third.id, 'not-a-resume'] });
    expect(ResumeBulkDeleteResponseSchema.parse(res.body)).toEqual({ deleted: 2, skippedIds: [first.id] });
    expect((await agent.get('/api/resumes')).body.items.map((item: { id: string }) => item.id)).toEqual([first.id]);
  });
});

describe('import JSON', () => {
  it('imports one file, several, and TailorIT envelopes (titles kept)', async () => {
    const { agent } = await setup();
    const one = await agent.post('/api/resumes/import-json').set('Origin', ORIGIN).send({ data: DOCUMENT, fileName: 'ines.json' });
    expect(one.status).toBe(201);
    expect(ResumeImportJsonResponseSchema.parse(one.body)).toMatchObject({ imported: 1 });
    const exported = await agent.get(`/api/resumes/${one.body.resumes[0].id}/export?format=json`);
    expect(exported.body.format).toBe(RESUME_EXPORT_FORMAT);
    const envelope = { ...exported.body, title: 'From a backup' };
    const many = await agent.post('/api/resumes/import-json').set('Origin', ORIGIN).send({ data: [envelope, { name: 'Bare', summary: 'x' }] });
    expect(many.body.imported).toBe(2);
    expect(many.body.resumes.map((resume: { label: string }) => resume.label)).toEqual(['From a backup', 'Bare']);
    expect(many.body.resumes[0].templateId).toBe('navy-gold');
  });

  it('refuses a file that is not a resume, saving nothing', async () => {
    const { agent } = await setup();
    const res = await agent.post('/api/resumes/import-json').set('Origin', ORIGIN).send({ data: [DOCUMENT, { version: '1.0.0' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Item 2 is not a resume/);
    expect((await agent.get('/api/resumes')).body.items).toEqual([]);
  });
});

describe('preview', () => {
  it('draws a draft with the sample person filling what is empty, and nothing is saved', async () => {
    const { agent } = await setup();
    const res = await agent.post('/api/resumes/preview').set('Origin', ORIGIN).send({ document: { name: 'Draft Person' } });
    expect(res.status).toBe(200);
    const preview = ResumePreviewResponseSchema.parse(res.body);
    expect(preview.templateId).toBe('default');
    expect(preview.page).toEqual({ widthPx: 794, heightPx: 1123, contentHeightPx: 1065 });
    expect(preview.sampled).toEqual(['title', 'email', 'phone', 'location', 'linkedin', 'summary', 'experience', 'education', 'skills']);
    expect(preview.html).toContain(`<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CONTENT_SECURITY_POLICY}">`);
    expect(preview.html).toContain('Draft Person');
    expect(preview.html).toContain('Larkspur Supply Exchange');
    expect((await agent.get('/api/resumes')).body.items).toEqual([]);
  });

  it('lays the draft over a stored resume, honours sample:false and a requested template', async () => {
    const { agent } = await setup();
    const stored = await create(agent);
    const res = await agent
      .post('/api/resumes/preview')
      .set('Origin', ORIGIN)
      .send({ document: { summary: 'Edited only here' }, resumeId: stored.id, templateId: 'forest-chips', sample: false });
    expect(res.body.templateId).toBe('forest-chips');
    expect(res.body.sampled).toEqual([]);
    expect(res.body.html).toContain('Edited only here');
    expect(res.body.html).toContain('Ines Halvorsen');
    expect(res.body.html).not.toContain('Larkspur Supply Exchange');
    const unknown = await agent.post('/api/resumes/preview').set('Origin', ORIGIN).send({ templateId: 'no-such-template' });
    expect(unknown.status).toBe(404);
  });
});

describe('thumbnail', () => {
  it('is the first page as HTML, rendered once per version', async () => {
    const { agent } = await setup();
    const created = await create(agent);
    const first = await agent.get(`/api/resumes/${created.id}/thumbnail`);
    expect(first.status).toBe(200);
    const thumbnail = ResumeThumbnailSchema.parse(first.body);
    expect(thumbnail.kind).toBe('html');
    if (thumbnail.kind !== 'html') return;
    expect(thumbnail.html).toContain('Ines Halvorsen');
    expect(thumbnail.html).not.toContain('Larkspur Supply Exchange');
    const again = await agent.get(`/api/resumes/${created.id}/thumbnail`);
    expect(again.body.html).toBe(thumbnail.html);
    ctx!.setNow(new Date(TEST_NOW.getTime() + 5000));
    await agent.put(`/api/resumes/${created.id}`).set('Origin', ORIGIN).send({ document: { name: 'Ines H. Halvorsen' } });
    expect((await agent.get(`/api/resumes/${created.id}/thumbnail`)).body.html).toContain('Ines H. Halvorsen');
  });

  it("follows the person's own skills: one added to their library joins Grouped", async () => {
    const { agent } = await setup();
    const created = await create(agent, { ...DOCUMENT, skills: ['Go', 'Kibana'] });
    expect((await agent.get(`/api/resumes/${created.id}/thumbnail`)).body.html).not.toContain('Kibana');
    await agent.post('/api/skills').set('Origin', ORIGIN).send({ type: 'hard', skill: 'Kibana' });
    expect((await agent.get(`/api/resumes/${created.id}/thumbnail`)).body.html).toContain('Kibana');
  });
});
