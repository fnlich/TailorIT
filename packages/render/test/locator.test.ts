import { describe, expect, it } from 'vitest';
import {
  createSkillIndex,
  createTemplateStore,
  externalUrl,
  externalUrlDisplay,
  findSections,
  inferNativeSectionOrder,
  inferSkillCategory,
  loadTemplateDirectory,
  locateSections,
  normalizeTemplateMarkup,
  renderPreviewDocument,
  renderSkillCategory,
  safeContactLink,
  sectionLocator,
  setRenderWarningSink,
  withExtraSkills,
  type CompileChoices,
} from '../src/index';
import { findClosingTag, nextClassedElement, sectionGuardAround, withGuards } from '../src/locator/markup';
import { sectionLoops } from '../src/locator/loops';
import { FIXTURES_DIR, fixture, skillLibrary, templateStore, textOf, withSettings } from './helpers';
import { join } from 'node:path';

const slice = (html: string, span: { start: number; end: number } | null | undefined) => (span ? html.slice(span.start, span.end) : null);

describe('markup reading', () => {
  it('finds the closing tag of the element, counting nested ones, case-insensitively', () => {
    const html = '<div a><DIV><br/><div/></div></Div>tail';
    expect(html.slice(0, findClosingTag(html, 'div', '<div a>'.length))).toBe('<div a><DIV><br/><div/></div></Div>');
    expect(findClosingTag('<div>never', 'div', 5)).toBe(-1);
  });

  it('matches a class as a whole token, on the tag that carries it, never in a stylesheet', () => {
    const html = '<style>.section-skills{}</style><div class="section-skills-x">x</div><p class="a section-skills b">y</p>';
    expect(slice(html, nextClassedElement(html, 'section-skills', 0))).toBe('<p class="a section-skills b">y</p>');
  });

  it('takes a guard written right around a span, both halves or neither, and stacked guards', () => {
    const html = 'x{{#if strengths.length}} {{#if strengths}}<div>S</div>{{/if}} {{/if}}y';
    const start = html.indexOf('<div>');
    const end = html.indexOf('</div>') + 6;
    expect(slice(html, sectionGuardAround(html, start, end, 'strengths'))).toBe('{{#if strengths}}<div>S</div>{{/if}}');
    expect(slice(html, withGuards(html, { start, end }, ['strengths']))).toBe(
      '{{#if strengths.length}} {{#if strengths}}<div>S</div>{{/if}} {{/if}}',
    );
    expect(sectionGuardAround('{{#if strengths}}<div>S</div>', 17, 29, 'strengths')).toBeNull();
  });

  it('finds loops (nested ones counted) and inline prints outside loops and tags', () => {
    const html = '{{#each skills}}{{#each x}}{{/each}}{{/each}} {{join skills ", "}} <i title="{{join skills}}"></i>';
    const found = sectionLoops(html, 'skills').map((span) => html.slice(span.start, span.end));
    expect(found).toEqual(['{{#each skills}}{{#each x}}{{/each}}{{/each}}', '{{join skills ", "}}']);
  });
});

describe('finding sections', () => {
  it('Stage A: by class and data-section, widened over their guards', () => {
    const html =
      '<main>{{#if strengths.length}}<section class="section-strengths"><h2>S</h2>{{#each strengths}}{{title}}{{/each}}</section>{{/if}}' +
      '<div data-section="soft-skills"><h2>Soft</h2>{{join softSkills ", "}}</div></main>';
    expect(findSections(html, sectionLocator('strengths')).map((span) => html.slice(span.start, span.start + 24))).toEqual([
      '{{#if strengths.length}}',
    ]);
    expect(slice(html, findSections(html, sectionLocator('softSkills'))[0])).toBe(
      '<div data-section="soft-skills"><h2>Soft</h2>{{join softSkills ", "}}</div>',
    );
  });

  it('Stage B: an unmarked section is its heading and list, never the column around them', () => {
    const html =
      '<div class="side"><img src="data:x"><p>{{contact.email}}</p><h3>Strengths</h3><hr>' +
      '<ul>{{#each strengths}}<li>{{title}}</li>{{/each}}</ul></div>';
    const [span] = findSections(html, sectionLocator('strengths'));
    expect(slice(html, span)).toBe('<h3>Strengths</h3><hr><ul>{{#each strengths}}<li>{{title}}</li>{{/each}}</ul>');
    expect(findSections(html, sectionLocator('strengths'), 'marked')).toEqual([]);
  });

  it('Stage B: an element holding only the heading and the list is the section', () => {
    const html = '<aside><section><h2>Key Strengths</h2>{{#each strengths}}<p>{{title}}</p>{{/each}}</section><p>{{summary}}</p></aside>';
    expect(slice(html, findSections(html, sectionLocator('strengths'))[0])).toBe(
      '<section><h2>Key Strengths</h2>{{#each strengths}}<p>{{title}}</p>{{/each}}</section>',
    );
  });

  it('locates every section once, never nested, generated blocks by their comments', () => {
    const html =
      '<div class="section-summary">{{summary}}</div><!--xs:projects--><div class="section-projects">{{#each projects}}{{/each}}</div><!--/xs:projects-->';
    expect(locateSections(html).map((section) => section.ref)).toEqual(['summary', 'projects']);
  });

  it("reads each template's own order, the macro's kinds at the macro", () => {
    expect(inferNativeSectionOrder(templateStore().get('default')!.htmlContent)).toEqual([
      'summary',
      'experience',
      'certifications',
      'projects',
      'volunteering',
      'awards',
      'publications',
      'courses',
      'languages',
      'interests',
      'references',
      'strengths',
      'skills',
      'softSkills',
      'education',
    ]);
    expect(inferNativeSectionOrder(templateStore().get('ats-education-first')!.htmlContent).slice(0, 2)).toEqual(['summary', 'education']);
  });
});

