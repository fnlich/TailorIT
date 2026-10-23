import {
  JobAnalysisViewSchema,
  JobDetailSchema,
  JobFacetResponseSchema,
  JobFacetsSummarySchema,
  JobSummarySchema,
  LevelMatchSchema,
  MatchResultSchema,
  SavedSearchListSchema,
  SavedSearchSchema,
  jobsQueryToQueryString,
  listResponse,
  type JobAnalysisView,
  type JobDetail,
  type JobFacet,
  type JobFacetResponse,
  type JobFacetsSummary,
  type JobReportBody,
  type JobsQuery,
  type SavedSearch,
} from '@tailorit/shared';
import { z } from 'zod';
import { api } from '@/lib/api';

/*
 * Everything the Jobs page reads and writes. Reads go through /api/jobs (work package J2); Save and Apply go through
 * the tracker's /api/applications (work package T), so the Job Tracker shows the same applications.
 */

/** A list card: the shared JobSummary plus its tracker application (to un-save from the list). */
export const JobListItemSchema = JobSummarySchema.extend({ applicationId: z.string().nullable().default(null) });
export type JobListItem = z.infer<typeof JobListItemSchema>;
export const JobListPageSchema = listResponse(JobListItemSchema);
export type JobListPage = z.infer<typeof JobListPageSchema>;

/** GET /api/jobs/:id/match: the "Improve Your Resume" card plus the facts grid's experience-level check. */
export const JobMatchSchema = MatchResultSchema.extend({ levelMatch: LevelMatchSchema.optional() });
export type JobMatch = z.infer<typeof JobMatchSchema>;

const HiddenSchema = z.object({ hidden: z.boolean() });
const CountSchema = z.object({ total: z.number().int().nonnegative() });

export const jobsKeys = {
  all: ['jobs'] as const,
  lists: ['jobs', 'list'] as const,
  list: (queryString: string) => ['jobs', 'list', queryString] as const,
  counts: ['jobs', 'count'] as const,
  count: (queryString: string) => ['jobs', 'count', queryString] as const,
  details: ['jobs', 'detail'] as const,
  detail: (id: number) => ['jobs', 'detail', id] as const,
  analysis: (id: number) => ['jobs', 'analysis', id] as const,
  matches: ['jobs', 'match'] as const,
  match: (id: number, analysisVersion: string) => ['jobs', 'match', id, analysisVersion] as const,
  facet: (facet: JobFacet, q: string) => ['jobs', 'facets', facet, q] as const,
  facetsSummary: ['jobs', 'facets', 'summary'] as const,
  savedSearches: ['jobs', 'saved-searches'] as const,
};

/** The list's query string: the filters without a cursor (the cursor is the page parameter). */
export function listQueryString(query: JobsQuery): string {
  return jobsQueryToQueryString({ ...query, cursor: undefined });
}

export function fetchJobsPage(queryString: string, cursor: string | undefined, signal?: AbortSignal) {
  const path = `/api/jobs${queryString ? `?${queryString}` : ''}`;
  return api.get<JobListPage>(path, { schema: JobListPageSchema, query: { cursor }, signal });
}

export async function fetchJobsCount(queryString: string, signal?: AbortSignal): Promise<number> {
  const result = await api.get<{ total: number }>(`/api/jobs/count${queryString ? `?${queryString}` : ''}`, {
    schema: CountSchema,
    signal,
  });
  return result.total;
}

export function fetchJob(id: number, signal?: AbortSignal) {
  return api.get<JobDetail>(`/api/jobs/${id}`, { schema: JobDetailSchema, signal });
}

export function fetchAnalysis(id: number, signal?: AbortSignal) {
  return api.get<JobAnalysisView>(`/api/jobs/${id}/analysis`, { schema: JobAnalysisViewSchema, signal });
}

export function fetchMatch(id: number, signal?: AbortSignal) {
  return api.get<JobMatch>(`/api/jobs/${id}/match`, { schema: JobMatchSchema, signal });
}

export function fetchFacet(facet: JobFacet, q: string, signal?: AbortSignal) {
  return api.get<JobFacetResponse>(`/api/jobs/facets/${facet}`, {
    schema: JobFacetResponseSchema,
    query: { q: q || undefined },
    signal,
  });
}

export function fetchFacetsSummary(signal?: AbortSignal) {
  return api.get<JobFacetsSummary>(`/api/jobs/facets/summary`, { schema: JobFacetsSummarySchema, signal });
}

export const hideJob = (id: number) => api.post(`/api/jobs/${id}/hide`, undefined, { schema: HiddenSchema });
export const unhideJob = (id: number) => api.delete(`/api/jobs/${id}/hide`, { schema: HiddenSchema });
export const hideCompany = (id: number) => api.post(`/api/companies/${id}/hide`, undefined, { schema: HiddenSchema });
export const unhideCompany = (id: number) => api.delete(`/api/companies/${id}/hide`, { schema: HiddenSchema });
export const reportJob = (id: number, body: JobReportBody) => api.post(`/api/jobs/${id}/report`, body);

export function fetchSavedSearches(signal?: AbortSignal) {
  return api.get<{ items: SavedSearch[] }>(`/api/saved-searches`, { schema: SavedSearchListSchema, signal });
}

export function createSavedSearch(name: string, query: JobsQuery) {
  return api.post<SavedSearch>(`/api/saved-searches`, { name, query: { ...query, cursor: undefined } }, { schema: SavedSearchSchema });
}

export const deleteSavedSearch = (id: string) => api.delete(`/api/saved-searches/${encodeURIComponent(id)}`);

// ------------------------------------------------------------------------------------------- the tracker (T)

/** Application statuses the Jobs page sets: Saved (bookmark) and Applied ("Did you apply?" → Yes). */
export const SAVED_STATUS = 1 as const;
export const APPLIED_STATUS = 2 as const;

/** The parts of the tracker's application answer the Jobs page reads. */
const ApplicationRefSchema = z.object({ id: z.string(), currentStatus: z.number().int().optional() });
export type ApplicationRef = z.infer<typeof ApplicationRefSchema>;

/**
 * Tracks the job in the Job Tracker: POST /api/applications with the job id. Creating it again for the same job
 * answers the existing application, moved up to `status` when that is further along.
 */
export function trackJob(jobId: number, status: typeof SAVED_STATUS | typeof APPLIED_STATUS, occurredOn?: string) {
  return api.post<ApplicationRef>(`/api/applications`, { jobId, status, ...(occurredOn ? { occurredOn } : {}) }, {
    schema: ApplicationRefSchema,
  });
}

/** Un-saves a job: deletes its application while it is still only Saved. */
export const untrackJob = (applicationId: string) => api.delete(`/api/applications/${encodeURIComponent(applicationId)}`);
