import { expect, test, type Page, type Route } from '@playwright/test';

/*
 * Work package R2: the resume editor and Documents › Resumes against a stand-in for the resume API (page.route), so
 * every behaviour is checked the same way whatever the stored data: the chooser's filters and details, all fifteen
 * section kinds and custom sections, reordering, the switches, Grouped / Plain, Write with AI and Undo, the preview,
 * leaving with changes, saving; the tab's two views, search, filter, menus, rename, default, upload and bulk delete.
 * Nothing reaches the real API: the session cookie is a placeholder (the page gate only checks that one exists) and
 * every /api call is answered here, so the spec does not depend on the API's state or data.
 */

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const HOUR = 3_600_000;

type Json = Record<string, unknown>;

interface Template {
  id: string;
  name: string;
  description: string;
  category: 'simple' | 'modern' | 'creative' | 'ats';
  supportsSoftSkills: boolean;
  supportsStrengths: boolean;
  printsSections: string[];
  nativeSectionOrder: string[];
}

const ALL_SECTIONS = ['summary', 'experience', 'education', 'skills', 'softSkills', 'strengths', 'certifications', 'projects', 'volunteering', 'awards', 'publications', 'courses', 'languages', 'interests', 'references', 'custom'];

function template(id: string, name: string, category: Template['category']): Template {
  return {
    id,
    name,
    description: `${name}: a clean layout for any role.`,
    category,
    supportsSoftSkills: category !== 'ats',
    supportsStrengths: category === 'modern',
    printsSections: category === 'ats' ? ['summary', 'experience', 'education', 'skills'] : ALL_SECTIONS,
    nativeSectionOrder: ['summary', 'experience', 'skills', 'education', 'certifications'],
  };
}

const TEMPLATES = [
  template('default', 'Professional Two-Column', 'modern'),
  template('navy-rule', 'Navy Rule', 'simple'),
  template('classic-serif', 'Classic Serif', 'simple'),
  template('ats-modern-sans', 'ATS Modern Sans', 'ats'),
];

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

function pageHtml(document: Json): string {
  const experience = Array.isArray(document.experience) ? (document.experience as Json[]) : [];
  return `<!doctype html><html><head><style>html{width:794px;min-height:1123px;padding:40px;box-sizing:border-box;font:13px Arial}</style></head><body>
<h1>${esc(document.name || 'Jordan Avery Chen')}</h1><p>${esc(document.title || 'Senior Software Engineer')}</p>
${experience.map((role) => `<h3>${esc(role.title)}</h3><ul>${((role.achievements as string[]) ?? []).map((line) => `<li>${esc(line)}</li>`).join('')}</ul>`).join('')}
</body></html>`;
}

interface Summary {
  id: string;
  kind: 'built' | 'uploaded';
  label: string;
  title: string | null;
  templateId: string | null;
  templateName: string | null;
  isDefault: boolean;
  fileKind: 'pdf' | 'docx' | null;
  nameOnResume: string;
  createdAt: string;
  updatedAt: string;
  lastEditedAt: string | null;
  /** The list's reading ("8 yrs · React, ..."); null while not read yet. */
  analysis?: Json | null;
}

interface FakeOptions {
  empty?: boolean;
  /** Readings on the list's resumes and GET /api/resumes/:id/analysis for the upload. */
  readings?: boolean;
  /** Every upload answers this long after it arrives (ms). */
  uploadDelayMs?: number;
  /** Files (by name) whose first upload is answered "server busy" (429, retry in 1 s). */
  busyOnce?: string[];
  /** An upload asking for an editable copy is kept, but the copy cannot start: this sentence. */
  copyError?: string;
}

const UPLOAD_SKILLS = ['React', 'TypeScript', 'Node.js', 'GraphQL', 'Redux', 'Jest', 'Webpack', 'CSS', 'HTML', 'Git', 'Docker', 'AWS'];

/** GET /api/resumes/r-upload/analysis: the quick reading while the AI reads it, then the AI's reading. */
function uploadReading(done: boolean): Json {
  return {
    resumeId: 'r-upload',
    source: done ? 'ai' : 'deterministic',
    refining: !done,
    aiWaiting: false,
    aiFailed: false,
    hardSkills: done ? UPLOAD_SKILLS : UPLOAD_SKILLS.slice(0, 5),
    softSkills: done ? ['Communication', 'Mentoring', 'Problem Solving'] : ['Communication'],
    keywords: { roles: ['Senior Frontend Engineer', 'Frontend Engineer'], certifications: done ? ['AWS Certified Developer'] : [], domains: ['finance'] },
    yearsExperience: 8.2,
    yearsBasis: 'dates',
    analyzedAt: new Date().toISOString(),
  };
}

class FakeApi {
  readonly resumes: Summary[];
  readonly documents = new Map<string, Json>();
  readonly calls: Array<{ method: string; path: string; body: unknown }> = [];
  readonly tasks = new Map<string, { kind: string; result: unknown; polls: number }>();
  /** Every upload as it arrived: the file's name, the name typed (title) and whether a copy was asked for. */
  readonly uploads: Array<{ fileName: string; title: string | null; parse: boolean }> = [];
  /** Readings the AI has finished (GET …/analysis answers the AI's reading from then on). */
  readonly readingsDone = new Set<string>();
  maxUploadsInFlight = 0;
  private uploadsInFlight = 0;
  private readonly busyOnce: Set<string>;
  private sequence = 0;

