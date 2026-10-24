import { requireAi } from '../../ai/index';
import type { Feature } from '../../core/feature';
import { runEntryBullets } from './ai/entryBullets';
import { runResumeImport } from './ai/resumeImport';
import { createResumeAnalysisBackfill } from './analysis/backfill';
import { createResumeAnalysisBacklog } from './analysis/backlog';
import { runResumeAnalysis } from './analysis/task';
import { getResumeEngine } from './engine';
import { createResumeBulletsRouter, createResumesRouter } from './router';

// Resumes: CRUD, upload/import, preview, thumbnails, export, what TailorIT reads from each resume, and the AI tasks
// `resume_import` (an editable copy of an upload), `entry_bullets` (Write with AI) and `resume_analysis` (Claude's
// reading of an upload). Owned by work package R1 (resume analysis: WP3).
export const resumesFeature: Feature = {
  name: 'resumes',
  services: (deps) => {
    getResumeEngine(deps);
    const ai = deps.services.ai ? requireAi(deps) : null;
    ai?.registerHandler('resume_import', (input, ctx) => runResumeImport(deps, input, ctx));
    ai?.registerHandler('entry_bullets', (input, ctx) => runEntryBullets(input, ctx));
    // Always registered: AI_RESUME_ANALYSIS=off (or AI off, or no background slot) only keeps the backlog idle.
    ai?.registerHandler('resume_analysis', (input, ctx) => runResumeAnalysis(deps, input, ctx));
    deps.services.resumeAnalysis = {
      backlog: createResumeAnalysisBacklog(deps),
      backfill: createResumeAnalysisBackfill(deps),
    };
  },
  routes: [
    { path: '/api/resumes', router: createResumesRouter },
    { path: '/api/ai/resume-bullets', router: createResumeBulletsRouter },
  ],
  // The readings' workers start only here (never before the server listens; tests and CLI commands do not start them).
  start: (deps) => {
    const workers = deps.services.resumeAnalysis;
    if (!workers) return;
    const stops = [workers.backfill.start(), workers.backlog.start()];
    return async () => {
      for (const stop of stops) await stop();
    };
  },
};
