import { requireAi } from '../../ai/index';
import type { Feature } from '../../core/feature';
import { runEntryBullets } from './ai/entryBullets';
import { runResumeImport } from './ai/resumeImport';
import { getResumeEngine } from './engine';
import { createResumeBulletsRouter, createResumesRouter } from './router';

// Resumes: CRUD, upload/import, preview, thumbnails, export, and the AI tasks `resume_import` (an editable copy of an
// upload) and `entry_bullets` (Write with AI). Owned by work package R1.
export const resumesFeature: Feature = {
  name: 'resumes',
  services: (deps) => {
    getResumeEngine(deps);
    const ai = deps.services.ai ? requireAi(deps) : null;
    ai?.registerHandler('resume_import', (input, ctx) => runResumeImport(deps, input, ctx));
    ai?.registerHandler('entry_bullets', (input, ctx) => runEntryBullets(input, ctx));
  },
  routes: [
    { path: '/api/resumes', router: createResumesRouter },
    { path: '/api/ai/resume-bullets', router: createResumeBulletsRouter },
  ],
};
