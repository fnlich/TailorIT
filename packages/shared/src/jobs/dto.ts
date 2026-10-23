import { z } from 'zod';
import { IsoDate, IsoDateTime, listResponse } from '../core/list';
import { JobKeywordsSchema, LevelMatchSchema, MatchResultSchema } from '../match/schemas';
import { EMPLOYMENT_TYPES, EXPERIENCE_LEVELS, LEADERSHIP, SALARY_PERIODS, WORK_ARRANGEMENTS } from './enums';
import { JobsQuerySchema } from './query';
import { COMPANY_SIZE_IDS, JOB_REPORT_REASONS } from './taxonomy';

// Contracts of the Jobs endpoints (GET /api/jobs and friends). Job and company ids are integers (SQLite rowids).

export const JobIdParam = z.coerce.number().int().positive();

/** A posting's pay as stated. `period` null means the posting did not say (shown without a suffix). */
export const SalarySchema = z.object({
  min: z.number().nonnegative().nullable(),
  max: z.number().nonnegative().nullable(),
  currency: z.string().length(3).nullable(),
  period: z.enum(SALARY_PERIODS).nullable(),
});
export type Salary = z.infer<typeof SalarySchema>;

export const JobLocationSchema = z.object({
  raw: z.string(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  countryCode: z.string().nullable(),
  isRemote: z.boolean(),
});
export type JobLocation = z.infer<typeof JobLocationSchema>;

export const CompanyRefSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  logoUrl: z.string().nullable(),
});
export type CompanyRef = z.infer<typeof CompanyRefSchema>;

export const CompanySummarySchema = CompanyRefSchema.extend({
  tagline: z.string().nullable(),
  website: z.string().nullable(),
  /** Active postings, when the endpoint counts them. */
  jobCount: z.number().int().nonnegative().optional(),
});
export type CompanySummary = z.infer<typeof CompanySummarySchema>;

export const CompanyLinkSchema = z.object({ label: z.string(), url: z.string() });

/** The detail panel's Company section: about, plus whichever stats are known. */
export const CompanyDetailSchema = CompanySummarySchema.extend({
  about: z.string().nullable(),
  sizeBucket: z.enum(COMPANY_SIZE_IDS).nullable(),
  stage: z.string().nullable(),
  funding: z.string().nullable(),
  headquarters: z.string().nullable(),
  foundedYear: z.number().int().nullable(),
  industry: z.string().nullable(),
  links: z.array(CompanyLinkSchema),
  sponsorsH1b: z.boolean().nullable(),
});
export type CompanyDetail = z.infer<typeof CompanyDetailSchema>;

/** One card of the jobs list. Format with `formatLocationLine`, `formatSalaryRange` and `relativeTime`. */
export const JobSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  company: CompanyRefSchema,
  /** The first place, formatted ("Fremont, CA, USA"); '' when the posting names none. */
  primaryLocation: z.string(),
  /** How many places the posting names in all. */
  locationCount: z.number().int().nonnegative(),
  workArrangement: z.enum(WORK_ARRANGEMENTS).nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES).nullable(),
  experienceLevels: z.array(z.enum(EXPERIENCE_LEVELS)),
  salary: SalarySchema.nullable(),
  postedAt: IsoDateTime.nullable(),
  updatedAt: IsoDateTime.nullable(),
  active: z.boolean(),
  /** The viewer's state, from the tracker. */
  saved: z.boolean(),
  appliedOn: IsoDate.nullable(),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

/** GET /api/jobs: 21 per page; `total` is "Found N jobs". */
export const JobsListResponseSchema = listResponse(JobSummarySchema);
export type JobsListResponse = z.infer<typeof JobsListResponseSchema>;

export const JobUserStateSchema = z.object({
  saved: z.boolean(),
  /** The tracker application for this job, when there is one. */
  applicationId: z.string().nullable(),
  appliedOn: IsoDate.nullable(),
  hidden: z.boolean(),
  companyHidden: z.boolean(),
});
export type JobUserState = z.infer<typeof JobUserStateSchema>;

