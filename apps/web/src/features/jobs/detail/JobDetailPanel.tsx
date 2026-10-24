'use client';

import {
  EMPLOYMENT_TYPE_LABEL,
  appliedChipLabel,
  formatMediumDate,
  liveChip,
  type JobDetail,
} from '@tailorit/shared';
import { clsx } from 'clsx';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button, buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { BookmarkSimpleIcon, BriefcaseIcon, CaretDownIcon, ClockIcon, EyeIcon, EyeSlashIcon } from '@/components/ui/icons';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { Notice } from '@/components/ui/Notice';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { Tooltip } from '@/components/ui/Tooltip';
import { UnderlineTabs } from '@/components/ui/UnderlineTabs';
import { isApiError, userMessage } from '@/lib/api';
import { useNow } from '@/lib/useNow';
import { CompanyLogo } from '../CompanyLogo';
import { useHideCompany, useHideJob, useJobDetail, useJobInsights, useMarkApplied, useSaveToggle } from '../hooks';
import { ArrowLeftIcon, ExportIcon, FlagIcon } from '../icons';
import { jobLevelsOf } from '../format';
import { jobShareUrl } from '../url';
import { AboutJob } from './AboutJob';
import { ApplyDialog } from './ApplyDialog';
import { CompanySection } from './CompanySection';
import { FactsGrid } from './FactsGrid';
import { ImproveResumeCard } from './ImproveResumeCard';
import { ReportDialog } from './ReportDialog';

type Section = 'overview' | 'company';
const SECTIONS = [
  { value: 'overview', label: 'Overview' },
  { value: 'company', label: 'Company' },
] as const;

/** The sticky header's height: the Company anchor scrolls to just under it. */
const HEADER_HEIGHT = 61;

export interface JobDetailPanelProps {
  jobId: number | null;
  /** No job is chosen yet because the list is still loading (shows the skeleton, not "Select a job"). */
  waiting?: boolean;
  /** Called after jobs left the list (this one, or its company's): the page opens the next job. */
  onJobsHidden: (hidden: { jobId?: number; companyId?: number }) => void;
  /** Changes when a job is chosen in the one-column layout: the panel scrolls itself into view. */
  revealSignal?: number;
  /** Back to the list (one column only: the back arrow shows below `lg`). */
  onShowList?: () => void;
  /** Leaves a job that no longer exists ("Back to jobs"). */
  onBackToJobs?: () => void;
  className?: string;
}

/** A quiet round icon button of the company row (hide, share, report): #191919 icons. */
const TOOL_BUTTON =
  'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-control px-2 text-black transition-colors duration-150 ' +
  'hover:bg-hover data-popup-open:bg-hover';

function Pill({ tone, icon, children, tooltip }: { tone: 'tint' | 'neutral'; icon?: ReactNode; children: ReactNode; tooltip?: string }) {
  const pill = (
    <span
      tabIndex={tooltip ? 0 : undefined}
      className={clsx(
        'inline-flex h-6 items-center gap-1.5 rounded-full px-3 text-[13px] leading-none font-medium whitespace-nowrap',
        tone === 'tint' ? 'bg-primary-container text-primary-ink' : 'bg-chip text-foreground',
      )}
    >
      {icon}
      {children}
    </span>
  );
  return tooltip ? <Tooltip content={tooltip}>{pill}</Tooltip> : pill;
}

function DetailSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="flex h-[61px] items-center gap-8 px-6 shadow-[inset_0_-1px_0_var(--color-border)]">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="ml-auto h-9 w-20" rounded="control" />
        <Skeleton className="h-9 w-24" rounded="control" />
      </div>
      <div className="px-6 pt-5">
        <div className="flex items-center gap-3">
          <Skeleton className="size-12" rounded="control" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 w-64" />
          </div>
        </div>
        <Skeleton className="mt-6 h-7 w-3/5" />
        <div className="mt-4 flex gap-2">
          <Skeleton className="h-6 w-20" rounded="full" />
          <Skeleton className="h-6 w-56" rounded="full" />
        </div>
        <SkeletonText lines={4} className="mt-9 max-w-2xl" />
      </div>
    </div>
  );
}

/**
 * The right panel: a sticky header (Overview | Company anchors, the Applied chip or "Already Applied?", Save, Apply
 * or INACTIVE), then the company row with hide / share / report, the title, chips, the facts grid, "About the job"
 * beside the "Improve Your Resume" card, and the Company section. It scrolls on its own from `lg` up; below, the page
 * scrolls and the header sticks under the app header.
 */
