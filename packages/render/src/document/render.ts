import { createHash } from 'node:crypto';
import { documentForTemplate, type ResumeDocument } from '@tailorit/shared/resume';
import { compileChoicesOf, prepareRenderData, type RenderData } from '../gate/renderData';
import { compilableMarkup, type CompileChoices } from '../markup/normalize';
import { withSampleDefaults } from '../sample/sample';
import type { SkillIndex } from '../skills/library';
import { previewPage, type TemplatePageBox } from '../templates/pageBox';
import type { ResumeTemplate, TemplateStore } from '../templates/store';
import { assembleDocument, previewPageChrome, withContentSecurityPolicy } from './assemble';
import { handlebars } from './handlebars';
import { shortenLinkedInAnchors, splitSkillCategoryLines } from './postRender';

// Rendering a resume with a template: render data -> compiled markup (cached) -> Handlebars -> post-render fixes ->
// a document. The preview, the thumbnail, the PDF and the template gallery all come through here.

export type RenderWarning = (message: string) => void;

const warned = new Set<string>();
let warningSink: RenderWarning = (message) => console.warn(`[render] ${message}`);

/** Where once-per-process template warnings go (the API passes its logger). */
export function setRenderWarningSink(sink: RenderWarning): void {
  warningSink = sink;
}

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  warningSink(message);
}

type Compiled = (data: unknown) => string;

/** Compiled templates, newest last; keyed by the choices and the markup itself. */
const compiled = new Map<string, Compiled>();
export const COMPILE_CACHE_SIZE = 128;

function markupKey(html: string): string {
  return createHash('sha1').update(html).digest('hex');
}

function compile(template: Pick<ResumeTemplate, 'id' | 'name' | 'htmlContent'>, choices: CompileChoices): Compiled {
  if (typeof template.htmlContent !== 'string' || !template.htmlContent.trim()) {
    throw new Error(`Template "${template.name || template.id}" has no markup.`);
  }
  const key = [
    choices.layout,
    choices.softSkills ? 1 : 0,
    choices.strengths ? 1 : 0,
    (choices.sectionOrder ?? []).join(','),
    choices.customKeys.join(','),
    markupKey(template.htmlContent),
  ].join('|');
  const hit = compiled.get(key);
  if (hit) {
    compiled.delete(key);
    compiled.set(key, hit);
    return hit;
  }
  const fresh = handlebars.compile(compilableMarkup(template.htmlContent, choices, template.id, warnOnce)) as Compiled;
  compiled.set(key, fresh);
  if (compiled.size > COMPILE_CACHE_SIZE) {
    const oldest = compiled.keys().next().value;
    if (oldest !== undefined) compiled.delete(oldest);
  }
  return fresh;
}

/** How many compiled templates are cached (tests). */
export function compileCacheSize(): number {
  return compiled.size;
}

/** The template body rendered against render data, with the post-render fixes. */
export function renderTemplateBody(template: ResumeTemplate, data: RenderData): string {
  const delegate = compile(template, compileChoicesOf(data));
  return splitSkillCategoryLines(shortenLinkedInAnchors(delegate(data)), data);
}

/** A resume as its template draws it: a switch the template has no section for counts as off. */
export function fitToTemplate(document: ResumeDocument, template: ResumeTemplate): ResumeDocument {
  return documentForTemplate(document, template);
}

/** The document the PDF prints: the template's stylesheet and rendered markup, no preview chrome. */
export function renderPrintDocument(document: ResumeDocument, template: ResumeTemplate, skills: SkillIndex): string {
  const data = prepareRenderData(fitToTemplate(document, template), skills);
  return assembleDocument(template.cssContent, renderTemplateBody(template, data));
}

export interface PreviewPage {
  widthPx: number;
  heightPx: number;
  contentHeightPx: number;
}

/**
 * A resume rendered for the browser: the print document behind a Content-Security-Policy meta, plus page chrome
 * that sizes it like the printed page. `page` is the sheet to size the frame to, and roughly where page breaks fall.
 */
export function renderPreviewDocument(
  document: ResumeDocument,
  template: ResumeTemplate,
  skills: SkillIndex,
): { html: string; page: PreviewPage } {
  const printed = renderPrintDocument(document, template, skills);
  return {
    html: `${withContentSecurityPolicy(printed)}${previewPageChrome(template.pageBox)}`,
    page: previewPage(template.pageBox),
  };
}

export interface ResumePreview {
  html: string;
  /** The template actually drawn (it differs when the requested or preferred one is not offered). */
  templateId: string;
  page: PreviewPage;
  /** The fields filled from the sample person. */
  sampled: string[];
}

export interface RenderRequest {
  /** A normalised resume (normalizeResumeDocument). */
  document: ResumeDocument;
  templates: TemplateStore;
  /** Overrides the document's own `preferredTemplate`. */
  templateId?: string | null;
  skills: SkillIndex;
}

function chooseTemplate(request: RenderRequest): ResumeTemplate {
  const template = request.templates.resolve(request.templateId, request.document.preferredTemplate);
  if (!template) throw new Error('No resume template is available.');
  return template;
}

/**
 * The editor's live preview (and the thumbnails, with no sample): the template resolved (requested, else the
 * resume's own, else `default`), the resume read through it, empty fields filled from `sample` when one is given.
 */
export function renderResumePreview(request: RenderRequest & { sample?: ResumeDocument | null }): ResumePreview {
  const template = chooseTemplate(request);
  const fitted = fitToTemplate(request.document, template);
  const { document, sampled } = request.sample ? withSampleDefaults(fitted, request.sample) : { document: fitted, sampled: [] };
  const { html, page } = renderPreviewDocument(document, template, request.skills);
  return { html, templateId: template.id, page, sampled };
}

/** What the PDF prints, and the page box to print it with. */
export function renderResumePrintHtml(request: RenderRequest): { html: string; templateId: string; pageBox: TemplatePageBox } {
  const template = chooseTemplate(request);
  return { html: renderPrintDocument(request.document, template, request.skills), templateId: template.id, pageBox: template.pageBox };
}

/** The template gallery's page: a template drawn with the sample person, in a layout and with the two switches. */
export function renderTemplatePreview(
  template: ResumeTemplate,
  sample: ResumeDocument,
  choices: { layout?: 'categorized' | 'flat'; softSkills?: boolean; strengths?: boolean },
  skills: SkillIndex,
): { html: string; page: PreviewPage } {
  const document: ResumeDocument = {
    ...sample,
    preferredTemplate: template.id,
    resumeSettings: {
      technicalSkillsLayout: choices.layout ?? 'categorized',
      includeSoftSkills: choices.softSkills === true,
      includeStrengths: choices.strengths === true,
    },
  };
  return renderPreviewDocument(document, template, skills);
}
