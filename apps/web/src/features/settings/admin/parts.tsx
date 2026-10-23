'use client';

import { clsx } from 'clsx';
import { Fragment, type ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import type { RunStatus, RunSummary } from './types';

/** A column of an admin table: its header and how a row renders in it. */
export interface AdminColumn<T> {
  key: string;
  header: ReactNode;
  cell: (item: T) => ReactNode;
  /** Width/alignment classes for the header and cells (e.g. "w-40 text-right"). */
  className?: string;
}

/**
 * Simplify's table in a white card: #f8f8f8 header row, #e8e8e8 dividers. `renderExpanded` adds a full-width row under
 * a row whose key is in `expanded` (a run's log).
 */
export function AdminTable<T>({
  items,
  columns,
  getKey,
  renderExpanded,
  expanded,
  'aria-label': label,
  className,
}: {
  items: readonly T[];
  columns: readonly AdminColumn<T>[];
  getKey: (item: T) => string | number;
  renderExpanded?: (item: T) => ReactNode;
  expanded?: ReadonlySet<string | number>;
  'aria-label': string;
  className?: string;
}) {
  return (
    <div className={clsx('overflow-x-auto rounded-surface border border-border bg-surface shadow-soft', className)}>
      <table aria-label={label} className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="h-11 bg-surface-low">
            {columns.map((column) => (
              <th key={column.key} scope="col" className={clsx('px-4 text-sm font-semibold whitespace-nowrap text-foreground', column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const key = getKey(item);
            const open = expanded?.has(key) ?? false;
            return (
              <Fragment key={key}>
                <tr data-admin-row={key} className="border-t border-border align-middle transition-colors hover:bg-[#fcfcfc]">
                  {columns.map((column) => (
                    <td key={column.key} className={clsx('px-4 py-3.5 text-sm text-foreground', column.className)}>
                      {column.cell(item)}
                    </td>
                  ))}
                </tr>
                {open && renderExpanded && (
                  <tr className="border-t border-border bg-surface-low/60">
                    <td colSpan={columns.length} className="px-4 py-4">
                      {renderExpanded(item)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A few grey rows while a table loads. */
export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-surface border border-border bg-surface p-4 shadow-soft" aria-busy="true">
      <div className="flex flex-col gap-4">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-6 w-full" />
        ))}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<RunStatus, string> = {
  running: 'Running',
  succeeded: 'Succeeded',
  partial: 'Partial',
  failed: 'Failed',
};

/** A run's status as a badge: green, amber, red, or blue with a spinner while it runs. */
export function RunStatusBadge({ status }: { status: RunStatus | string | null }) {
  if (!status) return <span className="text-muted-foreground">Never run</span>;
  const known = status as RunStatus;
  const tone = known === 'succeeded' ? 'success' : known === 'partial' ? 'warning' : known === 'failed' ? 'destructive' : 'sky';
  return (
    <Badge tone={tone} icon={known === 'running' ? <Spinner size={12} /> : undefined}>
      {STATUS_LABEL[known] ?? status}
    </Badge>
  );
}

/** "+12 new · 3 updated · 2 closed · 1 failed": what a run changed, the zero parts left out. */
export function runCounts(run: Pick<RunSummary, 'created' | 'updated' | 'unchanged' | 'deactivated' | 'failed'>): string {
  const parts = [
    run.created ? `${run.created} new` : '',
    run.updated ? `${run.updated} updated` : '',
    run.unchanged ? `${run.unchanged} unchanged` : '',
    run.deactivated ? `${run.deactivated} closed` : '',
    run.failed ? `${run.failed} failed` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No changes';
}

/** How long a run took: "42s", "3m 05s"; "Running" while it has no end. */
export function runDuration(run: Pick<RunSummary, 'startedAt' | 'finishedAt'>): string {
  if (!run.finishedAt) return 'Running';
  const seconds = Math.max(0, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/** A tab's heading row: title and description on the left, actions on the right. */
export function SectionHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-xl leading-7 font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
