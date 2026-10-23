'use client';

import { ArrowDownIcon } from '@phosphor-icons/react/ArrowDown';
import { ArrowUpIcon } from '@phosphor-icons/react/ArrowUp';
import type { SectionIcon } from '@tailorit/shared/resume';
import { clsx } from 'clsx';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { CaretDownIcon, TrashIcon } from '@/components/ui/icons';
import { SectionGlyph } from '../sectionIcons';

/** The hover tools' visibility: on hover or focus inside the card, always on touch screens. */
export const CARD_TOOLS =
  'opacity-0 transition-opacity duration-150 group-hover/section:opacity-100 group-focus-within/section:opacity-100 max-md:opacity-100';

/** What the editor decides for every card: how it moves, its count, whether it can be removed. */
export interface CardFrame {
  /** The drag grip (SortableSections makes it: it carries dnd-kit's handle). */
  grip?: ReactNode;
  move?: { up: () => void; down: () => void; canUp: boolean; canDown: boolean };
  /** "3 entries", "12 skills": after the label in the head. */
  meta?: string;
  /** Remove section (offered for the kinds that are not always shown, and custom sections). */
  onRemove?: () => void;
  /** Open and focus the card when it mounts (the card Add content just made). */
  focusOnMount?: boolean;
  /** The card is being dragged. */
  dragging?: boolean;
}

/**
 * One collapsible section card of the Content tab: the grip, the section's icon tile, its label and count; Move up,
 * Move down and Remove section on hover or focus (always on touch screens); the chevron. Closed by default. The body
 * stays mounted while closed (`hidden`), so a half-typed field keeps its text and every id stays in the page.
 */
export function SectionCard({
  sectionRef,
  label,
  icon,
  description,
  frame,
  children,
}: {
  /** The section's ref ("experience", "custom:cs-…"), on the card as `data-section`. */
  sectionRef: string;
  label: string;
  icon: SectionIcon;
  /** One line at the top of the body. */
  description?: string;
  frame?: CardFrame;
  children: ReactNode;
}) {
  const focusOnMount = frame?.focusOnMount === true;
  const [open, setOpen] = useState(focusOnMount);
  const id = useId();
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusOnMount) toggle.current?.focus();
  }, [focusOnMount]);

  const tools = CARD_TOOLS;
  return (
    <section
      data-section={sectionRef}
      aria-labelledby={titleId}
      className={clsx(
        'group/section rounded-surface border bg-surface transition-[box-shadow,border-color] duration-150',
        frame?.dragging ? 'border-control-hover shadow-dialog' : 'border-border shadow-soft',
      )}
    >
      <div className="flex min-h-[60px] items-center gap-1 pr-2 pl-1">
        {frame?.grip ?? <span className="w-6 shrink-0" aria-hidden="true" />}
        <h3 id={titleId} className="flex min-w-0 flex-1">
          <button
            ref={toggle}
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((current) => !current)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-control py-3 pr-2 pl-1 text-left focus-visible:outline-offset-0"
          >
            <SectionGlyph icon={icon} />
            <span className="min-w-0 truncate text-[15px] leading-6 font-semibold text-foreground">{label}</span>
            {frame?.meta && <span className="shrink-0 text-[13px] whitespace-nowrap text-muted-foreground">{frame.meta}</span>}
          </button>
        </h3>
        {(frame?.move || frame?.onRemove) && (
          <div className={clsx('flex shrink-0 items-center', tools)}>
            {frame.move && (
              <>
                <IconButton
                  label={`Move ${label} up`}
                  tooltip="Move up"
                  size="sm"
                  icon={<ArrowUpIcon size={16} />}
                  disabled={!frame.move.canUp}
                  onClick={frame.move.up}
                  data-move="up"
                />
                <IconButton
                  label={`Move ${label} down`}
                  tooltip="Move down"
                  size="sm"
                  icon={<ArrowDownIcon size={16} />}
                  disabled={!frame.move.canDown}
                  onClick={frame.move.down}
                  data-move="down"
                />
              </>
            )}
            {frame.onRemove && (
              <IconButton
                label={`Remove section ${label}`}
                tooltip="Remove section"
                size="sm"
                icon={<TrashIcon size={16} />}
                onClick={frame.onRemove}
              />
            )}
          </div>
        )}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setOpen((current) => !current)}
          className="flex size-8 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-hover"
        >
          <CaretDownIcon size={16} className={clsx('transition-transform duration-150', open && 'rotate-180')} />
        </button>
      </div>
      <div id={bodyId} role="region" aria-labelledby={titleId} hidden={!open} className="border-t border-border px-4 pt-4 pb-5 sm:px-5">
        <div className="flex flex-col gap-4">
          {description && <p className="text-[13px] leading-5 text-muted-foreground">{description}</p>}
          {children}
        </div>
      </div>
    </section>
  );
}
