import { z } from 'zod';
import { IsoDateTime } from '../core/list';

// What TailorIT reads from a resume to pick the best one for each job: main (hard) skills, soft skills, keywords and
// the years of experience it shows. Every resume gets a quick rule-based reading ('deterministic'); Claude adds a
// closer one ('ai') for uploads. An upload is never changed: its reading is stored beside it (resume_analyses).
// "Keywords" are the screening terms that are neither tools nor traits: roles held (the headline first),
// certifications, and industries (INDUSTRIES ids).

/** Bump when the rule-based reading or Claude's prompt changes what a stored reading holds. */
export const RESUME_READING_VERSION = 1;
/**
 * The edition of the skill library (apps/api/static/skills/skills.json) the reading matches against. Bump it whenever
 * the file's skill lists change, so every resume is read again; the API tests compare it with the file.
 */
export const RESUME_SKILLS_STAMP = 4;
/** Stored on every reading and on the AI backlog: a row of another version is stale and is read again. */
export const RESUME_ANALYSIS_VERSION = RESUME_READING_VERSION * 1000 + RESUME_SKILLS_STAMP;

export const RESUME_ANALYSIS_SOURCES = ['deterministic', 'ai'] as const;
export type ResumeAnalysisSource = (typeof RESUME_ANALYSIS_SOURCES)[number];

/** Where a stated total of years comes from: the editor's field (built resumes), or the resume's own words. */
export const YEARS_STATED_BASES = ['field', 'stated'] as const;
/** How the years shown were found: added up from the roles' dates, or a stated total. */
export const YEARS_BASES = ['dates', ...YEARS_STATED_BASES] as const;
export type YearsBasis = (typeof YEARS_BASES)[number];

export const ResumeKeywordsSchema = z.object({
  /** Roles held, the headline first. */
  roles: z.array(z.string().min(1).max(120)).max(8),
  /** Certifications and licences, by their canonical names. */
  certifications: z.array(z.string().min(1).max(120)).max(10),
  /** Industries worked in: INDUSTRIES ids (never technology, other or not_specified). */
  domains: z.array(z.string().min(1).max(40)).max(5),
});
export type ResumeKeywords = z.infer<typeof ResumeKeywordsSchema>;

/** One stored reading: what the rules, or Claude, found in a resume. */
export const ResumeAnalysisDataSchema = z.object({
  /** In the skill library's spelling, most relevant first. */
  hardSkills: z.array(z.string().min(1).max(100)).max(60),
  /** By their canonical names. */
  softSkills: z.array(z.string().min(1).max(100)).max(40),
  keywords: ResumeKeywordsSchema,
  /**
   * The roles' dates as written: [start, end] month indexes (year * 12 + month - 1), end null for Present. Future
   * dates are skipped and ends clamped to this month only when the years are worked out, on read.
   */
  experience: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative().nullable()])).max(50),
  /** A total of years the resume states ("8 years of experience"), or the editor's field. */
  yearsStated: z.number().min(0).max(80).nullable(),
  yearsStatedBasis: z.enum(YEARS_STATED_BASES).nullable(),
  /** The person's name as the resume gives it (the resume ZIP's First_Last), when found. */
  personName: z.string().min(1).max(120).nullable(),
});
export type ResumeAnalysisData = z.infer<typeof ResumeAnalysisDataSchema>;

/**
 * GET /api/resumes/:id/analysis: "What TailorIT read from this resume". For an upload Claude has read, both readings
 * are merged (`source` 'ai'). The years are worked out with today's date.
 */
export const ResumeAnalysisViewSchema = z.object({
  resumeId: z.string(),
  source: z.enum(RESUME_ANALYSIS_SOURCES),
  /** Claude is reading this upload now (its task is queued or running): "Reading it with AI...". */
  refining: z.boolean(),
  /** The upload is in line for Claude's reading, which has not started yet: "Waiting for the AI reading". */
  aiWaiting: z.boolean(),
  /** Claude's reading did not work; the quick reading stands. */
  aiFailed: z.boolean(),
  hardSkills: z.array(z.string()),
  softSkills: z.array(z.string()),
  keywords: ResumeKeywordsSchema,
  yearsExperience: z.number().min(0).max(80).nullable(),
  yearsBasis: z.enum(YEARS_BASES).nullable(),
  analyzedAt: IsoDateTime,
});
export type ResumeAnalysisView = z.infer<typeof ResumeAnalysisViewSchema>;

/** A list row's reading (GET /api/resumes), for the card line "8 yrs · React, TypeScript, Node.js +9". */
export const ResumeAnalysisBriefSchema = z.object({
  yearsExperience: z.number().min(0).max(80).nullable(),
  /** Main skills, most relevant first: the line shows three and "+N" for the rest; the list's search reads them all. */
  hardSkills: z.array(z.string()),
  softSkillCount: z.number().int().nonnegative(),
  refining: z.boolean(),
  aiWaiting: z.boolean(),
});
export type ResumeAnalysisBrief = z.infer<typeof ResumeAnalysisBriefSchema>;
