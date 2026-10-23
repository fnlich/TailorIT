'use client';

import { clsx } from 'clsx';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PAGE_GUTTER } from '@/components/shell/layout';
import { PageSpinner } from '@/components/ui/Spinner';
import type { JobListItem } from './api';
import { JobDetailPanel } from './detail/JobDetailPanel';
import { clearedQuery } from './filters';
import { useFacet, useJobsList, useSaveToggle } from './hooks';
import { JobList } from './list/JobList';
import { JobsToolbar } from './toolbar/JobsToolbar';
import { queryKeyOf } from './url';
import { useJobsUrl } from './useJobsUrl';

/** Below Tailwind's `lg` the page is one column: the selected job's detail sits under the list. */
function isOneColumn(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 1023.98px)').matches;
}

/**
 * Simplify's Jobs page (`/jobs?jobId=…&filters`): the toolbar on the canvas, then one white bordered frame split into
 * the list (a third) and the selected job (two thirds), each scrolling on its own. The first job opens by itself;
 * the address keeps the job and every filter. In one column (narrow screens) choosing a job scrolls its detail into
 * view, and the detail's back arrow returns to the list.
 */
export function JobsPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <JobsPageContent />
    </Suspense>
  );
}

function JobsPageContent() {
  const { query, jobId, setQuery, updateQuery, selectJob } = useJobsUrl();
  const list = useJobsList(query);
  const { toggle } = useSaveToggle();
  const listScrollRef = useRef<HTMLDivElement>(null);
  /** Counts the jobs chosen in one column: each change asks the detail panel to scroll itself into view. */
  const [revealDetail, setRevealDetail] = useState(0);
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
    (job: JobListItem) => toggle({ jobId: job.id, saved: job.saved, appliedOn: job.appliedOn, applicationId: job.applicationId }),
    [toggle],
  );

  // A job chosen from the list; in one column its detail (under the list) scrolls into view.
  const openJob = useCallback(
    (id: number) => {
      selectJob(id);
      if (isOneColumn()) setRevealDetail((count) => count + 1);
    },
    [selectJob],
  );

  // Back to the list from the detail (one column), with the chosen job in view.
  const showList = useCallback(() => {
    const panel = listScrollRef.current;
    if (!panel || !isOneColumn()) return;
    panel.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // A job that no longer exists: back to the list, where the first job opens.
  const backToJobs = useCallback(() => {
    selectJob(null);
    showList();
  }, [selectJob, showList]);

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
      {/* Clipped, not a scroll container: in one column the detail's sticky header then sticks under the app header. */}
      <div
        data-jobs-frame
        className="mt-4 grid min-h-0 flex-1 grid-cols-1 overflow-clip rounded-t-surface border border-b-0 border-border bg-surface lg:grid-cols-3"
      >
        <div
          ref={listScrollRef}
          role="region"
          aria-label="Job list"
          className="max-h-[60vh] min-h-0 scroll-mt-[79px] overflow-y-auto lg:max-h-none"
        >
          <JobList
            query={query}
            list={list}
            selectedId={jobId}
            scrollRef={listScrollRef}
            onSelect={openJob}
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
          revealSignal={revealDetail}
          onShowList={showList}
          onBackToJobs={backToJobs}
          className="border-t border-border lg:col-span-2 lg:border-t-0 lg:border-l"
        />
      </div>
    </div>
  );
}
