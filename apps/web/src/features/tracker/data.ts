'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  ApplicationCountsSchema,
  ApplicationDetailSchema,
  ApplicationListResponseSchema,
  ApplicationQuestionSchema,
  BOARD_PAGE_SIZE,
  BoardResponseSchema,
  BulkApplicationsResponseSchema,
  ArchiveAllResponseSchema,
  InsightsResponseSchema,
  MatchResultSchema,
  SankeyResponseSchema,
  StatusChangeResponseSchema,
  TRACKER_LIST_PAGE_SIZE,
  TrackerImportResponseSchema,
  toIsoDate,
  type ApplicationCounts,
  type ApplicationDetail,
  type ApplicationQuestion,
  type ApplicationStatus,
  type ApplicationSummary,
  type BoardResponse,
  type BulkApplicationsBody,
  type CreateApplicationBody,
  type InsightsResponse,
  type ListResponse,
  type MatchResult,
  type PatchApplicationBody,
  type SankeyResponse,
  type StatusChangeResponse,
  type TrackerImportBody,
  type TrackerImportResponse,
  type TrackerTab,
} from '@tailorit/shared';
import { useState } from 'react';
import { z } from 'zod';
import { api, isApiError } from '@/lib/api';
import { createMatchPendingPoll, readResumeMatches, type ResumeMatchView } from './detail/resumeMatches';
import { filterKey, filterQuery, type FilterState } from './state';

/*
 * Everything the tracker reads and writes through /api/applications, as React Query hooks. All keys start with
 * 'tracker'; a change to applications invalidates the application reads (board, list, counts, chart, detail).
 */

export const trackerKeys = {
  all: ['tracker'] as const,
  counts: ['tracker', 'counts'] as const,
  board: (key: string, limits: string) => ['tracker', 'board', key, limits] as const,
  boards: ['tracker', 'board'] as const,
  list: (tab: TrackerTab, key: string) => ['tracker', 'list', tab, key] as const,
  lists: ['tracker', 'list'] as const,
  detail: (id: string) => ['tracker', 'app', id] as const,
  details: ['tracker', 'app'] as const,
  sankey: ['tracker', 'sankey'] as const,
  insights: ['tracker', 'insights'] as const,
  score: (id: string) => ['tracker', 'score', id] as const,
  scores: ['tracker', 'score'] as const,
  companies: ['tracker', 'companies'] as const,
  resumes: ['tracker', 'resumes'] as const,
  /** How the account's resumes rank for each application (the Documents tab's picker). */
  resumeMatches: ['tracker', 'resume-matches'] as const,
  resumeMatchesFor: (id: string) => ['tracker', 'resume-matches', id] as const,
  letters: ['tracker', 'letters'] as const,
  lettersFor: (id: string) => ['tracker', 'letters-for', id] as const,
};

/** The Jobs page's insights: their keyword card scores the resume linked to a tracked job. */
const JOBS_INSIGHTS_KEY = ['jobs', 'insights'] as const;

/** Status moves share a key, so overlapping ones settle together (see useMoveStatus). */
const MOVE_KEY = ['tracker', 'move'] as const;

/** The browser's calendar day: status dates are the person's own day, not the server's. */
export function localToday(): string {
  return toIsoDate(new Date()) ?? new Date().toISOString().slice(0, 10);
}

/** Refetches everything that shows applications (not the resume or letter pickers). */
export function invalidateApplications(client: QueryClient): Promise<void> {
  const keys = [
    trackerKeys.counts,
    trackerKeys.boards,
    trackerKeys.lists,
    trackerKeys.details,
    trackerKeys.sankey,
    trackerKeys.insights,
    trackerKeys.scores,
    trackerKeys.companies,
  ];
  return Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey }))).then(() => undefined);
}

/**
 * What an application's resume changing affects beyond the application: its ranking (which says who chose), its
 * Resume Score, and the Jobs page's keyword card for its job. Rankings are invalidated only here (a link changed) and
 * by a change to the resumes themselves (`invalidateResumes`), never by moves or archiving: each read scores every
 * resume of the account.
 */
