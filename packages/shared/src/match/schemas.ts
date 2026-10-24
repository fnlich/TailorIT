import { z } from 'zod';

/** One keyword of a posting: the label shown on its chip, and other spellings that count as it. */
export const KeywordGroupSchema = z.object({
  term: z.string().min(1).max(120),
  synonyms: z.array(z.string().min(1).max(120)).max(20),
});
export type KeywordGroup = z.infer<typeof KeywordGroupSchema>;

/** A posting's keywords: `high` priority (required, emphasised) and `low` (mentioned). */
export const JobKeywordsSchema = z.object({
  high: z.array(KeywordGroupSchema),
  low: z.array(KeywordGroupSchema),
});
export type JobKeywords = z.infer<typeof JobKeywordsSchema>;

export const KEYWORD_PRIORITIES = ['high', 'low'] as const;
export type KeywordPriority = (typeof KEYWORD_PRIORITIES)[number];

/**
 * A posting's screening terms that are neither tools nor traits: the certifications and licences it names, and the
 * industries it is in (INDUSTRIES ids). A resume's keywords have the same groups, plus roles.
 */
export const JobTermsSchema = z.object({
  certifications: z.array(z.string().min(1).max(120)).max(10),
  domains: z.array(z.string().min(1).max(40)).max(6),
});
export type JobTerms = z.infer<typeof JobTermsSchema>;

/** A chip of the job analysis card. */
export const MatchedKeywordSchema = z.object({
  term: z.string(),
  priority: z.enum(KEYWORD_PRIORITIES),
});
export type MatchedKeyword = z.infer<typeof MatchedKeywordSchema>;

export const MATCH_STATES = ['no_resume', 'ok'] as const;

/** Which resume a match scored: the one linked to the job's tracker application, or the default resume. */
export const MATCH_RESUME_BASES = ['linked', 'default'] as const;
export type MatchResumeBasis = (typeof MATCH_RESUME_BASES)[number];

/**
 * GET /api/jobs/:id/match. `matched` lists the keywords the resume carries (high first, then low), `missing` the
 * rest in the same order; `percentage` = round(matchedCount / total * 100), 0 when the posting has no keywords.
 * `no_resume`: the user has no default resume (the card says "Add a resume").
 * `resumeLabel` and `resumeBasis` name the resume scored ("Scored with {label}"), when the endpoint says.
 */
export const MatchResultSchema = z.object({
  state: z.enum(MATCH_STATES),
  resumeId: z.string().optional(),
  resumeLabel: z.string().optional(),
  resumeBasis: z.enum(MATCH_RESUME_BASES).optional(),
  matched: z.array(MatchedKeywordSchema),
  missing: z.array(MatchedKeywordSchema),
  matchedCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  percentage: z.number().int().min(0).max(100),
});
export type MatchResult = z.infer<typeof MatchResultSchema>;

export const LEVEL_MATCH_STATES = ['match', 'mismatch', 'none'] as const;

/**
 * The facts grid's experience-level icon. `match`: green check, `mismatch`: amber info, `none`: no icon (no
 * preferences set, or the posting names no level). `lines` is the tooltip, one sentence per line.
 */
export const LevelMatchSchema = z.object({
  state: z.enum(LEVEL_MATCH_STATES),
  jobLabels: z.array(z.string()),
  preferredLabels: z.array(z.string()),
  matchingLabels: z.array(z.string()),
  lines: z.array(z.string()),
});
export type LevelMatch = z.infer<typeof LevelMatchSchema>;
