'use client';

import { clsx } from 'clsx';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PAGE_GUTTER } from '@/components/shell/layout';
import { Notice } from '@/components/ui/Notice';
import { PageSpinner } from '@/components/ui/Spinner';
import { TabPanel } from '@/components/ui/SegmentedControl';
import { UnderlineTabs } from '@/components/ui/UnderlineTabs';
import { useAuth } from '@/lib/auth';
import { AiTab } from './admin/AiTab';
import { ImportTab } from './admin/ImportTab';
import { ReportsTab } from './admin/ReportsTab';
import { RunsTab } from './admin/RunsTab';
import { SourcesTab } from './admin/SourcesTab';
import { UsersTab } from './admin/UsersTab';

const ADMIN_TABS = [
  { value: 'sources', label: 'Sources' },
  { value: 'runs', label: 'Runs' },
  { value: 'import', label: 'Import jobs' },
  { value: 'reports', label: 'Reports' },
  { value: 'ai', label: 'AI' },
  { value: 'users', label: 'Users' },
] as const;
type AdminTab = (typeof ADMIN_TABS)[number]['value'];

function readTab(value: string | null): AdminTab {
  return ADMIN_TABS.some((tab) => tab.value === value) ? (value as AdminTab) : 'sources';
}

/**
 * Admin (/settings/admin?tab=sources|runs|import|reports|ai|users): job sources and their runs, job imports, reports
 * on postings, AI health and accounts. Administrators only; the API refuses everyone else as well.
 */
export function AdminPage() {
  const { isAdmin, status } = useAuth();
  return (
    <div className={clsx('mx-auto w-full max-w-[1400px] pt-9 pb-20', PAGE_GUTTER)}>
      <h1 className="text-[30px] leading-10 font-bold tracking-[-0.01em] text-foreground">Admin</h1>
      <p className="mt-2 text-base text-muted-foreground">Job sources, imports, reports, AI health and accounts for this installation.</p>
      {status === 'loading' ? (
        <PageSpinner />
      ) : isAdmin ? (
        <AdminConsole />
      ) : (
        <Notice tone="warning" className="mt-8">
          That is an administrator-only part of this installation.
        </Notice>
      )}
    </div>
  );
}

function AdminConsole() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = readTab(searchParams.get('tab'));
  const sourceParam = Number(searchParams.get('source'));
  const sourceId = Number.isInteger(sourceParam) && sourceParam > 0 ? sourceParam : null;

  const go = (next: AdminTab, source: number | null = null) => {
    const params = new URLSearchParams();
    params.set('tab', next);
    if (source !== null) params.set('source', String(source));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  const showRuns = (source: number | null) => go('runs', source);

  return (
    <UnderlineTabs aria-label="Admin sections" items={ADMIN_TABS} value={tab} onValueChange={(next) => go(next)} size="md" className="mt-8">
      <TabPanel value="sources" className="mt-8">
        <SourcesTab onShowRuns={showRuns} onImportAgain={(id) => go('import', id)} />
      </TabPanel>
      <TabPanel value="runs" className="mt-8">
        <RunsTab sourceId={sourceId} onSourceChange={showRuns} />
      </TabPanel>
      <TabPanel value="import" className="mt-8">
        <ImportTab sourceId={tab === 'import' ? sourceId : null} onShowRuns={showRuns} />
      </TabPanel>
      <TabPanel value="reports" className="mt-8">
        <ReportsTab />
      </TabPanel>
      <TabPanel value="ai" className="mt-8">
        <AiTab />
      </TabPanel>
      <TabPanel value="users" className="mt-8">
        <UsersTab />
      </TabPanel>
    </UnderlineTabs>
  );
}
