'use client';

import { clsx } from 'clsx';
import { PAGE_GUTTER } from '@/components/shell/layout';
import { EmptyState } from '@/components/ui/EmptyState';
import { ShieldCheckIcon } from '@/components/ui/icons';
import { Notice } from '@/components/ui/Notice';
import { useAuth } from '@/lib/auth';

/*
 * PLACEHOLDER (work package F5). Packages J1 (job sources, imports, reports) and F4 (AI health) fill this page.
 */
export function AdminPage() {
  const { isAdmin } = useAuth();
  return (
    <div className={clsx('mx-auto w-full max-w-[880px] pt-9 pb-20', PAGE_GUTTER)}>
      <h1 className="text-[30px] leading-10 font-bold tracking-[-0.01em] text-foreground">Admin</h1>
      <p className="mt-2 text-base text-muted-foreground">Job sources, imports, reports and AI health for this installation.</p>
      {isAdmin ? (
        <div className="mt-8 rounded-surface border border-border bg-surface shadow-soft">
          <EmptyState
            icon={<ShieldCheckIcon size={22} />}
            title="Nothing to administer yet"
            description="Job sources, imports, reports and AI health will appear here."
          />
        </div>
      ) : (
        <Notice tone="warning" className="mt-8">
          That is an administrator-only part of this installation.
        </Notice>
      )}
    </div>
  );
}
