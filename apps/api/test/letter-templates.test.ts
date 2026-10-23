import HTMLtoDOCX from '@turbodocx/html-to-docx';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aiVariablesIn,
  findPlaceholders,
  LETTER_FONT_NAMES,
  LetterTemplateDetailSchema,
  LetterTemplateListResponseSchema,
  TEMPLATE_NAME_MESSAGE,
  variableDefinition,
} from '@tailorit/shared';
import { seedSystemTemplates, starterHtml, starterTemplates } from '../src/features/cover-letter-templates/seed';
import { signIn, type SignedIn } from './auth-helpers';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';

// Work package C: /api/cover-letter-templates (system starters + the account's own), and the starter set itself.

let ctx: TestContext;
beforeEach(() => {
  ctx = createTestContext();
});
afterEach(() => ctx.cleanup());

const later = (minutes: number) => new Date(TEST_NOW.getTime() + minutes * 60_000);
const STARTERS = ['Classic Professional', 'Creative Industry', 'Software Engineering', 'Career Change', 'Internship / New Grad', 'Short & Direct'];

async function list(user: SignedIn) {
  return LetterTemplateListResponseSchema.parse((await user.agent.get('/api/cover-letter-templates')).body).items;
}

async function create(user: SignedIn, body: Record<string, unknown> = {}) {
  const res = await user.agent.post('/api/cover-letter-templates').set('Origin', ORIGIN).send(body);
  expect(res.status).toBe(201);
  return LetterTemplateDetailSchema.parse(res.body);
}

async function systemTemplate(user: SignedIn, name = 'Classic Professional') {
  return (await list(user)).find((template) => template.name === name)!;
}

describe('starter templates', () => {
  it('are TailorIT originals that mix plain and AI variables, all known to the registry', () => {
    const starters = starterTemplates();
    expect(starters.map((template) => template.name)).toEqual(STARTERS);
    for (const template of starters) {
      const html = starterHtml(template);
      const names = findPlaceholders(html);
      expect(names.every((name) => variableDefinition(name) !== null), template.name).toBe(true);
      expect(aiVariablesIn(html).length, template.name).toBeGreaterThan(0);
      expect(names.filter((name) => variableDefinition(name)?.group !== 'ai').length, template.name).toBeGreaterThan(0);
      expect(LETTER_FONT_NAMES).toContain(template.fontFamily);
      expect(template.aiPrompt.length).toBeLessThanOrEqual(1000);
    }
  });

  it('are seeded once (upsert by system_key) and listed first, read-only', async () => {
    expect(seedSystemTemplates(ctx.deps)).toBe(0);
    const count = ctx.deps.db.prepare('SELECT count(*) AS n FROM cover_letter_templates WHERE is_system = 1').get();
    expect(count).toEqual({ n: STARTERS.length });

    const me = await signIn(ctx, 'me@example.com');
    const mine = await create(me, { name: 'Zeta template' });
    const items = await list(me);
    expect(items.map((item) => item.name)).toEqual([...STARTERS, 'Zeta template']);
    expect(items.slice(0, STARTERS.length).every((item) => item.isSystem)).toBe(true);
    expect(items.at(-1)).toMatchObject({ id: mine.id, isSystem: false });
    for (const item of items) expect(item.preview.length).toBeLessThanOrEqual(83);
    expect(items[1]!.preview).toBe('Hello {{COMPANY_NAME}} team, When I saw your opening for the {{JOB_TITLE}} role,...');
  });

  it('a changed starter file updates its row in place', () => {
    const row = ctx.deps.db
      .prepare("SELECT id, created_at FROM cover_letter_templates WHERE system_key = 'short-and-direct'")
      .get() as { id: string; created_at: string };
    ctx.deps.db.prepare("UPDATE cover_letter_templates SET content_html = '<p>old</p>' WHERE id = ?").run(row.id);
    ctx.setNow(later(60));
    expect(seedSystemTemplates(ctx.deps)).toBe(1);
    const after = ctx.deps.db.prepare('SELECT id, created_at, updated_at, content_html FROM cover_letter_templates WHERE id = ?').get(row.id) as {
      created_at: string;
      updated_at: string;
      content_html: string;
    };
    expect(after.created_at).toBe(row.created_at);
    expect(after.updated_at).toBe(later(60).toISOString());
    expect(after.content_html).toContain('{{COVER_LETTER_BODY}}');
  });
});

