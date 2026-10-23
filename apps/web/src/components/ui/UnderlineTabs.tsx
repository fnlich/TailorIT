'use client';

import { Tabs } from '@base-ui/react/tabs';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface UnderlineTabItem<V extends string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
}

export interface UnderlineTabsProps<V extends string> {
  items: readonly UnderlineTabItem<V>[];
  value: V;
  onValueChange: (value: V) => void;
  'aria-label': string;
  /**
   * "lg": the Documents page tabs (56 px, 16 px labels padded 16 px; the bar spans the padded tab).
   * "md": 48 px. "tight": the job detail's "Overview | Company" (61 px, no padding, 32 px apart, the bar under
   * the label only).
   */
  size?: 'lg' | 'md' | 'tight';
  className?: string;
  listClassName?: string;
  /** TabPanel-s for the content under the tabs. */
  children?: ReactNode;
}

const SIZES = {
  lg: { list: '', tab: 'h-14 px-4 text-base' },
  md: { list: '', tab: 'h-12 px-4 text-base' },
  tight: { list: 'gap-8', tab: 'h-[61px] px-0 text-base' },
} as const;

/**
 * Simplify's underline tabs ("Resumes | Cover Letters | Templates"): muted labels, the active one #191919 with a 2 px
 * #191919 bar sitting on a full-width #e8e8e8 baseline. Arrow keys move between tabs.
 */
export function UnderlineTabs<V extends string>({
  items,
  value,
  onValueChange,
  size = 'lg',
  className,
  listClassName,
  children,
  ...aria
}: UnderlineTabsProps<V>) {
  const sizing = SIZES[size];
  return (
    <Tabs.Root value={value} onValueChange={(next) => onValueChange(next as V)} className={className}>
      <Tabs.List
        activateOnFocus
        aria-label={aria['aria-label']}
        // The baseline is an inset shadow (not a border) so the active bar can sit on it inside the scroll box.
        className={clsx(
          'flex items-stretch overflow-x-auto shadow-[inset_0_-1px_0_var(--color-border)]',
          sizing.list,
          listClassName,
        )}
      >
        {items.map((item) => (
          <Tabs.Tab
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className={clsx(
              'relative inline-flex shrink-0 items-center whitespace-nowrap text-muted-foreground',
              sizing.tab,
              'transition-colors duration-150 hover:text-foreground focus-visible:outline-offset-[-2px]',
              'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-transparent after:content-[""]',
              'data-active:text-foreground data-active:after:bg-foreground',
              'data-disabled:pointer-events-none data-disabled:opacity-50',
            )}
          >
            {item.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {children}
    </Tabs.Root>
  );
}
