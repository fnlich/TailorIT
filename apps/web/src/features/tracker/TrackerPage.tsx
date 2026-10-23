'use client';

import { clsx } from 'clsx';
import { PAGE_GUTTER } from '@/components/shell/layout';
import { EmptyState } from '@/components/ui/EmptyState';
import { KanbanIcon } from '@/components/ui/icons';

/*
 * PLACEHOLDER (work package F5). Package T replaces this file with Simplify's job tracker (Active/Archived, Board |
 * List | Chart, Options, Add application). Keep the export name: app/(app)/tracker renders <TrackerPage />.
 */
export function TrackerPage() {
  return (
    <div className={clsx('py-10', PAGE_GUTTER)}>
      <h1 className="sr-only">Job Tracker</h1>
      <div className="rounded-surface border border-border bg-surface shadow-soft">
        <EmptyState
          icon={<KanbanIcon size={22} />}
          title="Add your first job application!"
          description="No more endless spreadsheets, keep track of everything in one place."
        />
      </div>
    </div>
  );
}
