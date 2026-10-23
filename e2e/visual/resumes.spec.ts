import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

/*
 * Work package R2 visual captures at the size of the user's Simplify screenshots (1567×889, project "shots"):
 * Documents › Resumes as the thumbnail grid and the list (compare with e2e/reference/simplify-3.png), the template
 * chooser and its details, and the editor. Real data when the resume API answers; while it does not (work package R1
 * not merged yet), a stand-in answers /api/resumes*, /api/resume-templates* and /api/skills* so the pages can still be
 * looked at. Writes e2e/artifacts/resumes/*.png.
 *   npx playwright test --project=shots e2e/visual/resumes.spec.ts
 */

const OUT = join(process.cwd(), 'e2e', 'artifacts', 'resumes');
const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3100';

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

async function settle(page: Page, ms = 800) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.waitForTimeout(ms);
}

async function signIn(page: Page) {
  // The dev API restarts when its files change; a sign-in that meets a restart is tried again.
  for (let attempt = 1; ; attempt += 1) {
    const answer = await page.request.post('/api/auth/email/verify', {
      data: { email: 'r2@tailorit.dev', code: '000000' },
      headers: { Origin: ORIGIN },
    });
    if (answer.ok()) return;
    if (attempt >= 8 || answer.status() < 500) throw new Error(`Sign-in failed (${answer.status()}): ${await answer.text()}`);
    await page.waitForTimeout(1500);
  }
}

// ------------------------------------------------------------------------------------------------- stand-in

const TEMPLATES = [
  ['default', 'Professional Two-Column', 'modern', '#1f4e79', true],
  ['navy-rule', 'Navy Rule', 'simple', '#14335c', false],
  ['classic-serif', 'Classic Serif', 'simple', '#333333', false],
  ['burgundy-rule', 'Burgundy Rule', 'simple', '#7a1f2b', false],
  ['azure-stack', 'Azure Stack', 'modern', '#1c7ed6', true],
  ['forest-chips', 'Forest Chips', 'modern', '#2b6e4f', true],
  ['amber-gradient', 'Amber Gradient', 'creative', '#b7791f', false],
  ['timeline-bars', 'Timeline Bars', 'creative', '#6b46c1', false],
  ['ats-classic-serif', 'ATS Classic Serif', 'ats', '#000000', false],
  ['ats-modern-sans', 'ATS Modern Sans', 'ats', '#222222', false],
] as const;

function samplePage(color: string, sidebar: boolean, document: Record<string, unknown> = {}): string {
  const name = String(document.name || 'Jordan Avery Chen');
  const title = String(document.title || 'Senior Software Engineer');
  const side = `<h2>Technical Skills</h2><p>Go, TypeScript, PostgreSQL, Kafka, Kubernetes, AWS, React, gRPC</p><h2>Certifications</h2><p>AWS Certified Solutions Architect</p>`;
  const main = `<h2>Professional Summary</h2><p>Senior engineer with nine years building and operating payment and data platforms at scale.</p>
<h2>Professional Experience</h2><div class="r"><b>Senior Software Engineer</b><span>01/2021 - Present</span></div><i>Northwind Payments</i>
<ul><li>Led the migration of the payments ledger to an event-sourced design, cutting reconciliation time by 70%</li><li>Mentored five engineers and ran the on-call rotation</li><li>Built the fraud scoring service in Go and Kafka</li></ul>
<div class="r"><b>Software Engineer</b><span>06/2017 - 12/2020</span></div><i>Contoso Data</i><ul><li>Shipped the analytics API used by 300 customers</li><li>Reduced p99 latency from 900 ms to 120 ms</li></ul>
<h2>Education</h2><div class="r"><b>M.S. Computer Science</b><span>2015 - 2017</span></div><i>University of Washington</i>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>html{width:794px;min-height:1123px;background:#fff;padding:44px 48px;box-sizing:border-box;font:12px/1.45 Calibri,Arial,sans-serif;color:#222}
body{margin:0}h1{margin:0;font-size:26px;color:${color}}h2{font-size:12.5px;text-transform:uppercase;letter-spacing:1px;color:${color};border-bottom:1.5px solid ${color};padding-bottom:3px;margin:16px 0 6px}
.r{display:flex;justify-content:space-between}ul{margin:3px 0 8px 16px;padding:0}.g{display:grid;grid-template-columns:${sidebar ? '1fr 200px' : '1fr'};gap:22px}</style></head>
<body><h1>${name}</h1><div>${title}</div><div style="color:#555;font-size:11px;margin-top:4px">jordan.chen@example.com · +1 (555) 123-4567 · San Francisco, CA</div>
<div class="g"><div>${main}${sidebar ? '' : side}</div>${sidebar ? `<div>${side}</div>` : ''}</div></body></html>`;
}

