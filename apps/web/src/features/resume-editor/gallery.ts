import { TEMPLATE_CATEGORIES, TEMPLATE_CATEGORY_LABEL, type TechnicalSkillsLayout, type TemplateCategory } from '@tailorit/shared/resume';
import { NEW_RESUME_HREF } from './api';

/*
 * The template chooser's decisions (free_tailor's lib/resumeGallery.ts, fresh): which filter pills to offer, which
 * templates each shows, the link from a chosen template to the editor and reading that link back.
 */

export type TemplateFilter = 'all' | TemplateCategory;

export const TEMPLATE_FILTER_LABEL: Record<TemplateFilter, string> = { all: 'All Templates', ...TEMPLATE_CATEGORY_LABEL };

/** All Templates, then each category some offered template is filed under (no pill ever shows an empty grid). */
export function templateFilters(templates: ReadonlyArray<{ category: TemplateCategory | null }>): TemplateFilter[] {
  return ['all', ...TEMPLATE_CATEGORIES.filter((category) => templates.some((template) => template.category === category))];
}

export function templatesForFilter<T extends { category: TemplateCategory | null }>(templates: readonly T[], filter: TemplateFilter): T[] {
  return filter === 'all' ? [...templates] : templates.filter((template) => template.category === filter);
}

/** The editor for a new resume on a template: `?template=<id>`, plus `&layout=flat` for Plain. */
export function startResumeHref(templateId: string, layout: TechnicalSkillsLayout = 'categorized'): string {
  const query = new URLSearchParams({ template: templateId });
  if (layout === 'flat') query.set('layout', 'flat');
  return `${NEW_RESUME_HREF}?${query.toString()}`;
}

export interface StartChoice {
  /** '' when started without one (drawn with the default template). */
  templateId: string;
  layout: TechnicalSkillsLayout;
}

/**
 * What /resumes/new's address asks for. Null shows the chooser: no `template` at all, or one the loaded list does not
 * offer. `template=` with nothing after it starts without one. While the list is unknown (`templates` null: loading
 * failed), the address is trusted as it is.
 */
export function readStartChoice(
  params: { template: string | null; layout: string | null },
  templates: ReadonlyArray<{ id: string }> | null,
): StartChoice | null {
  if (params.template === null) return null;
  const layout: TechnicalSkillsLayout = params.layout === 'flat' ? 'flat' : 'categorized';
  const id = params.template.trim();
  if (!id) return { templateId: '', layout };
  if (templates === null) return { templateId: id, layout };
  return templates.some((template) => template.id === id) ? { templateId: id, layout } : null;
}

/** The neighbours of `id` in `list`, for the details dialog's Previous / Next. */
export function neighboursOf<T extends { id: string }>(list: readonly T[], id: string): { previous: T | null; next: T | null } {
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return { previous: null, next: null };
  return { previous: list[index - 1] ?? null, next: list[index + 1] ?? null };
}
