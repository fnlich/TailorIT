import { describe, expect, it } from 'vitest';
import { normalizeResumeDocument, type ResumeDocument } from '@tailorit/shared/resume';
import {
  COMPILE_CACHE_SIZE,
  compileCacheSize,
  createTemplateStore,
  PREVIEW_CONTENT_SECURITY_POLICY,
  readTemplate,
  renderPreviewDocument,
  renderPrintDocument,
  renderResumeDocxHtml,
  renderResumePreview,
  renderResumePrintHtml,
  renderTemplatePreview,
} from '../src/index';
import {
  FIXTURE_NAMES,
  fixture,
  sampleResume,
  skillLibrary,
  templateStore,
  textOf,
  withSettings,
} from './helpers';

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CONTENT_SECURITY_POLICY}">`;

describe('the template store', () => {
  it('loads the 26 templates with free_tailor categories (19 built-ins) and the ATS set', () => {
    const list = templateStore().list();
    expect(list).toHaveLength(26);
    const count = (category: string) => list.filter((template) => template.category === category).length;
    expect({ simple: count('simple'), modern: count('modern'), creative: count('creative'), ats: count('ats') }).toEqual({
      simple: 8,
      modern: 6,
      creative: 5,
      ats: 7,
    });
    expect(list.filter((template) => template.origin === 'built-in')).toHaveLength(19);
    // Built-ins are listed before the ATS set.
    const firstAts = list.findIndex((template) => template.category === 'ats');
    expect(list.slice(firstAts).every((template) => template.category === 'ats')).toBe(true);
  });

  it('describes capabilities, printed sections and native order from the markup', () => {
    const store = templateStore();
    const burgundy = store.get('burgundy-rule')!;
    expect([burgundy.supportsSoftSkills, burgundy.supportsStrengths]).toEqual([false, false]);
    expect(store.get('ink-ledger')!.supportsSoftSkills).toBe(false);
    expect(store.get('ink-ledger')!.supportsStrengths).toBe(true);
    const defaults = store.get('default')!;
    expect(defaults.printsSections).toEqual(expect.arrayContaining(['summary', 'experience', 'projects', 'custom']));
    expect(defaults.nativeSectionOrder.slice(0, 2)).toEqual(['summary', 'experience']);
    const ats = store.get('ats-classic-serif')!;
    expect(ats.printsSections).toContain('certifications');
    expect(ats.printsSections).not.toContain('projects');
    expect(ats.printsSections).not.toContain('custom');
  });

  it('reads @page boxes: A4 by default, Letter shrunk onto A4', () => {
    const store = templateStore();
    expect(store.get('default')!.pageBox).toMatchObject({ pageWidthPx: 794, pageHeightPx: 1123, mediaScale: 1 });
    const letter = store.get('charcoal-sidebar')!.pageBox;
    expect(letter).toMatchObject({ pageWidthPx: 816, pageHeightPx: 1056, margin: { top: '0', right: '0' } });
    expect(letter.mediaScale).toBeCloseTo(794 / 816, 5);
    const noPageRule = readTemplate({ id: 'bare', name: 'Bare', htmlContent: '<html><body>{{name}}</body></html>' })!;
    expect(noPageRule.pageBox.margin).toEqual({ top: '0.4in', right: '0.5in', bottom: '0.3in', left: '0.5in' });
    expect(noPageRule.category).toBe('ats');
  });

  it('resolves the requested template, else the preferred one, else default, else the first', () => {
    const store = templateStore();
    expect(store.resolve('navy-gold', 'default')!.id).toBe('navy-gold');
    expect(store.resolve('nope', 'navy-gold')!.id).toBe('navy-gold');
    expect(store.resolve(undefined, 'gone')!.id).toBe('default');
    const lone = createTemplateStore([readTemplate({ id: 'only', name: 'Only', htmlContent: '<p>{{name}}</p>' })!]);
    expect(lone.resolve('x', 'y')!.id).toBe('only');
    expect(createTemplateStore([]).resolve()).toBeNull();
  });
});