async function installStandIn(page: Page) {
  const now = Date.now();
  const at = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  const resumes = [
    { id: 'r-1', kind: 'built', label: 'Senior Platform Engineer', title: null, templateId: 'navy-rule', templateName: 'Navy Rule', isDefault: true, fileKind: null, nameOnResume: 'David Jack', createdAt: at(72), updatedAt: at(6), lastEditedAt: at(6) },
    { id: 'r-2', kind: 'built', label: 'PaaS Infrastructure Engineering Cloud Automation & Tools Consultant', title: null, templateId: 'azure-stack', templateName: 'Azure Stack', isDefault: false, fileKind: null, nameOnResume: 'David Jack', createdAt: at(26), updatedAt: at(3), lastEditedAt: at(3) },
    { id: 'r-3', kind: 'uploaded', label: 'David_Jack_resume', title: 'David_Jack_resume', templateId: null, templateName: null, isDefault: false, fileKind: 'pdf', nameOnResume: '', createdAt: at(50), updatedAt: at(50), lastEditedAt: null },
    { id: 'r-4', kind: 'built', label: 'Backend Engineer', title: null, templateId: 'classic-serif', templateName: 'Classic Serif', isDefault: false, fileKind: null, nameOnResume: 'David Jack', createdAt: at(200), updatedAt: at(190), lastEditedAt: at(190) },
  ];
  const templateOf = (id: string | null) => TEMPLATES.find(([key]) => key === id) ?? TEMPLATES[0];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/resume-templates**', (route) => {
    const preview = /\/api\/resume-templates\/([^/]+)\/preview/.exec(new URL(route.request().url()).pathname);
    if (preview) {
      const [, , , color, sidebar] = templateOf(decodeURIComponent(preview[1] ?? ''));
      return route.fulfill({ status: 200, contentType: 'text/html', body: samplePage(color, sidebar) });
    }
    return json(route, {
      items: TEMPLATES.map(([id, name, category, , sidebar]) => ({
        id,
        name,
        description: `${name}: a clean, print-ready layout with clear section headings.`,
        category,
        supportsSoftSkills: category !== 'ats',
        supportsStrengths: sidebar,
        printsSections: category === 'ats' ? ['summary', 'experience', 'education', 'skills'] : ['summary', 'experience', 'education', 'skills', 'projects', 'custom'],
        nativeSectionOrder: ['summary', 'experience', 'skills', 'education', 'certifications'],
      })),
    });
  });
  await page.route('**/api/skills**', (route) => json(route, { type: 'hard', skills: ['Go', 'Kubernetes', 'TypeScript'] }));
  await page.route('**/api/files/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><rect width="794" height="1123" fill="#fff"/><text x="60" y="110" font-family="Georgia" font-size="38">David Jack</text>${Array.from({ length: 26 }, (_, i) => `<rect x="60" y="${190 + i * 32}" width="${i % 5 === 0 ? 220 : 600}" height="${i % 5 === 0 ? 12 : 8}" rx="3" fill="${i % 5 === 0 ? '#333' : '#d6d6d6'}"/>`).join('')}</svg>`,
    }),
  );
  await page.route('**/api/resumes**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/resumes') return json(route, { items: resumes });
    if (path === '/api/resumes/preview') {
      const body = (request.postDataJSON() ?? {}) as { document?: Record<string, unknown> };
      const document = body.document ?? { name: 'David Jack', title: 'Senior Platform Engineer', preferredTemplate: 'navy-rule' };
      const [id, , , color, sidebar] = templateOf(String(document.preferredTemplate || 'default'));
      return json(route, { html: samplePage(color, sidebar, document), templateId: id, page: { widthPx: 794, heightPx: 1123, contentHeightPx: 1035 }, sampled: document.name ? [] : ['name', 'title', 'email', 'phone', 'experience'] });
    }
    const thumbnail = /^\/api\/resumes\/([^/]+)\/thumbnail$/.exec(path);
    if (thumbnail) {
      const resume = resumes.find((item) => item.id === thumbnail[1]);
      if (resume?.kind === 'uploaded') return json(route, { kind: 'image', url: '/api/files/f-1/thumbnail' });
      const [, , , color, sidebar] = templateOf(resume?.templateId ?? null);
      return json(route, { kind: 'html', html: samplePage(color, sidebar, { name: 'David Jack', title: resume?.label }), page: { widthPx: 794, heightPx: 1123, contentHeightPx: 1035 } });
    }
    const one = /^\/api\/resumes\/([^/]+)$/.exec(path);
    const resume = one ? resumes.find((item) => item.id === one[1]) : undefined;
    if (resume) {
      return json(route, {
        ...resume,
        document: {
          name: 'David Jack',
          title: resume.label,
          preferredTemplate: resume.templateId,
          contact: { email: 'david.jack@example.com', phone: '(555) 201-3344', location: 'Austin, TX', linkedin: 'linkedin.com/in/davidjack' },
          summary: 'Platform engineer with eight years of building internal developer platforms.',
          experience: [{ title: 'Senior Platform Engineer', company: 'Fabrikam', startDate: '03/2021', endDate: 'Present', location: 'Remote', description: '', achievements: ['Built the self-service deploy pipeline used by 40 teams', 'Cut cloud spend by 22%'], skills: ['Kubernetes'] }],
          skills: ['Kubernetes', 'Terraform', 'Go', 'AWS'],
          education: [{ degree: 'B.S. Computer Science', institution: 'UT Austin', startDate: '2010', endDate: '2014', location: 'Austin, TX' }],
        },
        file: null,
        hasExtractedText: false,
      });
    }
    return json(route, { error: { code: 'not_found', message: 'There is no such API endpoint.' } }, 404);
  });
}

