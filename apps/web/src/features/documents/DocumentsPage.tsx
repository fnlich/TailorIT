'use client';

import { clsx } from 'clsx';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PAGE_GUTTER } from '@/components/shell/layout';
import { TabPanel } from '@/components/ui/SegmentedControl';
import { UnderlineTabs } from '@/components/ui/UnderlineTabs';
import { DocumentActionCards } from './DocumentActionCards';
import { CoverLettersTab } from './cover-letters/CoverLettersTab';
import { ResumesTab } from './resumes/ResumesTab';
import { TemplatesTab } from './templates/TemplatesTab';

export const DOCUMENT_TABS = [
  { value: 'resumes', label: 'Resumes' },
  { value: 'cover-letters', label: 'Cover Letters' },
  { value: 'templates', label: 'Templates' },
] as const;

export type DocumentsTab = (typeof DOCUMENT_TABS)[number]['value'];

/** `?tab=cover-letters` / `?tab=templates`; anything else (missing, a typo) is Resumes. */
export function readDocumentsTab(value: string | null | undefined): DocumentsTab {
  return DOCUMENT_TABS.some((tab) => tab.value === value) ? (value as DocumentsTab) : 'resumes';
}

export function documentsHref(tab: DocumentsTab): string {
  return `/documents?tab=${tab}`;
}

/**
 * Simplify's "My Documents": heading, the three "new" cards, then Resumes | Cover Letters | Templates bound to
 * `?tab=` (the address keeps the tab, so reload and back land on it).
 */
export function DocumentsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = readDocumentsTab(searchParams.get('tab'));

  const selectTab = (next: DocumentsTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className={clsx('mx-auto w-full max-w-[1600px] pt-9 pb-16', PAGE_GUTTER)}>
      <h1 className="text-2xl leading-10 font-bold tracking-[-0.01em] text-foreground sm:text-3xl">My Documents</h1>
      <p className="mt-2 text-base text-muted-foreground">Manage and tailor all of your job search documents here!</p>

      <DocumentActionCards className="mt-8" />

      <UnderlineTabs
        aria-label="Document types"
        items={DOCUMENT_TABS}
        value={tab}
        onValueChange={selectTab}
        className="mt-8"
      >
        <TabPanel value="resumes" className="mt-8">
          <ResumesTab />
        </TabPanel>
        <TabPanel value="cover-letters" className="mt-8">
          <CoverLettersTab />
        </TabPanel>
        <TabPanel value="templates" className="mt-8">
          <TemplatesTab />
        </TabPanel>
      </UnderlineTabs>
    </div>
  );
}
