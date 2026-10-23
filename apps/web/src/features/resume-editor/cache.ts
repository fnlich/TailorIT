import type { ResumeSummary } from '@tailorit/shared/resume';
import type { QueryClient } from '@tanstack/react-query';
import { resumeKeys } from './api';

/*
 * The Resumes list as React Query holds it, brought up to date from a change's own answer before the list is read
 * again: the page shows the change at once, and still shows it when that read fails (the API restarting, a dropped
 * connection). The read that follows (`invalidate`) reconciles anything else.
 */

function patch(client: QueryClient, change: (items: ResumeSummary[]) => ResumeSummary[]): void {
  client.setQueryData<ResumeSummary[]>(resumeKeys.list(), (items) => (items ? change(items) : items));
}

/** A resume created, saved, renamed or duplicated: replaced in place, or added first. */
export function putResumeInList(client: QueryClient, summary: ResumeSummary | null): void {
  if (!summary) return;
  patch(client, (items) => {
    const at = items.findIndex((item) => item.id === summary.id);
    if (at < 0) return [summary, ...items];
    const next = [...items];
    next[at] = summary;
    return next;
  });
}

/** Resumes deleted; `defaultId` (when the server named one) is the default after them. */
export function dropResumesFromList(client: QueryClient, ids: readonly string[], defaultId?: string | null): void {
  const gone = new Set(ids);
  patch(client, (items) =>
    items
      .filter((item) => !gone.has(item.id))
      .map((item) => (defaultId === undefined ? item : { ...item, isDefault: item.id === defaultId })),
  );
}

/** The default resume chosen. */
export function markDefaultInList(client: QueryClient, id: string | null): void {
  patch(client, (items) => items.map((item) => (item.isDefault === (item.id === id) ? item : { ...item, isDefault: item.id === id })));
}

/** Reads every resume query again (list, details). */
export function invalidateResumes(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: resumeKeys.all });
}