export function invalidateResumeChoice(client: QueryClient, id: string): Promise<void> {
  const keys = [trackerKeys.resumeMatchesFor(id), trackerKeys.scores, JOBS_INSIGHTS_KEY];
  return Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey }))).then(() => undefined);
}

// ----------------------------------------------------------------------------------------------------- reads

export function useCounts() {
  return useQuery({
    queryKey: trackerKeys.counts,
    queryFn: ({ signal }) => api.get<ApplicationCounts>('/api/applications/counts', { schema: ApplicationCountsSchema, signal }),
  });
}

export type ColumnLimits = Partial<Record<ApplicationStatus, number>>;

/**
 * The board: every column's first page, then more pages for columns where "Load more applications" asked for them
 * (`limits`), so a refetch after a change keeps what was loaded.
 */
async function fetchBoard(
  filters: FilterState,
  q: string,
  limits: ColumnLimits,
  signal: AbortSignal,
): Promise<BoardResponse> {
  const query = filterQuery(filters, q);
  const board = await api.get<BoardResponse>('/api/applications/board', {
    query: { ...query, limit: BOARD_PAGE_SIZE },
    schema: BoardResponseSchema,
    signal,
  });
  const columns = await Promise.all(
    board.columns.map(async (column) => {
      const wanted = limits[column.status] ?? BOARD_PAGE_SIZE;
      let { items, nextCursor } = column;
      while (nextCursor && items.length < wanted) {
        const page = await api.get<BoardResponse>('/api/applications/board', {
          query: { ...query, status: column.status, cursor: nextCursor, limit: Math.min(100, wanted - items.length) },
          schema: BoardResponseSchema,
          signal,
        });
        const more = page.columns[0];
        if (!more) break;
        items = [...items, ...more.items];
        nextCursor = more.nextCursor;
      }
      return { ...column, items, nextCursor };
    }),
  );
  return { columns };
}

export function boardQueryKey(filters: FilterState, q: string, limits: ColumnLimits) {
  return trackerKeys.board(filterKey(filters, q), JSON.stringify(limits));
}