  constructor(private readonly options: FakeOptions = {}) {
    const now = Date.now();
    const at = (ago: number) => new Date(now - ago).toISOString();
    this.busyOnce = new Set(options.busyOnce ?? []);
    this.resumes = options.empty
      ? []
      : [
          { id: 'r-default', kind: 'built', label: 'Senior Platform Engineer', title: null, templateId: 'navy-rule', templateName: 'Navy Rule', isDefault: true, fileKind: null, nameOnResume: 'David Jack', createdAt: at(72 * HOUR), updatedAt: at(6 * HOUR), lastEditedAt: at(6 * HOUR) },
          { id: 'r-built', kind: 'built', label: 'Backend Engineer', title: null, templateId: 'classic-serif', templateName: 'Classic Serif', isDefault: false, fileKind: null, nameOnResume: 'David Jack', createdAt: at(30 * HOUR), updatedAt: at(3 * HOUR), lastEditedAt: at(3 * HOUR) },
          { id: 'r-upload', kind: 'uploaded', label: 'David_Jack_resume', title: 'David_Jack_resume', templateId: null, templateName: null, isDefault: false, fileKind: 'pdf', nameOnResume: '', createdAt: at(50 * HOUR), updatedAt: at(50 * HOUR), lastEditedAt: null },
        ];
    if (options.readings && !options.empty) {
      this.resumes[0]!.analysis = { yearsExperience: 6.4, hardSkills: ['Go', 'Kubernetes', 'PostgreSQL'], softSkillCount: 2, refining: false, aiWaiting: false };
      this.resumes[1]!.analysis = null;
      this.resumes[2]!.analysis = { yearsExperience: 8.2, hardSkills: UPLOAD_SKILLS, softSkillCount: 3, refining: true, aiWaiting: false };
    }
    this.documents.set('r-default', {
      name: 'David Jack',
      title: 'Senior Platform Engineer',
      preferredTemplate: 'navy-rule',
      resumeSettings: { technicalSkillsLayout: 'categorized', includeSoftSkills: false, includeStrengths: false },
      contact: { email: 'david@example.com', phone: '555', location: 'Austin, TX' },
      summary: 'Platform engineer.',
      experience: [{ title: 'Platform Engineer', company: 'Fabrikam', startDate: '2021', endDate: 'Present', location: '', description: '', achievements: ['Built the deploy pipeline'], skills: [] }],
      skills: ['Go', 'Kubernetes'],
      education: [],
    });
    this.documents.set('r-built', { name: 'David Jack', title: 'Backend Engineer', preferredTemplate: 'classic-serif' });
  }

  task(kind: string, result: unknown): string {
    this.sequence += 1;
    const id = `task-${this.sequence}`;
    this.tasks.set(id, { kind, result, polls: 0 });
    return id;
  }

  calledWith(method: string, path: RegExp) {
    return this.calls.filter((call) => call.method === method && path.test(call.path));
  }

  async install(page: Page) {
    const json = (route: Route, status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    // Registered first, so it answers only what no route below does.
    await page.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      this.calls.push({ method: route.request().method(), path: `${url.pathname}${url.search}`, body: null });
      return json(route, 404, { error: { code: 'not_found', message: 'There is no such API endpoint.' } });
    });
    await page.route('**/api/auth/me', (route) =>
      json(route, 200, {
        account: { id: 'acct', email: 'r2@tailorit.dev', name: 'Ann Lee', avatarUrl: null, role: 'user', defaultResumeId: 'r-default', createdAt: '2026-10-20T12:00:00.000Z' },
      }),
    );

