import { z } from 'zod';
import { IsoDateTime } from '../core/list';

// AI work runs through the local Claude CLI and can take minutes, longer than Next's /api proxy waits. So every AI
// endpoint answers `202 { taskId }` and the page polls GET /api/ai/tasks/:id until the task finishes.

export const AI_TASK_KINDS = [
  'resume_import',
  'entry_bullets',
  'job_analysis',
  'cover_letter',
  'template_fill',
  'resume_analysis',
] as const;
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
  resume_analysis: 'RESUME_ANALYSIS',
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
  resume_analysis: ['Reading your resume...', 'Picking out skills, roles and dates...'],
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

/** When Claude reads added jobs (AI_JOB_ANALYSIS): `ingest` and `saved` run the background backlog; `lazy`, `off` do not. */
export const AI_JOB_ANALYSIS_MODES = ['ingest', 'saved', 'lazy', 'off'] as const;
export type AiJobAnalysisMode = (typeof AI_JOB_ANALYSIS_MODES)[number];
/** Whether Claude reads each uploaded resume in the background (AI_RESUME_ANALYSIS). */
export const AI_RESUME_ANALYSIS_MODES = ['auto', 'off'] as const;
export type AiResumeAnalysisMode = (typeof AI_RESUME_ANALYSIS_MODES)[number];

const BacklogCount = z.number().int().nonnegative();

/**
 * Admin › AI › Background work (GET /api/admin/ai/background): what the background workers still have to do, counted
 * from the database (no AI call, no write). A mode without a backlog (jobs `lazy` or `off`, resumes `off`) counts 0.
 * Rows of disabled accounts are left out, as the workers skip them.
 */
export const AiBackgroundWorkSchema = z.object({
  jobs: z.object({
    mode: z.enum(AI_JOB_ANALYSIS_MODES),
    /** Jobs the add-time backlog would still read: live, enough text, no Claude analysis of their text yet. */
    waiting: BacklogCount,
    /** Of the rest, jobs whose text waits out a failed reading (30 or 60 minutes) or an outage. */
    backingOff: BacklogCount,
    /** Jobs whose text Claude failed on three times: it is tried again once a day. */
    gaveUp: BacklogCount,
    /** AI_JOB_ANALYSIS_PER_HOUR: the most the backlog starts in an hour; 0 = no cap. */
    perHourCap: BacklogCount,
  }),
  resumes: z.object({
    mode: z.enum(AI_RESUME_ANALYSIS_MODES),
    /** Uploads in line for Claude's reading (some wait out a failed one). */
    waiting: BacklogCount,
    /** Uploads being read now (one at a time on the server). */
    queued: BacklogCount,
    /** Uploads Claude failed on three times: tried again after a day. */
    failed: BacklogCount,
    /** AI_RESUME_ANALYSIS_PER_HOUR; 0 = no cap. */
    perHourCap: BacklogCount,
  }),
  matches: z.object({
    /** Saved applications whose best-matched resume TailorIT is to choose again (`resume_match_due`; no AI). */
    due: BacklogCount,
  }),
  /** Whether background AI work may start a task now; if not, why, and until when (null: until a setting changes). */
  gate: z.object({
    open: z.boolean(),
    reason: z.string().nullable(),
    retryAt: IsoDateTime.nullable(),
  }),
});
export type AiBackgroundWork = z.infer<typeof AiBackgroundWorkSchema>;
