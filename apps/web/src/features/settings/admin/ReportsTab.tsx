'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ShieldCheckIcon } from '@/components/ui/icons';
import { Notice } from '@/components/ui/Notice';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useToast } from '@/components/ui/Toast';
import { Tooltip } from '@/components/ui/Tooltip';
import { userMessage } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { adminKeys, fetchReports, updateReport } from './api';
import { AdminTable, SectionHeader, TableSkeleton, type AdminColumn } from './parts';
import type { AdminReport, ReportFilter, ReportStatus } from './types';

const STATUS_TONE = { open: 'sky', resolved: 'success', dismissed: 'neutral' } as const;
const STATUS_LABEL: Record<ReportStatus, string> = { open: 'Open', resolved: 'Resolved', dismissed: 'Dismissed' };

/** Admin > Reports: what people flagged on job postings (the Jobs page's flag button), to resolve or dismiss. */
export function ReportsTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const now = useNow();
  const [filter, setFilter] = useState<ReportFilter>('open');
  const reports = useQuery({ queryKey: adminKeys.reports(filter), queryFn: ({ signal }) => fetchReports(filter, signal) });

  const change = useMutation({
    mutationFn: ({ report, status, closeJob }: { report: AdminReport; status: ReportStatus; closeJob?: boolean }) =>
      updateReport(report.id, { status, closeJob }),
    onSuccess: (updated, { closeJob }) => {
      toast.success(
        updated.status === 'open' ? 'Report reopened' : updated.status === 'resolved' ? 'Report resolved' : 'Report dismissed',
        closeJob ? `${updated.job.title} is closed.` : undefined,
      );
      void queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] });
    },
    onError: (error) => toast.error('The report was not changed', userMessage(error)),
  });

  const counts = reports.data?.counts;
  const items = [
    { value: 'open' as const, label: `Open${counts ? ` (${counts.open})` : ''}` },
    { value: 'resolved' as const, label: 'Resolved' },
    { value: 'dismissed' as const, label: 'Dismissed' },
    { value: 'all' as const, label: 'All' },
  ];
  const busy = (report: AdminReport) => change.isPending && change.variables?.report.id === report.id;

  const columns: AdminColumn<AdminReport>[] = [
    {
      key: 'job',
      header: 'Job',
      cell: (report) => (
        <div className="min-w-0">
          <Link href={`/jobs?jobId=${report.job.id}`} className="font-semibold text-foreground hover:underline">
            {report.job.title}
          </Link>
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            {report.job.companyName}
            {!report.job.active && <Badge tone="neutral">Closed</Badge>}
          </p>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      className: 'w-72',
      cell: (report) => (
        <div>
          <p>{report.reasonLabel}</p>
          {report.details && <p className="line-clamp-2 text-[13px] text-muted-foreground">{report.details}</p>}
        </div>
      ),
    },
    {
      key: 'reporter',
      header: 'Reported by',
      className: 'w-56',
      cell: (report) => (
        <div className="min-w-0">
          <p className="truncate">{report.reporter.name || report.reporter.email}</p>
          <Tooltip content={new Date(report.createdAt).toLocaleString('en-US')}>
            <p className="text-[13px] text-muted-foreground">{relativeTime(report.createdAt, now)}</p>
          </Tooltip>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      className: 'w-36',
      cell: (report) => (
        <div>
          <Badge tone={STATUS_TONE[report.status]}>{STATUS_LABEL[report.status]}</Badge>
          {report.resolvedBy && <p className="mt-1 truncate text-[13px] text-muted-foreground">by {report.resolvedBy}</p>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-64 text-right',
      cell: (report) =>
        report.status === 'open' ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {report.reason === 'inactive' && report.job.active ? (
              <Button size="sm" disabled={busy(report)} onClick={() => change.mutate({ report, status: 'resolved', closeJob: true })}>
                Close job
              </Button>
            ) : (
              <Button size="sm" disabled={busy(report)} onClick={() => change.mutate({ report, status: 'resolved' })}>
                Resolve
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy(report)} onClick={() => change.mutate({ report, status: 'dismissed' })}>
              Dismiss
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy(report)} onClick={() => change.mutate({ report, status: 'open' })}>
            Reopen
          </Button>
        ),
    },
  ];

  return (
    <section>
      <SectionHeader
        title="Reports"
        description="Postings people flagged as closed, spam, wrong or duplicated. Closing a job hides it from search until a source lists it again."
        actions={<SegmentedControl aria-label="Report status" size="sm" items={items} value={filter} onValueChange={setFilter} />}
      />
      {reports.isError ? (
        <Notice tone="error" title="The reports could not be loaded">
          {userMessage(reports.error)}
        </Notice>
      ) : reports.isPending ? (
        <TableSkeleton />
      ) : reports.data.items.length === 0 ? (
        <div className="rounded-surface border border-border bg-surface shadow-soft">
          <EmptyState
            icon={<ShieldCheckIcon size={22} />}
            title={filter === 'open' ? 'No open reports' : 'No reports here'}
            description={filter === 'open' ? 'When someone flags a job, it appears here.' : undefined}
          />
        </div>
      ) : (
        <AdminTable aria-label="Job reports" items={reports.data.items} columns={columns} getKey={(report) => report.id} />
      )}
    </section>
  );
}