// ----------------------------------------------------------------------------------------------- live data

const SEED_TITLES = ['Senior Platform Engineer', 'Staff Software Engineer, Payments', 'Backend Engineer'];

function seedDocument(title: string, templateId: string) {
  return {
    name: 'David Jack',
    title,
    preferredTemplate: templateId,
    contact: { email: 'david.jack@example.com', phone: '(555) 201-3344', location: 'Austin, TX', linkedin: 'linkedin.com/in/davidjack' },
    summary: 'Engineer with eight years building internal platforms and payment services, from the first design review to the on-call rotation.',
    experience: [
      {
        title,
        company: 'Fabrikam',
        startDate: '03/2021',
        endDate: 'Present',
        location: 'Remote',
        description: '',
        achievements: ['Built the self-service deploy pipeline used by 40 teams', 'Cut cloud spend by 22% with right-sizing automation', 'Ran the on-call rotation for services handling 30M requests a day'],
        skills: ['Kubernetes', 'Terraform'],
      },
      {
        title: 'Software Engineer',
        company: 'Contoso Data',
        startDate: '06/2017',
        endDate: '02/2021',
        location: 'Austin, TX',
        description: '',
        achievements: ['Shipped the analytics API used by 300 customers', 'Reduced p99 latency from 900 ms to 120 ms'],
        skills: ['Go', 'PostgreSQL'],
      },
    ],
    skills: ['Go', 'TypeScript', 'Kubernetes', 'Terraform', 'PostgreSQL', 'AWS', 'Kafka'],
    education: [{ degree: 'B.S. Computer Science', institution: 'The University of Texas at Austin', startDate: '2010', endDate: '2014', location: 'Austin, TX' }],
  };
}

/**
 * The account's documents for the captures: three built resumes on three templates (the first the default) and an
 * upload made from one of them as a PDF. Made once; a later run finds them and leaves them alone.
 */
async function seedLive(page: Page) {
  const headers = { Origin: ORIGIN };
  const list = (await (await page.request.get('/api/resumes')).json()) as { items: Array<{ id: string; label: string }> };
  if (SEED_TITLES.every((title) => list.items.some((item) => item.label === title))) return;
  const templates = ((await (await page.request.get('/api/resume-templates')).json()) as { items: Array<{ id: string }> }).items;
  const pick = (wanted: string, index: number) => (templates.some((item) => item.id === wanted) ? wanted : (templates[index]?.id ?? ''));
  const ids: string[] = [];
  for (const [index, title] of SEED_TITLES.entries()) {
    const templateId = pick(['navy-rule', 'azure-stack', 'classic-serif'][index] ?? '', index);
    const created = await page.request.post('/api/resumes', { data: { document: seedDocument(title, templateId) }, headers });
    ids.push(((await created.json()) as { id: string }).id);
  }
  await page.request.put('/api/me/default-resume', { data: { resumeId: ids[0] }, headers });
  const pdf = await page.request.get(`/api/resumes/${ids[2]}/export?format=pdf`);
  if (pdf.ok()) {
    await page.request.post('/api/resumes/upload', {
      multipart: { file: { name: 'David_Jack_resume.pdf', mimeType: 'application/pdf', buffer: await pdf.body() }, title: 'David_Jack_resume' },
      headers,
    });
  }
}

