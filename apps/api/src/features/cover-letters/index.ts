import type { Feature } from '../../core/feature';
import { generateFromTemplate, generateWithoutTemplate } from './generate';
import { createCoverLettersRouter } from './router';

// Cover letters: CRUD, generation, import, preview, export. Owned by work package C.
// AI kinds: `cover_letter` (no template, or an empty one) and `template_fill` (a template's AI placeholders).
export const coverLettersFeature: Feature = {
  name: 'cover-letters',
  services: (deps) => {
    const ai = deps.services.ai;
    if (!ai) return;
    ai.registerHandler('cover_letter', (input, ctx) => generateWithoutTemplate(deps, input, ctx));
    ai.registerHandler('template_fill', (input, ctx) => generateFromTemplate(deps, input, ctx));
  },
  routes: [{ path: '/api/cover-letters', router: createCoverLettersRouter }],
};
