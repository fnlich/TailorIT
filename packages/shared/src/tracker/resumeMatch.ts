import { z } from 'zod';
import { IsoDateTime } from '../core/list';
import { RESUME_KINDS } from '../resume/dto';

// The resume chosen for a tracker application, and how the account's resumes rank for its job (the Documents tab's
// picker). TailorIT links the best match when a job is saved ('auto') and keeps choosing while the application is
// Saved; a resume the person picks or clears is theirs ('user') and is never changed automatically.

export const RESUME_ORIGINS = ['auto', 'user'] as const;
export type ResumeOrigin = (typeof RESUME_ORIGINS)[number];

/** What the resumes are compared with: the job's analysis, or the application's own description when it has no job. */
export const RESUME_MATCH_BASES = ['job', 'description'] as const;

const part = z.number().min(0).max(1).nullable();

/** One resume in the picker. The numbers shown are the Jobs card's; `fit` only orders the list. */
export const ResumeMatchItemSchema = z.object({
  resumeId: z.string(),
  label: z.string(),
  kind: z.enum(RESUME_KINDS),
  isDefault: z.boolean(),
  /** The weighted fit, unrounded 0-100: it ranks the resumes and is never shown. */
  fit: z.number().min(0).max(100),
  /** "{matchedCount} of {total} keywords · {percentage}%", counted exactly as the Jobs card and Resume Score do. */
  matchedCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  percentage: z.number().int().min(0).max(100),
  softMatched: z.number().int().nonnegative(),
  softTotal: z.number().int().nonnegative(),
  yearsExperience: z.number().min(0).max(80).nullable(),
  /** Each part of the fit, 0-1; null when the job gives that part nothing to compare (it then does not count). */
  parts: z.object({ hard: part, title: part, years: part, soft: part, keywords: part }),
  /** False for an upload whose text could not be read: it ranks last. */
  readable: z.boolean(),
  /** Claude is still reading this resume, so its place may change. */
  refining: z.boolean(),
});
export type ResumeMatchItem = z.infer<typeof ResumeMatchItemSchema>;

/** GET /api/applications/:id/resume-matches: the account's resumes, best first. */
export const ResumeMatchListSchema = z.object({
  applicationId: z.string(),
  basis: z.enum(RESUME_MATCH_BASES),
  /** The job names keywords. False: the options read "No keywords in this job" and none is tagged "Best match". */
  scored: z.boolean(),
  /** The years of experience the job asks for, when it says. */
  requiredYears: z.number().int().min(0).max(30).nullable(),
  /** The job's AI analysis is still under way. */
  refining: z.boolean(),
  /** The application's resume now, and who chose it. */
  chosen: z.object({
    resumeId: z.string().nullable(),
    origin: z.enum(RESUME_ORIGINS).nullable(),
    matchedAt: IsoDateTime.nullable(),
  }),
  items: z.array(ResumeMatchItemSchema),
});
export type ResumeMatchList = z.infer<typeof ResumeMatchListSchema>;
