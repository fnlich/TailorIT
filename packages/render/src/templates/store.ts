import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { SectionKind, TemplateCategory } from '@tailorit/shared/resume';
import { inferNativeSectionOrder, printedSections, templateCapabilities } from './describe';
import { resolvePageBox, type TemplatePageBox } from './pageBox';

// The resume templates: free_tailor's 26 JSON files, reused as data (apps/api/static/resume-templates). Each is
// read once and described from its own markup. Files are only read through `loadTemplateDirectory`, so the rest of
// the engine works on values a caller may build any way it likes (tests do).

/** The template every install has and every fallback ends at. */
export const FALLBACK_TEMPLATE_ID = 'default';

const BUILT_IN_CATEGORIES = new Set(['simple', 'modern', 'creative']);

export interface ResumeTemplate {
  id: string;
  name: string;
  description: string;
  /** The chooser's filter: a built-in's own category; the uploaded (ATS) files are 'ats'. */
  category: TemplateCategory;
  /** Built-ins carry the section markers and the extra-sections macro; the uploaded ATS files carry neither. */
  origin: 'built-in' | 'uploaded';
  htmlContent: string;
  cssContent: string;
  createdAt: string;
  updatedAt: string;
  supportsSoftSkills: boolean;
  supportsStrengths: boolean;
  printsSections: Array<SectionKind | 'custom'>;
  nativeSectionOrder: string[];
  pageBox: TemplatePageBox;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** A template from one file's parsed JSON, described; null when it has no id or no markup. */
export function readTemplate(json: unknown, fileName = ''): ResumeTemplate | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const source = json as Record<string, unknown>;
  const id = text(source.id) || basename(fileName, '.json');
  const htmlContent = typeof source.htmlContent === 'string' ? source.htmlContent : '';
  if (!id || !htmlContent.trim()) return null;
  const cssContent = typeof source.cssContent === 'string' ? source.cssContent : '';
  const uploaded = text(source.source) !== '' || !BUILT_IN_CATEGORIES.has(text(source.category));
  const capabilities = templateCapabilities(htmlContent);
  return {
    id,
    name: text(source.name) || id,
    description: text(source.description),
    category: uploaded ? 'ats' : (text(source.category) as TemplateCategory),
    origin: uploaded ? 'uploaded' : 'built-in',
    htmlContent,
    cssContent,
    createdAt: text(source.createdAt),
    updatedAt: text(source.updatedAt),
    ...capabilities,
    printsSections: printedSections(htmlContent),
    nativeSectionOrder: inferNativeSectionOrder(htmlContent),
    pageBox: resolvePageBox({ htmlContent, cssContent }),
  };
}

/** Every `*.json` template in `dir` (README and unreadable files skipped; a broken file is reported to `onSkip`). */
export function loadTemplateDirectory(dir: string, onSkip?: (file: string, reason: string) => void): ResumeTemplate[] {
  const templates: ResumeTemplate[] = [];
  for (const file of readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.json')).sort()) {
    try {
      const template = readTemplate(JSON.parse(readFileSync(join(dir, file), 'utf8')), file);
      if (template) templates.push(template);
      else onSkip?.(file, 'it has no id or no htmlContent');
    } catch (error) {
      onSkip?.(file, error instanceof Error ? error.message : String(error));
    }
  }
  return templates;
}

export interface TemplateStore {
  /** Built-ins first, then the ATS set; each newest first (as free_tailor lists them). */
  list(): readonly ResumeTemplate[];
  get(id: string | null | undefined): ResumeTemplate | null;
  /**
   * The template a resume is drawn with: the requested one, else its own preferred one, else `default`, the first
   * of those that exists; else the first template there is; null only for an empty store.
   */
  resolve(requested?: string | null, preferred?: string | null): ResumeTemplate | null;
}

function timeOf(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export function createTemplateStore(templates: readonly ResumeTemplate[]): TemplateStore {
  const byId = new Map<string, ResumeTemplate>();
  for (const template of templates) if (!byId.has(template.id)) byId.set(template.id, template);
  const ordered = [...byId.values()].sort(
    (a, b) =>
      Number(a.origin === 'uploaded') - Number(b.origin === 'uploaded') ||
      timeOf(b.updatedAt) - timeOf(a.updatedAt) ||
      a.id.localeCompare(b.id),
  );
  const get = (id: string | null | undefined) => (typeof id === 'string' ? (byId.get(id.trim()) ?? null) : null);
  return {
    list: () => ordered,
    get,
    resolve(requested, preferred) {
      for (const candidate of [requested, preferred, FALLBACK_TEMPLATE_ID]) {
        const template = get(candidate);
        if (template) return template;
      }
      return ordered[0] ?? null;
    },
  };
}