describe('every template renders every fixture', () => {
  const store = templateStore();
  for (const template of store.list()) {
    it(`${template.id}`, () => {
      for (const name of FIXTURE_NAMES) {
        for (const layout of ['categorized', 'flat'] as const) {
          for (const [soft, strengths] of [
            [false, false],
            [true, true],
          ] as const) {
            const document = withSettings(fixture(name), layout, soft, strengths);
            const { html, page } = renderPreviewDocument(document, template, skillLibrary());
            expect(html).toContain(CSP_META);
            expect(html).toContain('<style id="resume-preview-page">');
            expect(html).not.toMatch(/\{\{|\}\}/);
            expect(page.widthPx).toBe(794);
            expect(page.heightPx).toBe(1123);
            if (/^\s*<!DOCTYPE/i.test(renderPrintDocument(document, template, skillLibrary()))) {
              expect(html.indexOf(CSP_META)).toBeLessThan(40);
            }
          }
        }
      }
    });
  }
});

describe('section switches', () => {
  const classic = fixture('classic-six');

  it('strips a switched-off Soft Skills / Strengths section, heading and all', () => {
    for (const id of ['default', 'classic-serif', 'ats-classic-serif', 'sidebar-executive']) {
      const template = templateStore().get(id)!;
      const off = textOf(renderPreviewDocument(withSettings(classic, 'categorized', false, false), template, skillLibrary()).html);
      expect(off, id).not.toContain('Incident command');
      expect(off, id).not.toContain('Operational ownership');
      const on = textOf(renderPreviewDocument(withSettings(classic, 'categorized', true, true), template, skillLibrary()).html);
      expect(on, id).toContain('Incident command');
      expect(on, id).toContain('Operational ownership');
    }
  });

  it('guards a switched-on section with nothing in it, so no empty heading prints', () => {
    const template = templateStore().get('classic-serif')!;
    const empty = normalizeResumeDocument({ softSkills: [], strengths: [] }, withSettings(classic, 'categorized', true, true));
    const html = renderPreviewDocument(empty, template, skillLibrary()).html;
    expect(html).not.toMatch(/<div class="[^"]*section-soft-skills/);
    expect(html).not.toMatch(/<div class="[^"]*section-strengths/);
    expect(textOf(html)).not.toContain('Soft Skills');
  });

  it('treats a switch as off on a template with no such section', () => {
    const template = templateStore().get('burgundy-rule')!;
    const html = renderPreviewDocument(withSettings(classic, 'categorized', true, true), template, skillLibrary()).html;
    expect(textOf(html)).not.toContain('Incident command');
  });
});

describe('Technical Skills layouts', () => {
  const template = () => templateStore().get('default')!;

  it('Grouped files skills under the library headings in library order, library-known skills only', () => {
    const html = textOf(renderPreviewDocument(withSettings(fixture('classic-six'), 'categorized', false, false), template(), skillLibrary()).html);
    expect(html).toMatch(/Languages Go, Python, SQL.*Cloud and Infrastructure AWS.*Databases and Storage PostgreSQL, Redis/);
    expect(html).not.toContain('Kibana');
  });

  it("Grouped keeps the author's own headings, with unplaced skills under the library's (or the fallback) heading", () => {
    const html = textOf(renderPreviewDocument(fixture('skills'), template(), skillLibrary()).html);
    // The author's headings first, each in the person's own skill order; then the unplaced skills under the
    // library's heading or, for a skill the library lacks, the fallback rule's (merging into an author heading).
    expect(html).toContain('Core Stack TypeScript, React, Node.js, PostgreSQL Cloud AWS, Terraform Languages Golang tooling, Go');
    expect(html).toContain('Data Engineering & Streaming Kafka Observability and Monitoring Grafana');
    expect(html).toContain('Frameworks and Libraries Quantum Widgets, nodejs, Kibana dashboards');
    expect(html).toContain('Databases and Storage Postgres replication');
  });

  it('Plain prints one headless list of library-known skills', () => {
    const html = renderPreviewDocument(withSettings(fixture('classic-six'), 'flat', false, false), template(), skillLibrary()).html;
    const text = textOf(html);
    expect(text).not.toContain('Cloud and Infrastructure');
    expect(text).toContain('Kubernetes');
    expect(text).not.toContain('Kibana');
  });

  it('Plain marks a category-grid holder so the one group takes the whole row', () => {
    const navy = templateStore().get('navy-rule')!;
    const html = renderPreviewDocument(withSettings(fixture('classic-six'), 'flat', false, false), navy, skillLibrary()).html;
    expect(html).toContain('data-plain-skills');
    expect(html).toContain('<style id="plain-skills-style">');
  });

  it('a skill the person added to their own library counts as known', async () => {
    const { withExtraSkills } = await import('../src/index');
    const own = withExtraSkills(skillLibrary(), [{ skill: 'Kibana', category: 'Observability and Monitoring' }]);
    const text = textOf(renderPreviewDocument(withSettings(fixture('classic-six'), 'categorized', false, false), template(), own).html);
    expect(text).toMatch(/Observability and Monitoring Grafana, Kibana/);
  });
});