export function JobDetailPanel({
  jobId,
  waiting = false,
  onJobsHidden,
  revealSignal = 0,
  onShowList,
  onBackToJobs,
  className,
}: JobDetailPanelProps) {
  const detail = useJobDetail(jobId);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A new job starts at the top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [jobId]);

  // In one column the panel sits under the list: a job chosen there brings it into view (under the app header).
  useEffect(() => {
    if (revealSignal > 0) scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [revealSignal]);

  let content: ReactNode;
  if (jobId === null && waiting) {
    content = <DetailSkeleton />;
  } else if (jobId === null) {
    content = (
      <EmptyState
        icon={<BriefcaseIcon size={22} />}
        title="Select a job"
        description="Choose a job from the list to see its details and how your resume matches."
        className="h-full"
      />
    );
  } else if (detail.isPending) {
    content = <DetailSkeleton />;
  } else if (detail.isError && isApiError(detail.error) && detail.error.code === 'not_found') {
    // Trying again cannot bring back a job that is gone.
    content = (
      <div className="p-6">
        <Notice
          tone="info"
          title="This job is no longer available"
          action={
            onBackToJobs && (
              <Button variant="outline" size="sm" onClick={onBackToJobs}>
                Back to jobs
              </Button>
            )
          }
        >
          It may have been taken down, or the link is out of date.
        </Notice>
      </div>
    );
  } else if (detail.isError) {
    content = (
      <div className="p-6">
        <Notice
          tone="error"
          title="This job could not be opened"
          action={
            <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
              Try again
            </Button>
          }
        >
          {userMessage(detail.error)}
        </Notice>
      </div>
    );
  } else {
    content = (
      <JobDetailBody
        key={detail.data.id}
        job={detail.data}
        scrollRef={scrollRef}
        onJobsHidden={onJobsHidden}
        onShowList={onShowList}
      />
    );
  }

  return (
    <div
      ref={scrollRef}
      className={clsx('relative h-full min-h-0 scroll-mt-[63px] lg:overflow-y-auto', className)}
      aria-label="Job details"
      role="region"
      aria-busy={detail.isFetching || undefined}
    >
      {content}
    </div>
  );
}

