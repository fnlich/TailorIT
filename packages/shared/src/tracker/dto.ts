import { z } from 'zod';
import { IsoDate, IsoDateTime, listResponse } from '../core/list';
import { formatShortDate, type DateInput } from '../format/dates';
import { firstParam, listParam, queryBoolean, queryEnum, queryNumber, queryText } from '../format/params';
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL, type EmploymentType } from '../jobs/enums';
import { TRACKER_PAY_PERIODS } from './csv';
import { StatusEventSchema } from './rules';
import { ApplicationStatusSchema, STATUS_INFO, isApplicationStatus, type ApplicationStatus } from './statuses';

// Contracts of the Job Tracker endpoints (/api/applications). Application ids are strings; job ids integers.

export const TRACKER_TABS = ['active', 'archived'] as const;
export type TrackerTab = (typeof TRACKER_TABS)[number];
export const TRACKER_VIEWS = ['board', 'list', 'chart'] as const;
export type TrackerView = (typeof TRACKER_VIEWS)[number];

export const TRACKER_SORTS = ['tracked', 'created', 'title'] as const;
export type TrackerSort = (typeof TRACKER_SORTS)[number];
export const TRACKER_SORT_LABEL: Record<TrackerSort, string> = {
  tracked: 'Tracked Date',
  created: 'Created Date',
  title: 'Title',
};
export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];
export const SORT_ORDER_LABEL: Record<SortOrder, string> = { asc: 'Ascending', desc: 'Descending' };

/** Rows per page of the list view. */
export const TRACKER_LIST_PAGE_SIZE = 25;

