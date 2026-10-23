'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import { ActionMenu } from './ActionMenu';
import type { ActionMenuItem, DocumentKind } from './types';

export interface DocumentCardProps {
  kind: DocumentKind;
  id: string;
  /** The card's title (and the accessible name of its links). */
  label: string;
  /** The editor (or viewer) address; the page and the title link there. */
  href?: string;
  /** Instead of `href`: what opening the card does. */
  onOpen?: () => void;
  /** The first page, usually <DocumentThumb …/>. */
  thumb: ReactNode;
  /** Badges over the page's top-left corner (★ Default, Uploaded…). */
  overlayBadges?: ReactNode;
  /** Lines under the title ("Edited 6 hours ago · Modern"). */
  meta?: ReactNode[];
  /** A cautionary line under the meta. */
  warning?: ReactNode;
  /** Greys the page out (e.g. a disabled document). */
  dimmed?: boolean;
  menuItems?: readonly ActionMenuItem[];
  /** Selection checkbox over the page's top-right corner. */
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (checked: boolean, options: { shiftKey: boolean }) => void;
  className?: string;
}

/**
 * A document in the grid view (free_tailor's card, Simplify's colours): the first page under a link the size of it
 * (a frame may not sit inside a link), the title, meta lines and a ⋮ menu.
 */
export function DocumentCard({
  kind,
  id,
  label,
  href,
  onOpen,
  thumb,
  overlayBadges,
  meta,
  warning,
  dimmed,
  menuItems,
  selectable,
  selected = false,
  onSelectedChange,
  className,
}: DocumentCardProps) {
  const dataAttr = { [`data-${kind}-card`]: id };
  const coverClasses = 'absolute inset-0 z-[1] rounded-[inherit] focus-visible:outline-none';
  return (
    <article {...dataAttr} className={clsx('group/card flex min-w-0 flex-col gap-3', className)}>
      <div
        data-selected={selected ? '' : undefined}
        className={clsx(
          'relative overflow-hidden rounded-[14px] border border-border bg-white shadow-soft transition-[transform,box-shadow,border-color] duration-150 ease-out-soft',
          'hover:-translate-y-0.5 hover:shadow-popover',
          'has-[[data-cover]:focus-visible]:outline-2 has-[[data-cover]:focus-visible]:outline-offset-[3px] has-[[data-cover]:focus-visible]:outline-focus',
          'data-selected:border-primary data-selected:ring-2 data-selected:ring-primary/30',
        )}
      >
        <div className={clsx(dimmed && 'opacity-50')}>{thumb}</div>
        {href ? (
          <Link href={href} data-cover aria-label={`Open ${label}`} className={coverClasses} />
        ) : onOpen ? (
          <button type="button" data-cover aria-label={`Open ${label}`} onClick={onOpen} className={coverClasses} />
        ) : null}
        {overlayBadges && (
          <span className="pointer-events-none absolute top-2.5 left-2.5 z-[2] flex max-w-[calc(100%-3.5rem)] flex-col items-start gap-1.5">
            {overlayBadges}
          </span>
        )}
        {selectable && onSelectedChange && (
          <span
            className={clsx(
              'absolute top-2.5 right-2.5 z-[2] flex rounded-md bg-white/90 p-1 shadow-control transition-opacity',
              selected ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100 focus-within:opacity-100',
            )}
          >
            <Checkbox
              checked={selected}
              onCheckedChange={(checked, details) => onSelectedChange(checked, details)}
              aria-label={`Select ${label}`}
            />
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] leading-6 font-semibold text-foreground" title={label}>
            {href ? (
              <Link href={href} className="hover:underline hover:underline-offset-2">
                {label}
              </Link>
            ) : onOpen ? (
              <button type="button" onClick={onOpen} className="max-w-full truncate text-left hover:underline hover:underline-offset-2">
                {label}
              </button>
            ) : (
              label
            )}
          </h3>
          {meta?.map((line, index) => (
            <p key={index} className="mt-0.5 truncate text-[13px] leading-5 text-muted-foreground">
              {line}
            </p>
          ))}
          {warning && <p className="mt-1.5 text-xs leading-4 text-amber-foreground">{warning}</p>}
        </div>
        {menuItems && menuItems.length > 0 && (
          <ActionMenu items={menuItems} label={`Actions for ${label}`} className="-mt-1 -mr-1" />
        )}
      </div>
    </article>
  );
}
