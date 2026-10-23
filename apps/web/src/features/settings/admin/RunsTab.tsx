'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ArrowsClockwiseIcon, CaretDownIcon, CaretRightIcon } from '@/components/ui/icons';
import { IconButton } from '@/components/ui/IconButton';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Tooltip } from '@/components/ui/Tooltip';
import { userMessage } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { adminKeys, fetchRun, fetchRuns, fetchSources } from './api';
import { AdminTable, RunStatusBadge, runCounts, runDuration, SectionHeader, TableSkeleton, type AdminColumn } from './parts';
import { SOURCE_KIND_LABEL, type AdminRun, type RunTrigger } from './types';

const TRIGGER_LABEL: Record<RunTrigger, string> = {
  schedule: 'Schedule',
  manual: 'Run now',
  upload: 'Upload',
  startup: 'Startup',
};

/** Admin > Runs: every ingest run, newest first, with its counts; a row opens to its errors and log. */
export function RunsTab({ sourceId, onSourceChange }: { sourceId: number | null; onSourceChange: (sourceId: number | null) => void }) {
  const now = useNow();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const sources = useQuery({ queryKey: adminKeys.sources, queryFn: ({ signal }) => fetchSources(signal) });

  const runs = useInfiniteQuery({
    queryKey: adminKeys.runs(sourceId),
    queryFn: ({ pageParam, signal }) => fetchRuns({ sourceId, cursor: pageParam, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.items.some((run) => run.status === 'running')) ? 2000 : false,
  });

  const items = runs.data?.pages.flatMap((page) => page.items) ?? [];
  const toggle = (id: number) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const columns: AdminColumn<AdminRun>[] = [
    {
      key: 'open',
      header: <span className="sr-only">Details</span>,
      className: 'w-12 pr-0',
      cell: (run) => (
        <IconButton
          label={expanded.has(run.id) ? `Hide the log of run ${run.id}` : `Show the log of run ${run.id}`}
          icon={expanded.has(run.id) ? <CaretDownIcon size={16} /> : <CaretRightIcon size={16} />}
          size="sm"
          tooltip={false}
          aria-expanded={expanded.has(run.id)}
          onClick={() => toggle(run.id)}
        />
      ),
    },
    {
      key: 'source',
      header: 'Source',
      cell: (run) => (
        <div className="min-w-0">
          <p className="truncate font-semibold">{run.sourceName}</p>
          <p className="text-[13px] text-muted-foreground">
            {SOURCE_KIND_LABEL[run.sourceKind]} · Run {run.id}
          </p>
        </div>
      ),
    },
    { key: 'trigger', header: 'Trigger', className: 'w-28', cell: (run) => TRIGGER_LABEL[run.trigger] ?? run.trigger },
    {
      key: 'started',
      header: 'Started',
      className: 'w-40',
      cell: (run) => (
        <Tooltip content={new Date(run.startedAt).toLocaleString('en-US')}>
          <span>{relativeTime(run.startedAt, now)}</span>
        </Tooltip>
      ),
    },
    { key: 'took', header: 'Took', className: 'w-24 text-muted-foreground', cell: (run) => runDuration(run) },
    { key: 'status', header: 'Status', className: 'w-32', cell: (run) => <RunStatusBadge status={run.status} /> },
    {
      key: 'counts',
      header: 'Postings',
      className: 'w-72',
      cell: (run) => (
        <div>
          <p>
            <span className="font-semibold">{run.fetched}</span> <span className="text-muted-foreground">fetched</span>
          </p>
          <p className="text-[13px] text-muted-foreground">{runCounts(run)}</p>
        </div>
      ),
    },
  ];

  const sourceOptions = [
    { value: 'all', label: 'All sources' },
    ...(sources.data?.items ?? []).map((source) => ({ value: String(source.id), label: `${source.name} (${source.kindLabel})` })),
  ];

  return (
    <section>
      <SectionHeader
        title="Runs"
        description="Every fetch of every source: what it found, what changed, and what went wrong. Missing postings are only closed after a complete, successful fetch."
        actions={
          <>
            <Select
              aria-label="Source"
              options={sourceOptions}
              value={sourceId === null ? 'all' : String(sourceId)}
              onValueChange={(value) => onSourceChange(value === 'all' ? null : Number(value))}
              className="w-64"
            />
            <IconButton label="Refresh" icon={<ArrowsClockwiseIcon size={16} />} variant="outline" onClick={() => void runs.refetch()} />
          </>
        }
      />
      {runs.isError ? (
        <Notice tone="error" title="The runs could not be loaded">
          {userMessage(runs.error)}
        </Notice>
      ) : runs.isPending ? (
        <TableSkeleton />
      ) : items.length === 0 ? (
        <div className="rounded-surface border border-border bg-surface shadow-soft">
          <EmptyState size="sm" title="No runs yet" description="Run a source from the Sources tab, or import a file." />
        </div>
      ) : (
        <>
          <AdminTable
            aria-label="Ingest runs"
            items={items}
            columns={columns}
            getKey={(run) => run.id}
            expanded={expanded}
            renderExpanded={(run) => <RunLog runId={run.id} running={run.status === 'running'} />}
          />
          {runs.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={() => void runs.fetchNextPage()} loading={runs.isFetchingNextPage}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** A run's error and log lines, read when the row is opened. */
function RunLog({ runId, running }: { runId: number; running: boolean }) {
  const detail = useQuery({
    queryKey: adminKeys.run(runId),
    queryFn: ({ signal }) => fetchRun(runId, signal),
    refetchInterval: running ? 2000 : false,
  });
  if (detail.isPending) return <Spinner label="Loading the log..." />;
  if (detail.isError) return <Notice tone="error">{userMessage(detail.error)}</Notice>;
  const run = detail.data;
  return (
    <div className="flex flex-col gap-3">
      {run.error && (
        <Notice tone="error" title="This run failed">
          {run.error}
        </Notice>
      )}
      <pre
        aria-label={`Log of run ${run.id}`}
        className="max-h-80 overflow-auto rounded-control border border-border bg-surface px-3 py-2.5 font-mono text-xs leading-5 whitespace-pre-wrap text-foreground"
      >
        {run.log.length ? run.log.join('\n') : 'No log lines.'}
      </pre>
    </div>
  );
}
