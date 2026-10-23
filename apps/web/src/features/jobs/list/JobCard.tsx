'use client';

import type { JobSort } from '@tailorit/shared';
import { clsx } from 'clsx';
import { memo, type MouseEvent } from 'react';
import { BookmarkSimpleIcon } from '@/components/ui/icons';
import { Tooltip } from '@/components/ui/Tooltip';
import type { JobListItem } from '../api';
import { CompanyLogo } from '../CompanyLogo';
import { cardLocationLine, cardMetaLine } from '../format';

export interface JobCardProps {
  job: JobListItem;
  href: string;
  selected: boolean;
  sort: JobSort;
  now: number;
  onSelect: (jobId: number) => void;
  onToggleSave: (job: JobListItem) => void;
}

/** A plain click opens the job here; modified clicks (new tab, new window) keep the browser's own behaviour. */
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * One job of the list (Simplify's card, ~135 px): 40 px logo, title (16 px, two lines at most), company and place
 * (14 px muted), salary and age (12 px muted), and an outline bookmark at the top right. The selected card is
 * #ccf6ff edge to edge.
 */
export const JobCard = memo(function JobCard({ job, href, selected, sort, now, onSelect, onToggleSave }: JobCardProps) {
  const place = cardLocationLine(job);
  const meta = cardMetaLine(job, sort, now);
  const saveLabel = job.saved ? `Remove ${job.title} from saved jobs` : `Save ${job.title}`;
  return (
    <li
      data-job-card={job.id}
      className={clsx(
        'relative transition-colors duration-100',
        selected ? 'bg-primary-container' : 'bg-surface hover:bg-[#fafafa]',
      )}
    >
      <a
        href={href}
        aria-current={selected ? 'true' : undefined}
        onClick={(event) => {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          onSelect(job.id);
        }}
        className="flex gap-3 py-4 pr-14 pl-4 outline-offset-[-2px]"
      >
        <CompanyLogo name={job.company.name} url={job.company.logoUrl} size={40} />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-base leading-5 font-semibold text-foreground">{job.title}</h3>
          <p className="truncate text-sm leading-[21px] text-muted-foreground">{job.company.name}</p>
          {place && <p className="truncate text-sm leading-[21px] text-muted-foreground">{place}</p>}
          {meta && <p className="mt-[5px] truncate text-xs leading-4 text-muted-foreground">{meta}</p>}
        </div>
      </a>
      <Tooltip content={job.saved ? 'Saved' : 'Save'}>
        <button
          type="button"
          aria-label={saveLabel}
          aria-pressed={job.saved}
          onClick={() => onToggleSave(job)}
          className={clsx(
            'absolute top-4 right-4 inline-flex size-8 items-center justify-center rounded-control',
            'transition-colors duration-150 hover:bg-black/[0.06]',
            job.saved ? 'text-primary-ink' : 'text-foreground',
          )}
        >
          <BookmarkSimpleIcon size={16} weight={job.saved ? 'fill' : 'bold'} />
        </button>
      </Tooltip>
    </li>
  );
});