/** Real data when the resume API answers; the stand-in while it does not. Returns whether the stand-in is in use. */
async function prepare(page: Page): Promise<boolean> {
  await signIn(page);
  const probe = await page.request.get('/api/resume-templates');
  if (probe.ok()) {
    await seedLive(page);
    return false;
  }
  await installStandIn(page);
  return true;
}

async function firstResumeId(page: Page): Promise<string | null> {
  const answer = await page.request.get('/api/resumes');
  if (!answer.ok()) return 'r-1';
  const items = ((await answer.json()) as { items?: Array<{ id: string; kind: string }> }).items ?? [];
  return items.find((item) => item.kind === 'built')?.id ?? null;
}

test('documents: Resumes as the thumbnail grid and the list (compare with simplify-3.png)', async ({ page }) => {
  await prepare(page);
  await page.goto('/documents?tab=resumes');
  await page.evaluate(() => localStorage.setItem('tailorit.documents.resumes.view', 'grid'));
  await page.reload();
  await page.locator('[data-new-tile="resume"]').or(page.getByText('Create your first resume!')).first().waitFor();
  await page.locator('[data-resume-card] iframe, [data-resume-card] img').first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => undefined);
  await settle(page, 1500);
  await page.screenshot({ path: join(OUT, 'documents-grid.png') });
  await page.screenshot({ path: join(OUT, 'documents-grid-full.png'), fullPage: true });

  await page.getByRole('button', { name: 'List' }).click();
  await settle(page);
  await page.screenshot({ path: join(OUT, 'documents-list.png') });
  const menu = page.getByRole('button', { name: /^Actions for / }).first();
  if (await menu.count()) {
    await menu.click();
    await settle(page, 400);
    await page.screenshot({ path: join(OUT, 'documents-list-menu.png') });
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Upload', exact: true }).first().click();
  await settle(page, 400);
  await page.screenshot({ path: join(OUT, 'documents-upload.png') });
});

test('template chooser and its details', async ({ page }) => {
  await prepare(page);
  await page.goto('/resumes/new');
  await page.locator('[data-template-card]').first().waitFor();
  await settle(page, 2500);
  await page.screenshot({ path: join(OUT, 'chooser.png') });
  await page.locator('[data-template-card]').nth(1).click();
  await page.getByRole('button', { name: 'Use this template' }).waitFor();
  await settle(page, 2000);
  await page.screenshot({ path: join(OUT, 'chooser-details.png') });
});

test('editor: a new resume, an entry, Customize, and a stored resume', async ({ page }) => {
  await prepare(page);
  await page.goto('/resumes/new');
  await page.locator('[data-template-card]').first().waitFor();
  const firstTemplate = await page.locator('[data-template-card]').nth(1).getAttribute('data-template-card');
  await page.goto(`/resumes/new?template=${encodeURIComponent(firstTemplate ?? '')}`);
  await page.getByRole('dialog', { name: 'Import your existing resume' }).waitFor();
  await settle(page, 1500);
  await page.screenshot({ path: join(OUT, 'editor-import-dialog.png') });
  await page.getByRole('button', { name: 'Start from blank' }).click();
  await expect(page.locator('[data-preview-status="current"]')).toBeVisible({ timeout: 30_000 });
  await settle(page, 800);
  await page.screenshot({ path: join(OUT, 'editor-new.png') });

  await page.getByRole('button', { name: /^Experience/ }).click();
  await page.getByRole('button', { name: 'Add experience' }).click();
  await page.getByLabel('Job title').fill('Staff Engineer');
  await page.getByLabel('Company').fill('Northwind Payments');
  await page.getByLabel('Start date').fill('01/2021');
  await page.getByLabel('End date').fill('Present');
  await page.getByLabel('Achievements, one per line').fill('Cut cloud spend by 22% with right-sizing automation\nLed a team of five engineers');
  await expect(page.locator('[data-preview-status="current"]')).toBeVisible({ timeout: 30_000 });
  await settle(page, 600);
  await page.screenshot({ path: join(OUT, 'editor-entry.png') });
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('tab', { name: 'Customize' }).click();
  await settle(page, 600);
  await page.screenshot({ path: join(OUT, 'editor-customize.png') });

  const id = await firstResumeId(page);
  if (id) {
    // The new resume was never saved: say yes to the browser's "leave this page?" (beforeunload).
    page.on('dialog', (dialog) => void dialog.accept());
    await page.goto(`/resumes/${encodeURIComponent(id)}`);
    await expect(page.locator('[data-preview-status="current"]')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^Technical skills/ }).click();
    await settle(page, 800);
    await page.screenshot({ path: join(OUT, 'editor-stored.png') });
  }
});
