import { z } from 'zod';
import { listParam, paramValues, type QueryRecord, type SearchParamsReader } from '../format/params';
import {
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  LEADERSHIP,
  SALARY_PERIODS,
  WORK_ARRANGEMENTS,
  type EmploymentType,
} from './enums';
import { CLEARANCE_FILTERS, COMPANY_SIZE_IDS, INDUSTRY_IDS, JOB_CATEGORY_IDS, JOB_SUBCATEGORY_IDS } from './taxonomy';

/** The text without lone surrogate halves (which encodeURIComponent refuses). */
function wellFormed(text: string): string {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[index]! + text[index + 1]!;
        index += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    out += text[index]!;
  }
  return out;
}

export const JOB_SORTS = ['relevant', 'posted', 'updated', 'salary'] as const;
export type JobSort = (typeof JOB_SORTS)[number];
export const JOB_SORT_LABEL: Record<JobSort, string> = {
  relevant: 'Most relevant',
  posted: 'Recently posted',
  updated: 'Recently updated',
  salary: 'Highest salary',
};

/** "Last updated" filter, in days. */
export const UPDATED_WITHIN_DAYS = [1, 7, 30] as const;
export type UpdatedWithin = (typeof UPDATED_WITHIN_DAYS)[number];
export const UPDATED_WITHIN_LABEL: Record<UpdatedWithin, string> = {
  1: 'Past 24 hours',
  7: 'Past week',
  30: 'Past month',
};

/** Jobs per page of GET /api/jobs. */
export const JOBS_PAGE_SIZE = 21;
/** Ceiling of the Minimum salary slider (yearly USD), and its step. */
export const MIN_SALARY_MAX = 400_000;
export const MIN_SALARY_STEP = 10_000;

const unique = <T>(items: T[]): T[] => [...new Set(items)];
/** `undefined` for a value that is the same as not filtering: false, 0, ''. */
const unset = <T>(value: T | undefined): T | undefined => (value ? value : undefined);

/** Each list field's item schema; a value it refuses is dropped from the list. */
const ITEM = {
  locations: z.string().transform(wellFormed).pipe(z.string().trim().min(1).max(120)),
  jobTypes: z.enum(EMPLOYMENT_TYPES),
  levels: z.enum(EXPERIENCE_LEVELS),
  categories: z.enum(JOB_CATEGORY_IDS),
  subcategories: z.enum(JOB_SUBCATEGORY_IDS),
  leadership: z.enum(LEADERSHIP),
  arrangements: z.enum(WORK_ARRANGEMENTS),
  industries: z.enum(INDUSTRY_IDS),
  companySizes: z.enum(COMPANY_SIZE_IDS),
  companies: z.string().trim().regex(/^\d{1,12}$/),
} as const;
type ListKey = keyof typeof ITEM;

/** How many values each list keeps. */
const LIST_MAX: Record<ListKey, number> = {
  locations: 10,
  jobTypes: 10,
  levels: 10,
  categories: 50,
  subcategories: 200,
  leadership: 5,
  arrangements: 5,
  industries: 50,
  companySizes: 10,
  companies: 50,
};

const list = <K extends ListKey>(key: K) => z.array(ITEM[key]).max(LIST_MAX[key]).default([]).transform(unique);

/**
 * Every filter of the Jobs page, as the URL and GET /api/jobs carry it, in one canonical form: strings trimmed, lists
 * without repeats (default empty), `sort` defaulting to "relevant", and anything that filters nothing (false, 0, '')
 * absent. `remote` is a country code ("Remote in USA"). `minSalary` is in `payPeriod` units (default yearly) and
 * compared against the posting's pay converted to that period.
 */
export const JobsQuerySchema = z.object({
  q: z.string().transform(wellFormed).pipe(z.string().trim().max(200)).optional().transform(unset),
  locations: list('locations'),
  remote: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
  jobTypes: list('jobTypes'),
  levels: list('levels'),
  categories: list('categories'),
  subcategories: list('subcategories'),
  leadership: list('leadership'),
  arrangements: list('arrangements'),
  minSalary: z.number().int().min(0).max(10_000_000).optional().transform(unset),
  payPeriod: z.enum(SALARY_PERIODS).optional(),
  /** Only companies that sponsor H1B visas. */
  h1b: z.boolean().optional().transform(unset),
  industries: list('industries'),
  companySizes: list('companySizes'),
  /** Company ids. */
  companies: list('companies'),
  clearance: z.enum(CLEARANCE_FILTERS).optional(),
  hideApplied: z.boolean().optional().transform(unset),
  updatedWithin: z.union([z.literal(1), z.literal(7), z.literal(30)]).optional(),
  sort: z.enum(JOB_SORTS).default('relevant'),
  cursor: z.string().transform(wellFormed).pipe(z.string().trim().max(500)).optional().transform(unset),
});
export type JobsQuery = z.infer<typeof JobsQuerySchema>;
export type JobsQueryInput = z.input<typeof JobsQuerySchema>;