describe('section order', () => {
  it('moves sections within their column and never out of it', () => {
    const template = templateStore().get('classic-serif')!;
    const document = withSettings(fixture('classic-six'), 'categorized', true, true, {
      sectionOrder: ['education', 'experience', 'summary'],
    });
    const text = textOf(renderPreviewDocument(document, template, skillLibrary()).html);
    expect(text.indexOf('Cascadia State University')).toBeLessThan(text.indexOf('Tallowmere Outfitters'));
    expect(text.indexOf('Tallowmere Outfitters')).toBeLessThan(text.indexOf('Backend engineer with eight years'));
  });

  it("the template's own order without a stored order", () => {
    const template = templateStore().get('classic-serif')!;
    const text = textOf(renderPreviewDocument(fixture('classic-six'), template, skillLibrary()).html);
    expect(text.indexOf('Backend engineer with eight years')).toBeLessThan(text.indexOf('Tallowmere Outfitters'));
  });

  it('prints custom sections and the nine extra kinds through the macro, each movable', () => {
    const template = templateStore().get('default')!;
    const all = fixture('all-kinds');
    const text = textOf(renderPreviewDocument(all, template, skillLibrary()).html);
    for (const words of ['Certified Kubernetes Administrator', 'kubelint', 'Code First Leeds', 'Engineer of the Year', 'Paved Roads',
      'Distributed Systems', 'Dutch - Fluent', 'Fell running', 'Priyanka Valdés', 'Patents', 'Rolling deploy coordinator', 'Speaking']) {
      expect(text, words).toContain(words);
    }
    const moved = textOf(
      renderPreviewDocument({ ...all, sectionOrder: ['custom:cs-9f8e7d6c', 'custom:cs-1a2b3c4d'] }, template, skillLibrary()).html,
    );
    expect(moved.indexOf('Speaking')).toBeLessThan(moved.indexOf('Patents'));
  });

  it('ATS templates (no macro) leave the extra kinds out', () => {
    const text = textOf(renderPreviewDocument(fixture('all-kinds'), templateStore().get('ats-modern-sans')!, skillLibrary()).html);
    expect(text).not.toContain('kubelint');
    expect(text).toContain('Certified Kubernetes Administrator');
  });
});