/** The card footer: "Added Oct 22". */
export function addedLabel(date: DateInput): string {
  const text = formatShortDate(date);
  return text ? `Added ${text}` : '';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const queryDate = z.preprocess((value) => {
  const text = firstParam(value);
  return text && ISO_DATE.test(text) ? text : undefined;
}, IsoDate.optional());
const queryStatuses = z.preprocess(
  (value) =>
    listParam(value)
      .map(Number)
      .filter((status) => isApplicationStatus(status)),
  z.array(ApplicationStatusSchema),
);

/** The filters every tracker read shares (Options menu, search). */
const filterFields = {
  q: z.preprocess((value) => firstParam(value)?.slice(0, 200), z.string().optional()),
  statuses: queryStatuses,
  jobType: queryEnum(EMPLOYMENT_TYPES),
  favorites: queryBoolean,
  /** Applied from / until, inclusive, "YYYY-MM-DD". */
  from: queryDate,
  until: queryDate,
  sort: queryEnum(TRACKER_SORTS).transform((value) => value ?? 'tracked'),
  order: queryEnum(SORT_ORDERS).transform((value) => value ?? 'desc'),
};

/** GET /api/applications (the list view; also Archived). */
export const ApplicationListQuerySchema = z.object({
  ...filterFields,
  tab: queryEnum(TRACKER_TABS).transform((value) => value ?? 'active'),
  cursor: queryText,
  limit: queryNumber(1, 100).transform((value) => value ?? TRACKER_LIST_PAGE_SIZE),
});
export type ApplicationListQuery = z.infer<typeof ApplicationListQuerySchema>;

/** GET /api/applications/export.csv: the list filters, every page. */
export const ApplicationExportQuerySchema = z.object({
  ...filterFields,
  tab: queryEnum(TRACKER_TABS).transform((value) => value ?? 'active'),
});
export type ApplicationExportQuery = z.infer<typeof ApplicationExportQuerySchema>;

/** GET /api/applications/board. With `status`, only that column is returned (its next page, from `cursor`). */
export const BoardQuerySchema = z.object({
  ...filterFields,
  status: z.preprocess((value) => {
    const status = Number(firstParam(value));
    return isApplicationStatus(status) ? status : undefined;
  }, ApplicationStatusSchema.optional()),
  cursor: queryText,
  limit: queryNumber(1, 100).transform((value) => value ?? 25),
});
export type BoardQuery = z.infer<typeof BoardQuerySchema>;

/** The filters as the page holds them (also what the chips read). */
export type TrackerFilters = Pick<ApplicationListQuery, 'q' | 'statuses' | 'jobType' | 'favorites' | 'from' | 'until' | 'sort' | 'order'>;

export const ApplicationSalarySchema = z.object({
  min: z.number().nonnegative().nullable(),
  max: z.number().nonnegative().nullable(),
  currency: z.string().length(3).nullable(),
  period: z.enum(TRACKER_PAY_PERIODS).nullable(),
});
export type ApplicationSalary = z.infer<typeof ApplicationSalarySchema>;

/** A board card and a list row. `events` feed the list's stepper; format the footer with `addedLabel(trackedOn)`. */
export const ApplicationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  companyName: z.string(),
  companyId: z.number().int().nullable(),
  logoUrl: z.string().nullable(),
  location: z.string(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  currentStatus: ApplicationStatusSchema,
  events: z.array(StatusEventSchema),
  favorite: z.boolean(),
  archivedAt: IsoDateTime.nullable(),
  /** The tracked day ("YYYY-MM-DD"; an ISO timestamp is accepted too). */
  trackedOn: z.union([IsoDate, IsoDateTime]),
  jobId: z.number().int().nullable(),
  postingUrl: z.string(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ApplicationSummary = z.infer<typeof ApplicationSummarySchema>;

export const ApplicationListResponseSchema = listResponse(ApplicationSummarySchema);
export type ApplicationListResponse = z.infer<typeof ApplicationListResponseSchema>;

export const BoardColumnSchema = z.object({
  status: ApplicationStatusSchema,
  /** Cards in the column under the current filters. */
  total: z.number().int().nonnegative(),
  items: z.array(ApplicationSummarySchema),
  nextCursor: z.string().optional(),
});
export type BoardColumn = z.infer<typeof BoardColumnSchema>;

/** GET /api/applications/board: every status's column, first page each (or one column when asked). */
export const BoardResponseSchema = z.object({ columns: z.array(BoardColumnSchema) });
export type BoardResponse = z.infer<typeof BoardResponseSchema>;

/** GET /api/applications/counts: the tab counts and "Visible columns" counts (active applications, by status). */
export const ApplicationCountsSchema = z.object({
  active: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  byStatus: z.record(z.string(), z.number().int().nonnegative()),
});
export type ApplicationCounts = z.infer<typeof ApplicationCountsSchema>;

export const ApplicationQuestionSchema = z.object({
  id: z.string(),
  position: z.number().int().nonnegative(),
  question: z.string(),
  answer: z.string(),
  createdAt: IsoDateTime.nullable(),
  updatedAt: IsoDateTime.nullable(),
});
export type ApplicationQuestion = z.infer<typeof ApplicationQuestionSchema>;

/** GET /api/applications/:id: the detail sheet. */
export const ApplicationDetailSchema = ApplicationSummarySchema.extend({
  descriptionHtml: z.string(),
  salary: ApplicationSalarySchema,
  resumeId: z.string().nullable(),
  coverLetterId: z.string().nullable(),
  notesHtml: z.string(),
  questions: z.array(ApplicationQuestionSchema),
});
export type ApplicationDetail = z.infer<typeof ApplicationDetailSchema>;

export const URL_MESSAGE = 'Must be a valid url';

/** An http(s) URL, or ''. A bare domain gets "https://" ("acme.com/jobs/1" -> "https://acme.com/jobs/1"). */
export function normalizeUrlInput(value: string): string | null {
  const text = value.trim();
  if (!text) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  return /^https?:\/\/[^\s/$.?#][^\s]*\.[^\s]*$|^https?:\/\/localhost(?::\d+)?(?:\/\S*)?$/i.test(withScheme)
    ? withScheme
    : null;
}

const UrlField = z
  .string()
  .max(2000)
  .transform((value, ctx) => {
    const url = normalizeUrlInput(value);
    if (url === null) {
      ctx.addIssue({ code: 'custom', message: URL_MESSAGE });
      return z.NEVER;
    }
    return url;
  });

const RequiredText = (max: number) => z.string().trim().min(1, 'Required').max(max);

/**
 * POST /api/applications. With `jobId` the title, company, location, job type and link come from the job when not
 * given; without it, Position Title, Company and Job Type are required. `status` defaults to Applied (Saved when a
 * job is saved from the Jobs page: the web sends it); the first events are dated `occurredOn` (default today).
 */
export const CreateApplicationBodySchema = z
  .object({
    jobId: z.number().int().positive().optional(),
    title: z.string().trim().max(200).optional(),
    companyName: z.string().trim().max(200).optional(),
    location: z.string().trim().max(200).optional(),
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    status: ApplicationStatusSchema.optional(),
    resumeId: z.string().nullable().optional(),
    postingUrl: UrlField.optional(),
    occurredOn: IsoDate.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.jobId) return;
    if (!body.title) ctx.addIssue({ code: 'custom', path: ['title'], message: 'Required' });
    if (!body.companyName) ctx.addIssue({ code: 'custom', path: ['companyName'], message: 'Required' });
    if (!body.employmentType) ctx.addIssue({ code: 'custom', path: ['employmentType'], message: 'Required' });
  });
export type CreateApplicationBody = z.infer<typeof CreateApplicationBodySchema>;

export const SALARY_ORDER_MESSAGE = 'Max salary must be greater than min salary';
export const SALARY_PERIOD_MESSAGE = 'Please select a salary period';

/** PATCH /api/applications/:id: any editable field; omitted fields keep their value. */
export const PatchApplicationBodySchema = z
  .object({
    title: RequiredText(200),
    companyName: RequiredText(200),
    location: z.string().trim().max(200),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    postingUrl: UrlField,
    descriptionHtml: z.string().max(200_000),
    salaryMin: z.number().nonnegative().max(100_000_000).nullable(),
    salaryMax: z.number().nonnegative().max(100_000_000).nullable(),
    salaryCurrency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/)
      .transform((value) => value.toUpperCase())
      .nullable(),
    salaryPeriod: z.enum(TRACKER_PAY_PERIODS).nullable(),
    favorite: z.boolean(),
    resumeId: z.string().nullable(),
    coverLetterId: z.string().nullable(),
    notesHtml: z.string().max(200_000),
    trackedOn: IsoDate,
  })
  .partial()
  .superRefine((body, ctx) => {
    const { salaryMin: min, salaryMax: max } = body;
    if (typeof min === 'number' && typeof max === 'number' && max < min) {
      ctx.addIssue({ code: 'custom', path: ['salaryMax'], message: SALARY_ORDER_MESSAGE });
    }
    if ((typeof min === 'number' || typeof max === 'number') && body.salaryPeriod === null) {
      ctx.addIssue({ code: 'custom', path: ['salaryPeriod'], message: SALARY_PERIOD_MESSAGE });
    }
  });
export type PatchApplicationBody = z.infer<typeof PatchApplicationBodySchema>;

/** PUT /api/applications/:id/status ("Move to", drag and drop, the Status select). `occurredOn` defaults to today. */
export const StatusChangeBodySchema = z.object({
  status: ApplicationStatusSchema,
  occurredOn: IsoDate.optional(),
});
export type StatusChangeBody = z.infer<typeof StatusChangeBodySchema>;

/** PUT /api/applications/:id/events/:status (the timeline's date popover). */
export const EventDateBodySchema = z.object({ occurredOn: IsoDate });
export type EventDateBody = z.infer<typeof EventDateBodySchema>;

export const EventStatusParam = z.coerce.number().pipe(ApplicationStatusSchema);

/** The application after a status or event change, with the events and the new current status. */
export const StatusChangeResponseSchema = z.object({
  id: z.string(),
  currentStatus: ApplicationStatusSchema,
  events: z.array(StatusEventSchema),
  updatedAt: IsoDateTime,
});
export type StatusChangeResponse = z.infer<typeof StatusChangeResponseSchema>;

export const BULK_ACTIONS = ['archive', 'unarchive', 'delete', 'status'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

/** POST /api/applications/bulk ("Manage jobs"). `status` is required for the status action. */
export const BulkApplicationsBodySchema = z
  .object({
    ids: z.array(z.string().min(1).max(64)).min(1).max(500),
    action: z.enum(BULK_ACTIONS),
    status: ApplicationStatusSchema.optional(),
    occurredOn: IsoDate.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.action === 'status' && body.status === undefined) {
      ctx.addIssue({ code: 'custom', path: ['status'], message: 'Choose a status' });
    }
  });
export type BulkApplicationsBody = z.infer<typeof BulkApplicationsBodySchema>;

export const BulkApplicationsResponseSchema = z.object({ affected: z.number().int().nonnegative() });

/** POST /api/applications/archive-all. */
export const ArchiveAllResponseSchema = z.object({ archived: z.number().int().nonnegative() });

/** One mapped CSV row: the raw text of each field (see `readImportRow`). */
export const TrackerImportRowSchema = z.object({
  title: z.string().max(500).optional(),
  companyName: z.string().max(500).optional(),
  location: z.string().max(500).optional(),
  employmentType: z.string().max(100).optional(),
  status: z.string().max(100).optional(),
  notes: z.string().max(20_000).optional(),
  postingUrl: z.string().max(2000).optional(),
  appliedOn: z.string().max(100).optional(),
});

/** POST /api/applications/import. `statusMap` is the wizard's "Map status values" (file text -> status). */
export const TrackerImportBodySchema = z.object({
  rows: z.array(TrackerImportRowSchema).min(1).max(2000),
  statusMap: z.record(z.string(), ApplicationStatusSchema).default({}),
});
export type TrackerImportBody = z.infer<typeof TrackerImportBodySchema>;

export const TrackerImportResponseSchema = z.object({
  imported: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  /** 1-based data row numbers. */
  errors: z.array(z.object({ row: z.number().int().positive(), message: z.string() })),
});
export type TrackerImportResponse = z.infer<typeof TrackerImportResponseSchema>;

/** GET /api/applications/sankey. */
export const SankeyResponseSchema = z.object({
  nodes: z.array(
    z.object({ id: z.string(), status: ApplicationStatusSchema, color: z.string(), value: z.number().int() }),
  ),
  links: z.array(z.object({ source: z.string(), target: z.string(), value: z.number().int() })),
  total: z.number().int().nonnegative(),
});
export type SankeyResponse = z.infer<typeof SankeyResponseSchema>;

const FunnelRateSchema = z.object({
  percent: z.number().int().min(0).max(100),
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
});

/** GET /api/applications/insights (see `insights`). */
export const InsightsResponseSchema = z.object({
  activity: z.object({
    total: z.number().int().nonnegative(),
    mostActiveDay: z.object({ weekday: z.string(), count: z.number().int().positive() }).nullable(),
    perDay: z.number().nonnegative(),
    perWeek: z.number().nonnegative(),
    perMonth: z.number().nonnegative(),
  }),
  funnel: z.object({
    appliedToScreening: FunnelRateSchema,
    screeningToInterview: FunnelRateSchema,
    interviewToOffer: FunnelRateSchema,
  }),
  response: z.object({
    averageResponseDays: z.number().nonnegative().nullable(),
    ghostRate: z.number().int().min(0).max(100),
    longestWait: z.object({ days: z.number().int().nonnegative(), title: z.string(), companyName: z.string() }).nullable(),
  }),
});
export type InsightsResponse = z.infer<typeof InsightsResponseSchema>;

/** POST /api/applications/:id/questions. */
export const CreateQuestionBodySchema = z.object({
  question: z.string().trim().min(1, 'Required').max(1000),
  answer: z.string().max(20_000).default(''),
});
/** PATCH /api/applications/:id/questions/:questionId. */
export const PatchQuestionBodySchema = z
  .object({
    question: z.string().trim().min(1, 'Required').max(1000),
    answer: z.string().max(20_000),
    position: z.number().int().nonnegative(),
  })
  .partial();
export const QuestionListResponseSchema = listResponse(ApplicationQuestionSchema);

/** One removable chip under the toolbar. */
export interface FilterChip {
  key: 'from' | 'until' | 'jobType' | 'status' | 'favorites' | 'sort';
  label: string;
  status?: ApplicationStatus;
}

/** The active-filter chips: "From Oct 22", "Until Oct 22", "Full-Time", each status, "Favorites", the sort. */
export function trackerFilterChips(filters: Partial<TrackerFilters>): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.from) chips.push({ key: 'from', label: `From ${formatShortDate(filters.from)}` });
  if (filters.until) chips.push({ key: 'until', label: `Until ${formatShortDate(filters.until)}` });
  if (filters.jobType) chips.push({ key: 'jobType', label: EMPLOYMENT_TYPE_LABEL[filters.jobType as EmploymentType] });
  for (const status of filters.statuses ?? []) chips.push({ key: 'status', label: STATUS_INFO[status].label, status });
  if (filters.favorites) chips.push({ key: 'favorites', label: 'Favorites' });
  const sort = filters.sort ?? 'tracked';
  const order = filters.order ?? 'desc';
  if (sort !== 'tracked' || order !== 'desc') {
    chips.push({ key: 'sort', label: `Sort: ${TRACKER_SORT_LABEL[sort].toLowerCase()} (${order})` });
  }
  return chips;
}