/** A fresh query with no filters (safe to change). */
export function emptyJobsQuery(): JobsQuery {
  return JobsQuerySchema.parse({});
}

/** The query with no filters, frozen: compare or spread it, never change it. */
export const EMPTY_JOBS_QUERY: JobsQuery = deepFreeze(emptyJobsQuery());

function deepFreeze<T extends object>(value: T): T {
  for (const item of Object.values(value)) if (item && typeof item === 'object') Object.freeze(item);
  return Object.freeze(value);
}

/** The URL key of each field. Lists repeat their key; a value that may hold commas is never split. */
export const JOBS_QUERY_PARAMS = {
  q: 'q',
  locations: 'location',
  remote: 'remote',
  jobTypes: 'type',
  levels: 'level',
  categories: 'category',
  subcategories: 'subcategory',
  leadership: 'leadership',
  arrangements: 'arrangement',
  minSalary: 'minSalary',
  payPeriod: 'period',
  h1b: 'h1b',
  industries: 'industry',
  companySizes: 'size',
  companies: 'company',
  clearance: 'clearance',
  hideApplied: 'hideApplied',
  updatedWithin: 'updated',
  sort: 'sort',
  cursor: 'cursor',
} as const satisfies Record<keyof JobsQuery, string>;

const LIST_KEYS = Object.keys(ITEM) as ListKey[];

/** List fields whose values may contain commas, so a comma never splits them. */
const UNSPLIT: ReadonlySet<ListKey> = new Set(['locations']);

/** At most `max` characters, never cutting a character in two. */
function cut(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('');
}

function first(values: string[]): string | undefined {
  return values.map((value) => value.trim()).find(Boolean);
}

function flag(values: string[]): boolean | undefined {
  const value = first(values)?.toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' ? true : undefined;
}

/** Reads a query string ("a=1&b=2", with or without "?") into a reader. */
function queryStringReader(text: string): SearchParamsReader {
  const pairs = text
    .replace(/^\?/, '')
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf('=');
      const decode = (part: string) => {
        try {
          return decodeURIComponent(part.replace(/\+/g, ' '));
        } catch {
          return part;
        }
      };
      return at < 0 ? [decode(pair), ''] : [decode(pair.slice(0, at)), decode(pair.slice(at + 1))];
    });
  return { getAll: (name) => pairs.filter(([key]) => key === name).map(([, value]) => value ?? '') };
}

/** The lenient reader both entry points share: `values(field)` gives each field's raw values as strings. */
function readJobsQuery(values: (key: keyof JobsQuery) => string[]): JobsQuery {
  const raw: Record<string, unknown> = {};

  const q = first(values('q'));
  if (q) raw.q = cut(q, 200);
  for (const key of LIST_KEYS) {
    const items: unknown[] = [];
    for (const item of listParam(values(key), !UNSPLIT.has(key))) {
      const parsed = ITEM[key].safeParse(item);
      if (parsed.success && !items.includes(parsed.data)) items.push(parsed.data);
    }
    raw[key] = items.slice(0, LIST_MAX[key]);
  }
  const remote = first(values('remote'))?.toUpperCase();
  if (remote && /^[A-Z]{2}$/.test(remote)) raw.remote = remote;
  const salaryText = first(values('minSalary'))?.replace(/[,_\s]/g, '') ?? '';
  const minSalary = /^\d+(?:\.\d+)?$/.test(salaryText) ? Number(salaryText) : Number.NaN;
  if (Number.isFinite(minSalary) && minSalary > 0) raw.minSalary = Math.min(10_000_000, Math.round(minSalary));
  const period = first(values('payPeriod'));
  if (period && (SALARY_PERIODS as readonly string[]).includes(period)) raw.payPeriod = period;
  if (flag(values('h1b'))) raw.h1b = true;
  if (flag(values('hideApplied'))) raw.hideApplied = true;
  const clearance = first(values('clearance'));
  if (clearance && (CLEARANCE_FILTERS as readonly string[]).includes(clearance)) raw.clearance = clearance;
  const updated = Number(first(values('updatedWithin')));
  if (updated === 1 || updated === 7 || updated === 30) raw.updatedWithin = updated;
  const sort = first(values('sort'));
  if (sort && (JOB_SORTS as readonly string[]).includes(sort)) raw.sort = sort;
  const cursor = first(values('cursor'));
  if (cursor && Array.from(cursor).length <= 500) raw.cursor = cursor;

  const parsed = JobsQuerySchema.safeParse(raw);
  return parsed.success ? parsed.data : emptyJobsQuery();
}

