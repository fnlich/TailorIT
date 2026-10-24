'use client';

import type { ResumeAnalysisView } from '@tailorit/shared/resume';
import { clsx } from 'clsx';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Chip, type ChipTone } from '@/components/ui/Chip';
import { ClockIcon, InfoIcon, SparkleIcon, WarningCircleIcon } from '@/components/ui/icons';
import { Notice } from '@/components/ui/Notice';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { userMessage } from '@/lib/api';
import { analysisNote, basisText, experienceText, industryNames, useResumeAnalysis, type AnalysisNoteKind } from './analysis';

/** Chips shown per group before "Show N more". */
const CHIPS_SHOWN = 24;

/**
 * "What TailorIT read from this resume", on an uploaded resume's page (`#profile`): its main skills, soft skills,
 * keywords (roles, certifications, industries) and years of experience with where they come from. While the AI reads
 * the file (or waits its turn) the panel says so and reads the answer again by itself.
 */
export function ResumeAnalysisPanel({ resumeId }: { resumeId: string }) {
  const query = useResumeAnalysis(resumeId);
  const headingId = useId();
  const section = useRef<HTMLElement>(null);

  // Opened from "Skills and details" (/resumes/{id}#profile): the panel scrolls into view and takes focus once it is
  // on the page (the page itself loads first, so the browser's own jump to #profile finds nothing).
  useEffect(() => {
    if (window.location.hash !== '#profile') return;
    const element = section.current;
    if (!element) return;
    element.scrollIntoView({ block: 'start' });
    element.focus({ preventScroll: true });
  }, []);

  // No reading to show (an API without it): no panel.
  if (query.isSuccess && query.data === null) return null;

  let body: ReactNode;
  if (query.data) {
    body = <Reading view={query.data} />;
  } else if (query.isError) {
    body = (
      <Notice
        tone="warning"
        className="mt-5"
        action={
          <Button variant="outline" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
            Try again
          </Button>
        }
      >
        {userMessage(query.error, "This can't be shown right now. Please try again in a moment.")}
      </Notice>
    );
  } else {
    body = (
      <div className="mt-6 flex flex-col gap-3" aria-busy="true">
        <span role="status" className="sr-only">
          Loading what TailorIT read from this resume...
        </span>
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-2/3" />
      </div>
    );
  }

  return (
    <section
      ref={section}
      id="profile"
      tabIndex={-1}
      aria-labelledby={headingId}
      data-resume-analysis={query.data ? (query.data.refining ? 'reading' : query.data.source) : undefined}
      className={clsx(
        'mt-6 scroll-mt-20 rounded-surface border border-border bg-surface p-6 shadow-soft sm:p-8',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
      )}
    >
      <h2 id={headingId} className="text-lg leading-7 font-semibold text-foreground">
        What TailorIT read from this resume
      </h2>
      <p className="mt-1 text-sm leading-5 text-muted-foreground">Used to pick your best resume for each job you save.</p>
      {body}
    </section>
  );
}

const NOTE_ICON: Record<AnalysisNoteKind, ReactNode> = {
  reading: <Spinner size={14} />,
  waiting: <ClockIcon size={16} />,
  failed: <WarningCircleIcon size={16} />,
  ai: <SparkleIcon size={16} weight="fill" />,
  quick: <InfoIcon size={16} />,
};

const NOTE_TONE: Record<AnalysisNoteKind, string> = {
  reading: 'text-primary-ink',
  waiting: 'text-muted-foreground',
  failed: 'text-amber-foreground',
  ai: 'text-primary-ink',
  quick: 'text-muted-foreground',
};

function Reading({ view }: { view: ResumeAnalysisView }) {
  const note = analysisNote(view);
  const basis = view.yearsExperience === null ? null : basisText(view.yearsBasis);
  return (
    <>
      <p role="status" className={clsx('mt-4 flex items-start gap-2 text-[13px] leading-5', NOTE_TONE[note.kind])}>
        <span className="mt-0.5 flex shrink-0">{NOTE_ICON[note.kind]}</span>
        <span>{note.text}</span>
      </p>
      <div className="mt-5 flex flex-col">
        <Group label="Experience">
          <p className="text-sm leading-6 font-semibold text-foreground">{experienceText(view.yearsExperience)}</p>
          {basis && <p className="text-[13px] leading-5 text-muted-foreground">{basis}</p>}
        </Group>
        <Group label="Main skills">
          <ChipList items={view.hardSkills} label="Main skills" tone="tint" />
        </Group>
        <Group label="Soft skills">
          <ChipList items={view.softSkills} label="Soft skills" />
        </Group>
        <Group label="Keywords">
          <div className="flex flex-col gap-4">
            <SubGroup label="Roles">
              <ChipList items={view.keywords.roles} label="Roles" />
            </SubGroup>
            <SubGroup label="Certifications">
              <ChipList items={view.keywords.certifications} label="Certifications" />
            </SubGroup>
            <SubGroup label="Industries">
              <ChipList items={industryNames(view.keywords.domains)} label="Industries" />
            </SubGroup>
          </div>
        </Group>
      </div>
    </>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-border py-4 last:pb-0 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-6">
      <h3 className="text-sm leading-6 font-semibold text-foreground">{label}</h3>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SubGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-[13px] leading-5 font-medium text-muted-foreground">{label}</h4>
      {children}
    </div>
  );
}

function ChipList({ items, label, tone = 'outline' }: { items: readonly string[]; label: string; tone?: ChipTone }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return <p className="text-sm leading-6 text-muted-foreground">None found.</p>;
  const shown = all ? items : items.slice(0, CHIPS_SHOWN);
  const more = items.length - shown.length;
  return (
    <div className="flex flex-col items-start gap-2">
      <ul aria-label={label} className="flex flex-wrap gap-2">
        {shown.map((item, index) => (
          <li key={`${index}:${item}`} className="max-w-full">
            <Chip size="sm" tone={tone}>
              {item}
            </Chip>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <Button variant="link" onClick={() => setAll(true)}>
          Show {more} more
        </Button>
      )}
    </div>
  );
}