    await page.route('**/api/resume-templates**', (route) => {
      const url = new URL(route.request().url());
      const preview = /\/api\/resume-templates\/([^/]+)\/preview$/.exec(url.pathname);
      if (preview) return route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml({ name: `Sample on ${decodeURIComponent(preview[1] ?? '')}` }) });
      return json(route, 200, { items: TEMPLATES });
    });
    await page.route('**/api/skills**', (route) =>
      route.request().method() === 'POST'
        ? json(route, 200, { added: true, skill: (route.request().postDataJSON() as Json).skill, type: 'hard', category: null })
        : json(route, 200, { type: 'hard', skills: ['Go', 'Kubernetes', 'TypeScript', 'PostgreSQL', 'React'] }),
    );
    await page.route('**/api/files/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><rect width="794" height="1123" fill="#fff"/></svg>' }),
    );
    await page.route('**/api/me/default-resume', (route) => {
      const { resumeId } = route.request().postDataJSON() as { resumeId: string };
      this.calls.push({ method: 'PUT', path: '/api/me/default-resume', body: { resumeId } });
      for (const resume of this.resumes) resume.isDefault = resume.id === resumeId;
      return json(route, 200, { id: 'acct', email: 'r2@tailorit.dev', name: 'r2', avatarUrl: null, role: 'user', defaultResumeId: resumeId, createdAt: new Date().toISOString() });
    });
    await page.route('**/api/ai/tasks/**', (route) => {
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
      const task = this.tasks.get(id);
      if (!task) return json(route, 404, { error: { code: 'not_found', message: 'That task was not found.' } });
      task.polls += 1;
      const done = task.polls >= 1;
      const stamp = new Date().toISOString();
      return json(route, 200, {
        id,
        kind: task.kind,
        status: done ? 'succeeded' : 'running',
        result: done ? task.result : null,
        error: null,
        createdAt: stamp,
        startedAt: stamp,
        finishedAt: done ? stamp : null,
      });
    });
    await page.route('**/api/resumes**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      const body = request.postData() && !request.headers()['content-type']?.includes('multipart') ? request.postDataJSON() : null;
      this.calls.push({ method, path: `${path}${url.search}`, body });

      if (path === '/api/resumes' && method === 'GET') return json(route, 200, { items: this.resumes });
      if (path === '/api/resumes' && method === 'POST') {
        const document = ((body as Json | null)?.document ?? {}) as Json;
        const id = `r-${this.resumes.length + 1}-${Date.now()}`;
        const stamp = new Date().toISOString();
        this.documents.set(id, document);
        this.resumes.unshift({ id, kind: 'built', label: String(document.title || document.name || 'Untitled resume'), title: null, templateId: String(document.preferredTemplate || '') || null, templateName: null, isDefault: false, fileKind: null, nameOnResume: String(document.name ?? ''), createdAt: stamp, updatedAt: stamp, lastEditedAt: null });
        return json(route, 201, { id });
      }
      if (path === '/api/resumes/preview') {
        const sent = body as Json;
        const document = (sent.document as Json | undefined) ?? this.documents.get(String(sent.resumeId)) ?? {};
        const templateId = String(document.preferredTemplate || 'default');
        return json(route, 200, { html: pageHtml(document), templateId, page: { widthPx: 794, heightPx: 1123, contentHeightPx: 1035 }, sampled: document.name ? [] : ['name', 'title'] });
      }
      if (path === '/api/resumes/bullets') {
        const sent = body as { task: string };
        const bullets = sent.task === 'improve' ? ['Improved the deploy pipeline for 40 teams'] : ['Built a deploy pipeline used by 40 teams', 'Cut build times by 35%'];
        return json(route, 202, { taskId: this.task('entry_bullets', { bullets }) });
      }
      if (path === '/api/resumes/upload') {
        const parse = url.searchParams.get('parse') === '1';
        const raw = request.postData() ?? '';
        const fileName = /filename="([^"]+)"/.exec(raw)?.[1] ?? 'resume.pdf';
        const title = /name="title"\r\n\r\n([^\r\n]*)/.exec(raw)?.[1] ?? null;
        this.uploads.push({ fileName, title, parse });
        this.uploadsInFlight += 1;
        this.maxUploadsInFlight = Math.max(this.maxUploadsInFlight, this.uploadsInFlight);
        try {
          if (this.options.uploadDelayMs) await new Promise((resolve) => setTimeout(resolve, this.options.uploadDelayMs));
          if (this.busyOnce.delete(fileName)) {
            return await json(route, 429, {
              error: { code: 'rate_limited', message: 'The server is busy reading other files. Please wait a few seconds and try again.', retryAfterSeconds: 1 },
            });
          }
          if (/\.doc$/.test(fileName)) {
            return await json(route, 415, { error: { code: 'unsupported_file', message: 'Old Word files (.doc) cannot be read. Save it as .docx or PDF and upload that.' } });
          }
          const stamp = new Date().toISOString();
          const label = title || fileName.replace(/\.(pdf|docx?)$/i, '');
          this.sequence += 1;
          const resume: Summary = { id: `r-up-${this.sequence}`, kind: 'uploaded', label, title, templateId: null, templateName: null, isDefault: false, fileKind: 'pdf', nameOnResume: '', createdAt: stamp, updatedAt: stamp, lastEditedAt: null };
          this.resumes.unshift(resume);
          if (parse && this.options.copyError) return await json(route, 201, { resume, taskId: null, copyError: this.options.copyError });
          return await json(route, 201, { resume, taskId: parse ? this.task('resume_import', { resumeId: 'r-default' }) : null, copyError: null });
        } finally {
          this.uploadsInFlight -= 1;
        }
      }
      const reading = /^\/api\/resumes\/([^/]+)\/analysis$/.exec(path);
      if (reading) {
        if (!this.options.readings || reading[1] !== 'r-upload') return json(route, 404, { error: { code: 'not_found', message: 'That resume was not found.' } });
        return json(route, 200, uploadReading(this.readingsDone.has('r-upload')));
      }
      if (path === '/api/resumes/bulk-delete') {
        const ids = (body as { ids: string[] }).ids;
        const skipped = ids.filter((id) => this.resumes.find((resume) => resume.id === id)?.isDefault);
        for (const id of ids) {
          if (skipped.includes(id)) continue;
          const index = this.resumes.findIndex((resume) => resume.id === id);
          if (index >= 0) this.resumes.splice(index, 1);
        }
        return json(route, 200, { deleted: ids.length - skipped.length, skippedIds: skipped });
      }
      const thumbnail = /^\/api\/resumes\/([^/]+)\/thumbnail$/.exec(path);
      if (thumbnail) {
        const resume = this.resumes.find((item) => item.id === thumbnail[1]);
        if (resume?.kind === 'uploaded') return json(route, 200, { kind: 'image', url: '/api/files/f-1/thumbnail' });
        return json(route, 200, { kind: 'html', html: pageHtml(this.documents.get(thumbnail[1] ?? '') ?? {}), page: { widthPx: 794, heightPx: 1123, contentHeightPx: 1035 } });
      }
      const parse = /^\/api\/resumes\/([^/]+)\/parse$/.exec(path);
      if (parse) return json(route, 202, { taskId: this.task('resume_import', { resumeId: 'r-built' }) });
      const one = /^\/api\/resumes\/([^/]+)$/.exec(path);
      if (one) {
        const resume = this.resumes.find((item) => item.id === one[1]);
        if (!resume) return json(route, 404, { error: { code: 'not_found', message: 'That resume was not found.' } });
        if (method === 'GET') {
          return json(route, 200, {
            ...resume,
            document: resume.kind === 'built' ? (this.documents.get(resume.id) ?? {}) : null,
            file: resume.kind === 'uploaded' ? { id: 'f-1', name: 'David_Jack_resume.pdf', mime: 'application/pdf', sizeBytes: 120_000, pageCount: 1 } : null,
            hasExtractedText: true,
          });
        }
        if (method === 'PATCH') {
          const title = (body as { title: string | null }).title;
          resume.title = title;
          resume.label = title || resume.label;
          return json(route, 200, resume);
        }
        if (method === 'PUT') return json(route, 200, resume);
        if (method === 'DELETE') {
          this.resumes.splice(this.resumes.indexOf(resume), 1);
          return json(route, 200, { deleted: true, defaultResumeId: null });
        }
      }
      return json(route, 404, { error: { code: 'not_found', message: 'There is no such API endpoint.' } });
    });
  }
}

