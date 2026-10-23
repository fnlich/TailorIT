'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import type { ApplicationDetail } from '@tailorit/shared';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { FileTextIcon, PencilSimpleIcon, SparkleIcon, XIcon } from '@/components/ui/icons';
import { userMessage } from '@/lib/api';
import {
  invalidateApplications,
  trackerApi,
  trackerKeys,
  useCoverLetterOptions,
  useLettersForApplication,
  useResumeOptions,
} from '../data';

interface LinkedDocument {
  id: string;
  title: string;
  badge?: string;
}

function DocumentCard({ document, actions }: { document: LinkedDocument; actions: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-control border border-border bg-surface px-4 py-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-primary-container text-primary-ink">
        <FileTextIcon size={18} />
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">{document.title}</span>
        {document.badge && <Badge tone="outline">{document.badge}</Badge>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </div>
  );
}

function Picker({
  label,
  placeholder,
  options,
  onPick,
  disabled,
}: {
  label: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  onPick: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      aria-label={label}
      placeholder={options.length > 0 ? placeholder : 'Nothing to link yet'}
      options={options}
      value={null}
      disabled={disabled || options.length === 0}
      onValueChange={onPick}
      className="w-full sm:w-80"
    />
  );
}

/**
 * Documents: the resume and the cover letter used for this application. Link an existing one, change or remove it,
 * or generate a cover letter for this job (the cover letter editor reads the application).
 */
export function DocumentsTab({ application }: { application: ApplicationDetail }) {
  const client = useQueryClient();
  const toast = useToast();
  const resumes = useResumeOptions(true);
  const letters = useCoverLetterOptions(true);
  const forJob = useLettersForApplication(application.id, true);
  const [changingResume, setChangingResume] = useState(false);
  const [busy, setBusy] = useState(false);

  const link = async (patch: { resumeId?: string | null; coverLetterId?: string | null }, done: string) => {
    setBusy(true);
    try {
      const saved = await trackerApi.patch(application.id, patch);
      client.setQueryData(trackerKeys.detail(application.id), saved);
      void invalidateApplications(client);
      toast.success(done);
      setChangingResume(false);
    } catch (error) {
      toast.error(userMessage(error, "We couldn't update the documents. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const resumeItems = resumes.data?.items ?? [];
  const letterItems = letters.data?.items ?? [];
  const resume = resumeItems.find((item) => item.id === application.resumeId);
  const letter = letterItems.find((item) => item.id === application.coverLetterId);
  // "Generate cover letter" opens the editor for this application; the letters it wrote are offered here to link.
  const writtenForJob = (forJob.data?.items ?? []).filter((item) => item.id !== application.coverLetterId);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="resume-docs-heading" className="flex flex-col gap-3">
        <div>
          <h3 id="resume-docs-heading" className="text-base font-semibold text-foreground">
            Resume
          </h3>
          <p className="text-sm text-muted-foreground">The resume you used for this application.</p>
        </div>
        {resumes.isError ? (
          <Notice tone="warning">Your resumes can&apos;t be listed right now. Please try again later.</Notice>
        ) : resumes.isLoading ? (
          <Skeleton className="h-16 w-full" rounded="control" />
        ) : application.resumeId && !changingResume ? (
          <DocumentCard
            document={{
              id: application.resumeId,
              title: resume?.label ?? 'Linked resume',
              badge: resume?.isDefault ? 'Default' : resume?.kind === 'uploaded' ? 'Uploaded' : undefined,
            }}
            actions={
              <>
                <Button variant="ghost" size="sm" onClick={() => setChangingResume(true)} disabled={busy}>
                  Change
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<XIcon size={14} />}
                  disabled={busy}
                  onClick={() => void link({ resumeId: null }, 'Resume removed from this application.')}
                >
                  Remove
                </Button>
              </>
            }
          />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Picker
              label="Link existing resume"
              placeholder="Link existing resume"
              disabled={busy}
              options={resumeItems.map((item) => ({ value: item.id, label: item.isDefault ? `${item.label} (Default)` : item.label }))}
              onPick={(id) => void link({ resumeId: id }, 'Resume linked to this application.')}
            />
            {changingResume && (
              <Button variant="ghost" size="sm" onClick={() => setChangingResume(false)}>
                Cancel
              </Button>
            )}
            {resumeItems.length === 0 && (
              <Link href="/resumes/new" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                Create a resume
              </Link>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="letter-docs-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="letter-docs-heading" className="text-base font-semibold text-foreground">
              Cover Letter
            </h3>
            <p className="text-sm text-muted-foreground">Write one for this job, or link a letter you already have.</p>
          </div>
          <Link
            href={`/cover-letter/new?applicationId=${encodeURIComponent(application.id)}`}
            className={buttonClasses({ variant: 'primary', size: 'sm' })}
          >
            <SparkleIcon size={14} weight="fill" />
            Generate cover letter
          </Link>
        </div>
        {letters.isError ? (
          <Notice tone="warning">Your cover letters can&apos;t be listed right now. Please try again later.</Notice>
        ) : letters.isLoading ? (
          <Skeleton className="h-16 w-full" rounded="control" />
        ) : application.coverLetterId ? (
          <DocumentCard
            document={{ id: application.coverLetterId, title: letter?.title ?? 'Linked cover letter' }}
            actions={
              <>
                <Link
                  href={`/cover-letter/${encodeURIComponent(application.coverLetterId)}`}
                  className={buttonClasses({ variant: 'ghost', size: 'sm' })}
                >
                  <PencilSimpleIcon size={14} />
                  Edit
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<XIcon size={14} />}
                  disabled={busy}
                  onClick={() => void link({ coverLetterId: null }, 'Cover letter removed from this application.')}
                >
                  Remove
                </Button>
              </>
            }
          />
        ) : (
          <Picker
            label="Link existing cover letter"
            placeholder="Link existing cover letter"
            disabled={busy}
            options={letterItems.map((item) => ({ value: item.id, label: item.title }))}
            onPick={(id) => void link({ coverLetterId: id }, 'Cover letter linked to this application.')}
          />
        )}
        {writtenForJob.length > 0 && (
          <section className="flex flex-col gap-2" aria-labelledby="written-for-job-heading">
            <h4 id="written-for-job-heading" className="text-sm font-medium text-muted-foreground">
              Written for this job
            </h4>
            {writtenForJob.map((item) => (
              <DocumentCard
                key={item.id}
                document={{ id: item.id, title: item.title }}
                actions={
                  <>
                    <Link href={`/cover-letter/${encodeURIComponent(item.id)}`} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                      <PencilSimpleIcon size={14} />
                      Edit
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void link({ coverLetterId: item.id }, 'Cover letter linked to this application.')}
                    >
                      Use for this application
                    </Button>
                  </>
                }
              />
            ))}
          </section>
        )}
      </section>
    </div>
  );
}