describe('templates: CRUD, validation and ownership', () => {
  it('creates "Template {date, time}" and edits name, content, font and AI prompt', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const blank = await create(me);
    expect(blank.name).toMatch(/^Template 10\/2[12]\/2026, \d{1,2}:\d{2}:\d{2} (AM|PM)$/);
    expect(blank).toMatchObject({ isSystem: false, contentHtml: '', aiPrompt: '', lastEditedAt: null, fontFamily: 'Times New Roman' });

    ctx.setNow(later(2));
    const res = await me.agent
      .patch(`/api/cover-letter-templates/${blank.id}`)
      .set('Origin', ORIGIN)
      .send({ name: 'Product roles', contentHtml: '<p>Dear {{HIRING_MANAGER}},</p><script>x</script>', aiPrompt: 'Be warm.' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Product roles',
      contentHtml: '<p>Dear {{HIRING_MANAGER}},</p>',
      aiPrompt: 'Be warm.',
      preview: 'Dear {{HIRING_MANAGER}},',
      lastEditedAt: later(2).toISOString(),
    });

    ctx.setNow(later(4));
    const renamed = await me.agent.patch(`/api/cover-letter-templates/${blank.id}`).set('Origin', ORIGIN).send({ name: 'Product' });
    expect(renamed.body.lastEditedAt).toBe(later(2).toISOString());
  });

  it('refuses short names and long AI prompts with the exact sentences', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const template = await create(me, { name: 'Valid name' });
    const short = await me.agent.patch(`/api/cover-letter-templates/${template.id}`).set('Origin', ORIGIN).send({ name: ' ab ' });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatchObject({ message: TEMPLATE_NAME_MESSAGE, fields: { name: TEMPLATE_NAME_MESSAGE } });
    const long = await me.agent
      .patch(`/api/cover-letter-templates/${template.id}`)
      .set('Origin', ORIGIN)
      .send({ aiPrompt: 'x'.repeat(1001) });
    expect(long.status).toBe(400);
    expect(long.body.error.message).toBe('The AI prompt can be at most 1,000 characters.');
    const exact = await me.agent
      .patch(`/api/cover-letter-templates/${template.id}`)
      .set('Origin', ORIGIN)
      .send({ aiPrompt: 'x'.repeat(1000) });
    expect(exact.status).toBe(200);
    expect((await me.agent.post('/api/cover-letter-templates').set('Origin', ORIGIN).send({ name: 'no' })).status).toBe(400);
  });

  it('system templates are readable by everyone and refuse changes with 403', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const classic = await systemTemplate(me);
    const detail = await me.agent.get(`/api/cover-letter-templates/${classic.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ isSystem: true, fontFamily: 'Times New Roman' });
    expect(detail.body.contentHtml).toContain('<h1 style="text-align: center">{{USER_FULL_NAME}}</h1>');

    for (const res of [
      await me.agent.patch(`/api/cover-letter-templates/${classic.id}`).set('Origin', ORIGIN).send({ name: 'Mine now' }),
      await me.agent.delete(`/api/cover-letter-templates/${classic.id}`).set('Origin', ORIGIN),
      await me.agent
        .post(`/api/cover-letter-templates/${classic.id}/import`)
        .set('Origin', ORIGIN)
        .attach('file', Buffer.from('%PDF-1.4'), { filename: 'x.pdf' }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('system_template_read_only');
    }
  });

  it('duplicates any visible template as "{name} (Copy)", owned by the caller', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const classic = await systemTemplate(me);
    ctx.setNow(later(1));
    const res = await me.agent.post(`/api/cover-letter-templates/${classic.id}/duplicate`).set('Origin', ORIGIN).send({});
    expect(res.status).toBe(201);
    const copy = LetterTemplateDetailSchema.parse(res.body);
    const source = LetterTemplateDetailSchema.parse((await me.agent.get(`/api/cover-letter-templates/${classic.id}`)).body);
    expect(copy).toMatchObject({
      name: 'Classic Professional (Copy)',
      isSystem: false,
      contentHtml: source.contentHtml,
      aiPrompt: source.aiPrompt,
      fontFamily: source.fontFamily,
      createdAt: later(1).toISOString(),
      lastEditedAt: null,
    });
    const row = ctx.deps.db.prepare('SELECT user_id, origin FROM cover_letter_templates WHERE id = ?').get(copy.id);
    expect(row).toEqual({ user_id: me.account.id, origin: 'duplicated' });

    const named = await me.agent.post(`/api/cover-letter-templates/${copy.id}/duplicate`).set('Origin', ORIGIN).send({ name: 'Third' });
    expect(named.body.name).toBe('Third');
  });

  it("hides another account's templates (404 everywhere)", async () => {
    const owner = await signIn(ctx, 'owner@example.com');
    const other = await signIn(ctx, 'other@example.com');
    const template = await create(owner, { name: 'Private' });
    const base = `/api/cover-letter-templates/${template.id}`;
    for (const res of [
      await other.agent.get(base),
      await other.agent.patch(base).set('Origin', ORIGIN).send({ name: 'Taken' }),
      await other.agent.delete(base).set('Origin', ORIGIN),
      await other.agent.post(`${base}/duplicate`).set('Origin', ORIGIN).send({}),
      await other.agent.get(`${base}/preview`),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('That template was not found.');
    }
    expect((await list(other)).map((item) => item.name)).toEqual(STARTERS);
    // A letter cannot point at it either.
    const letter = await other.agent.post('/api/cover-letters').set('Origin', ORIGIN).send({ templateId: template.id });
    expect(letter.status).toBe(404);
    expect((await request(ctx.app).get('/api/cover-letter-templates')).status).toBe(401);
  });

  it('bulk delete skips system templates and ignores other accounts', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const other = await signIn(ctx, 'other@example.com');
    const a = await create(me, { name: 'Alpha' });
    const b = await create(me, { name: 'Bravo' });
    const theirs = await create(other, { name: 'Theirs' });
    const classic = await systemTemplate(me);
    const res = await me.agent
      .post('/api/cover-letter-templates/bulk-delete')
      .set('Origin', ORIGIN)
      .send({ ids: [a.id, b.id, classic.id, theirs.id] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 2, skippedIds: [classic.id] });
    expect((await list(me)).map((item) => item.name)).toEqual(STARTERS);
    expect((await list(other)).map((item) => item.name)).toContain('Theirs');
  });

  it('deleting a template keeps letters made from it', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const template = await create(me, { name: 'Gone soon' });
    const letter = await me.agent.post('/api/cover-letters').set('Origin', ORIGIN).send({ templateId: template.id });
    expect(letter.body.templateId).toBe(template.id);
    expect((await me.agent.delete(`/api/cover-letter-templates/${template.id}`).set('Origin', ORIGIN)).status).toBe(204);
    const after = await me.agent.get(`/api/cover-letters/${letter.body.id}`);
    expect(after.status).toBe(200);
    expect(after.body.templateId).toBeNull();
  });
});

describe('templates: upload, import, preview and export', () => {
  async function docx(html: string): Promise<Buffer> {
    const output = await HTMLtoDOCX(`<!DOCTYPE html><html><body>${html}</body></html>`);
    return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
  }

  it('reads loose { {X} } spellings as variables and names the template after the file', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const file = await docx('<p>Dear { {HIRING_MANAGER} },</p><p>I want the {{ JOB_TITLE }} role.</p>');
    const res = await me.agent
      .post('/api/cover-letter-templates/upload')
      .set('Origin', ORIGIN)
      .attach('file', file, { filename: 'Sales template.docx' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Sales template',
      isSystem: false,
      contentHtml: '<p>Dear {{HIRING_MANAGER}},</p><p>I want the {{JOB_TITLE}} role.</p>',
    });
    const row = ctx.deps.db.prepare('SELECT origin FROM cover_letter_templates WHERE id = ?').get(res.body.id);
    expect(row).toEqual({ origin: 'uploaded' });
    // Nothing is kept on disk for templates.
    expect(ctx.deps.db.prepare('SELECT count(*) AS n FROM stored_files').get()).toEqual({ n: 0 });

    const bad = await me.agent
      .post('/api/cover-letter-templates/upload')
      .set('Origin', ORIGIN)
      .attach('file', Buffer.from('hello'), { filename: 'x.docx' });
    expect(bad.status).toBe(415);
  });

  it('imports into one of my templates, and previews / exports any visible one', async () => {
    const me = await signIn(ctx, 'me@example.com');
    const template = await create(me, { name: 'Importable' });
    ctx.setNow(later(5));
    const imported = await me.agent
      .post(`/api/cover-letter-templates/${template.id}/import`)
      .set('Origin', ORIGIN)
      .attach('file', await docx('<p>From a file at {{COMPANY_NAME}}.</p>'), { filename: 'a.docx' });
    expect(imported.status).toBe(200);
    expect(imported.body).toMatchObject({
      contentHtml: '<p>From a file at {{COMPANY_NAME}}.</p>',
      lastEditedAt: later(5).toISOString(),
    });

    const classic = await systemTemplate(me, 'Creative Industry');
    const preview = await me.agent.get(`/api/cover-letter-templates/${classic.id}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.page).toEqual({ widthPx: 816, heightPx: 1056 });
    expect(preview.body.html).toContain('<span class="ti-var">{{COMPANY_APPEAL}}</span>');
    expect(preview.body.html).toContain("font-family:'Poppins'");

    const word = await me.agent.get(`/api/cover-letter-templates/${classic.id}/export?format=docx`).buffer(true);
    expect(word.status).toBe(200);
    expect(word.headers['content-disposition']).toContain('filename="Creative Industry.docx"');
  });
});
