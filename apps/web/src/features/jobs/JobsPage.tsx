'use client';

import { clsx } from 'clsx';
import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { PAGE_GUTTER } from '@/components/shell/layout';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { userMessage } from '@/lib/api';
import type { JobListItem } from './api';
import { JobDetailPanel } from './detail/JobDetailPanel';
import { clearedQuery } from './filters';
import { useFacet, useJobsList, useSaveJob, useUnsaveJob } from './hooks';
import { JobList } from './list/JobList';
import { JobsToolbar } from './toolbar/JobsToolbar';
import { queryKeyOf } from './url';
import { useJobsUrl } from './useJobsUrl';

/**
 * Simplify's Jobs page (`/jobs?jobId=…&filters`): the toolbar on the canvas, then one white bordered frame split into
 * the list (a third) and the selected job (two thirds), each scrolling on its own. The first job opens by itself;
 * the address keeps the job and every filter.
 */
export function JobsPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <JobsPageContent />
    </Suspense>
  );
}

function JobsPageContent() {
  const toast = useToast();
  const { query, jobId, setQuery, updateQuery, selectJob } = useJobsUrl();
  const list = useJobsList(query);
  const save = useSaveJob();
  const unsave = useUnsaveJob();
  const listScrollRef = useRef<HTMLDivElement>(null);
  const companies = useFacet('companies', '', query.companies.length > 0);

  const items = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data]);
  const settled = list.isSuccess && !list.isPlaceholderData;

  // The first job opens by itself (and the address records it, so reload lands on the same job).
  useEffect(() => {
    if (jobId === null && settled && items[0]) selectJob(items[0].id);
  }, [jobId, settled, items, selectJob]);

  // New filters start the list from the top.
  const filtersKey = queryKeyOf(query);
  useEffect(() => {
    listScrollRef.current?.scrollTo({ top: 0 });
  }, [filtersKey]);

  const companyNames = useMemo(
    () => new Map((companies.data?.items ?? []).map((item) => [item.value, item.label] as const)),
    [companies.data],
  );

  const toggleSave = useCallback(
    (job: JobListItem) => {
      if (job.appliedOn) {
        toast.info("You've applied to this job", 'It is in your Job Tracker as Applied.');
        return;
      }
      if (job.saved && job.applicationId) {
        unsave.mutate(
          { jobId: job.id, applicationId: job.applicationId },
          { onError: (error) => toast.error('The job could not be removed from saved jobs', userMessage(error)) },
        );
        return;
      }
      save.mutate(
        { jobId: job.id },
        { onError: (error) => toast.error('The job could not be saved', userMessage(error)) },
      );
    },
    [save, unsave, toast],
  );

  // After hiding, the next job in the list opens (or the one before when it was the last).
  const onJobsHidden = useCallback(
    ({ jobId: hiddenJob, companyId }: { jobId?: number; companyId?: number }) => {
      const gone = (item: JobListItem) =>
        (hiddenJob !== undefined && item.id === hiddenJob) || (companyId !== undefined && item.company.id === companyId);
      const index = items.findIndex((item) => item.id === jobId);
      const after = items.slice(index + 1).find((item) => !gone(item));
      const before = items
        .slice(0, Math.max(index, 0))
        .reverse()
        .find((item) => !gone(item));
      selectJob((after ?? before)?.id ?? null);
    },
    [items, jobId, selectJob],
  );

  const waitingForFirst = jobId === null && (list.isPending || list.isPlaceholderData);

  return (
    <div className={clsx('flex flex-col pt-4 lg:h-[calc(100dvh-63px)]', PAGE_GUTTER)}>
      <h1 className="sr-only">Jobs</h1>
      <JobsToolbar
        query={query}
        onChange={updateQuery}
        onReplace={setQuery}
        onClearAll={() => setQuery(clearedQuery(query))}
      />
      <div
        data-jobs-frame
        className="mt-4 grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-t-surface border border-b-0 border-border bg-surface lg:grid-cols-3"
      >
        <div
          ref={listScrollRef}
          role="region"
          aria-label="Job list"
          className="max-h-[60vh] min-h-0 overflow-y-auto lg:max-h-none"
        >
          <JobList
            query={query}
            list={list}
            selectedId={jobId}
            scrollRef={listScrollRef}
            onSelect={selectJob}
            onToggleSave={toggleSave}
            onQueryChange={updateQuery}
            onClearAll={() => setQuery(clearedQuery(query))}
            companyNames={companyNames}
          />
        </div>
        <JobDetailPanel
          jobId={jobId}
          waiting={waitingForFirst}
          onJobsHidden={onJobsHidden}
          className="border-t border-border lg:col-span-2 lg:border-t-0 lg:border-l"
        />
      </div>
    </div>
  );
}