/** GET /api/jobs/:id: the detail panel. Chips and facts are derived from these fields. */
export const JobDetailSchema = JobSummarySchema.extend({
  company: CompanyDetailSchema,
  locations: z.array(JobLocationSchema),
  leadership: z.enum(LEADERSHIP).nullable(),
  categoryId: z.string().nullable(),
  subcategoryIds: z.array(z.string()),
  degree: z.string().nullable(),
  sponsorsH1b: z.boolean().nullable(),
  requiresClearance: z.boolean().nullable(),
  industry: z.string().nullable(),
  /** Sanitized HTML ("Full posting"). */
  descriptionHtml: z.string(),
  /** The original posting; Apply always opens it. */
  applyUrl: z.string(),
  lastVerifiedAt: IsoDateTime.nullable(),
  closedAt: IsoDateTime.nullable(),
  userState: JobUserStateSchema,
});
export type JobDetail = z.infer<typeof JobDetailSchema>;

export const JOB_ANALYSIS_SOURCES = ['deterministic', 'ft_lake', 'ai'] as const;
export type JobAnalysisSource = (typeof JOB_ANALYSIS_SOURCES)[number];

/**
 * GET /api/jobs/:id/analysis: the "About the job" summary and the keywords the match uses. `refining` is true while an
 * AI analysis is running; the page shows this version with a quiet "Refining..." and swaps when it is ready.
 */
export const JobAnalysisViewSchema = z.object({
  source: z.enum(JOB_ANALYSIS_SOURCES),
  refining: z.boolean(),
  requirements: z.array(z.string()),
  responsibilities: z.array(z.string()),
  desired: z.array(z.string()),
  keywords: JobKeywordsSchema,
  experienceLevels: z.array(z.enum(EXPERIENCE_LEVELS)),
  categoryId: z.string().nullable(),
  subcategoryIds: z.array(z.string()),
});
export type JobAnalysisView = z.infer<typeof JobAnalysisViewSchema>;

/** GET /api/jobs/:id/match: the job analysis card. */
export const JobMatchResponseSchema = MatchResultSchema;
export type JobMatchResponse = z.infer<typeof JobMatchResponseSchema>;

/** The facts grid's level check, computed with `levelMatch(job.experienceLevels, preferences.experienceLevels)`. */
export const JobLevelMatchSchema = LevelMatchSchema;

/** POST/DELETE /api/jobs/:id/hide and POST /api/companies/:id/hide. */
export const JobHideResponseSchema = z.object({ hidden: z.boolean() });

/** POST /api/jobs/:id/report. */
export const JobReportBodySchema = z.object({
  reason: z.enum(JOB_REPORT_REASONS),
  details: z.string().trim().max(2000).default(''),
});
export type JobReportBody = z.infer<typeof JobReportBodySchema>;

export const SavedSearchSchema = z.object({
  id: z.string(),
  name: z.string(),
  query: JobsQuerySchema,
  createdAt: IsoDateTime,
});
export type SavedSearch = z.infer<typeof SavedSearchSchema>;

export const SavedSearchListSchema = listResponse(SavedSearchSchema);

/** POST /api/saved-searches. The cursor is never saved. */
export const CreateSavedSearchBodySchema = z.object({
  name: z.string().trim().min(1, 'Give the search a name').max(100),
  query: JobsQuerySchema,
});
export type CreateSavedSearchBody = z.infer<typeof CreateSavedSearchBodySchema>;

/** The facet lists the filters search over (GET /api/jobs/facets/:facet). */
export const JOB_FACETS = [
  'categories',
  'subcategories',
  'industries',
  'companySizes',
  'companies',
  'locations',
  'remoteCountries',
] as const;
export type JobFacet = (typeof JOB_FACETS)[number];

export const JobFacetQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

export const JobFacetItemSchema = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
  /** A subcategory's category. */
  parent: z.string().optional(),
});
export type JobFacetItem = z.infer<typeof JobFacetItemSchema>;

export const JobFacetResponseSchema = z.object({
  facet: z.enum(JOB_FACETS),
  items: z.array(JobFacetItemSchema),
});
export type JobFacetResponse = z.infer<typeof JobFacetResponseSchema>;

/**
 * GET /api/jobs/facets/summary: which filters the data can answer ("a filter only appears when the data has values
 * for it"), with the small facet lists inline.
 */
export const JobFacetsSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  available: z.object({
    salary: z.boolean(),
    h1b: z.boolean(),
    clearance: z.boolean(),
    leadership: z.boolean(),
    industries: z.boolean(),
    companySizes: z.boolean(),
    arrangements: z.boolean(),
    levels: z.boolean(),
  }),
  categories: z.array(JobFacetItemSchema),
  remoteCountries: z.array(JobFacetItemSchema),
});
export type JobFacetsSummary = z.infer<typeof JobFacetsSummarySchema>;
