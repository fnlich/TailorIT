'use client';

import { JOB_SORTS, JOB_SORT_LABEL, hasJobFilters, type JobSort, type JobsQuery } from '@tailorit/shared';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { CaretDownIcon, MagnifyingGlassIcon } from '@/components/ui/icons';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/Menu';
import { Notice } from '@/components/ui/Notice';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { userMessage } from '@/lib/api';
import { useNow } from '@/lib/useNow';
import type { JobListItem } from '../api';
import { activeFilters } from '../filters';
import { foundJobsLabel } from '../format';
import type { useJobsList } from '../hooks';
import { jobHrefBuilder } from '../url';
import { JobCard } from './JobCard';
import { SaveAllButton } from './SaveAllButton';

export interface JobListProps {
  query: JobsQuery;
  list: ReturnType<typeof useJobsList>;
  selectedId: number | null;
  /** The panel that scrolls (the infinite-scroll sentinel watches it). */
  scrollRef: RefObject<HTMLDivElement | null>;
  onSelect: (jobId: number) => void;
  onToggleSave: (job: JobListItem) => void;
  onQueryChange: (patch: Partial<JobsQuery>) => void;
  onClearAll: () => void;
  companyNames: ReadonlyMap<string, string>;
}

/** Few enough results that Simplify suggests removing a filter. */
const FEW_RESULTS = 10;

function SortMenu({ sort, onChange }: { sort: JobSort; onChange: (sort: JobSort) => void }) {
  return (
    <Menu>
      <MenuTrigger
        aria-label={`Sort jobs: ${JOB_SORT_LABEL[sort]}`}
        className="-mr-2 inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-xs font-medium text-black hover:bg-hover data-popup-open:bg-hover"
      >
        {JOB_SORT_LABEL[sort]}
        <CaretDownIcon size={14} />
      </MenuTrigger>
      <MenuContent align="end" width="w-48" aria-label="Sort jobs">
        <MenuRadioGroup value={sort} onValueChange={onChange}>
          {JOB_SORTS.map((value) => (
            <MenuRadioItem key={value} value={value} closeOnClick>
              {JOB_SORT_LABEL[value]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

function CardSkeleton() {
  return (
    <li className="flex gap-3 px-4 py-4" aria-hidden="true">
      <Skeleton className="size-10" rounded="control" />
      <div className="flex flex-1 flex-col gap-2 pt-0.5">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-3 w-1/4" />
      </div>
    </li>
  );
}

/**
 * The left panel: "Found N jobs", Save all and the sort, then the cards, 21 at a time; the next page loads as the end
 * of the list comes near (IntersectionObserver with Simplify's 150% bottom margin). "Load more" appears only after an
 * error.
 */
export function JobList({
  query,
  list,
  selectedId,
  scrollRef,
  onSelect,
  onToggleSave,
  onQueryChange,
  onClearAll,
  companyNames,
}: JobListProps) {
  const now = useNow();
  const sentinel = useRef<HTMLDivElement>(null);
  const items = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage, isFetchNextPageError } = list;

  useEffect(() => {
    const target = sentinel.current;
    const root = scrollRef.current;
    if (!target || !root || !hasNextPage || isFetchNextPageError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { root, rootMargin: '0px 0px 150% 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [scrollRef, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, items.length]);

  const hrefOf = useMemo(() => jobHrefBuilder(query), [query]);
  const filtered = hasJobFilters(query);
  const chips = filtered && !hasNextPage && total > 0 && total < FEW_RESULTS ? activeFilters(query, companyNames) : [];

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center justify-between gap-2 bg-surface pr-4 pl-4">
        <p className="min-w-0 truncate text-xs text-muted-foreground" role="status" aria-live="polite">
          {list.isPending ? 'Finding jobs...' : list.data ? foundJobsLabel(total) : ''}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <SaveAllButton query={query} list={list} />
          <SortMenu sort={query.sort} onChange={(sort) => onQueryChange({ sort })} />
        </div>
      </div>

      {list.isPending ? (
        <ul aria-label="Loading jobs">
          {Array.from({ length: 5 }, (_, index) => (
            <CardSkeleton key={index} />
          ))}
        </ul>
      ) : !list.data ? (
        <div className="p-4">
          <Notice
            tone="error"
            title="The jobs could not be loaded"
            action={
              <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
                Try again
              </Button>
            }
          >
            {userMessage(list.error)}
          </Notice>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<MagnifyingGlassIcon size={22} />}
          title="No matching jobs found"
          description={
            filtered ? 'Try a different search, or remove a filter to see more jobs.' : 'New postings will appear here as job boards are added.'
          }
          action={
            filtered ? (
              <Button variant="outline" onClick={onClearAll}>
                Clear all filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul aria-label="Jobs">
            {items.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                href={hrefOf(job.id)}
                selected={job.id === selectedId}
                sort={query.sort}
                now={now}
                onSelect={onSelect}
                onToggleSave={onToggleSave}
              />
            ))}
          </ul>
          <div ref={sentinel} aria-hidden="true" className="h-px" />
          {isFetchingNextPage && (
            <div className="flex justify-center py-4">
              <Spinner size={18} label="Loading more jobs..." />
            </div>
          )}
          {isFetchNextPageError && (
            <div className="flex flex-col items-center gap-2 px-4 py-4 text-center">
              <p className="text-sm text-muted-foreground">{userMessage(list.error, 'More jobs could not be loaded.')}</p>
              <Button variant="outline" size="sm" onClick={() => void fetchNextPage()}>
                Load more
              </Button>
            </div>
          )}
          {chips.length > 0 && (
            <div className="mt-2 border-t border-border px-4 py-5">
              <p className="text-sm text-muted-foreground">
                Only {total} {total === 1 ? 'job matches' : 'jobs match'} your filters. Remove one of these filters to see more
                results.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {chips.map((chip) => (
                  <Chip key={chip.key} tone="neutral" size="sm" onRemove={() => onQueryChange(chip.remove)} removeLabel={`Remove ${chip.label}`}>
                    {chip.label}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