describe('render data', () => {
  it('prints only http(s) links, shortened for display', () => {
    const unicode = fixture('unicode-links');
    for (const template of templateStore().list()) {
      const html = renderPreviewDocument(unicode, template, skillLibrary()).html;
      expect(html).not.toMatch(/href="(?:javascript|data|java)/i);
      expect(html).not.toContain('<script');
    }
    const html = renderPreviewDocument(unicode, templateStore().get('default')!, skillLibrary()).html;
    expect(html).toContain('href="https://www.example.com:8080/path?q&#x3D;1&amp;r&#x3D;2#frag"');
    expect(html).toContain('example.com/path?q&#x3D;1&amp;r&#x3D;2#frag');
  });

  it('sanitises the headline for ATS and falls back to the latest role', () => {
    const html = textOf(renderPreviewDocument(fixture('unicode-links'), templateStore().get('default')!, skillLibrary()).html);
    expect(html).toContain('Sénior Engineer Platform & Data R&D (C#/C++) Scale b bold /b 100');
    const untitled = normalizeResumeDocument({ title: '' }, fixture('classic-six'));
    expect(textOf(renderPreviewDocument(untitled, templateStore().get('default')!, skillLibrary()).html)).toContain('Senior Backend Engineer');
    expect(textOf(renderPreviewDocument(fixture('minimal'), templateStore().get('default')!, skillLibrary()).html)).toContain('Professional');
  });

  it('clamps a long role description near 1,200 characters at a sentence', () => {
    const html = textOf(renderPreviewDocument(fixture('two-page'), templateStore().get('default')!, skillLibrary()).html);
    expect(html).toContain('Sentence 7 of a deliberately long role description');
    expect(html).not.toContain('Sentence 8 of a deliberately long role description');
  });

  it("prints contact.website (the portfolio link) on the ATS templates", () => {
    const html = renderPreviewDocument(fixture('all-kinds'), templateStore().get('ats-classic-serif')!, skillLibrary()).html;
    expect(html).toContain('imogen.example.dev');
  });
});

describe('documents', () => {
  it('the print document has neither the CSP meta nor the preview chrome', () => {
    const { html, templateId, pageBox } = renderResumePrintHtml({
      document: fixture('classic-six'),
      templates: templateStore(),
      skills: skillLibrary(),
    });
    expect(templateId).toBe('default');
    expect(html).not.toContain('Content-Security-Policy');
    expect(html).not.toContain('resume-preview-page');
    expect(pageBox.margin.top).toBe('0.3in');
  });

  it('puts the CSP meta right after a leading doctype, and first otherwise', () => {
    const preview = renderPreviewDocument(fixture('minimal'), templateStore().get('default')!, skillLibrary()).html;
    expect(preview.startsWith(`<!DOCTYPE html>${CSP_META}`)).toBe(true);
    const withCss = renderPreviewDocument(fixture('minimal'), templateStore().get('navy-rule')!, skillLibrary()).html;
    expect(withCss.startsWith(CSP_META)).toBe(true);
  });

  it('mirrors the shrink of a Letter page onto A4 in the preview chrome', () => {
    const { html, page } = renderPreviewDocument(fixture('minimal'), templateStore().get('charcoal-sidebar')!, skillLibrary());
    expect(page).toEqual({ widthPx: 794, heightPx: 1123, contentHeightPx: 1028 });
    expect(html).toMatch(/transform: translateY\(\d+\.\d\dpx\) scale\(0\.97304\)/);
  });

  it('the DOCX layout prints the sections the PDF prints, in order', () => {
    const html = renderResumeDocxHtml(fixture('all-kinds'), templateStore().get('default')!, skillLibrary());
    const text = textOf(html);
    expect(text).toContain('Imogen Achterberg');
    expect(text.indexOf('PROFESSIONAL SUMMARY')).toBeLessThan(text.indexOf('PROFESSIONAL EXPERIENCE'));
    expect(text).toContain('PATENTS');
    const offSwitches = renderResumeDocxHtml(withSettings(fixture('classic-six'), 'categorized', false, false), templateStore().get('default')!, skillLibrary());
    expect(textOf(offSwitches)).not.toContain('Incident command');
    const ats = renderResumeDocxHtml(fixture('all-kinds'), templateStore().get('ats-modern-sans')!, skillLibrary());
    expect(textOf(ats)).not.toContain('kubelint');
  });

  it('bounds the compile cache', () => {
    const template = templateStore().get('default')!;
    for (let index = 0; index < COMPILE_CACHE_SIZE + 10; index += 1) {
      const document = normalizeResumeDocument(
        { customSections: [{ key: `cs-${index.toString(16).padStart(8, '0')}`, title: 'X', entries: [] }] },
        fixture('minimal'),
      );
      renderPreviewDocument(document, template, skillLibrary());
    }
    expect(compileCacheSize()).toBeLessThanOrEqual(COMPILE_CACHE_SIZE);
  });
});

describe('the preview request', () => {
  it('draws the requested template, else the resume own, else default', () => {
    const own = normalizeResumeDocument({ preferredTemplate: 'navy-gold' }, fixture('minimal'));
    const store = templateStore();
    expect(renderResumePreview({ document: own, templates: store, skills: skillLibrary() }).templateId).toBe('navy-gold');
    expect(renderResumePreview({ document: own, templates: store, templateId: 'forest-chips', skills: skillLibrary() }).templateId).toBe('forest-chips');
    const gone = normalizeResumeDocument({ preferredTemplate: 'retired' }, fixture('minimal'));
    expect(renderResumePreview({ document: gone, templates: store, skills: skillLibrary() }).templateId).toBe('default');
  });

  it('fills empty fields from the sample person and says which', () => {
    const empty = normalizeResumeDocument({});
    const preview = renderResumePreview({ document: empty, templates: templateStore(), skills: skillLibrary(), sample: sampleResume() });
    expect(preview.sampled).toEqual(['name', 'title', 'email', 'phone', 'location', 'linkedin', 'summary', 'experience', 'education', 'skills']);
    expect(textOf(preview.html)).toContain('Maren Kowalczyk-Hart');
    const typed = normalizeResumeDocument({ name: 'Ada Typed', resumeSettings: { includeStrengths: true } });
    const mixed = renderResumePreview({ document: typed, templates: templateStore(), skills: skillLibrary(), sample: sampleResume() });
    expect(mixed.sampled).not.toContain('name');
    expect(mixed.sampled).toContain('strengths');
    expect(textOf(mixed.html)).toContain('Ada Typed');
    const without = renderResumePreview({ document: empty, templates: templateStore(), skills: skillLibrary(), sample: null });
    expect(without.sampled).toEqual([]);
  });

  it('a switch on, on a template without the section, is not sampled', () => {
    const doc = normalizeResumeDocument({ resumeSettings: { includeStrengths: true, includeSoftSkills: true } });
    const preview = renderResumePreview({ document: doc, templates: templateStore(), templateId: 'burgundy-rule', skills: skillLibrary(), sample: sampleResume() });
    expect(preview.sampled).not.toContain('strengths');
    expect(preview.sampled).not.toContain('softSkills');
  });

  it('the template gallery draws the sample in the requested layout', () => {
    const template = templateStore().get('classic-serif')!;
    const grouped = renderTemplatePreview(template, sampleResume(), { layout: 'categorized', softSkills: true }, skillLibrary());
    expect(textOf(grouped.html)).toContain('Mentoring');
    expect(textOf(grouped.html)).toContain('Databases and Storage');
    const plain = renderTemplatePreview(template, sampleResume(), { layout: 'flat' }, skillLibrary());
    expect(textOf(plain.html)).not.toContain('Databases and Storage');
    expect(textOf(plain.html)).not.toContain('Calm under pressure');
  });
});

describe('fixtures', () => {
  it('are normalised resume documents', () => {
    for (const name of FIXTURE_NAMES) {
      const document = fixture(name);
      expect(normalizeResumeDocument(document), name).toEqual(document);
    }
  });

  it('use fictional people only (example domains)', () => {
    for (const name of FIXTURE_NAMES) {
      const email = fixture(name).contact.email;
      expect(email, name).toMatch(/@example\.(com|org|es)$/);
    }
    const sample: ResumeDocument = sampleResume();
    expect(sample.contact.email).toMatch(/@example\.com$/);
  });
});
