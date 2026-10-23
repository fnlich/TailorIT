'use client';

import { clsx } from 'clsx';
import type { CSSProperties, ReactNode } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import type { Selection } from './useSelection';
import type { DocumentColumn, DocumentKind } from './types';

export type DocumentListVariant = 'table' | 'cards';

export interface DocumentListProps<T> {
  kind: DocumentKind;
  /**
   * "table": Simplify's table (inside a white card: #f8f8f8 header row, #e8e8e8 dividers, 76 px rows).
   * "cards": free_tailor's list (each row its own white rounded card under a muted header row).
   */
  variant: DocumentListVariant;
  items: readonly T[];
  getId: (item: T) => string;
  /** For accessible names: "Select {label}". */
  getLabel: (item: T) => string;
  columns: readonly DocumentColumn<T>[];
  /** The last cell of each row (table: "✎ Edit · More ⌄"; cards: a ⋮ ActionMenu). */
  renderActions?: (item: T) => ReactNode;
  /** Header of the actions column (table default "Actions"; cards default none). */
  actionsHeader?: ReactNode;
  /** Track of the actions column (table default 13.5rem, cards 2.5rem). */
  actionsTrack?: string;
  /** Adds a checkbox column (with select-all in the header). */
  selection?: Selection;
  /** Rows that cannot be selected (e.g. system templates) get a disabled box. */
  isSelectable?: (item: T) => boolean;
  /** Greys out a row's cells. */
  dimmed?: (item: T) => boolean;
  /** Names the select-all box: "Select all resumes". */
  selectAllLabel?: string;
  'aria-label': string;
  className?: string;
}

/**
 * The list view of a document collection, laid out with CSS grid but exposed as an ARIA table (column headers
 * are announced, unlike free_tailor's aria-hidden header). Rows carry `data-{kind}-row="{id}"` for focus moves.
 */
export function DocumentList<T>({
  kind,
  variant,
  items,
  getId,
  getLabel,
  columns,
  renderActions,
  actionsHeader,
  actionsTrack,
  selection,
  isSelectable,
  dimmed,
  selectAllLabel = 'Select all',
  className,
  ...aria
}: DocumentListProps<T>) {
  const table = variant === 'table';
  const hasActions = Boolean(renderActions);
  const tracks = [
    selection ? '18px' : null,
    ...columns.map((column) => column.track),
    hasActions ? (actionsTrack ?? (table ? '13.5rem' : '2.5rem')) : null,
  ].filter(Boolean);
  const mobileTracks = [selection ? '18px' : null, 'minmax(0,1fr)', hasActions ? 'auto' : null].filter(Boolean);
  const gridStyle = {
    '--doc-cols': tracks.join(' '),
    '--doc-cols-sm': mobileTracks.join(' '),
  } as CSSProperties;

  const rowGrid = clsx(
    'grid items-center [grid-template-columns:var(--doc-cols-sm)] sm:[grid-template-columns:var(--doc-cols)]',
    table ? 'gap-x-[15px] px-4' : 'gap-x-4 px-4',
  );
  // On phones the extra cells stack under the name; checkbox and actions stay on the first line.
  const mainCol = selection ? 'max-sm:col-start-2' : 'max-sm:col-start-1';
  const actionsCol = selection ? 'max-sm:col-start-3' : 'max-sm:col-start-2';

  const selectableIds = selection ? items.filter((item) => isSelectable?.(item) ?? true).map(getId) : [];
  const headerTone = table ? 'text-sm font-semibold text-foreground' : 'text-[13px] font-semibold text-muted-foreground';

  return (
    <div role="table" aria-label={aria['aria-label']} className={clsx(!table && 'flex flex-col gap-2', className)} style={gridStyle}>
      <div role="rowgroup">
        <div
          role="row"
          className={clsx(
            rowGrid,
            table ? 'h-11 bg-surface-low' : 'h-9 max-sm:hidden',
          )}
        >
          {selection && (
            <span role="columnheader" className="flex items-center">
              <Checkbox
                checked={selection.allSelected}
                indeterminate={selection.someSelected}
                disabled={selectableIds.length === 0}
                onCheckedChange={(checked) => selection.setAll(checked)}
                aria-label={selectAllLabel}
              />
            </span>
          )}
          {columns.map((column, index) => (
            <span
              key={column.key}
              role="columnheader"
              className={clsx(
                'truncate',
                headerTone,
                column.align === 'end' && 'text-right',
                index > 0 && 'max-sm:hidden',
                index === 0 && mainCol,
              )}
            >
              {column.header}
            </span>
          ))}
          {hasActions && (
            <span role="columnheader" className={clsx(headerTone, 'max-sm:hidden')}>
              {actionsHeader ?? (table ? 'Actions' : <span className="sr-only">Actions</span>)}
            </span>
          )}
        </div>
      </div>
      <div role="rowgroup" className={clsx(!table && 'flex flex-col gap-2')}>
        {items.map((item) => {
          const id = getId(item);
          const canSelect = isSelectable?.(item) ?? true;
          const selected = selection?.isSelected(id) ?? false;
          const isDimmed = dimmed?.(item) ?? false;
          return (
            <div
              key={id}
              role="row"
              data-selected={selected ? '' : undefined}
              {...{ [`data-${kind}-row`]: id }}
              className={clsx(
                rowGrid,
                'gap-y-1 transition-colors duration-100',
                // Each colour is chosen once (classes are not merged, so two backgrounds must never meet).
                table
                  ? clsx('min-h-[76px] border-b border-border py-4 last:border-b-0', selected ? 'bg-primary-50' : 'hover:bg-[#fcfcfc]')
                  : clsx(
                      'min-h-14 rounded-surface border py-2.5 shadow-soft',
                      selected ? 'border-primary/40 bg-primary-50' : 'border-border bg-surface hover:border-control-hover',
                    ),
              )}
            >
              {selection && (
                <span role="cell" className="flex items-center max-sm:row-start-1 max-sm:self-start max-sm:pt-0.5">
                  <Checkbox
                    checked={selected}
                    disabled={!canSelect}
                    onCheckedChange={(checked, details) => selection.toggle(id, checked, details)}
                    aria-label={`Select ${getLabel(item)}`}
                  />
                </span>
              )}
              {columns.map((column, index) => (
                <div
                  key={column.key}
                  role="cell"
                  className={clsx(
                    'min-w-0 text-sm text-foreground',
                    column.align === 'end' && 'sm:text-right',
                    index === 0 ? clsx(mainCol, 'max-sm:row-start-1') : clsx(mainCol, 'max-sm:text-[13px] max-sm:text-muted-foreground'),
                    column.hideOnMobile && 'max-sm:hidden',
                    isDimmed && 'opacity-60',
                    column.className,
                  )}
                >
                  {column.cell(item)}
                </div>
              ))}
              {renderActions && (
                <div role="cell" className={clsx('flex min-w-0 items-center', actionsCol, 'max-sm:row-start-1 max-sm:self-start', !table && 'justify-end')}>
                  {renderActions(item)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
