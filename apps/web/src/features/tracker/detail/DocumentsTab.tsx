'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import type { ApplicationDetail } from '@tailorit/shared';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { Select, type SelectOption } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { FileTextIcon, PencilSimpleIcon, SparkleIcon, XIcon } from '@/components/ui/icons';
import { isApiError, userMessage } from '@/lib/api';
import {
  invalidateApplications,
  invalidateResumeChoice,
  trackerApi,
  trackerKeys,
  useCoverLetterOptions,
  useLettersForApplication,
  useResumeMatches,
  useResumeOptions,
} from '../data';
import {
  BEST_MATCH,
  autoMatchedText,
  linkedResumeBadges,
  offersAutoMatch,
  pickerHint,
  plainOptions,
  rankedOptions,
  type DocumentBadge,
  type ResumePickerOption,
} from './resumeMatches';

interface LinkedDocument {
  id: string;
  title: string;
  badges?: readonly DocumentBadge[];
}

function DocumentCard({ document, actions }: { document: LinkedDocument; actions: ReactNode }) {
  return (
    <div
      data-document-id={document.id}
      className="flex items-center gap-3 rounded-control border border-border bg-surface px-4 py-3"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-primary-container text-primary-ink">
        <FileTextIcon size={18} />
      </span>
      {/* On a narrow sheet the badges go under the name rather than squeeze it away. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="max-w-full min-w-0 truncate text-sm font-medium text-foreground">{document.title}</span>
        {document.badges?.map((badge) => (
          <Badge key={badge.label} tone={badge.tone}>
            {badge.label}
          </Badge>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </div>
  );
}

/** A resume in the picker: its name, the "Best match" tag, and its numbers ("9 of 12 keywords · 75%") under them. */
function ResumeOptionLabel({ name, option }: { name: string; option: ResumePickerOption }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate">{name}</span>
        {option.best && <Badge tone="tint">{BEST_MATCH}</Badge>}
      </span>
      {option.numbers && <span className="truncate text-xs leading-4 text-muted-foreground tabular-nums">{option.numbers}</span>}
    </span>
  );
}

function resumeSelectOptions(options: readonly ResumePickerOption[]): Array<SelectOption<string>> {
  return options.map((option) => {
    const name = option.isDefault ? `${option.label} (Default)` : option.label;
    return {
      value: option.id,
      textValue: option.label,
      label: option.best || option.numbers ? <ResumeOptionLabel name={name} option={option} /> : name,
    };
  });
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
  options: Array<SelectOption<string>>;
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
 *
 * The resume of a job saved at Saved is TailorIT's best match ("Best match") until the person picks or removes one
 * ("Chosen by you"); "Let TailorIT choose" hands the choice back. The picker lists the resumes ranked for this job,
 * each with the Jobs card's numbers; without a ranking (an older server, or it failed) it lists them as before.
 */
export function DocumentsTab({ application }: { application: ApplicationDetail }) {
  const client = useQueryClient();
  const toast = useToast();
  const matches = useResumeMatches(application.id, true);
  const ranking = matches.data ?? null;
  // No ranking to show (the server has none for it, or it failed): the plain list, as before resumes were ranked.
  const unranked = ranking === null && !matches.isPending;
  const resumes = useResumeOptions(unranked);
  const letters = useCoverLetterOptions(true);
  const forJob = useLettersForApplication(application.id, true);
  const [changingResume, setChangingResume] = useState(false);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);

  const link = async (patch: { resumeId?: string | null; coverLetterId?: string | null }, done: string) => {
    setBusy(true);
    try {
      const saved = await trackerApi.patch(application.id, patch);
      client.setQueryData(trackerKeys.detail(application.id), saved);
      void invalidateApplications(client);
      if (patch.resumeId !== undefined) void invalidateResumeChoice(client, application.id);
      toast.success(done);
      setChangingResume(false);
    } catch (error) {
      toast.error(userMessage(error, "We couldn't update the documents. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const resumeOptions = ranking ? rankedOptions(ranking) : plainOptions(resumes.data?.items ?? []);
  const resumesLoading = matches.isPending || (unranked && resumes.isPending);
  const resumesFailed = unranked && resumes.isError;
  const resume = resumeOptions.find((option) => option.id === application.resumeId);
  const hint = pickerHint(ranking);
  // The same service ranks and chooses: without a ranking there is nothing to offer.
  const canLetTailorItChoose = ranking !== null && offersAutoMatch(application, ranking.items.length);

  /** "Let TailorIT choose": the best match is linked now, and is TailorIT's again. */
  const letTailorItChoose = async () => {
    setBusy(true);
    setChoosing(true);
    try {
      const saved = await trackerApi.autoMatchResume(application.id);
      client.setQueryData(trackerKeys.detail(application.id), saved);
      void invalidateResumeChoice(client, application.id);
      const text = autoMatchedText(saved.resumeId, resumeOptions.find((option) => option.id === saved.resumeId)?.label);
      if (saved.resumeId) toast.success(text);
      else toast.info(text);
      setChangingResume(false);
    } catch (error) {
      // 409: the application is no longer a Saved job (applied or archived meanwhile); show it as it is now.
      if (isApiError(error) && error.status === 409) void client.invalidateQueries({ queryKey: trackerKeys.detail(application.id) });
      toast.error(userMessage(error, "TailorIT couldn't choose a resume. Please try again."));
    } finally {
      setBusy(false);
      setChoosing(false);
    }
  };

  const letterItems = letters.data?.items ?? [];
  const letter = letterItems.find((item) => item.id === application.coverLetterId);
  // "Generate cover letter" opens the editor for this application; the letters it wrote are offered here to link.
  const writtenForJob = (forJob.data?.items ?? []).filter((item) => item.id !== application.coverLetterId);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="resume-docs-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="resume-docs-heading" className="text-base font-semibold text-foreground">
              Resume
            </h3>
            <p className="text-sm text-muted-foreground">The resume you used for this application.</p>
          </div>
          {canLetTailorItChoose && (
            <Button
              variant="outline"
              size="sm"
              icon={<SparkleIcon size={14} />}
              loading={choosing}
              disabled={busy}
              onClick={() => void letTailorItChoose()}
            >
              Let TailorIT choose
            </Button>
          )}
        </div>
        {resumesFailed ? (
          <Notice tone="warning">Your resumes can&apos;t be listed right now. Please try again later.</Notice>
        ) : resumesLoading ? (
          <Skeleton className="h-16 w-full" rounded="control" />
        ) : application.resumeId && !changingResume ? (
          <DocumentCard
            document={{
              id: application.resumeId,
              title: resume?.label ?? 'Linked resume',
              badges: linkedResumeBadges(application.resumeOrigin, resume, ranking),
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
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <Picker
                label="Link existing resume"
                placeholder="Link existing resume"
                disabled={busy}
                options={resumeSelectOptions(resumeOptions)}
                onPick={(id) => void link({ resumeId: id }, 'Resume linked to this application.')}
              />
              {changingResume && (
                <Button variant="ghost" size="sm" onClick={() => setChangingResume(false)}>
                  Cancel
                </Button>
              )}
              {resumeOptions.length === 0 && (
                <Link href="/resumes/new" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                  Create a resume
                </Link>
              )}
            </div>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
        )}
        {application.resumeMatchPending && <Spinner size={14} label="Matching..." className="self-start" />}
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
