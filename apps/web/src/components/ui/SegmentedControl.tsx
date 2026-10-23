'use client';

import { Tabs } from '@base-ui/react/tabs';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface SegmentedItem<V extends string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** The accessible name when the label is an icon alone. */
  'aria-label'?: string;
}

export interface SegmentedControlProps<V extends string> {
  items: readonly SegmentedItem<V>[];
  value: V;
  onValueChange: (value: V) => void;
  'aria-label': string;
  size?: 'sm' | 'md';
  /** Classes for the outer element (layout: margins, alignment). */
  className?: string;
  /** TabPanel-s to render after the track, when the control switches content. */
  children?: ReactNode;
}

/**
 * Simplify's segmented tabs: a rounded-full track at 4% black (#f2f2f2 on the canvas), the active segment a white
 * full-height pill with a 6% black border, labels 15 px ("Active (87) | Archived (0)", "Board | List | Chart",
 * "Summary | Full posting"). Arrow keys move between segments (Base UI Tabs).
 */
export function SegmentedControl<V extends string>({
  items,
  value,
  onValueChange,
  size = 'md',
  className,
  children,
  ...aria
}: SegmentedControlProps<V>) {
  return (
    <Tabs.Root value={value} onValueChange={(next) => onValueChange(next as V)} className={className}>
      <Tabs.List
        activateOnFocus
        aria-label={aria['aria-label']}
        className={clsx('inline-flex shrink-0 items-center rounded-full bg-segment', size === 'sm' ? 'h-8' : 'h-9')}
      >
        {items.map((item) => (
          <Tabs.Tab
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            aria-label={item['aria-label']}
            className={clsx(
              'inline-flex h-full items-center justify-center gap-1.5 rounded-full border border-transparent whitespace-nowrap',
              size === 'sm' ? 'px-2.5 text-sm' : 'px-3 text-[15px]',
              'text-muted-foreground transition-colors duration-150 hover:text-foreground',
              'data-active:border-black/[0.06] data-active:bg-surface data-active:text-foreground',
              'focus-visible:outline-offset-0 data-disabled:pointer-events-none data-disabled:opacity-50',
            )}
          >
            {item.icon && <span className="flex">{item.icon}</span>}
            {item.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {children}
    </Tabs.Root>
  );
}

/** Content shown while its tab is active (SegmentedControl or UnderlineTabs). Unmounted otherwise. */
export function TabPanel({
  value,
  children,
  className,
  keepMounted,
}: {
  value: string;
  children: ReactNode;
  className?: string;
  keepMounted?: boolean;
}) {
  return (
    <Tabs.Panel value={value} keepMounted={keepMounted} className={clsx('outline-none', className)}>
      {children}
    </Tabs.Panel>
  );
}
