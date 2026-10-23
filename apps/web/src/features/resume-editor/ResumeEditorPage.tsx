'use client';

import Link from 'next/link';
import { EditorBar } from '@/components/shell/EditorBar';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FileTextIcon } from '@/components/ui/icons';

/*
 * PLACEHOLDER (work package F5). Package R2 replaces this file with the resume builder: the template chooser at
 * /resumes/new (`resumeId` null) and the editor at /resumes/[id]. Keep the export name and props.
 */
export function ResumeEditorPage({ resumeId }: { resumeId: string | null }) {
  return (
    <>
      <EditorBar name={resumeId ? 'Resume' : 'New resume'} documentsHref="/documents?tab=resumes" />
      <main className="flex flex-1 items-start justify-center px-4 py-16">
        <div className="w-full max-w-lg rounded-surface border border-border bg-surface shadow-soft">
          <EmptyState
            icon={<FileTextIcon size={22} />}
            title={resumeId ? 'The resume editor is on its way' : 'Start building a resume'}
            description="Choose a design you like. You can customize or switch it later."
            action={
              <Link href="/documents?tab=resumes" className={buttonClasses({ variant: 'outline' })}>
                Back to Documents
              </Link>
            }
          />
        </div>
      </main>
    </>
  );
}
