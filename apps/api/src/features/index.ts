import type { Feature } from '../core/feature';
import { authFeature } from './auth/index';
import { meFeature } from './me/index';
import { filesFeature } from './files/index';
import { adminUsersFeature } from './admin-users/index';
import { aiTasksFeature } from './ai-tasks/index';
import { adminAiFeature } from './admin-ai/index';
import { resumesFeature } from './resumes/index';
import { resumeTemplatesFeature } from './resume-templates/index';
import { skillsFeature } from './skills/index';
import { coverLettersFeature } from './cover-letters/index';
import { coverLetterTemplatesFeature } from './cover-letter-templates/index';
import { jobAnalysisFeature } from './job-analysis/index';
import { ingestFeature } from './ingest/index';
import { jobsFeature } from './jobs/index';
import { applicationsFeature } from './applications/index';
import { resumeMatchFeature } from './resume-match/index';
import { resumeZipFeature } from './resume-zip/index';
import { demoFeature } from './demo/index';

/**
 * Every feature of the API, in setup order: services are created in this order (AI before the features that queue
 * AI work), then all routers are mounted, then background work starts. Work packages edit only their own folder.
 */
export const FEATURES: Feature[] = [
  authFeature,
  meFeature,
  filesFeature,
  adminUsersFeature,
  aiTasksFeature,
  adminAiFeature,
  resumesFeature,
  resumeTemplatesFeature,
  skillsFeature,
  coverLettersFeature,
  coverLetterTemplatesFeature,
  jobAnalysisFeature,
  ingestFeature,
  jobsFeature,
  // Before the tracker: its /api/applications/:id routes must never take /api/applications/resume-zip/...
  resumeZipFeature,
  applicationsFeature,
  resumeMatchFeature,
  demoFeature,
];
