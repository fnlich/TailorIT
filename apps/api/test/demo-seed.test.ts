import { existsSync } from 'node:fs';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APPLICATION_STATUSES,
  SECTION_KIND_IDS,
  STATUS,
  TERMINAL_STATUSES,
  currentStatus,
  findPlaceholders,
  normalizeEvents,
  normalizeResumeDocument,
  toIsoDate,
  type ApplicationStatus,
  type ResumeDocument,
  type SectionKind,
  type StatusEvent,
} from '@tailorit/shared';
import { getFileStore } from '../src/core/files/index';
import { getPdfService } from '../src/core/pdf/index';
import { DEMO_APPLICATIONS, DEMO_EMAIL, DEMO_NAME } from '../src/features/demo/content';
import { demoFeature, parseSeedDemoArgs } from '../src/features/demo/index';
import { seedDemo, type DemoSeedResult } from '../src/features/demo/seed';
import { signIn } from './auth-helpers';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';

// seed:demo (work package I): the demo jobs plus a populated account, written through the features' own functions.

let ctx: TestContext | null = null;
afterEach(async () => {
  if (ctx) await getPdfService(ctx.deps).close();
  ctx?.cleanup();
  ctx = null;
});

const DAY_MS = 86_400_000;

function count(sql: string, ...params: unknown[]): number {
  return (ctx!.deps.db.prepare(sql).get(...params) as { n: number }).n;
}

