'use client';

import { clsx } from 'clsx';
import { useCallback, useState } from 'react';
import { RowsIcon, SquaresFourIcon } from '@/components/ui/icons';
import { Tooltip } from '@/components/ui/Tooltip';
import { useStoredValue } from '@/lib/storage';
import type { ViewMode } from './types';

/**
 * The view a collection shows, remembered per `storageKey` in localStorage ("tailorit.documents.resumes.view").
 * Anything stored that is not one of `views` reads as `fallback`; a refused storage just is not remembered. Without
 * a key the choice lives in component state.
 */
export function useViewMode(
  storageKey: string | undefined,
  views: readonly ViewMode[],
  fallback: ViewMode,
): [ViewMode, (mode: ViewMode) => void] {
  const allowed = views.join(',');
  const parse = useCallback(
    (raw: string | null): ViewMode => (raw && allowed.split(',').includes(raw) ? (raw as ViewMode) : fallback),
    [allowed, fallback],
  );
  const [stored, setStored] = useStoredValue<ViewMode>(storageKey ?? 'tailorit.view.unset', parse);
  const [local, setLocal] = useState<ViewMode>(fallback);
  if (!storageKey) return [local, setLocal];
  return [stored, setStored];
}

const OPTIONS: Record<ViewMode, { label: string; icon: typeof SquaresFourIcon }> = {
  grid: { label: 'Grid', icon: SquaresFourIcon },
  list: { label: 'List', icon: RowsIcon },
};

/**
 * Grid | List, two icon toggle buttons on Simplify's segmented track (4% black, white active pill).
 * `role="group"` with `aria-pressed` buttons.
 */
export function ViewToggle({
  value,
  onChange,
  views = ['grid', 'list'],
  className,
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  views?: readonly ViewMode[];
  className?: string;
}) {
  return (
    <div role="group" aria-label="View" className={clsx('inline-flex h-9 shrink-0 items-center rounded-full bg-segment', className)}>
      {views.map((mode) => {
        const { label, icon: Icon } = OPTIONS[mode];
        const pressed = value === mode;
        return (
          <Tooltip key={mode} content={`${label} view`}>
            <button
              type="button"
              aria-label={label}
              aria-pressed={pressed}
              onClick={() => onChange(mode)}
              className={clsx(
                'inline-flex h-9 w-10 items-center justify-center rounded-full border transition-colors duration-150 focus-visible:outline-offset-0',
                pressed
                  ? 'border-black/[0.06] bg-surface text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon size={18} weight={pressed ? 'fill' : 'regular'} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