async function signIn(page: Page) {
  await page.context().addCookies([{ name: 'ti_session', value: 'resumes-ui-spec', url: ORIGIN }]);
}

async function setup(page: Page, options: FakeOptions = {}) {
  await signIn(page);
  const api = new FakeApi(options);
  await api.install(page);
  return api;
}

/** The section refs in the order the Content tab shows them. */
const sectionOrder = (page: Page) =>
  page.locator('[data-section]').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-section')));

async function openNewEditor(page: Page, query = 'template=navy-rule') {
  await page.goto(`/resumes/new?${query}`);
  await page.getByRole('dialog', { name: 'Import your existing resume' }).getByRole('button', { name: 'Start from blank' }).click();
  await expect(page.locator('[data-preview-status="current"]')).toBeVisible({ timeout: 20_000 });
}

test.describe('template chooser', () => {
  test('filters by the categories present, steps through details and starts on the layout shown', async ({ page }) => {
    await setup(page);
    await page.goto('/resumes/new');
    const pills = page.getByRole('tablist', { name: 'Show templates' });
    await expect(pills.getByRole('tab')).toHaveText(['All Templates', 'Simple', 'Modern', 'ATS']);
    await pills.getByRole('tab', { name: 'Simple' }).click();
    await expect(page.locator('[data-template-card]')).toHaveCount(2);
    await pills.getByRole('tab', { name: 'All Templates' }).click();
    await expect(page.locator('[data-template-card]')).toHaveCount(4);

    await page.getByRole('button', { name: 'Navy Rule: see the template' }).click();
    const details = page.getByRole('dialog', { name: 'Navy Rule' });
    await expect(details.getByText('Sections in the order you arrange them')).toBeVisible();
    await details.getByRole('button', { name: 'Plain', exact: true }).click();
    await expect(details.locator('iframe')).toHaveAttribute('src', /layout=flat/);
    // The arrows step through templates, except on the layout switch itself.
    await page.keyboard.press('ArrowRight');
    await expect(details).toBeVisible();
    await details.getByRole('button', { name: 'Use this template' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('dialog', { name: 'Classic Serif' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Classic Serif' }).getByRole('button', { name: 'Use this template' }).click();
    await expect(page).toHaveURL(/\/resumes\/new\?template=classic-serif&layout=flat$/);
    await expect(page.getByRole('dialog', { name: 'Import your existing resume' })).toBeVisible();
  });

  test('offers a PDF or a JSON file as the start', async ({ page }) => {
    await setup(page);
    await page.goto('/resumes/new');
    await page.getByRole('button', { name: /Import existing resume/ }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText([/^Resume PDF/, /^Resume JSON file/]);
    await expect(menu).toContainText('An AI reads it into a new resume. Up to 5 MB.');
  });
});

test.describe('resume editor', () => {
  test('shows every section kind and custom sections, in the order arranged', async ({ page }) => {
    await setup(page);
    await openNewEditor(page);
    expect(await sectionOrder(page)).toEqual(['summary', 'experience', 'skills', 'education', 'certifications', 'strengths', 'softSkills']);

    for (const label of ['Projects', 'Volunteering', 'Awards', 'Publications', 'Courses', 'Languages', 'Interests', 'References']) {
      await page.getByRole('button', { name: 'Add content' }).click();
      await page.getByRole('dialog', { name: 'Add content' }).getByRole('button', { name: new RegExp(`^${label}`) }).click();
      await expect(page.locator('[data-section]').last().getByRole('button', { name: new RegExp(`^${label}`) })).toBeFocused();
    }
    await page.getByRole('button', { name: 'Add content' }).click();
    const add = page.getByRole('dialog', { name: 'Add content' });
    await expect(add).toContainText('Every kind of section is on the page already.');
    await add.getByLabel('Custom section title').fill('Patents');
    await add.getByRole('button', { name: 'Add', exact: true }).click();
    const order = await sectionOrder(page);
    expect(order).toHaveLength(16);
    expect(order.at(-1)).toMatch(/^custom:cs-[0-9a-f]{8}$/);

    // A section with entries asks before it goes (a card just added is open).
    await page.getByRole('button', { name: 'Add project' }).click();
    for (const label of ['Project name', 'Your role', 'Start date', 'End date', 'Link', 'Description']) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await page.getByLabel('Project name').fill('Lakehouse');
    await page.getByRole('button', { name: 'Done' }).click();
    await page.locator('[data-section="projects"]').hover();
    await page.getByRole('button', { name: 'Remove section Projects' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Remove Projects and its 1 entry? It is deleted when you save.');
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('[data-section="projects"]')).toHaveCount(0);

    // Move, then let go of the order again.
    await page.locator('[data-section="experience"]').hover();
    await page.getByRole('button', { name: 'Move Experience down' }).click();
    expect((await sectionOrder(page)).slice(0, 3)).toEqual(['summary', 'skills', 'experience']);
    await expect(page.getByRole('button', { name: 'Move Experience down' })).toBeFocused();
    await page.getByRole('tab', { name: 'Customize' }).click();
    await page.getByRole('button', { name: "Use the template's order" }).click();
    await page.getByRole('tab', { name: 'Content' }).click();
    expect((await sectionOrder(page)).slice(0, 3)).toEqual(['summary', 'experience', 'skills']);
  });

  test('drags a section by its grip with the keyboard', async ({ page }) => {
    await setup(page);
    await openNewEditor(page);
    const grip = page.getByRole('button', { name: 'Drag to reorder Education' });
    await grip.focus();
    await page.keyboard.press('Space');
    // dnd-kit marks the lifted card's grip as pressed; each arrow then moves it one place.
    await expect(grip).toHaveAttribute('aria-pressed', 'true');
    for (let step = 0; step < 2; step += 1) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(150);
    }
    await page.keyboard.press('Space');
    await expect(grip).not.toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => sectionOrder(page)).toEqual(['summary', 'education', 'experience', 'skills', 'certifications', 'strengths', 'softSkills']);
  });

  test('Write with AI fills the bullets, says so and can be undone', async ({ page }) => {
    const api = await setup(page);
    await openNewEditor(page);
    await page.getByRole('button', { name: /^Experience/ }).click();
    await page.getByRole('button', { name: 'Add experience' }).click();
    const write = page.getByRole('button', { name: 'Write with AI' });
    await expect(write).toBeDisabled();
    await expect(page.getByText('Give the role a title or a company before asking for bullets.')).toBeVisible();
    await page.getByLabel('Job title').fill('Platform Engineer');
    await page.getByLabel('A note for the AI (optional)').fill('the build times');
    await write.click();
    const box = page.getByLabel('Achievements, one per line');
    await expect(box).toHaveValue('Built a deploy pipeline used by 40 teams\nCut build times by 35%', { timeout: 15_000 });
    await expect(page.getByText('Bullets written.')).toBeVisible();
    const sent = api.calledWith('POST', /^\/api\/resumes\/bullets/)[0]?.body as Json;
    expect(sent).toMatchObject({ kind: 'experience', task: 'write', instructions: 'the build times', entry: { title: 'Platform Engineer' } });
    await expect(page.getByRole('button', { name: 'Improve with AI' })).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(box).toHaveValue('');
  });

  test('skills: headings in Grouped, none in Plain; the print switches', async ({ page }) => {
    await setup(page);
    await openNewEditor(page);
    await page.getByRole('button', { name: /^Technical skills/ }).click();
    const add = page.getByLabel('Add a hard skill');
    await add.fill('go');
    await add.press('Enter');
    await expect(page.getByRole('list', { name: 'Technical skills' }).getByText('Go', { exact: true })).toBeVisible();
    await page.getByLabel('Heading for Go').selectOption('Languages');
    await page.getByRole('tab', { name: 'Customize' }).click();
    await page.getByRole('radio', { name: 'Plain' }).click();
    await page.getByRole('tab', { name: 'Content' }).click();
    await expect(page.getByLabel('Heading for Go')).toHaveCount(0);

    await page.getByRole('button', { name: /^Soft skills/ }).click();
    await page.getByRole('switch', { name: 'Print a Soft Skills section' }).click();
    await page.getByLabel('Add a soft skill').fill('Mentoring');
    await page.getByLabel('Add a soft skill').press('Enter');
    await expect(page.getByRole('list', { name: 'Soft skills' })).toContainText('Mentoring');

    await page.getByRole('button', { name: /^Strengths/ }).click();
    await expect(page.getByRole('button', { name: 'Add strength' })).toHaveCount(0);
    await page.getByRole('switch', { name: 'Print a Strengths section' }).click();
    await expect(page.getByRole('button', { name: 'Add strength' })).toBeVisible();
  });

  test('asks before leaving with changes, and saves to Documents with a toast', async ({ page }) => {
    const api = await setup(page);
    await openNewEditor(page);
    await expect(page.getByText('Nothing entered yet')).toBeVisible();
    await page.getByRole('button', { name: 'Edit name and contact details' }).click();
    await page.getByLabel('Full name').fill('Ann Lee');
    await page.getByLabel('Professional title').fill('Staff Engineer');
    await page.getByLabel('Total years of experience').fill('9');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await expect(page.frameLocator('iframe[title="Resume preview"]').getByText('Ann Lee')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('link', { name: 'Documents' }).click();
    const leave = page.getByRole('alertdialog', { name: 'Leave without saving?' });
    await expect(leave).toContainText('The changes you made to this resume will be lost.');
    await leave.getByRole('button', { name: 'Stay' }).click();
    await expect(page).toHaveURL(/\/resumes\/new/);

    await page.getByRole('button', { name: 'Create Resume' }).click();
    await expect(page).toHaveURL(/\/documents\?tab=resumes$/);
    await expect(page.getByText('Resume created')).toBeVisible();
    const created = api.calledWith('POST', /^\/api\/resumes$/)[0]?.body as { document: Json };
    expect(created.document).toMatchObject({ name: 'Ann Lee', title: 'Staff Engineer', totalYearsExperience: 9, preferredTemplate: 'navy-rule', sectionOrder: [] });
    expect(created.document.experience).toEqual([]);
  });

  test('a start date without an end date is pointed out, and saving still goes ahead', async ({ page }) => {
    const api = await setup(page);
    await openNewEditor(page);
    await page.getByRole('button', { name: /^Experience/ }).click();
    await page.getByRole('button', { name: 'Add experience' }).click();
    await page.getByLabel('Job title').fill('Platform Engineer');
    const endDate = page.getByLabel('End date', { exact: true });
    await expect(endDate).toHaveAttribute('placeholder', 'MM/YYYY or Present');
    await page.getByLabel('Start date', { exact: true }).fill('2021-02');
    const hint = 'Add an end date, or Present for a current role.';
    await expect(endDate).toHaveAccessibleDescription(hint);
    await page.getByRole('button', { name: 'Done' }).click();

    // The row says so too, and the card head carries a mark described for screen readers.
    await expect(page.getByRole('button', { name: 'Edit Platform Engineer' })).toHaveAccessibleDescription(hint);
    await expect(page.getByRole('button', { name: /^Experience/ })).toHaveAccessibleDescription('1 entry needs an end date');

    await page.getByRole('button', { name: 'Create Resume' }).click();
    await expect(page).toHaveURL(/\/documents\?tab=resumes$/);
    const created = api.calledWith('POST', /^\/api\/resumes$/)[0]?.body as { document: Json };
    expect(created.document.experience).toMatchObject([{ title: 'Platform Engineer', startDate: '2021-02', endDate: '' }]);
  });

  test('a stored resume opens with its content and saves with PUT', async ({ page }) => {
    const api = await setup(page);
    await page.goto('/resumes/r-default');
    await expect(page.getByText('No changes yet')).toBeVisible();
    await expect(page.getByText('Platform Engineer at Fabrikam')).toBeAttached();
    await page.getByRole('button', { name: /^Summary/ }).click();
    await page.getByLabel('Professional summary').fill('Platform engineer who ships.');
    await page.getByRole('button', { name: 'Save Resume' }).click();
    await expect(page).toHaveURL(/\/documents\?tab=resumes$/);
    const saved = api.calledWith('PUT', /^\/api\/resumes\/r-default$/)[0]?.body as { document: Json };
    expect(saved.document).toMatchObject({ summary: 'Platform engineer who ships.', skills: ['Go', 'Kubernetes'] });
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const pageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  test('the editor bar keeps the name readable and its buttons apart', async ({ page }) => {
    await setup(page);
    await page.goto('/resumes/r-default');
    const bar = page.locator('[data-editor-bar]');
    const name = bar.locator('[aria-current="page"] > span').first();
    await expect(name).toHaveText('Senior Platform Engineer');
    // "Documents" is its icon alone and Save its icon alone, both still named; the ⓘ waits for a wider screen.
    await expect(bar.getByRole('link', { name: 'Documents' })).toBeVisible();
    const save = bar.getByRole('button', { name: 'Save Resume' });
    await expect(save).toBeVisible();
    await expect(bar.getByRole('button', { name: 'About this name' })).toBeHidden();

    const nameBox = await name.boundingBox();
    const renameBox = await bar.getByRole('button', { name: 'Rename' }).boundingBox();
    const saveBox = await save.boundingBox();
    expect(nameBox!.width).toBeGreaterThan(80);
    expect(renameBox!.x + renameBox!.width).toBeLessThanOrEqual(saveBox!.x);
    expect(saveBox!.width).toBeLessThanOrEqual(40);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('the template filters scroll sideways instead of widening the page', async ({ page }) => {
    await setup(page);
    await page.goto('/resumes/new');
    const pills = page.getByRole('tablist', { name: 'Show templates' });
    await expect(pills.getByRole('tab')).toHaveText(['All Templates', 'Simple', 'Modern', 'ATS']);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    await pills.getByRole('tab', { name: 'ATS' }).click();
    await expect(page.locator('[data-template-card]')).toHaveCount(1);
  });
});

test.describe('Documents › Resumes', () => {
  test('grid badges sit under the title, clear of the page; the toggle reads Grid | List', async ({ page }) => {
    await setup(page);
    await page.goto('/documents?tab=resumes');
    const toggle = page.getByRole('group', { name: 'View' }).getByRole('button');
    await expect(toggle).toHaveCount(2);
    expect(await toggle.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))).toEqual(['Grid', 'List']);
    await page.getByRole('button', { name: 'Grid' }).click();

    for (const [id, text] of [['r-upload', 'Uploaded'], ['r-upload', 'PDF'], ['r-default', 'Default']] as const) {
      const card = page.locator(`[data-resume-card="${id}"]`);
      const pageBox = await card.locator('[data-cover]').boundingBox();
      const badgeBox = await card.getByText(text, { exact: true }).boundingBox();
      expect(badgeBox!.y, `${text} badge`).toBeGreaterThanOrEqual(pageBox!.y + pageBox!.height);
    }
  });

  test('grid and list views, the view remembered, badges and menus', async ({ page }) => {
    await setup(page);
    await page.goto('/documents?tab=resumes');
    await page.getByRole('button', { name: 'Grid' }).click();
    const grid = page.locator('[data-resume-card]');
    await expect(grid).toHaveCount(3);
    await expect(page.locator('[data-new-tile="resume"]')).toContainText('New resume');
    await expect(grid.first()).toContainText('Senior Platform Engineer');
    await expect(grid.first()).toContainText('Edited 6 hours ago · Navy Rule');
    await expect(grid.first().locator('[data-default-resume]')).toBeVisible();
    await expect(page.locator('[data-resume-card="r-upload"]')).toContainText('Uploaded');
    await expect(page.locator('[data-resume-card="r-default"] iframe[sandbox=""]')).toBeAttached({ timeout: 15_000 });
    await expect(page.locator('[data-resume-card="r-upload"] img')).toBeAttached({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Actions for Backend Engineer' }).first().click();
    await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
      'Edit',
      'Rename',
      'Duplicate',
      'Set as default',
      'Download PDF',
      'Download Word',
      'Download JSON',
      'Delete',
    ]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Actions for David_Jack_resume' }).first().click();
    await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
      'View',
      'Skills and details',
      'Rename',
      'Duplicate',
      'Set as default',
      'Download PDF',
      'Make editable copy',
      'Delete',
    ]);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'List' }).click();
    await page.reload();
    const table = page.getByRole('table', { name: 'Resumes' });
    await expect(table.getByRole('columnheader')).toHaveText(['', 'Resume', 'Name on resume', 'Template', 'Edited', 'Actions']);
    await expect(page.locator('[data-resume-row="r-built"]')).toContainText('David Jack');
    await expect(page.locator('[data-resume-row="r-built"]')).toContainText('3 hours ago');
  });

  test('search, the source filter and their empty states', async ({ page }) => {
    await setup(page);
    await page.goto('/documents?tab=resumes');
    const search = page.getByRole('searchbox', { name: 'Search resumes' });
    await search.fill('backend');
    await expect(page.getByRole('status').filter({ hasText: 'match.' })).toHaveText('1 of 3 resumes match.');
    await search.fill('zzz');
    await expect(page.getByText('Oops! No matching resumes found.')).toBeVisible();
    await search.fill('');
    await page.getByRole('combobox', { name: 'Resume source' }).click();
    await page.getByRole('option', { name: 'Uploaded' }).click();
    await page.getByRole('button', { name: 'List' }).click();
    await expect(page.locator('[data-resume-row]')).toHaveCount(1);
  });

  test('rename, set as default and bulk delete (the default is skipped)', async ({ page }) => {
    const api = await setup(page);
    await page.goto('/documents?tab=resumes');
    await page.getByRole('button', { name: 'List' }).click();
    const row = page.locator('[data-resume-row="r-built"]');
    await row.getByRole('button', { name: 'Actions for Backend Engineer' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const rename = page.getByRole('dialog', { name: 'Change resume name' });
    await expect(rename.getByRole('button', { name: 'Keep it' })).toBeVisible();
    await rename.getByLabel('Resume name').fill('Backend Engineer (Fintech)');
    await rename.getByRole('button', { name: 'Change' }).click();
    await expect(row).toContainText('Backend Engineer (Fintech)');
    expect(api.calledWith('PATCH', /^\/api\/resumes\/r-built$/)[0]?.body).toEqual({ title: 'Backend Engineer (Fintech)' });

    await row.getByRole('button', { name: /^Actions for Backend Engineer/ }).click();
    await page.getByRole('menuitem', { name: 'Set as default' }).click();
    await expect(row.locator('[data-default-resume]')).toBeVisible();
    await expect(page.locator('[data-resume-row="r-default"] [data-default-resume]')).toHaveCount(0);

    await page.getByRole('checkbox', { name: 'Select all resumes' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('1 default resume will be skipped');
    await confirm.getByRole('button', { name: 'Delete Bulk' }).click();
    await expect(page.locator('[data-resume-row]')).toHaveCount(1);
    await expect(page.locator('[data-resume-row="r-built"]')).toBeVisible();
  });

  test('upload: the server refuses a .doc with its own sentence; an editable copy is offered when ready', async ({ page }) => {
    const api = await setup(page);
    await page.goto('/documents?tab=resumes');
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload Resume' });
    await expect(dialog.getByPlaceholder('Ex. John_Doe_Finance')).toBeVisible();
    await expect(dialog).toContainText('PDF, DOC, DOCX up to 5 MB');
    // The AI copy is asked for only when the box is ticked.
    const copy = dialog.getByRole('checkbox', { name: 'Make an editable copy with AI' });
    await expect(copy).not.toBeChecked();

    await dialog.getByLabel('Resume file').setInputFiles({ name: 'old.doc', mimeType: 'application/msword', buffer: Buffer.from('doc') });
    await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(dialog).toContainText('Old Word files (.doc) cannot be read. Save it as .docx or PDF and upload that.');

    await dialog.getByRole('button', { name: 'Remove the file' }).click();
    await dialog.getByLabel('Resume file').setInputFiles({ name: 'John_Doe_Finance.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await copy.click();
    await expect(copy).toBeChecked();
    await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Your editable copy is ready')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Open the resume' })).toHaveAttribute('href', '/resumes/r-default');
    expect(api.uploads.map((upload) => [upload.fileName, upload.title, upload.parse])).toEqual([
      ['old.doc', 'old', false],
      ['John_Doe_Finance.pdf', 'John_Doe_Finance', true],
    ]);
  });

  test('upload several files', async ({ page }) => {
    const api = await setup(page, { uploadDelayMs: 400, busyOnce: ['Busy_Resume.pdf'] });
    await page.goto('/documents?tab=resumes');
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload Resume' });
    const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await dialog
      .getByLabel('Resume file')
      .setInputFiles([pdf('Alice_Resume.pdf'), pdf('Busy_Resume.pdf'), pdf('Carol_Resume.pdf'), { name: 'old.doc', mimeType: 'application/msword', buffer: Buffer.from('doc') }]);

    // Several files: each is named after its file, and no AI copy is offered.
    const rows = dialog.getByRole('list', { name: 'Files to upload' }).getByRole('listitem');
    await expect(rows).toHaveCount(4);
    await expect(dialog.getByPlaceholder('Ex. John_Doe_Finance')).toHaveCount(0);
    await expect(dialog.getByRole('checkbox', { name: 'Make an editable copy with AI' })).toHaveCount(0);
    await expect(dialog).toContainText('Each resume is named after its file. You can rename it later.');
    await expect(rows.first()).toContainText('Ready');

    await dialog.getByRole('button', { name: 'Upload 4 files' }).click();
    // While files are sent the dialog stays open: Stop instead of Cancel, no ✕, Escape does nothing.
    await expect(dialog.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();

    const row = (name: string) => dialog.locator(`[data-upload-row="${name}"]`);
    for (const name of ['Alice_Resume.pdf', 'Busy_Resume.pdf', 'Carol_Resume.pdf']) {
      await expect(row(name)).toHaveAttribute('data-upload-status', 'done', { timeout: 15_000 });
      await expect(row(name)).toContainText('Uploaded');
    }
    // The .doc gets the server's own sentence and is not offered again.
    await expect(row('old.doc')).toHaveAttribute('data-upload-status', 'failed');
    await expect(row('old.doc')).toContainText('Old Word files (.doc) cannot be read.');
    await expect(dialog.getByRole('status').filter({ hasText: 'not uploaded' })).toHaveText('3 uploaded, 1 not uploaded.');
    await expect(dialog.getByRole('button', { name: /^Try again/ })).toHaveCount(0);
    // One toast for the whole upload.
    await expect(page.getByText('3 resumes uploaded')).toBeVisible();
    await expect(page.getByText('1 file was not uploaded.')).toBeVisible();

    // Two in flight at most; the busy file went again after the wait; no name and no AI copy were asked for.
    expect(api.maxUploadsInFlight).toBe(2);
    expect(api.uploads.filter((upload) => upload.fileName === 'Busy_Resume.pdf')).toHaveLength(2);
    expect(api.uploads.every((upload) => upload.title === null && !upload.parse)).toBe(true);

    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'List' }).click();
    for (const label of ['Alice_Resume', 'Busy_Resume', 'Carol_Resume']) {
      await expect(page.locator('[data-resume-row]').filter({ hasText: label })).toHaveCount(1);
    }
  });

  test("an upload's skills", async ({ page }) => {
    const api = await setup(page, { readings: true });
    await page.goto('/documents?tab=resumes');
    await page.getByRole('button', { name: 'Grid' }).click();
    // The card line: years, then three main skills and how many more (a spinner first while the AI reads it).
    const upload = page.locator('[data-resume-card="r-upload"] [data-profile-line]');
    await expect(upload).toContainText('8 yrs · React, TypeScript, Node.js +9');
    await expect(upload).toHaveAttribute('href', '/resumes/r-upload#profile');
    await expect(page.locator('[data-resume-card="r-default"] [data-profile-line]')).toHaveText('6 yrs · Go, Kubernetes, PostgreSQL');
    await expect(page.locator('[data-resume-card="r-built"] [data-profile-line]')).toHaveText('Finding skills...');

    // The list: the same line inside the Resume cell, and no new column.
    await page.getByRole('button', { name: 'List' }).click();
    await expect(page.getByRole('table', { name: 'Resumes' }).getByRole('columnheader')).toHaveText(['', 'Resume', 'Name on resume', 'Template', 'Edited', 'Actions']);
    await expect(page.locator('[data-resume-row="r-upload"]')).toContainText('8 yrs · React, TypeScript, Node.js +9');

    // Search reads the main skills too.
    const search = page.getByRole('searchbox', { name: 'Search resumes' });
    await search.fill('graphql');
    await expect(page.getByRole('status').filter({ hasText: 'match.' })).toHaveText('1 of 3 resumes match.');
    await expect(page.locator('[data-resume-row]')).toHaveCount(1);
    await search.fill('');

    // Skills and details: the file page at "What TailorIT read from this resume".
    await page.getByRole('button', { name: 'Actions for David_Jack_resume' }).click();
    await page.getByRole('menuitem', { name: 'Skills and details' }).click();
    await expect(page).toHaveURL(/\/resumes\/r-upload#profile$/);
    const panel = page.getByRole('region', { name: 'What TailorIT read from this resume' });
    await expect(panel).toContainText('Reading it with AI for a closer look...');
    await expect(panel).toBeFocused();
    await expect(panel.getByRole('list', { name: 'Main skills' }).getByRole('listitem')).toHaveCount(5);

    // The AI finishes; the panel reads it again by itself (10 s later) and shows its reading.
    api.readingsDone.add('r-upload');
    await expect(panel).toContainText('Read with AI. Everything shown here appears in your file.', { timeout: 20_000 });
    await expect(panel).not.toContainText('Reading it with AI');
    await expect(panel.getByRole('list', { name: 'Main skills' }).getByRole('listitem')).toHaveCount(12);
    await expect(panel.getByRole('list', { name: 'Soft skills' })).toContainText('Mentoring');
    await expect(panel.getByRole('list', { name: 'Roles' })).toContainText('Senior Frontend Engineer');
    await expect(panel.getByRole('list', { name: 'Certifications' })).toHaveText('AWS Certified Developer');
    await expect(panel.getByRole('list', { name: 'Industries' })).toHaveText('Finance');
    await expect(panel).toContainText('About 8 years');
    await expect(panel).toContainText('Added up from the dates of your roles.');
  });

  test('a copy that cannot start keeps the upload', async ({ page }) => {
    const busy = 'An AI request of this kind is already running for your account. Wait for it to finish, then try again.';
    const api = await setup(page, { copyError: busy });
    await page.goto('/documents?tab=resumes');
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload Resume' });
    await dialog.getByLabel('Resume file').setInputFiles({ name: 'Jane_Doe.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await dialog.getByRole('checkbox', { name: 'Make an editable copy with AI' }).click();
    await dialog.getByRole('button', { name: 'Upload', exact: true }).click();

    // The upload is kept and listed; why the copy could not start stays on the tab until dismissed.
    await expect(dialog).toBeHidden();
    const notice = page.getByRole('alert').filter({ hasText: 'The editable copy of Jane_Doe could not start' });
    await expect(notice).toContainText(busy);
    await expect(notice).toContainText('Your upload is kept as it is.');
    await page.getByRole('button', { name: 'List' }).click();
    await expect(page.locator('[data-resume-row]').filter({ hasText: 'Jane_Doe' })).toHaveCount(1);
    expect(api.uploads).toEqual([{ fileName: 'Jane_Doe.pdf', title: 'Jane_Doe', parse: true }]);
    await notice.getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice).toHaveCount(0);
  });

  test('an empty tab invites a first resume', async ({ page }) => {
    await setup(page, { empty: true });
    await page.goto('/documents?tab=resumes');
    await expect(page.getByText('Create your first resume!')).toBeVisible();
    await expect(page.getByText('Get started with a polished resume that highlights your skills and experience.')).toBeVisible();
  });

  test('delete asks first, then focus moves to the next resume', async ({ page }) => {
    await setup(page);
    await page.goto('/documents?tab=resumes');
    await page.getByRole('button', { name: 'Grid' }).click();
    await page.getByRole('button', { name: 'Actions for Backend Engineer' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('[data-resume-card="r-built"]')).toHaveCount(0);
    await expect(page.locator('[data-resume-card="r-upload"] a[href], [data-resume-card="r-upload"] button').first()).toBeFocused();
  });
});
