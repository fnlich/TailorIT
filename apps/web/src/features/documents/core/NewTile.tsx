'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
import { PlusIcon } from '@/components/ui/icons';
import { PAGE_A4, type DocumentKind, type PageSize } from './types';

export interface NewTileProps {
  kind: DocumentKind;
  /** "New resume" */
  label: string;
  /** "Start from a template" */
  hint?: string;
  href?: string;
  onClick?: () => void;
  /** Disables the tile and says why (tooltip). */
  blockedReason?: string;
  page?: PageSize;
  className?: string;
}

/**
 * The dashed page-sized tile first in a grid (free_tailor's "New resume"), in Simplify's colours: a #ccf6ff circle
 * with a teal plus, a dashed border that turns teal on hover. `data-new-tile` is the focus fallback after a delete.
 */
export function NewTile({ kind, label, hint, href, onClick, blockedReason, page = PAGE_A4, className }: NewTileProps) {
  const classes = clsx(
    'group flex w-full flex-col items-center justify-center gap-3 rounded-[14px] border-2 border-dashed border-control-strong p-4 text-center',
    'transition-colors duration-150 focus-visible:outline-offset-[3px]',
    blockedReason ? 'cursor-not-allowed opacity-55' : 'hover:border-primary hover:bg-primary-50',
    className,
  );
  const content = (
    <>
      <span className="flex size-14 items-center justify-center rounded-full bg-primary-container text-primary-ink transition-colors group-hover:bg-primary group-hover:text-white">
        <PlusIcon size={26} weight="bold" />
      </span>
      <span className="text-base font-semibold text-foreground">{label}</span>
      {hint && <span className="text-[13px] text-muted-foreground">{hint}</span>}
    </>
  );
  const style = { aspectRatio: `${page.widthPx} / ${page.heightPx}` };
  if (href && !blockedReason) {
    return (
      <Link href={href} data-new-tile={kind} className={classes} style={style}>
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      data-new-tile={kind}
      onClick={onClick}
      disabled={Boolean(blockedReason)}
      title={blockedReason}
      className={classes}
      style={style}
    >
      {content}
    </button>
  );
}