function userIdOf(email: string): string {
  return (ctx!.deps.db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id;
}

/** Whether a resume document has content for a section kind. */
function hasKind(document: ResumeDocument, kind: SectionKind): boolean {
  const value = (document as unknown as Record<string, unknown>)[kind];
  if (typeof value === 'string') return value.trim().length > 0;
  return Array.isArray(value) && value.length > 0;
}

interface EventRow {
  application_id: string;
  status: ApplicationStatus;
  occurred_on: string;
}

describe('seed:demo', () => {
  it('fills the demo account: preferences, resumes covering every section kind, 30 applications, letters, templates', async () => {
    ctx = createTestContext();
    const result: DemoSeedResult = await seedDemo(ctx.deps, { pdf: false });
    expect(result).toMatchObject({ email: DEMO_EMAIL, accountCreated: true, alreadySeeded: false, coverLetters: 3, templates: 2 });
    expect(result.jobs).toMatchObject({ status: 'succeeded', failed: 0 });
    expect(result.jobs.created).toBeGreaterThan(100);
    expect(result.resumes).toEqual({ built: 2, uploaded: 0, defaultLabel: 'Senior Platform Engineer' });
    expect(result.uploadSkipped).toMatch(/--no-pdf/);
    expect(result.applications).toMatchObject({ total: 30, favorites: 6, archived: 3, skipped: 0 });
    expect(result.applications.fromJobBoard).toBe(DEMO_APPLICATIONS.filter((plan) => plan.seedJobId).length);
    // Every status has applications.
    expect(Object.keys(result.applications.byStatus).map(Number).sort((a, b) => a - b)).toEqual([...APPLICATION_STATUSES]);

    const userId = userIdOf(DEMO_EMAIL);
    const user = ctx.deps.db.prepare('SELECT name, default_resume_id FROM users WHERE id = ?').get(userId) as {
      name: string;
      default_resume_id: string;
    };
    expect(user.name).toBe(DEMO_NAME);

    // Two built resumes on different templates; between them every one of the fifteen section kinds.
    const resumes = ctx.deps.db.prepare("SELECT id, data, template_id FROM resumes WHERE user_id = ? AND kind = 'built'").all(userId) as Array<{
      id: string;
      data: string;
      template_id: string;
    }>;
    expect(resumes).toHaveLength(2);
    expect(new Set(resumes.map((row) => row.template_id)).size).toBe(2);
    const documents = resumes.map((row) => normalizeResumeDocument(JSON.parse(row.data)));
    expect(SECTION_KIND_IDS).toHaveLength(15);
    for (const kind of SECTION_KIND_IDS) {
      expect(documents.some((document) => hasKind(document, kind)), `section kind ${kind}`).toBe(true);
    }
    const platform = resumes.find((row) => normalizeResumeDocument(JSON.parse(row.data)).title === 'Senior Platform Engineer')!;
    expect(user.default_resume_id).toBe(platform.id);

    // The tracker: every application's events follow the shared status rules and its current status.
    const today = toIsoDate(TEST_NOW)!;
    const earliest = toIsoDate(new Date(TEST_NOW.getTime() - 92 * DAY_MS))!;
    const applications = ctx.deps.db
      .prepare('SELECT id, current_status, tracked_on, job_id, favorite, archived_at, notes_html, resume_id FROM applications WHERE user_id = ?')
      .all(userId) as Array<{
      id: string;
      current_status: ApplicationStatus;
      tracked_on: string;
      job_id: number | null;
      favorite: number;
      archived_at: string | null;
      notes_html: string;
      resume_id: string | null;
    }>;
    expect(applications).toHaveLength(30);
    const events = ctx.deps.db
      .prepare('SELECT e.application_id, e.status, e.occurred_on FROM application_status_events e JOIN applications a ON a.id = e.application_id WHERE a.user_id = ? ORDER BY e.status')
      .all(userId) as EventRow[];
    for (const application of applications) {
      const own: StatusEvent[] = events
        .filter((event) => event.application_id === application.id)
        .map((event) => ({ status: event.status, occurredOn: event.occurred_on }));
      expect(normalizeEvents(own)).toEqual(own);
      expect(application.current_status).toBe(currentStatus(own));
      expect(own[0]).toEqual({ status: STATUS.saved, occurredOn: application.tracked_on });
      if (application.current_status > STATUS.applied) expect(own.some((event) => event.status === STATUS.applied)).toBe(true);
      expect(own.filter((event) => (TERMINAL_STATUSES as readonly number[]).includes(event.status)).length).toBeLessThanOrEqual(1);
      // Dated in the order they were reached, within the last three months.
      const dates = own.map((event) => event.occurredOn);
      expect([...dates].sort()).toEqual(dates);
      expect(dates[0]! >= earliest && dates[dates.length - 1]! <= today).toBe(true);
    }
    const tracked = applications.map((row) => row.tracked_on).sort();
    expect(Date.parse(tracked[tracked.length - 1]!) - Date.parse(tracked[0]!)).toBeGreaterThan(80 * DAY_MS);
    expect(applications.filter((row) => row.job_id !== null).length).toBe(result.applications.fromJobBoard);
    expect(applications.filter((row) => row.favorite === 1)).toHaveLength(6);
    expect(applications.filter((row) => row.archived_at !== null).every((row) => row.current_status > STATUS.applied)).toBe(true);
    expect(applications.filter((row) => row.notes_html.includes('<p>')).length).toBe(result.applications.withNotes);
    expect(count('SELECT count(DISTINCT q.application_id) AS n FROM application_questions q JOIN applications a ON a.id = q.application_id WHERE a.user_id = ?', userId)).toBe(
      result.applications.withQuestions,
    );

    // Letters: the no-template wrapper, a filled starter template (nothing left to fill) and an upload; each is the
    // cover letter of a tracked application.
    const letters = ctx.deps.db
      .prepare('SELECT id, title, origin, content_html, template_id, file_id, application_id, last_edited_at FROM cover_letters WHERE user_id = ? ORDER BY created_at')
      .all(userId) as Array<Record<string, string | null>>;
    expect(letters.map((letter) => letter.origin).sort()).toEqual(['generated', 'generated', 'uploaded']);
    const wrapped = letters.find((letter) => letter.origin === 'generated' && !letter.template_id)!;
    expect(wrapped.title).toMatch(/^Cover Letter \d{1,2}\/\d{1,2}\/\d{4}$/);
    expect(wrapped.content_html).toMatch(new RegExp(`^<h1 style="text-align: ?center">${DEMO_NAME}</h1>`));
    expect(wrapped.content_html).toContain('Dear Hiring Manager,');
    expect(wrapped.last_edited_at).toBeNull();
    const filled = letters.find((letter) => letter.origin === 'generated' && letter.template_id)!;
    expect(findPlaceholders(filled.content_html!)).toEqual([]);
    expect(filled.content_html).toContain('Sunmere Grid');
    const systemKey = ctx.deps.db.prepare('SELECT system_key FROM cover_letter_templates WHERE id = ?').get(filled.template_id) as { system_key: string };
    expect(systemKey.system_key).toBe('software-engineering');
    const uploaded = letters.find((letter) => letter.origin === 'uploaded')!;
    expect(uploaded.content_html).toContain('Kestrel Ridge');
    expect(ctx.deps.db.prepare('SELECT purpose FROM stored_files WHERE id = ?').get(uploaded.file_id)).toEqual({ purpose: 'letter_import' });
    for (const letter of letters) {
      expect(count('SELECT count(*) AS n FROM applications WHERE user_id = ? AND cover_letter_id = ?', userId, letter.id)).toBe(1);
    }

    // Two templates of the person's own; the duplicate carries the starter's chips.
    const templates = ctx.deps.db.prepare('SELECT name, origin, content_html FROM cover_letter_templates WHERE user_id = ? ORDER BY name').all(userId) as Array<
      Record<string, string>
    >;
    expect(templates.map((template) => [template.name, template.origin])).toEqual([
      ['Creative Industry Cover Letter', 'duplicated'],
      ['Platform Engineering Outreach', 'blank'],
    ]);
    expect(findPlaceholders(templates[0]!.content_html!)).toContain('COMPANY_APPEAL');

    // And it all reads through the API as the person sees it.
    const { agent } = await signIn(ctx, DEMO_EMAIL);
    const counts = (await agent.get('/api/applications/counts')).body as { active: number; archived: number };
    expect(counts).toMatchObject({ active: 27, archived: 3 });
    expect((await agent.get('/api/resumes')).body.items).toHaveLength(2);
    expect((await agent.get('/api/cover-letters')).body.items).toHaveLength(3);
    const preferences = (await agent.get('/api/me/preferences')).body as { experienceLevels: string[]; phone: string };
    expect(preferences.experienceLevels).toEqual(['senior', 'mid']);
    expect(preferences.phone).toBe('+1 (555) 013-2468');
    const sre = applications.find((row) => row.job_id !== null && row.current_status === STATUS.interviewing)!;
    const match = (await agent.get(`/api/jobs/${sre.job_id}/match`)).body as { state: string; resumeId: string; matchedCount: number };
    expect(match).toMatchObject({ state: 'ok', resumeId: platform.id });
    expect(match.matchedCount).toBeGreaterThan(0);
  }, 60_000);

  it('is idempotent; refresh rebuilds the demo account', async () => {
    ctx = createTestContext();
    await seedDemo(ctx.deps, { pdf: false });
    const userId = userIdOf(DEMO_EMAIL);
    const snapshot = () => ({
      resumes: count('SELECT count(*) AS n FROM resumes WHERE user_id = ?', userId),
      applications: count('SELECT count(*) AS n FROM applications WHERE user_id = ?', userId),
      events: count('SELECT count(*) AS n FROM application_status_events e JOIN applications a ON a.id = e.application_id WHERE a.user_id = ?', userId),
      letters: count('SELECT count(*) AS n FROM cover_letters WHERE user_id = ?', userId),
      templates: count('SELECT count(*) AS n FROM cover_letter_templates WHERE user_id = ?', userId),
      files: count('SELECT count(*) AS n FROM stored_files WHERE user_id = ?', userId),
      jobs: count('SELECT count(*) AS n FROM jobs'),
    });
    const first = snapshot();
    expect(first).toMatchObject({ resumes: 2, applications: 30, letters: 3, templates: 2, files: 1 });
    const firstResumeIds = (ctx.deps.db.prepare('SELECT id FROM resumes WHERE user_id = ?').all(userId) as Array<{ id: string }>).map((row) => row.id);
    const firstFile = (ctx.deps.db.prepare('SELECT id FROM stored_files WHERE user_id = ?').get(userId) as { id: string }).id;
    const firstPath = getFileStore(ctx.deps).pathOf(firstFile);

    const again = await seedDemo(ctx.deps, { pdf: false });
    expect(again.alreadySeeded).toBe(true);
    expect(again.accountCreated).toBe(false);
    expect(snapshot()).toEqual(first);

    // Something the person did in the demo account goes with a refresh.
    ctx.deps.db.prepare("UPDATE applications SET title = 'Edited' WHERE user_id = ?").run(userId);
    ctx.setNow(new Date(TEST_NOW.getTime() + 2 * DAY_MS));
    const rebuilt = await seedDemo(ctx.deps, { pdf: false, refresh: true });
    expect(rebuilt.alreadySeeded).toBe(false);
    expect(rebuilt.applications.total).toBe(30);
    expect(snapshot()).toEqual(first);
    expect(count("SELECT count(*) AS n FROM applications WHERE user_id = ? AND title = 'Edited'", userId)).toBe(0);
    const resumeIds = (ctx.deps.db.prepare('SELECT id FROM resumes WHERE user_id = ?').all(userId) as Array<{ id: string }>).map((row) => row.id);
    expect(resumeIds.some((id) => firstResumeIds.includes(id))).toBe(false);
    // The old upload is gone from the disk too.
    expect(existsSync(firstPath)).toBe(false);
    // Dates move with "now": the newest application is tracked on the new today.
    const newest = (ctx.deps.db.prepare('SELECT max(tracked_on) AS d FROM applications WHERE user_id = ?').get(userId) as { d: string }).d;
    expect(newest).toBe(toIsoDate(new Date(TEST_NOW.getTime() + 2 * DAY_MS)));
  }, 60_000);

  it('--email fills another account and leaves what the person made alone', async () => {
    ctx = createTestContext();
    const owner = await signIn(ctx, 'owner@example.com', { name: 'Owner Person' });
    const own = await owner.agent
      .post('/api/resumes')
      .set('Origin', ORIGIN)
      .send({ title: 'My own resume', document: { name: 'Owner Person', title: 'Data Engineer', skills: ['SQL'] } });
    expect(own.status).toBe(201);
    await owner.agent.put('/api/me/preferences').set('Origin', ORIGIN).send({
      experienceLevels: ['entry'],
      jobTypes: ['internship'],
      workArrangements: ['onsite'],
      categories: [],
      locations: [],
      minSalary: null,
      phone: '',
      linkedinUrl: '',
      location: 'Lisbon',
      portfolioUrl: '',
    });
    // The jobs exist after a first seeding of another account; the owner already tracks one of the demo's jobs.
    await seedDemo(ctx.deps, { pdf: false });
    const jobId = (
      ctx.deps.db
        .prepare("SELECT job_id FROM job_source_links WHERE source_job_id = 'seed-013'")
        .get() as { job_id: number }
    ).job_id;
    const mine = await owner.agent.post('/api/applications').set('Origin', ORIGIN).send({ jobId, status: STATUS.applied });
    expect(mine.status).toBe(201);

    const result = await seedDemo(ctx.deps, { email: 'Owner@Example.com', pdf: false });
    expect(result).toMatchObject({ email: 'owner@example.com', accountCreated: false, alreadySeeded: false });
    expect(result.applications).toMatchObject({ total: 29, skipped: 1 });
    expect(result.resumes.defaultLabel).toBe('your own resume');
    const userId = owner.account.id;
    const account = ctx.deps.db.prepare('SELECT name, default_resume_id FROM users WHERE id = ?').get(userId) as { name: string; default_resume_id: string };
    expect(account).toEqual({ name: 'Owner Person', default_resume_id: own.body.id });
    expect((await owner.agent.get('/api/me/preferences')).body).toMatchObject({ experienceLevels: ['entry'], location: 'Lisbon' });
    // The application the owner made is untouched (still Applied, no notes).
    expect((await owner.agent.get(`/api/applications/${mine.body.id}`)).body).toMatchObject({ currentStatus: STATUS.applied, notesHtml: '' });

    // A refresh removes only what the seed wrote.
    const rebuilt = await seedDemo(ctx.deps, { email: 'owner@example.com', pdf: false, refresh: true });
    expect(rebuilt.applications.total).toBe(29);
    expect(count('SELECT count(*) AS n FROM resumes WHERE user_id = ?', userId)).toBe(3);
    expect(count('SELECT count(*) AS n FROM applications WHERE user_id = ?', userId)).toBe(30);
    expect(ctx.deps.db.prepare('SELECT 1 AS ok FROM resumes WHERE id = ?').get(own.body.id)).toEqual({ ok: 1 });
    expect(ctx.deps.db.prepare('SELECT 1 AS ok FROM applications WHERE id = ?').get(mine.body.id)).toEqual({ ok: 1 });

    // An address with no account gets one.
    const fresh = await seedDemo(ctx.deps, { email: 'new.person@example.com', pdf: false });
    expect(fresh).toMatchObject({ accountCreated: true, alreadySeeded: false });
    expect(fresh.applications.total).toBe(30);
    expect(fresh.resumes.defaultLabel).toBe('Senior Platform Engineer');
  }, 90_000);

  it('uploads a PDF printed from the platform resume through the PDF service (when Chrome or Edge is installed)', async ({ skip }) => {
    ctx = createTestContext();
    if (!getPdfService(ctx.deps).available()) skip();
    const result = await seedDemo(ctx.deps);
    expect(result.resumes).toMatchObject({ built: 2, uploaded: 1 });
    expect(result.uploadSkipped).toBeNull();
    const userId = userIdOf(DEMO_EMAIL);
    const upload = ctx.deps.db
      .prepare(
        `SELECT r.id, r.extracted_text, f.mime, f.page_count, f.thumb_path, f.original_name FROM resumes r
           JOIN stored_files f ON f.id = r.file_id WHERE r.user_id = ? AND r.kind = 'uploaded'`,
      )
      .get(userId) as { id: string; extracted_text: string; mime: string; page_count: number; thumb_path: string | null; original_name: string };
    expect(upload).toMatchObject({ mime: 'application/pdf', original_name: 'Alex_Rivera_Resume_2026.pdf' });
    expect(upload.page_count).toBeGreaterThanOrEqual(1);
    expect(upload.thumb_path).not.toBeNull();
    expect(upload.extracted_text).toContain('Kubernetes');
    const { cookie } = await signIn(ctx, DEMO_EMAIL);
    const file = await request(ctx.app).get(`/api/resumes/${upload.id}/file`).set('Cookie', cookie).buffer(true);
    expect(file.status).toBe(200);
    expect(Buffer.from(file.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 90_000);

  it('reads its command line', () => {
    expect(Object.keys(demoFeature.commands ?? {})).toEqual(['seed:demo']);
    expect(parseSeedDemoArgs([])).toEqual({});
    expect(parseSeedDemoArgs(['--email', 'you@example.com', '--refresh'])).toEqual({ email: 'you@example.com', refresh: true });
    expect(parseSeedDemoArgs(['--email=you@example.com', '--no-pdf'])).toEqual({ email: 'you@example.com', pdf: false });
    expect(parseSeedDemoArgs(['--help'])).toBeNull();
    expect(() => parseSeedDemoArgs(['--email'])).toThrow(/needs an address/);
    expect(() => parseSeedDemoArgs(['--wat'])).toThrow(/Unknown option/);
  });

  it('refuses an address that is not one', async () => {
    ctx = createTestContext();
    await expect(seedDemo(ctx.deps, { email: 'not-an-address', pdf: false })).rejects.toThrow(/is not an email address/);
  });
});
