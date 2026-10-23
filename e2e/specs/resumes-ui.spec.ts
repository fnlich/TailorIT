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
}

class FakeApi {
  readonly resumes: Summary[];
  readonly documents = new Map<string, Json>();
  readonly calls: Array<{ method: string; path: string; body: unknown }> = [];
  readonly tasks = new Map<string, { kind: string; result: unknown; polls: number }>();
  private sequence = 0;

  constructor(options: { empty?: boolean } = {}) {
    const now = Date.now();
    const at = (ago: number) => new Date(now - ago).toISOString();
    this.resumes = options.empty
      ? []
      : [
          { id: 'r-default', kind: 'built', label: 'Senior Platform Engineer', title: null, templateId: 'navy-rule', templateName: 'Navy Rule', isDefault: true, fileKind: null, nameOnResume: 'David Jack', createdAt: at(72 * HOUR), updatedAt: at(6 * HOUR), lastEditedAt: at(6 * HOUR) },
          { id: 'r-built', kind: 'built', label: 'Backend Engineer', title: null, templateId: 'classic-serif', templateName: 'Classic Serif', isDefault: false, fileKind: null, nameOnResume: 'David Jack', createdAt: at(30 * HOUR), updatedAt: at(3 * HOUR), lastEditedAt: at(3 * HOUR) },
          { id: 'r-upload', kind: 'uploaded', label: 'David_Jack_resume', title: 'David_Jack_resume', templateId: null, templateName: null, isDefault: false, fileKind: 'pdf', nameOnResume: '', createdAt: at(50 * HOUR), updatedAt: at(50 * HOUR), lastEditedAt: null },
        ];
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
        if (/filename="[^"]+\.doc"/.test(raw)) {
          return json(route, 415, { error: { code: 'unsupported_file', message: 'Old Word files (.doc) cannot be read. Save it as .docx or PDF and upload that.' } });
        }
        const stamp = new Date().toISOString();
        const resume: Summary = { id: `r-up-${Date.now()}`, kind: 'uploaded', label: 'John_Doe_Finance', title: 'John_Doe_Finance', templateId: null, templateName: null, isDefault: false, fileKind: 'pdf', nameOnResume: '', createdAt: stamp, updatedAt: stamp, lastEditedAt: null };
        this.resumes.unshift(resume);
        return json(route, 201, { resume, taskId: parse ? this.task('resume_import', { resumeId: 'r-default' }) : null });
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

async function setup(page: Page, options: { empty?: boolean } = {}) {
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

test.describe('Documents › Resumes', () => {
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
    await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['View', 'Rename', 'Duplicate', 'Set as default', 'Download PDF', 'Make editable copy', 'Delete']);
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
    await setup(page);
    await page.goto('/documents?tab=resumes');
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload Resume' });
    await expect(dialog.getByPlaceholder('Ex. John_Doe_Finance')).toBeVisible();
    await expect(dialog).toContainText('PDF, DOC, DOCX up to 5 MB');
    await expect(dialog.getByRole('checkbox', { name: 'Make an editable copy with AI' })).toBeChecked();

    await dialog.getByLabel('Resume file').setInputFiles({ name: 'old.doc', mimeType: 'application/msword', buffer: Buffer.from('doc') });
    await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(dialog).toContainText('Old Word files (.doc) cannot be read. Save it as .docx or PDF and upload that.');

    await dialog.getByRole('button', { name: 'Remove the file' }).click();
    await dialog.getByLabel('Resume file').setInputFiles({ name: 'John_Doe_Finance.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Your editable copy is ready')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Open the resume' })).toHaveAttribute('href', '/resumes/r-default');
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