/**
 * The Jobs query in a URL (URLSearchParams, Next's search params, Express's `req.query`, or a query string). Lenient:
 * unknown values are dropped, unreadable numbers ignored, repeats removed, so any URL a person edits by hand still
 * opens the page. Lists read repeated keys and comma-separated values.
 */
export function searchParamsToJobsQuery(
  source: SearchParamsReader | QueryRecord | string | null | undefined,
): JobsQuery {
  if (typeof source !== 'string' && (source === null || typeof source !== 'object')) return emptyJobsQuery();
  const reader = typeof source === 'string' ? queryStringReader(source) : source;
  return readJobsQuery((key) => paramValues(reader, JOBS_QUERY_PARAMS[key]));
}

/**
 * A query object from anywhere (a saved search, a form, a hand-built object) made valid by the same lenient rules:
 * values the schema would refuse are dropped one by one instead of failing the whole query.
 */
export function normalizeJobsQuery(input: unknown): JobsQuery {
  const record = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  return readJobsQuery((key) => {
    const value = record[key];
    const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
    return list.filter((item) => ['string', 'number', 'boolean'].includes(typeof item)).map(String);
  });
}

/**
 * The query as URL entries, in a fixed order, leaving out every default (no empty lists, no `sort=relevant`, no false
 * flags), so equal queries make equal URLs: `new URLSearchParams(jobsQueryToSearchParams(query))`.
 */
export function jobsQueryToSearchParams(query: JobsQueryInput): Array<[string, string]> {
  const value = normalizeJobsQuery(query);
  const out: Array<[string, string]> = [];
  const push = (key: keyof JobsQuery, item: string | number) => out.push([JOBS_QUERY_PARAMS[key], String(item)]);

  if (value.q?.trim()) push('q', value.q.trim());
  for (const key of LIST_KEYS) {
    const items = [...new Set(value[key] as readonly string[])];
    for (const item of items) push(key, item);
    if (key === 'locations' && value.remote) push('remote', value.remote);
  }
  if (value.minSalary !== undefined && value.minSalary > 0) push('minSalary', value.minSalary);
  if (value.payPeriod) push('payPeriod', value.payPeriod);
  if (value.h1b) push('h1b', 1);
  if (value.clearance) push('clearance', value.clearance);
  if (value.hideApplied) push('hideApplied', 1);
  if (value.updatedWithin) push('updatedWithin', value.updatedWithin);
  if (value.sort !== 'relevant') push('sort', value.sort);
  if (value.cursor) push('cursor', value.cursor);
  return out;
}

/** `jobsQueryToSearchParams` as a query string without "?" (form encoding, as URLSearchParams writes it). */
export function jobsQueryToQueryString(query: JobsQueryInput): string {
  const encode = (text: string) =>
    encodeURIComponent(wellFormed(text))
      .replace(/%20/g, '+')
      .replace(/[!'()~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return jobsQueryToSearchParams(query)
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join('&');
}

/** The count badges of the toolbar pills ("Job Type [1]", "Category [2]") and of All filters. */
export function jobFilterCounts(query: JobsQuery): {
  location: number;
  jobType: number;
  experience: number;
  category: number;
  total: number;
} {
  const location = query.locations.length + (query.remote ? 1 : 0) + query.arrangements.length;
  const jobType = query.jobTypes.length;
  const experience = query.levels.length;
  const category = query.categories.length + query.subcategories.length;
  const others =
    query.leadership.length +
    query.industries.length +
    query.companySizes.length +
    query.companies.length +
    (query.minSalary ? 1 : 0) +
    (query.h1b ? 1 : 0) +
    (query.clearance ? 1 : 0) +
    (query.hideApplied ? 1 : 0) +
    (query.updatedWithin ? 1 : 0);
  return { location, jobType, experience, category, total: location + jobType + experience + category + others };
}

/** Whether the query filters anything (search text included); sort and cursor do not count. */
export function hasJobFilters(query: JobsQuery): boolean {
  return Boolean(query.q?.trim()) || jobFilterCounts(query).total > 0;
}

/** The default job type for the Add Application sheet and filters: Internship for users who prefer only internships. */
export function preferredJobType(preferred: readonly EmploymentType[]): EmploymentType {
  return preferred.length === 1 && preferred[0] === 'internship' ? 'internship' : 'full_time';
}