export function useBoard(filters: FilterState, q: string, limits: ColumnLimits, enabled: boolean) {
  return useQuery({
    queryKey: boardQueryKey(filters, q, limits),
    queryFn: ({ signal }) => fetchBoard(filters, q, limits, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useApplicationList(tab: TrackerTab, filters: FilterState, q: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: trackerKeys.list(tab, filterKey(filters, q)),
    queryFn: ({ pageParam, signal }) =>
      api.get<ListResponse<ApplicationSummary>>('/api/applications', {
        query: { ...filterQuery(filters, q), tab, cursor: pageParam, limit: TRACKER_LIST_PAGE_SIZE },
        schema: ApplicationListResponseSchema,
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    // Keep showing the rows while a search or filter reloads, but never the other tab's rows.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === tab ? previous : undefined),
    enabled,
  });
}

/**
 * One application's detail. `enabled` is false while its sheet is closed (the data stays for the exit animation).
 * While TailorIT is still choosing the resume of a saved job (`resumeMatchPending`) it is read again every few seconds,
 * for up to a minute, so the choice shows once the match worker links it; then what scores the linked resume (the
 * Resume Score, the Jobs card) is marked stale.
 */
export function useApplication(id: string | null, enabled = true) {
  const client = useQueryClient();
  const [poll] = useState(createMatchPendingPoll);
  return useQuery({
    queryKey: trackerKeys.detail(id ?? ''),
    queryFn: async ({ signal }) => {
      const before = client.getQueryData<ApplicationDetail>(trackerKeys.detail(id!));
      const detail = await api.get<ApplicationDetail>(`/api/applications/${encodeURIComponent(id!)}`, {
        schema: ApplicationDetailSchema,
        signal,
      });
      if (before?.resumeMatchPending && before.resumeId !== detail.resumeId) {
        for (const queryKey of [trackerKeys.score(detail.id), JOBS_INSIGHTS_KEY]) void client.invalidateQueries({ queryKey });
      }
      return detail;
    },
    enabled: enabled && Boolean(id),
    refetchInterval: (query) => poll.next(id ?? '', query.state.data?.resumeMatchPending === true, Date.now()),
  });
}

export function useSankey(enabled: boolean) {
  return useQuery({
    queryKey: trackerKeys.sankey,
    queryFn: ({ signal }) => api.get<SankeyResponse>('/api/applications/sankey', { schema: SankeyResponseSchema, signal }),
    enabled,
  });
}

export function useInsights(enabled: boolean) {
  return useQuery({
    queryKey: trackerKeys.insights,
    queryFn: ({ signal }) => api.get<InsightsResponse>('/api/applications/insights', { schema: InsightsResponseSchema, signal }),
    enabled,
  });
}

export function useResumeScore(id: string, enabled: boolean) {
  return useQuery({
    queryKey: trackerKeys.score(id),
    queryFn: ({ signal }) =>
      api.get<MatchResult>(`/api/applications/${encodeURIComponent(id)}/resume-score`, { schema: MatchResultSchema, signal }),
    enabled,
  });
}

/** How long a ranking stays fresh: each read scores every resume of the account (see invalidateResumeChoice). */
export const RESUME_MATCHES_STALE_MS = 30_000;

/** How the account's resumes rank for one application, best first; null when the server has none for it (404). */
export async function fetchResumeMatches(id: string, signal?: AbortSignal): Promise<ResumeMatchView | null> {
  try {
    return readResumeMatches(await api.get(`/api/applications/${encodeURIComponent(id)}/resume-matches`, { signal }));
  } catch (error) {
    if (isApiError(error) && error.status === 404) return null;
    throw error;
  }
}

/**
 * The Documents tab's ranked resume picker. No ranking (null, or a failure) sends the picker back to the plain list
 * (`useResumeOptions`); it is not retried, so that list comes at once.
 */
export function useResumeMatches(id: string, enabled: boolean) {
  return useQuery({
    queryKey: trackerKeys.resumeMatchesFor(id),
    queryFn: ({ signal }) => fetchResumeMatches(id, signal),
    enabled,
    retry: false,
    staleTime: RESUME_MATCHES_STALE_MS,
  });
}

/** Company suggestions: the account's companies and the job board's, searched on the server by `q`. */
export function useCompanyNames(q: string, enabled = true) {
  const query = q.trim().toLowerCase();
  return useQuery({
    queryKey: [...trackerKeys.companies, query] as const,
    queryFn: ({ signal }) =>
      api.get<{ items: string[] }>('/api/applications/companies', {
        query: { q: query || undefined },
        schema: z.object({ items: z.array(z.string()) }),
        signal,
      }),
    // The previous suggestions stay while the next ones load.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled,
  });
}

/** What the pickers need of a resume or a letter; read leniently, so another package's extra fields never matter. */
export interface ResumeOption {
  id: string;
  label: string;
  isDefault: boolean;
  kind: string;
}

export interface LetterOption {
  id: string;
  title: string;
}

const LooseResumeList = z.object({
  items: z.array(
    z
      .object({
        id: z.string(),
        label: z.string().optional(),
        title: z.string().nullable().optional(),
        isDefault: z.boolean().optional(),
        kind: z.string().optional(),
      })
      .passthrough(),
  ),
});

const LooseLetterList = z.object({
  items: z.array(z.object({ id: z.string(), title: z.string().optional() }).passthrough()),
});

/** The account's resumes for the pickers (Documents' API; the tracker degrades when it is not there). */
export function useResumeOptions(enabled: boolean) {
  return useQuery({
    queryKey: trackerKeys.resumes,
    queryFn: async ({ signal }): Promise<{ items: ResumeOption[] }> => {
      const data = await api.get<z.infer<typeof LooseResumeList>>('/api/resumes', { schema: LooseResumeList, signal });
      return {
        items: data.items.map((item) => ({
          id: item.id,
          label: item.label || item.title || 'Untitled resume',
          isDefault: item.isDefault ?? false,
          kind: item.kind ?? 'built',
        })),
      };
    },
    enabled,
    retry: false,
    // Read again whenever a picker opens: a resume made in another tab must be there.
    staleTime: 0,
  });
}

export function useCoverLetterOptions(enabled: boolean) {
  return useQuery({
    queryKey: trackerKeys.letters,
    queryFn: async ({ signal }): Promise<{ items: LetterOption[] }> => {
      const data = await api.get<z.infer<typeof LooseLetterList>>('/api/cover-letters', { schema: LooseLetterList, signal });
      return { items: data.items.map((item) => ({ id: item.id, title: item.title || 'Untitled cover letter' })) };
    },
    enabled,
    retry: false,
    staleTime: 0,
  });
}

/** Letters the cover letter editor wrote for this application ("Generate cover letter"). */
export function useLettersForApplication(id: string, enabled: boolean) {
  return useQuery({
    queryKey: trackerKeys.lettersFor(id),
    queryFn: ({ signal }) =>
      api.get<{ items: Array<{ id: string; title: string; updatedAt: string }> }>(
        `/api/applications/${encodeURIComponent(id)}/cover-letters`,
        {
          schema: z.object({ items: z.array(z.object({ id: z.string(), title: z.string(), updatedAt: z.string() })) }),
          signal,
        },
      ),
    enabled,
    staleTime: 0,
  });
}

// ---------------------------------------------------------------------------------------------------- writes

const path = (id: string) => `/api/applications/${encodeURIComponent(id)}`;

export const trackerApi = {
  create: (body: CreateApplicationBody) => api.post<ApplicationDetail>('/api/applications', body, { schema: ApplicationDetailSchema }),
  patch: (id: string, body: PatchApplicationBody) => api.patch<ApplicationDetail>(path(id), body, { schema: ApplicationDetailSchema }),
  /** "Let TailorIT choose": links the best-matching resume now (origin 'auto'); 409 when the application is not a Saved job. */
  autoMatchResume: (id: string) =>
    api.post<ApplicationDetail>(`${path(id)}/resume-match`, {}, { schema: ApplicationDetailSchema }),
  remove: (id: string) => api.delete(path(id)),
  status: (id: string, status: ApplicationStatus, occurredOn = localToday()) =>
    api.put<StatusChangeResponse>(`${path(id)}/status`, { status, occurredOn }, { schema: StatusChangeResponseSchema }),
  setDate: (id: string, status: ApplicationStatus, occurredOn: string) =>
    api.put<StatusChangeResponse>(`${path(id)}/events/${status}`, { occurredOn }, { schema: StatusChangeResponseSchema }),
  clearDate: (id: string, status: ApplicationStatus) =>
    api.delete<StatusChangeResponse>(`${path(id)}/events/${status}`, { schema: StatusChangeResponseSchema }),
  archive: (id: string) => api.post<ApplicationDetail>(`${path(id)}/archive`, undefined, { schema: ApplicationDetailSchema }),
  restore: (id: string) => api.post<ApplicationDetail>(`${path(id)}/restore`, undefined, { schema: ApplicationDetailSchema }),
  bulk: (body: BulkApplicationsBody) =>
    api.post<{ affected: number }>('/api/applications/bulk', body, { schema: BulkApplicationsResponseSchema }),
  archiveAll: () => api.post<{ archived: number }>('/api/applications/archive-all', undefined, { schema: ArchiveAllResponseSchema }),
  import: (body: TrackerImportBody) =>
    api.post<TrackerImportResponse>('/api/applications/import', body, { schema: TrackerImportResponseSchema }),
  /** Which of an import file's company names TailorIT knows (up to 1,000 at a time), each with its known name. */
  knownCompanies: (names: string[]) =>
    api.post<{ known: Record<string, string> }>(
      '/api/applications/import/companies',
      { names },
      { schema: z.object({ known: z.record(z.string(), z.string()) }) },
    ),
  addQuestion: (id: string, question: string, answer = '') =>
    api.post<ApplicationQuestion>(`${path(id)}/questions`, { question, answer }, { schema: ApplicationQuestionSchema }),
  patchQuestion: (id: string, questionId: string, body: { question?: string; answer?: string; position?: number }) =>
    api.patch<ApplicationQuestion>(`${path(id)}/questions/${encodeURIComponent(questionId)}`, body, { schema: ApplicationQuestionSchema }),
  deleteQuestion: (id: string, questionId: string) => api.delete(`${path(id)}/questions/${encodeURIComponent(questionId)}`),
};

/** Applies `update` to every cached application summary with this id (board columns, list pages, the detail). */
export function patchCachedApplication(
  client: QueryClient,
  id: string,
  update: (summary: ApplicationSummary) => ApplicationSummary,
): void {
  client.setQueriesData<BoardResponse>({ queryKey: trackerKeys.boards }, (board) =>
    board
      ? {
          columns: board.columns.map((column) => ({
            ...column,
            items: column.items.map((item) => (item.id === id ? update(item) : item)),
          })),
        }
      : board,
  );
  client.setQueriesData<{ pages: ListResponse<ApplicationSummary>[]; pageParams: unknown[] }>(
    { queryKey: trackerKeys.lists },
    (data) =>
      data
        ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map((item) => (item.id === id ? update(item) : item)) })) }
        : data,
  );
  client.setQueryData<ApplicationDetail>(trackerKeys.detail(id), (detail) =>
    detail ? { ...detail, ...update(detail) } : detail,
  );
}

