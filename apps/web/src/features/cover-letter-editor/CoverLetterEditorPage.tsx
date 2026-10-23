'use client';

import Link from 'next/link';
import { EditorBar } from '@/components/shell/EditorBar';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FileTextIcon } from '@/components/ui/icons';

/*
 * PLACEHOLDER (work package F5). Package C replaces this file with the cover-letter editor (TipTap paper, generate
 * dialog, autosave). Keep the export name and props: app/(editor)/cover-letter/[id] renders it.
 */
export function CoverLetterEditorPage({ letterId }: { letterId: string }) {
  return (
    <>
      <EditorBar
        name="Cover letter"
        documentsHref="/documents?tab=cover-letters"
        info="This name is only for your documents list. It is not shown inside the letter unless you add it in the editor."
      />
      <main className="flex flex-1 items-start justify-center px-4 py-16">
        <div className="w-full max-w-lg rounded-surface border border-border bg-surface shadow-soft">
          <EmptyState
            icon={<FileTextIcon size={22} />}
            title="The cover letter editor is on its way"
            description={`Letter ${letterId} will open here.`}
            action={
              <Link href="/documents?tab=cover-letters" className={buttonClasses({ variant: 'outline' })}>
                Back to Documents
              </Link>
            }
          />
        </div>
      </main>
    </>
  );
}

/**
 * PLACEHOLDER: /cover-letter/new creates "Cover Letter {M/D/YYYY}" and opens /cover-letter/[id] (package C).
 */
export function NewCoverLetterPage() {
  return (
    <>
      <EditorBar name="New cover letter" documentsHref="/documents?tab=cover-letters" />
      <main className="flex flex-1 items-start justify-center px-4 py-16">
        <div className="w-full max-w-lg rounded-surface border border-border bg-surface shadow-soft">
          <EmptyState
            icon={<FileTextIcon size={22} />}
            title="Generate a Tailored Cover Letter"
            description="Creating cover letters arrives with the cover-letter editor."
            action={
              <Link href="/documents?tab=cover-letters" className={buttonClasses({ variant: 'outline' })}>
                Back to Documents
              </Link>
            }
          />
        </div>
      </main>
    </>
  );
}
