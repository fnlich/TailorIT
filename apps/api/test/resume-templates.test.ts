import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { ResumeTemplateListResponseSchema } from '@tailorit/shared';
import { signIn, type TestAgent } from './auth-helpers';
import { createTestContext, type TestContext } from './helpers';

let ctx: TestContext | null = null;
afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

async function setup(): Promise<TestAgent> {
  ctx = createTestContext();
  return (await signIn(ctx, 'chooser@example.com')).agent;
}

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

describe('GET /api/resume-templates', () => {
  it('lists the 26 templates light (no markup), built-ins first, ATS last', async () => {
    const agent = await setup();
    const res = await agent.get('/api/resume-templates');
    expect(res.status).toBe(200);
    const { items } = ResumeTemplateListResponseSchema.parse(res.body);
    expect(items).toHaveLength(26);
    expect(JSON.stringify(res.body)).not.toContain('htmlContent');
    const categories = items.map((item) => item.category);
    expect(categories.lastIndexOf('simple')).toBeLessThan(categories.indexOf('ats'));
    expect(items.filter((item) => item.category === 'ats').map((item) => item.id)).toEqual(
      expect.arrayContaining(['ats-classic-serif', 'sidebar-executive', '9145ec7c-211d-4cce-a6ef-4ac44793c66a']),
    );
    const defaults = items.find((item) => item.id === 'default')!;
    expect(defaults).toMatchObject({ name: 'Professional Two-Column', category: 'modern', supportsSoftSkills: true, supportsStrengths: true });
    expect(defaults.printsSections).toContain('projects');
    expect(defaults.nativeSectionOrder[0]).toBe('summary');
    const burgundy = items.find((item) => item.id === 'burgundy-rule')!;
    expect([burgundy.supportsSoftSkills, burgundy.supportsStrengths]).toEqual([false, false]);
  });

  it('needs a signed-in account', async () => {
    ctx = createTestContext();
    expect((await request(ctx.app).get('/api/resume-templates')).status).toBe(401);
    expect((await request(ctx.app).get('/api/resume-templates/default/preview')).status).toBe(401);
  });
});

describe('GET /api/resume-templates/:id/preview', () => {
  it('is an HTML page of the sample person, under a locked-down CSP header', async () => {
    const agent = await setup();
    const res = await agent.get('/api/resume-templates/classic-serif/preview');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['content-security-policy']).toBe(CSP);
    expect(res.text).toContain('Maren Kowalczyk-Hart');
    expect(res.text).toContain('Databases and Storage');
    expect(res.text).not.toContain('Calm under pressure');
    expect(res.text).toContain('<style id="resume-preview-page">');
  });

  it('takes the layout and the two switches', async () => {
    const agent = await setup();
    const plain = await agent.get('/api/resume-templates/classic-serif/preview?layout=flat&softSkills=1&strengths=true');
    expect(plain.text).not.toContain('Databases and Storage');
    expect(plain.text).toContain('Calm under pressure');
    expect(plain.text).toContain('Pragmatic design');
    const unsupported = await agent.get('/api/resume-templates/burgundy-rule/preview?softSkills=1');
    expect(unsupported.text).not.toContain('Calm under pressure');
  });

  it('answers 404 for an unknown template', async () => {
    const agent = await setup();
    const res = await agent.get('/api/resume-templates/no-such-template/preview');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
