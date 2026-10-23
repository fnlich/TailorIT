import {
  EMPTY_JOBS_QUERY,
  jobsQueryToSearchParams,
  normalizeJobsQuery,
  searchParamsToJobsQuery,
  type JobsQuery,
  type JobsQueryInput,
} from '@tailorit/shared';

/*
 * The Jobs page keeps its whole state in the address: `/jobs?jobId=12&q=engineer&type=full_time&…` (the filter keys
 * are the shared contract's: q, location, remote, type, level, category, …). Reload, back and a shared link land
 * on the same list and job.
 */

export const JOBS_PATH = '/jobs';

export interface JobsUrlState {
  query: JobsQuery;
  /** The job open in the detail panel. */
  jobId: number | null;
}

interface ParamsLike {
  get(name: string): string | null;
  getAll(name: string): string[];
  toString(): string;
}

/** The selected job id of `?jobId=`, or null for a missing or unreadable one. */
export function readJobId(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,12}$/.test(value.trim())) return null;
  const id = Number(value.trim());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The page state of a URL's search params (unknown values dropped; the cursor never comes from the address). */
export function readJobsUrl(params: ParamsLike | null | undefined): JobsUrlState {
  if (!params) return { query: { ...EMPTY_JOBS_QUERY, cursor: undefined }, jobId: null };
  const query = searchParamsToJobsQuery(params);
  return { query: { ...query, cursor: undefined }, jobId: readJobId(params.get('jobId')) };
}

/** `/jobs?jobId=…&<filters>`: the canonical address of a state (equal states make equal URLs). */
export function jobsHref(query: JobsQueryInput, jobId: number | null = null): string {
  const params = new URLSearchParams();
  if (jobId) params.set('jobId', String(jobId));
  for (const [key, value] of jobsQueryToSearchParams({ ...normalizeJobsQuery(query), cursor: undefined })) {
    params.append(key, value);
  }
  const search = params.toString();
  return search ? `${JOBS_PATH}?${search}` : JOBS_PATH;
}

/**
 * A builder of job links for one filter state: the filters are encoded once (`jobsHref` for every card of a list
 * would re-normalize the query per card).
 */
export function jobHrefBuilder(query: JobsQueryInput): (jobId: number) => string {
  const filters = jobsHref(query).slice(JOBS_PATH.length).replace(/^\?/, '');
  return (jobId) => `${JOBS_PATH}?jobId=${jobId}${filters ? `&${filters}` : ''}`;
}

/** The filters as one comparable string (sort included, job and cursor not). */
export function queryKeyOf(query: JobsQueryInput): string {
  return jobsQueryToSearchParams({ ...normalizeJobsQuery(query), cursor: undefined })
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

/** A shareable absolute link to one job. */
export function jobShareUrl(origin: string, jobId: number): string {
  return `${origin.replace(/\/+$/, '')}${JOBS_PATH}?jobId=${jobId}`;
}
