'use client';

import Link from 'next/link';
import { EditorBar } from '@/components/shell/EditorBar';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { CirclesFourIcon } from '@/components/ui/icons';

/*
 * PLACEHOLDER (work package F5). Package C replaces this file with the template editor ({{VARIABLE}} chips,
 * "Insert variable...", "Base from template...", Copilot AI Prompt). Keep the export names and props.
 */
export function TemplateEditorPage({ templateId }: { templateId: string }) {
  return (
    <>
      <EditorBar
        name="Template"
        documentsHref="/documents?tab=templates"
        info="This name appears in your documents list when you choose a template for a cover letter."
      />
      <main className="flex flex-1 items-start justify-center px-4 py-16">
        <div className="w-full max-w-lg rounded-surface border border-border bg-surface shadow-soft">
          <EmptyState
            icon={<CirclesFourIcon size={22} />}
            title="The template editor is on its way"
            description={`Template ${templateId} will open here.`}
            action={
              <Link href="/documents?tab=templates" className={buttonClasses({ variant: 'outline' })}>
                Back to Documents
              </Link>
            }
          />
        </div>
      </main>
    </>
  );
}

/** PLACEHOLDER: /cover-letter-template/new creates "Template {datetime}" and opens its editor (package C). */
export function NewTemplatePage() {
  return (
    <>
      <EditorBar name="New template" documentsHref="/documents?tab=templates" />
      <main className="flex flex-1 items-start justify-center px-4 py-16">
        <div className="w-full max-w-lg rounded-surface border border-border bg-surface shadow-soft">
          <EmptyState
            icon={<CirclesFourIcon size={22} />}
            title="Create a reusable cover letter template"
            description="Templates arrive with the cover-letter editor."
            action={
              <Link href="/documents?tab=templates" className={buttonClasses({ variant: 'outline' })}>
                Back to Documents
              </Link>
            }
          />
        </div>
      </main>
    </>
  );
}
