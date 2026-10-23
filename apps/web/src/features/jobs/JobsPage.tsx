'use client';

import { clsx } from 'clsx';
import { PAGE_GUTTER } from '@/components/shell/layout';
import { EmptyState } from '@/components/ui/EmptyState';
import { BriefcaseIcon } from '@/components/ui/icons';

/*
 * PLACEHOLDER (work package F5). Package J2 replaces this file with Simplify's job search (search pill, filter
 * pills, the list + detail panels and the job-analysis card). Keep the export name: app/(app)/jobs renders
 * <JobsPage />.
 */
export function JobsPage() {
  return (
    <div className={clsx('py-10', PAGE_GUTTER)}>
      <h1 className="sr-only">Jobs</h1>
      <div className="rounded-surface border border-border bg-surface shadow-soft">
        <EmptyState
          icon={<BriefcaseIcon size={22} />}
          title="Job search is on its way"
          description="Jobs from the boards you follow will appear here, with a keyword match against your default resume."
        />
      </div>
    </div>
  );
}
