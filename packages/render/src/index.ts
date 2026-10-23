// The resume template engine (work package R1): free_tailor's 26 resume templates rendered by TailorIT's own code,
// honouring the template contract in docs/ARCHITECTURE.md, Appendix B. Pure TypeScript over Handlebars; the only
// file reads are `loadTemplateDirectory` (and whatever JSON a caller reads and hands in).

/** Bumped whenever rendered output changes on purpose (caches keyed on it go stale). */
export const RENDER_ENGINE_VERSION = 1;

export {
  createTemplateStore,
  FALLBACK_TEMPLATE_ID,
  loadTemplateDirectory,
  readTemplate,
  type ResumeTemplate,
  type TemplateStore,
} from './templates/store';
export { printedSections, templateCapabilities, type TemplateCapabilities } from './templates/describe';
export {
  A4_HEIGHT_PX,
  A4_WIDTH_PX,
  FALLBACK_PAGE_MARGIN,
  previewPage,
  resolvePageBox,
  type PageMargin,
  type TemplatePageBox,
} from './templates/pageBox';
export {
  inferNativeSectionOrder,
  locateSections,
  findSections,
  sectionLocator,
  SECTION_LOCATORS,
  type LocatedSection,
  type SectionFinds,
  type SectionLocator,
} from './locator/sections';
export { type MarkupSpan } from './locator/markup';
export { normalizeTemplateMarkup, compilableMarkup, type CompileChoices } from './markup/normalize';
export { expandExtraSectionsMacro } from './markup/extraSections';
export {
  createSkillIndex,
  inferSkillCategory,
  libraryCategory,
  renderSkillCategory,
  skillIndexKey,
  withExtraSkills,
  type SkillIndex,
  type SkillRecord,
} from './skills/library';
export { externalUrl, externalUrlDisplay, safeContactLink } from './gate/links';
export {
  clampRoleDescription,
  compileChoicesOf,
  prepareRenderData,
  sanitizeTitleForAts,
  type RenderData,
} from './gate/renderData';
export { skillGroupsFor, skillLines, type SkillGroup } from './gate/skills';
export { readSampleResume, withSampleDefaults, type SampledDocument } from './sample/sample';
export {
  assembleDocument,
  PREVIEW_CONTENT_SECURITY_POLICY,
  previewPageChrome,
  withContentSecurityPolicy,
} from './document/assemble';
export {
  compileCacheSize,
  COMPILE_CACHE_SIZE,
  fitToTemplate,
  renderPreviewDocument,
  renderPrintDocument,
  renderResumePreview,
  renderResumePrintHtml,
  renderTemplatePreview,
  setRenderWarningSink,
  type PreviewPage,
  type RenderRequest,
  type ResumePreview,
} from './document/render';
export { renderResumeDocxHtml } from './document/docx';
