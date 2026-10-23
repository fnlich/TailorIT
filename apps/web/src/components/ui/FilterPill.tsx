'use client';

import { clsx } from 'clsx';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { CountBadge } from './Badge';
import { CaretUpDownIcon } from './icons';

export interface FilterPillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: ReactNode;
  /** How many values are chosen; 0 / undefined shows the up-down caret instead of a count. */
  count?: number;
  /** A leading icon (Options pill: sliders). */
  icon?: ReactNode;
  /** Highlights the pill while its panel is open or it filters something. */
  active?: boolean;
}

/**
 * Simplify's filter pill: white, rounded-full, 36 px, `#e8e8e8` border, "Location ⇕" or "Job Type [1]". It is a
 * plain button that forwards ref and props, so a Menu/Popover trigger can render it.
 */
export const FilterPill = forwardRef<HTMLButtonElement, FilterPillProps>(function FilterPill(
  { label, count, icon, active, className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={clsx(
        'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border bg-surface pr-3 pl-3.5 text-sm text-foreground shadow-soft',
        'transition-[border-color,background-color] duration-150 hover:border-control-hover hover:bg-[#fafafa]',
        'data-popup-open:border-control-hover data-popup-open:bg-[#fafafa]',
        active ? 'border-control-hover' : 'border-border',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      {icon && <span className="flex text-foreground">{icon}</span>}
      <span className="whitespace-nowrap">{label}</span>
      {count && count > 0 ? (
        <CountBadge count={count} />
      ) : (
        <CaretUpDownIcon size={14} className="text-muted-foreground" />
      )}
    </button>
  );
});
