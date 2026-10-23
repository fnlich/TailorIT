'use client';

import type { MatchedKeyword } from '@tailorit/shared';
import { clsx } from 'clsx';
import Link from 'next/link';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { buttonClasses } from '@/components/ui/Button';
import { CaretDownIcon, CaretUpIcon, CheckCircleIcon } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { userMessage } from '@/lib/api';
import type { JobMatch } from '../api';
import { showMoreLabel } from '../format';
import { TargetIcon } from '../icons';

interface Chip extends MatchedKeyword {
  matched: boolean;
}

/** How many rows the chips show before "Show N more". */
const COLLAPSED_ROWS = 2;

/**
 * Keyword chips, matched first (tinted, check-circle) then missing (plain), collapsed to two rows. N in "Show N
 * more" is how many chips the two rows leave out, measured after layout (and again when the card resizes).
 */
function KeywordChips({ chips }: { chips: Chip[] }) {
  const listRef = useRef<HTMLUListElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [fit, setFit] = useState<{ height: number | null; clipped: number[] }>({ height: null, clipped: [] });

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const items = Array.from(list.children) as HTMLElement[];
      const rowTops = [...new Set(items.map((item) => item.offsetTop))].sort((a, b) => a - b);
      if (rowTops.length <= COLLAPSED_ROWS) {
        setFit((previous) => (previous.height === null && previous.clipped.length === 0 ? previous : { height: null, clipped: [] }));
        return;
      }
      const lastTop = rowTops[COLLAPSED_ROWS - 1]!;
      const lastRow = items.find((item) => item.offsetTop === lastTop)!;
      const clipped = items.flatMap((item, index) => (item.offsetTop > lastTop ? [index] : []));
      const height = lastTop + lastRow.offsetHeight - rowTops[0]!;
      setFit((previous) =>
        previous.height === height && previous.clipped.join() === clipped.join() ? previous : { height, clipped },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [chips]);

  const clipped = new Set(expanded ? [] : fit.clipped);
  return (
    <>
      <ul
        ref={listRef}
        aria-label="Keywords"
        className="relative flex flex-wrap gap-x-2 gap-y-1.5 overflow-hidden"
        style={!expanded && fit.height !== null ? { maxHeight: fit.height } : undefined}
      >
        {chips.map((chip, index) => (
          <li
            key={`${chip.matched ? 'm' : 'x'}-${chip.term}`}
            aria-hidden={clipped.has(index) || undefined}
            data-keyword={chip.matched ? 'matched' : 'missing'}
            className={clsx(
              'inline-flex h-[30px] max-w-full items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap',
              chip.matched ? 'border-transparent bg-primary-container text-primary-ink' : 'border-border bg-surface text-foreground',
            )}
          >
            {chip.matched && <CheckCircleIcon size={16} />}
            <span className="truncate">
              {chip.matched && <span className="sr-only">Found: </span>}
              {chip.term}
            </span>
          </li>
        ))}
      </ul>
      {fit.clipped.length > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="mt-2.5 inline-flex items-center gap-1 self-start text-sm leading-5 font-semibold text-primary-ink hover:underline"
        >
          {showMoreLabel(fit.clipped.length, expanded)}
          {expanded ? <CaretUpIcon size={14} /> : <CaretDownIcon size={14} />}
        </button>
      )}
    </>
  );
}

/**
 * Simplify's job analysis card, "Improve Your Resume": how many of the job's keywords the default resume has
 * ("5 out of 13 required keywords found") and which, matched first. No "Tailor my resume" button (out of scope).
 * Without a resume it asks for one.
 */
export function ImproveResumeCard({
  match,
  pending,
  error,
  onRetry,
  className,
}: {
  match: JobMatch | undefined;
  pending: boolean;
  error: unknown;
  onRetry: () => void;
  className?: string;
}) {
  let body: ReactNode;
  if (pending) {
    body = (
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-4 w-3/4" />
        <div className="flex flex-wrap gap-2">
          {[88, 72, 64, 80, 70].map((width) => (
            <span key={width} style={{ width }}>
              <Skeleton className="h-[30px] w-full" rounded="full" />
            </span>
          ))}
        </div>
      </div>
    );
  } else if (error || !match) {
    body = (
      <p className="text-sm text-muted-foreground">
        {userMessage(error, 'The keyword match could not be loaded.')}{' '}
        <button type="button" onClick={onRetry} className="font-semibold text-primary-ink hover:underline">
          Try again
        </button>
      </p>
    );
  } else if (match.state === 'no_resume') {
    body = (
      <div className="flex flex-col gap-1">
        <p className="text-sm leading-5 font-semibold text-foreground">Add a resume</p>
        <p className="text-sm leading-5 text-muted-foreground">
          Upload or create a resume and we&apos;ll score it against this job&apos;s keywords.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/resumes/new" className={buttonClasses({ variant: 'primary', size: 'sm' })}>
            Create a resume
          </Link>
          <Link href="/documents?tab=resumes" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
            Upload a resume
          </Link>
        </div>
      </div>
    );
  } else if (match.total === 0) {
    body = <p className="text-sm leading-5 text-muted-foreground">We didn&apos;t find any skill keywords in this posting.</p>;
  } else {
    const chips: Chip[] = [
      ...match.matched.map((keyword) => ({ ...keyword, matched: true })),
      ...match.missing.map((keyword) => ({ ...keyword, matched: false })),
    ];
    body = (
      <div className="flex flex-col">
        <p className="text-sm leading-5 text-foreground" data-testid="keyword-score">
          <b className="font-bold">
            {match.matchedCount} out of {match.total}
          </b>{' '}
          required keywords found
        </p>
        <div className="mt-4 flex flex-col">
          <KeywordChips chips={chips} />
        </div>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="improve-resume-title"
      data-improve-card
      className={clsx('rounded-surface border border-[#a7d4de] p-4', className)}
      style={{ background: 'linear-gradient(to bottom right, var(--color-primary-container), #ffffff)' }}
    >
      <div className="flex items-center gap-3">
        <TargetIcon size={28} weight="bold" className="shrink-0 text-primary-ink" />
        <h2 id="improve-resume-title" className="text-base leading-6 font-semibold text-foreground">
          Improve Your Resume
        </h2>
      </div>
      <div className="mt-4">{body}</div>
    </section>
  );
}
