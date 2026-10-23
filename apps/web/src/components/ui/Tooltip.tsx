'use client';

import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { clsx } from 'clsx';
import type { ReactElement, ReactNode } from 'react';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: ReactNode;
  /** The element the tooltip describes. It must forward its ref and spread props (kit buttons do). */
  children: ReactElement;
  side?: TooltipSide;
  align?: 'start' | 'center' | 'end';
  /** Hover delay in ms (Base UI default 600; the provider in AppProviders shortens it to 400). */
  delay?: number;
  disabled?: boolean;
  className?: string;
}

const POPUP =
  'max-w-xs origin-(--transform-origin) rounded-[8px] bg-foreground px-2.5 py-1.5 text-xs leading-4 font-medium text-white ' +
  'shadow-popover transition-[opacity,scale] duration-150 ease-out-soft data-starting-style:scale-95 ' +
  'data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none';

/** A short dark hint on hover and keyboard focus. Supplementary only: never the sole carrier of information. */
export function Tooltip({ content, children, side = 'top', align = 'center', delay, disabled, className }: TooltipProps) {
  if (disabled || content === null || content === undefined || content === '') return children;
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} delay={delay} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} align={align} sideOffset={8} className="z-[70]">
          <BaseTooltip.Popup className={clsx(POPUP, className)}>{content}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

/** Shares the hover delay between neighbouring tooltips (mounted once in AppProviders). */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <BaseTooltip.Provider delay={400} closeDelay={0}>
      {children}
    </BaseTooltip.Provider>
  );
}
