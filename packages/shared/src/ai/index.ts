import { z } from 'zod';
import { IsoDateTime } from '../core/list';

// AI work runs through the local Claude CLI and can take minutes, longer than Next's /api proxy waits. So every AI
// endpoint answers `202 { taskId }` and the page polls GET /api/ai/tasks/:id until the task finishes.

export const AI_TASK_KINDS = ['resume_import', 'entry_bullets', 'job_analysis', 'cover_letter', 'template_fill'] as const;
export type AiTaskKind = (typeof AI_TASK_KINDS)[number];

export const AI_TASK_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type AiTaskStatus = (typeof AI_TASK_STATUSES)[number];

/** The `.env` feature name for per-feature model/effort overrides: AI_MODEL_<FEATURE>, AI_EFFORT_<FEATURE>. */
export const AI_FEATURE_ENV: Record<AiTaskKind, string> = {
  resume_import: 'RESUME_IMPORT',
  entry_bullets: 'BULLETS',
  job_analysis: 'JOB_ANALYSIS',
  cover_letter: 'COVER_LETTER',
  template_fill: 'TEMPLATE_FILL',
};

export const AiTaskAcceptedSchema = z.object({ taskId: z.string() });
export type AiTaskAccepted = z.infer<typeof AiTaskAcceptedSchema>;

export const AiTaskViewSchema = z.object({
  id: z.string(),
  kind: z.enum(AI_TASK_KINDS),
  status: z.enum(AI_TASK_STATUSES),
  /** Feature-specific result (validated by the feature's own schema on the client). Null until succeeded. */
  result: z.unknown().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: IsoDateTime,
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
});
export type AiTaskView = z.infer<typeof AiTaskViewSchema>;

/** Staged progress lines the UI rotates through while a task runs (cover letter copy is Simplify's). */
export const AI_PROGRESS_MESSAGES: Record<AiTaskKind, readonly string[]> = {
  resume_import: ['Reading your resume...', 'Organizing your experience...', 'Opening your new resume...'],
  entry_bullets: ['Writing the bullets...'],
  job_analysis: ['Refining the job summary...'],
  cover_letter: [
    'Analyzing job description...',
    'Extracting key skills and requirements...',
    'Generating your tailored cover letter...',
  ],
  template_fill: [
    'Analyzing job description...',
    'Extracting key skills and requirements...',
    'Generating your tailored cover letter...',
  ],
};

export const AiHealthSchema = z.object({
  enabled: z.boolean(),
  available: z.boolean(),
  cliVersion: z.string().nullable(),
  loggedIn: z.boolean(),
  authMethod: z.string().nullable(),
  subscriptionType: z.string().nullable(),
  defaultModel: z.string(),
  models: z.record(z.string(), z.string()),
  message: z.string(),
  checkedAt: IsoDateTime,
});
export type AiHealth = z.infer<typeof AiHealthSchema>;