function JobDetailBody({
  job,
  scrollRef,
  onJobsHidden,
  onShowList,
}: {
  job: JobDetail;
  scrollRef: RefObject<HTMLDivElement | null>;
  onJobsHidden: JobDetailPanelProps['onJobsHidden'];
  onShowList?: () => void;
}) {
  const toast = useToast();
  const now = useNow();
  // "About the job" and the keyword card come from one answer, so they always change together.
  const insights = useJobInsights(job.id);
  const analysis = insights.data?.analysis;
  const match = insights.data?.match ?? undefined;
  const saveToggle = useSaveToggle();
  const markApplied = useMarkApplied();
  const hideJob = useHideJob();
  const hideCompany = useHideCompany();
  const [applyOpen, setApplyOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [section, setSection] = useState<Section>('overview');
  const companyRef = useRef<HTMLDivElement>(null);

  const { saved, appliedOn, applicationId, hidden, companyHidden } = job.userState;
  const chip = liveChip({ active: job.active, postedAt: job.postedAt, updatedAt: job.updatedAt }, now);
  const levels = jobLevelsOf(job.experienceLevels, analysis);

  // The keyword card scores the resume linked to the job's application while the job is tracked (saved, or applied),
  // else the default resume. Saving, un-saving or applying, here or from the list, can change which: read it again.
  const trackedState = `${applicationId ?? ''}|${saved}|${appliedOn ?? ''}`;
  const scoredFor = useRef(trackedState);
  const refetchInsights = insights.refetch;
  useEffect(() => {
    if (scoredFor.current === trackedState) return;
    scoredFor.current = trackedState;
    void refetchInsights();
  }, [trackedState, refetchInsights]);

  // Overview | Company follow the scroll position (the Company tab lights up once its section reaches the header).
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => {
      const company = companyRef.current;
      if (!company) return;
      const top = company.getBoundingClientRect().top - container.getBoundingClientRect().top;
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
      setSection(top <= HEADER_HEIGHT + 48 || (atBottom && container.scrollTop > 0) ? 'company' : 'overview');
    };
    onScroll();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [scrollRef]);

  const jumpTo = useCallback(
    (next: Section) => {
      const container = scrollRef.current;
      if (!container) return;
      setSection(next);
      if (next === 'overview') {
        container.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const company = companyRef.current;
      if (!company) return;
      // On narrow screens the page scrolls, not the panel.
      if (container.scrollHeight <= container.clientHeight) {
        company.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const offset = company.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top: Math.max(0, offset - HEADER_HEIGHT - 16), behavior: 'smooth' });
    },
    [scrollRef],
  );

  const toggleSave = () => saveToggle.toggle({ jobId: job.id, saved, appliedOn, applicationId }, { confirmSave: true });

  const openPosting = () => {
    if (job.applyUrl) window.open(job.applyUrl, '_blank', 'noopener,noreferrer');
    markApplied.reset();
    setApplyOpen(true);
  };

  const recordApplied = (fromDialog: boolean) => {
    markApplied.mutate(
      { jobId: job.id },
      {
        onSuccess: () => {
          if (fromDialog) setApplyOpen(false);
          toast.success('Marked as applied', 'We added it to your Job Tracker.');
        },
        onError: (error) => {
          if (!fromDialog) toast.error('The job could not be marked as applied', userMessage(error));
        },
      },
    );
  };

  const copyLink = async () => {
    const url = jobShareUrl(window.location.origin, job.id);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied', 'Anyone signed in to TailorIT can open this job with it.');
    } catch {
      toast.info('Copy this link', url);
    }
  };

  const hide = (kind: 'job' | 'company') => {
    const undo = () =>
      kind === 'job'
        ? hideJob.mutate({ jobId: job.id, hidden: false })
        : hideCompany.mutate({ companyId: job.company.id, hidden: false });
    const onSuccess = () => {
      toast.toast({
        type: 'info',
        title: kind === 'job' ? 'Job hidden' : `Jobs from ${job.company.name} hidden`,
        description: kind === 'job' ? "You won't see it in your search results." : "You won't see their jobs in your search results.",
        action: { label: 'Undo', onClick: undo },
      });
      onJobsHidden(kind === 'job' ? { jobId: job.id } : { companyId: job.company.id });
    };
    const onError = (error: unknown) => toast.error('That could not be hidden', userMessage(error));
    if (kind === 'job') hideJob.mutate({ jobId: job.id, hidden: true }, { onSuccess, onError });
    else hideCompany.mutate({ companyId: job.company.id, hidden: true }, { onSuccess, onError });
  };

  const trackerHref = applicationId ? `/tracker?app=${encodeURIComponent(applicationId)}` : '/tracker';

  return (
    <>
      {/*
        Sticks to the panel's top on wide screens (the panel scrolls), under the app header on narrow ones. Narrow, the
        actions get their own row and wrap from the left (never off the panel's edge), and a back arrow leads to the list.
      */}
      <div
        data-detail-header
        className="sticky top-[63px] z-20 flex flex-wrap items-stretch gap-x-4 bg-surface px-4 pb-3 shadow-[inset_0_-1px_0_var(--color-border)] sm:px-6 lg:top-0 lg:h-[61px] lg:flex-nowrap lg:pb-0"
      >
        {onShowList && (
          <IconButton
            label="Back to the job list"
            icon={<ArrowLeftIcon size={18} weight="bold" />}
            onClick={onShowList}
            className="-ml-2 self-center lg:hidden"
          />
        )}
        <UnderlineTabs
          aria-label="Job sections"
          size="tight"
          items={SECTIONS}
          value={section}
          onValueChange={jumpTo}
          listClassName="h-[61px] shadow-none"
        />
        <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap sm:justify-end sm:gap-4">
          {appliedOn ? (
            <Link href={trackerHref} className={buttonClasses({ variant: 'secondary' })} data-applied-chip>
              {appliedChipLabel(appliedOn)}
            </Link>
          ) : job.active ? (
            <Button variant="ghost" onClick={() => recordApplied(false)} loading={markApplied.isPending && !applyOpen}>
              Already Applied?
            </Button>
          ) : null}
          <Button
            variant="outline"
            aria-pressed={saved}
            icon={<BookmarkSimpleIcon size={16} weight={saved ? 'fill' : 'bold'} />}
            onClick={toggleSave}
            disabled={saveToggle.pending}
          >
            {saved ? 'Saved' : 'Save'}
          </Button>
          {job.active ? (
            <Button onClick={openPosting} className="sm:min-w-24" disabled={!job.applyUrl}>
              Apply
            </Button>
          ) : (
            <span className="inline-flex h-9 min-w-24 items-center justify-center rounded-control bg-chip px-4 text-sm font-semibold tracking-wide text-muted-foreground">
              INACTIVE
            </span>
          )}
        </div>
      </div>

      <div className="px-4 pt-5 pb-12 sm:px-6">
        {(hidden || companyHidden) && (
          <Notice
            tone="info"
            className="mb-5"
            title={hidden ? 'You hid this job' : `You hid jobs from ${job.company.name}`}
            action={
              <Button
                variant="outline"
                size="sm"
                icon={<EyeIcon size={14} />}
                onClick={() =>
                  hidden
                    ? hideJob.mutate({ jobId: job.id, hidden: false })
                    : hideCompany.mutate({ companyId: job.company.id, hidden: false })
                }
              >
                {hidden ? 'Unhide this job' : `Show jobs from ${job.company.name}`}
              </Button>
            }
          >
            It won&apos;t appear in your search results.
          </Notice>
        )}

        <section id="job-overview" aria-label="Overview">
          <div className="flex items-start gap-3">
            <CompanyLogo name={job.company.name} url={job.company.logoUrl} size={48} />
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="truncate text-lg leading-6 font-bold text-foreground">{job.company.name}</p>
              {job.company.tagline && <p className="truncate text-sm leading-5 text-muted-foreground">{job.company.tagline}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Menu>
                <Tooltip content="Hide">
                  <MenuTrigger aria-label="Hide options" className={TOOL_BUTTON}>
                    <EyeIcon size={18} weight="bold" />
                    <CaretDownIcon size={14} weight="bold" />
                  </MenuTrigger>
                </Tooltip>
                <MenuContent align="end" width="w-64" aria-label="Hide options">
                  <MenuItem icon={<EyeSlashIcon size={16} />} onClick={() => hide('job')} disabled={hidden}>
                    Hide this job
                  </MenuItem>
                  <MenuItem icon={<EyeSlashIcon size={16} />} onClick={() => hide('company')} disabled={companyHidden}>
                    Hide jobs from {job.company.name}
                  </MenuItem>
                </MenuContent>
              </Menu>
              <Tooltip content="Copy link">
                <button type="button" aria-label="Share: copy a link to this job" onClick={() => void copyLink()} className={TOOL_BUTTON}>
                  <ExportIcon size={17} weight="bold" />
                </button>
              </Tooltip>
              <Tooltip content="Report">
                <button type="button" aria-label="Report this job" onClick={() => setReportOpen(true)} className={TOOL_BUTTON}>
                  <FlagIcon size={17} weight="bold" />
                </button>
              </Tooltip>
            </div>
          </div>

          <h1 className="mt-5 text-2xl leading-8 font-bold tracking-[-0.01em] text-foreground">{job.title}</h1>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {job.employmentType && <Pill tone="tint">{EMPLOYMENT_TYPE_LABEL[job.employmentType]}</Pill>}
            <Pill
              tone="neutral"
              icon={<ClockIcon size={14} />}
              tooltip={chip.kind === 'live' && job.postedAt ? `Posted on ${formatMediumDate(job.postedAt)}` : undefined}
            >
              <span data-live-chip={chip.kind}>{chip.label}</span>
            </Pill>
          </div>

          <FactsGrid
            job={job}
            levels={levels}
            levelMatch={match?.levelMatch}
            requiredYears={analysis?.requiredYears}
            className="mt-8"
          />
        </section>

        <hr className="mt-5 border-border" />

        <div className="mt-5 flex flex-col gap-8 xl:flex-row">
          <div className="min-w-0 flex-1">
            <AboutJob
              analysis={analysis}
              analysisPending={insights.isPending}
              analysisFailed={insights.isError && !insights.data}
              descriptionHtml={job.descriptionHtml}
            />
            <div
              ref={companyRef}
              id="job-company"
              className="mt-12 scroll-mt-[180px] border-t border-border pt-8 sm:scroll-mt-[140px] lg:scroll-mt-[77px]"
            >
              <CompanySection company={job.company} />
            </div>
          </div>
          <aside className="w-full shrink-0 xl:w-[300px]" aria-label="Job analysis">
            {/* A failed poll keeps what is shown; only a first load that fails shows the error. */}
            <ImproveResumeCard
              match={match}
              pending={insights.isPending}
              error={insights.data ? null : insights.error}
              onRetry={() => void insights.refetch()}
            />
          </aside>
        </div>
      </div>

      <ApplyDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        company={job.company.name}
        title={job.title}
        pending={markApplied.isPending}
        error={markApplied.error}
        onConfirm={() => recordApplied(true)}
      />
      <ReportDialog jobId={job.id} jobTitle={job.title} open={reportOpen} onOpenChange={setReportOpen} />
    </>
  );
}
