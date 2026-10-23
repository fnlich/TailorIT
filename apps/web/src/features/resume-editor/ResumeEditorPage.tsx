'use client';

import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { EditorBar } from '@/components/shell/EditorBar';
import { PAGE_GUTTER } from '@/components/shell/layout';
import { buttonClasses } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { PageSpinner } from '@/components/ui/Spinner';
import { ApiError, userMessage } from '@/lib/api';
import { RESUMES_TAB_HREF, fetchResume, fetchTemplates, resumeKeys } from './api';
import { TemplateChooser } from './chooser/TemplateChooser';
import { ResumeEditor } from './editor/ResumeEditor';
import { readStartChoice } from './gallery';
import { UploadedResumeView } from './UploadedResumeView';

/**
 * The resume builder (free_tailor's "new resume" flow): /resumes/new is the template chooser, /resumes/new?template=
 * the editor for a new resume (it first asks "Import your existing resume"), /resumes/[id] the editor for a stored
 * one (an uploaded file gets its own page: it is not a document this editor writes).
 */
export function ResumeEditorPage({ resumeId }: { resumeId: string | null }) {
  return (
    // The new-resume route reads ?template= (useSearchParams), which needs a Suspense boundary when prerendered.
    <Suspense fallback={<PageSpinner />}>{resumeId ? <StoredResume id={resumeId} /> : <NewResume />}</Suspense>
  );
}

function NewResume() {
  const params = useSearchParams();
  const template = params.get('template');
  const layout = params.get('layout');
  const templatesQuery = useQuery({
    queryKey: resumeKeys.templates(),
    queryFn: ({ signal }) => fetchTemplates(signal),
    staleTime: 5 * 60_000,
    enabled: template !== null,
  });

  if (template === null) return <TemplateChooser />;
  if (templatesQuery.isPending) return <Waiting name="New resume" label="Loading the template..." />;
  // A list that failed to load proves nothing about the address: it is trusted as it is.
  const choice = readStartChoice({ template, layout }, templatesQuery.isError ? null : (templatesQuery.data ?? []));
  if (!choice) return <TemplateChooser />;
  return <ResumeEditor key={`${choice.templateId}:${choice.layout}`} resume={null} start={choice} offerImport />;
}

function StoredResume({ id }: { id: string }) {
  // Read afresh every time the editor opens (gcTime 0): a draft must never start from a page cached before a save.
  const query = useQuery({
    queryKey: resumeKeys.detail(id),
    queryFn: ({ signal }) => fetchResume(id, signal),
    gcTime: 0,
    staleTime: Infinity,
    retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
  });

  if (query.isPending) return <Waiting name="Resume" label="Loading the resume..." />;
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <>
        <EditorBar name="Resume" documentsHref={RESUMES_TAB_HREF} />
        <main className={clsx('mx-auto w-full max-w-xl pt-16', PAGE_GUTTER)}>
          <Notice
            tone={missing ? 'warning' : 'error'}
            title={missing ? 'That resume was not found' : 'Could not load this resume'}
            action={
              <Link href={RESUMES_TAB_HREF} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                Back to Documents
              </Link>
            }
          >
            {missing ? 'It may have been deleted.' : userMessage(query.error, 'Please try again in a moment.')}
          </Notice>
        </main>
      </>
    );
  }
  const resume = query.data;
  if (resume.kind === 'uploaded') return <UploadedResumeView resume={resume} />;
  return <ResumeEditor key={resume.id} resume={resume} />;
}

function Waiting({ name, label }: { name: string; label: string }) {
  return (
    <>
      <EditorBar name={name} documentsHref={RESUMES_TAB_HREF} />
      <PageSpinner label={label} />
    </>
  );
}