describe('compile-time markup', () => {
  const choices = (over: Partial<CompileChoices> = {}): CompileChoices => ({
    layout: 'categorized',
    softSkills: false,
    strengths: false,
    sectionOrder: null,
    customKeys: [],
    ...over,
  });
  const quiet = () => undefined;

  it('expands the macro with the hash classes and one block per custom section', () => {
    const html = '<body>{{> extra-sections sectionClass="sec" headingClass="h" headingTextClass="ht"}}</body>';
    const out = normalizeTemplateMarkup(html, choices({ customKeys: ['cs-0000abcd'] }), 'all', 't', quiet);
    expect(out).toContain('<!--xs:projects-->{{#if projects.length}}<div class="sec section-projects" data-section="projects">');
    expect(out).toContain('<div class="xs-heading h"><span class="ht">Projects</span></div>');
    expect(out).toContain('{{#with (lookup @root.customSectionsByKey "cs-0000abcd")}}');
    expect(out).toContain('<style id="xs-style">');
  });

  it('renames Hard Skills, rewrites per-skill loops for Grouped, guards empty headings and descriptions', () => {
    const html = '<h2>Hard Skills</h2><ul>{{#each hardSkills}}<li>{{this}}</li>{{/each}}</ul><div class="d">{{description}}</div>';
    const out = normalizeTemplateMarkup(html, choices(), 'all', 't', quiet);
    expect(out).toContain('<h2>Technical Skills</h2>');
    expect(out).toContain('{{#each skillCategories}}<li>{{#if category}}<strong>{{category}}</strong><br>{{/if}}{{join skills ", "}}</li>{{/each}}');
    expect(out).toContain('{{#if description}}<div class="d">{{description}}</div>{{/if}}');
  });

  it('falls back to drawing every section in place when cutting one would break the template', () => {
    const messages: string[] = [];
    setRenderWarningSink((message) => messages.push(message));
    const synthetic = createTemplateStore(loadTemplateDirectory(join(FIXTURES_DIR, 'templates')));
    const template = synthetic.get('x-fallback-misnested')!;
    const html = renderPreviewDocument(withSettings(fixture('classic-six'), 'categorized', false, false), template, skillLibrary()).html;
    expect(textOf(html)).toContain('Rowan Delacroix-Imai');
    expect(textOf(html)).toContain('Soft Skills');
    expect(messages.some((message) => message.includes('x-fallback-misnested'))).toBe(true);
    setRenderWarningSink(() => undefined);
  });
});

describe('links', () => {
  it('keeps only http(s), adds https to a bare host, refuses schemes and control characters', () => {
    expect(externalUrl('linkedin.com/in/x')).toBe('https://linkedin.com/in/x');
    expect(externalUrl('HTTP://Example.com/a')).toBe('HTTP://Example.com/a');
    expect(externalUrl('www.example.com:8080/x')).toBe('https://www.example.com:8080/x');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'mailto:a@b.c', 'java\tscript:alert(1)', 'https://javascript:alert(1)', '']) {
      expect(externalUrl(bad), bad).toBe('');
    }
    expect(externalUrlDisplay('https://www.linkedin.com/in/x/')).toBe('linkedin.com/in/x');
    expect(safeContactLink(' github.com/me ')).toBe('github.com/me');
    expect(safeContactLink('javascript:x')).toBe('');
  });
});

describe('the skill library', () => {
  it('matches by trimmed, case- and space-folded name and returns the library spelling', () => {
    const index = createSkillIndex([
      { skill: 'GitHub Actions', category: 'DevOps and CI/CD', priority: 5 },
      { skill: 'github actions', category: 'Testing and Quality', priority: 1 },
      { skill: 'Oddity', category: 'not a heading' },
    ]);
    expect(index.get('  github   ACTIONS ')).toMatchObject({ skill: 'GitHub Actions', category: 'DevOps and CI/CD' });
    expect(index.get('oddity')!.category).toBe('Frameworks and Libraries');
    expect(index.size).toBe(2);
  });

  it("lays a person's own skills under the library, never over it", () => {
    const own = withExtraSkills(skillLibrary(), [
      { skill: 'Kibana', category: 'Observability and Monitoring' },
      { skill: 'Python', category: 'Security' },
    ]);
    expect(own.get('kibana')!.category).toBe('Observability and Monitoring');
    expect(own.get('Python')!.category).toBe('Languages');
  });

  it('infers a heading for a skill the library lacks', () => {
    expect(inferSkillCategory('Golang')).toBe('Languages');
    expect(inferSkillCategory('Vector search')).toBe('AI/ML & Data Science');
    expect(inferSkillCategory('Kibana dashboards')).toBe('Observability and Monitoring');
    expect(inferSkillCategory('Pulumi')).toBe('DevOps and CI/CD');
    expect(inferSkillCategory('Something new')).toBe('Frameworks and Libraries');
  });

  it("files a resume's unplaced skill by the render contract's fallback rules", () => {
    expect(renderSkillCategory('Postgres replication', skillLibrary())).toBe('Databases and Storage');
    expect(renderSkillCategory('golang tooling', skillLibrary())).toBe('Languages');
    expect(renderSkillCategory('Kafka', skillLibrary())).toBe('Data Engineering & Streaming');
    expect(renderSkillCategory('Quantum Widgets', skillLibrary())).toBe('Frameworks and Libraries');
  });
});
