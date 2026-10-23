import { Router } from 'express';
import { IdParam, ResumeTemplatePreviewQuerySchema, type ResumeTemplateSummary } from '@tailorit/shared';
import { PREVIEW_CONTENT_SECURITY_POLICY, renderTemplatePreview } from '@tailorit/render';
import { requireUser } from '../../core/auth/guards';
import type { AppDeps } from '../../core/context';
import { parseInput } from '../../core/http/validate';
import { getResumeEngine, requireTemplate } from '../resumes/engine';

// Resume templates: free_tailor's 26 template files, reused as data and drawn by packages/render. Owned by work
// package R1 (see docs/ARCHITECTURE.md §4).

/** Mounted at /api/resume-templates. */
export function createResumeTemplatesRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireUser);

  /** The light list: no markup, the capabilities read off each template's markup. */
  router.get('/', (_req, res) => {
    const items: ResumeTemplateSummary[] = getResumeEngine(deps)
      .templates.list()
      .map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        category: template.category,
        supportsSoftSkills: template.supportsSoftSkills,
        supportsStrengths: template.supportsStrengths,
        printsSections: [...template.printsSections],
        nativeSectionOrder: [...template.nativeSectionOrder],
      }));
    res.json({ items, total: items.length });
  });

  /**
   * A template drawn with the sample person, as a whole HTML page for an iframe `src` (same origin through the Next
   * proxy). The page may run nothing and fetch nothing: the policy goes in the header and in the document.
   */
  router.get('/:id/preview', (req, res) => {
    const template = requireTemplate(deps, parseInput(IdParam, req.params.id, 'template id'));
    const query = parseInput(ResumeTemplatePreviewQuerySchema, req.query, 'query');
    const engine = getResumeEngine(deps);
    const { html } = renderTemplatePreview(
      template,
      engine.sample,
      { layout: query.layout, softSkills: query.softSkills === true, strengths: query.strengths === true },
      engine.library,
    );
    res.setHeader('Content-Security-Policy', PREVIEW_CONTENT_SECURITY_POLICY);
    res.type('html').send(html);
  });

  return router;
}
