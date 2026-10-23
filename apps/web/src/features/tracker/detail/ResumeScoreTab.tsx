'use client';

import { TargetIcon } from '@phosphor-icons/react/Target';
import Link from 'next/link';
import { useState } from 'react';
import type { ApplicationDetail, MatchedKeyword } from '@tailorit/shared';
import { buttonClasses } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Notice } from '@/components/ui/Notice';
import { Skeleton } from '@/components/ui/Skeleton';
import { CaretDownIcon, CaretUpIcon, CheckCircleIcon } from '@/components/ui/icons';
import { userMessage } from '@/lib/api';
import { useResumeOptions, useResumeScore } from '../data';

const COLLAPSED = 12;

function KeywordChips({ matched, missing }: { matched: MatchedKeyword[]; missing: MatchedKeyword[] }) {
  const [expanded, setExpanded] = useState(false);
  const all = [...matched.map((keyword) => ({ ...keyword, found: true })), ...missing.map((keyword) => ({ ...keyword, found: false }))];
  const shown = expanded ? all : all.slice(0, COLLAPSED);
  const hidden = all.length - shown.length;
  return (
    <div className="flex flex-col items-start gap-3">
      <ul className="flex flex-wrap gap-2" aria-label="Keywords">
        {shown.map((keyword) => (
          <li key={`${keyword.found ? 'm' : 'x'}-${keyword.term}`}>
            <Chip
              size="sm"
              tone={keyword.found ? 'tint' : 'outline'}
              icon={keyword.found ? <CheckCircleIcon size={14} weight="fill" /> : undefined}
            >
              {keyword.term}
              <span className="sr-only">{keyword.found ? ', found in your resume' : ', missing from your resume'}</span>
            </Chip>
          </li>
        ))}
      </ul>
      {all.length > COLLAPSED && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary-ink hover:underline"
        >
          {expanded ? 'Show less' : `Show ${hidden} more`}
          {expanded ? <CaretUpIcon size={14} /> : <CaretDownIcon size={14} />}
        </button>
      )}
    </div>
  );
}

/**
 * Resume Score: the posting's keywords against the linked resume (else the default one), as Simplify's "Improve your
 * resume" card shows them: matched chips first, then the missing ones. An application tracked from the Jobs page
 * uses that job's keywords (the score agrees with the Jobs page's); one added by hand, its description's.
 */
export function ResumeScoreTab({ application, onDocuments }: { application: ApplicationDetail; onDocuments: () => void }) {
  const score = useResumeScore(application.id, true);
  const resumes = useResumeOptions(true);

  if (score.isLoading) return <Skeleton className="h-48 w-full" rounded="surface" />;
  if (score.isError || !score.data) {
    return <Notice tone="error">{userMessage(score.error, "We couldn't score your resume. Please try again.")}</Notice>;
  }
  const result = score.data;
  const resume = resumes.data?.items.find((item) => item.id === result.resumeId);

  return (
    <section
      aria-labelledby="score-heading"
      className="flex flex-col gap-4 rounded-surface border border-improve-border bg-improve p-5"
    >
      <header className="flex items-center gap-2.5">
        <TargetIcon size={20} className="text-primary-ink" />
        <h3 id="score-heading" className="text-base font-semibold text-foreground">
          Resume Score
        </h3>
        {result.state === 'ok' && result.total > 0 && (
          <span className="ml-auto text-2xl leading-8 font-semibold text-primary-ink tabular-nums">{result.percentage}%</span>
        )}
      </header>
      {result.state === 'no_resume' ? (
        <div className="flex flex-col items-start gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Add a resume</p>
            <p className="text-sm text-muted-foreground">Upload or create a resume and we&apos;ll score it against this job&apos;s keywords.</p>
          </div>
          <Link href="/documents?tab=resumes" className={buttonClasses({ variant: 'primary', size: 'sm' })}>
            Go to Documents
          </Link>
          {result.total > 0 && <KeywordChips matched={[]} missing={result.missing} />}
        </div>
      ) : result.total === 0 ? (
        <div>
          <p className="text-sm font-semibold text-foreground">No keywords to score yet</p>
          <p className="text-sm text-muted-foreground">
            {application.jobId !== null
              ? "This job's posting names no skills to score your resume against."
              : 'Add a job description in Overview to see how your resume matches this job.'}
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-foreground">
            <strong className="font-semibold">{result.matchedCount}</strong> out of <strong className="font-semibold">{result.total}</strong>{' '}
            keywords found
          </p>
          <KeywordChips matched={result.matched} missing={result.missing} />
          <p className="border-t border-improve-border pt-3 text-xs text-muted-foreground">
            Scored against {resume ? <span className="font-medium text-foreground">{resume.label}</span> : 'your resume'}.{' '}
            <button type="button" onClick={onDocuments} className="font-medium text-primary-ink hover:underline">
              Change resume
            </button>
          </p>
        </>
      )}
    </section>
  );
}
