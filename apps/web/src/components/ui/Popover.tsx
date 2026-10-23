'use client';

import { Popover as BasePopover } from '@base-ui/react/popover';
import { clsx } from 'clsx';
import type { ComponentProps, ReactNode } from 'react';
import { POPOVER_SURFACE, Z_FLOATING } from './styles';

/*
 *   <Popover>
 *     <PopoverTrigger render={<FilterPill label="Location" />} />
 *     <PopoverContent>…</PopoverContent>
 *   </Popover>
 */

export function Popover(props: ComponentProps<typeof BasePopover.Root>) {
  return <BasePopover.Root {...props} />;
}

export function PopoverTrigger(props: ComponentProps<typeof BasePopover.Trigger>) {
  return <BasePopover.Trigger {...props} />;
}

export const PopoverClose = BasePopover.Close;

export interface PopoverContentProps {
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  /** Padding preset: "md" = 16 px (default), "none" for content that draws its own. */
  padding?: 'none' | 'sm' | 'md';
  className?: string;
  /** Title read by screen readers when the popover has no visible heading. */
  'aria-label'?: string;
  initialFocus?: ComponentProps<typeof BasePopover.Popup>['initialFocus'];
}

const PADDING = { none: '', sm: 'p-3', md: 'p-4' } as const;

/** A white panel (radius 14, popover shadow) anchored to its trigger. */
export function PopoverContent({
  children,
  side = 'bottom',
  align = 'start',
  sideOffset = 8,
  padding = 'md',
  className,
  initialFocus,
  ...aria
}: PopoverContentProps) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={clsx(Z_FLOATING, 'outline-none')}
      >
        <BasePopover.Popup
          aria-label={aria['aria-label']}
          initialFocus={initialFocus}
          className={clsx(POPOVER_SURFACE, PADDING[padding], 'max-h-(--available-height) max-w-[calc(100vw-1rem)] overflow-y-auto', className)}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}

export function PopoverTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <BasePopover.Title className={clsx('text-sm font-semibold text-foreground', className)}>{children}</BasePopover.Title>;
}

export function PopoverDescription({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <BasePopover.Description className={clsx('text-[13px] text-muted-foreground', className)}>{children}</BasePopover.Description>
  );
}
