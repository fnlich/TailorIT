'use client';

import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { XIcon } from './icons';

export type ChipTone = 'outline' | 'tint' | 'neutral';

const TONES: Record<ChipTone, string> = {
  // a keyword the resume is missing / an unselected option
  outline: 'border-border bg-surface text-foreground',
  // a matched keyword (check-circle icon) / a selected option
  tint: 'border-transparent bg-primary-container text-primary-ink',
  // an active filter
  neutral: 'border-transparent bg-chip text-foreground',
};

export interface ChipProps {
  children: ReactNode;
  tone?: ChipTone;
  icon?: ReactNode;
  /** Makes the chip a toggle button (aria-pressed); `selected` switches it to the tint tone. */
  onClick?: () => void;
  selected?: boolean;
  /** Adds an ✕ that removes the chip; `removeLabel` names it ("Remove Remote"). */
  onRemove?: () => void;
  removeLabel?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * A rounded-full chip: keyword chips on the job analysis card, active filter chips with ✕, selectable option chips.
 */
export function Chip({
  children,
  tone,
  icon,
  onClick,
  selected,
  onRemove,
  removeLabel,
  disabled,
  size = 'md',
  className,
}: ChipProps) {
  const resolvedTone = tone ?? (selected ? 'tint' : 'outline');
  const classes = clsx(
    'inline-flex max-w-full items-center gap-1.5 rounded-full border font-medium whitespace-nowrap transition-colors duration-150',
    size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-8 px-3 text-sm',
    TONES[resolvedTone],
    onClick && !disabled && resolvedTone === 'outline' && 'hover:border-control-hover hover:bg-[#fafafa]',
    onClick && !disabled && resolvedTone !== 'outline' && 'hover:brightness-[0.97]',
    disabled && 'opacity-50',
    onRemove && 'pr-1.5',
    className,
  );
  const content = (
    <>
      {icon}
      <span className="truncate">{children}</span>
    </>
  );
  if (onRemove) {
    return (
      <span className={classes}>
        {onClick ? (
          <button type="button" onClick={onClick} disabled={disabled} aria-pressed={selected} className="inline-flex min-w-0 items-center gap-1.5">
            {content}
          </button>
        ) : (
          content
        )}
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={removeLabel ?? 'Remove'}
          className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <XIcon size={12} weight="bold" />
        </button>
      </span>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} aria-pressed={selected} className={classes}>
        {content}
      </button>
    );
  }
  return <span className={classes}>{content}</span>;
}