/** Moves a card between columns in every cached board (the optimistic drag and drop). */
function moveOnBoards(client: QueryClient, id: string, to: ApplicationStatus): void {
  client.setQueriesData<BoardResponse>({ queryKey: trackerKeys.boards }, (board) => {
    if (!board) return board;
    let moving: ApplicationSummary | undefined;
    for (const column of board.columns) moving ??= column.items.find((item) => item.id === id);
    if (!moving || moving.currentStatus === to) return board;
    const moved = { ...moving, currentStatus: to };
    return {
      columns: board.columns.map((column) => {
        if (column.status === moving!.currentStatus) {
          return { ...column, total: Math.max(0, column.total - 1), items: column.items.filter((item) => item.id !== id) };
        }
        if (column.status === to) return { ...column, total: column.total + 1, items: [moved, ...column.items] };
        return column;
      }),
    };
  });
}

/** "Move to", drag and drop, the list's Status menu and the detail's select: optimistic, rolled back on failure. */
export function useMoveStatus(options: { onMoved?: (result: StatusChangeResponse, previous: ApplicationStatus | null) => void } = {}) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: MOVE_KEY,
    mutationFn: ({ id, status }: { id: string; status: ApplicationStatus; from?: ApplicationStatus | null }) =>
      trackerApi.status(id, status),
    onMutate: async ({ id, status }) => {
      await client.cancelQueries({ queryKey: trackerKeys.boards });
      const boards = client.getQueriesData<BoardResponse>({ queryKey: trackerKeys.boards });
      const detail = client.getQueryData<ApplicationDetail>(trackerKeys.detail(id));
      moveOnBoards(client, id, status);
      // The detail's select shows the choice at once (its timeline follows with the server's events).
      if (detail) client.setQueryData<ApplicationDetail>(trackerKeys.detail(id), { ...detail, currentStatus: status });
      return { boards, detail };
    },
    onError: (_error, { id }, context) => {
      // Put the snapshot back only when no other move is in flight (it would undo that one too); otherwise the
      // refetch below restores the truth.
      if (client.isMutating({ mutationKey: MOVE_KEY }) > 1) return;
      for (const [key, data] of context?.boards ?? []) client.setQueryData(key, data);
      if (context?.detail) client.setQueryData(trackerKeys.detail(id), context.detail);
    },
    onSuccess: (result, { from }) => {
      patchCachedApplication(client, result.id, (summary) => ({
        ...summary,
        currentStatus: result.currentStatus,
        events: result.events,
        updatedAt: result.updatedAt,
      }));
      options.onMoved?.(result, from ?? null);
    },
    // Refetch once the last overlapping move settles, so a refetch never overwrites another move's optimistic card.
    onSettled: () =>
      client.isMutating({ mutationKey: MOVE_KEY }) === 1 ? invalidateApplications(client) : Promise.resolve(),
  });
}

/** The heart: flips at once, rolled back on failure. */
export function useToggleFavorite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) => trackerApi.patch(id, { favorite }),
    onMutate: ({ id, favorite }) => {
      patchCachedApplication(client, id, (summary) => ({ ...summary, favorite }));
    },
    onError: (_error, { id, favorite }) => {
      patchCachedApplication(client, id, (summary) => ({ ...summary, favorite: !favorite }));
    },
    onSettled: () => invalidateApplications(client),
  });
}
