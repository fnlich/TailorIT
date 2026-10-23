'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { clsx } from 'clsx';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  DROP_HERE_TEXT,
  EMPTY_COLUMN_TITLE,
  STATUS_INFO,
  emptyColumnText,
  hideColumn,
  isApplicationStatus,
  type ApplicationStatus,
  type ApplicationSummary,
  type BoardColumn,
  type ColumnPrefs,
} from '@tailorit/shared';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { ArchiveIcon, EyeSlashIcon } from '@/components/ui/icons';
import { NO_MATCH_COLUMN_TEXT, NO_MATCH_TEXT, NO_MATCH_TITLE } from '../state';
import { StatusIcon } from '../status';
import { ApplicationCard, CARD_SURFACE, CardBody, type CardHandlers } from './ApplicationCard';

const COLUMN_ID = (status: ApplicationStatus) => `column-${status}`;
/** The optional Archived column (Simplify's "Visible columns" lists it after the statuses). */
const ARCHIVED_ID = 'column-archived';

/** Where a dragged card comes from: a status column, or the Archived column. */
type Source = ApplicationStatus | 'archived';
const sourceOf = (application: ApplicationSummary): Source => (application.archivedAt ? 'archived' : application.currentStatus);

/** Pointer drags use the column under the pointer; the keyboard (no pointer) uses the card's rectangle. */
const collisions: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

/** Left and right arrows jump the dragged card to the neighbouring column (dnd-kit moves 25 px by default). */
const columnCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  const { collisionRect, droppableRects, droppableContainers } = context;
  if (!collisionRect || (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft')) return undefined;
  event.preventDefault();
  const columns = droppableContainers
    .getEnabled()
    .map((container) => droppableRects.get(container.id))
    .filter((rect): rect is NonNullable<typeof rect> => Boolean(rect))
    .sort((a, b) => a.left - b.left);
  const center = collisionRect.left + collisionRect.width / 2;
  const index = columns.findIndex((rect) => center >= rect.left && center <= rect.right);
  const target = event.code === 'ArrowRight' ? columns[index + 1] : columns[index - 1];
  if (!target) return undefined;
  return { x: target.left, y: Math.max(target.top, collisionRect.top) };
};

function statusOf(id: string | number | undefined): ApplicationStatus | null {
  const status = Number(String(id ?? '').replace('column-', ''));
  return isApplicationStatus(status) ? status : null;
}

/** An empty column's dashed box: "No applications" and what to do, or "Drop application here" under a dragged card. */
function EmptyColumn({ text, dropping }: { text: string; dropping: boolean }) {
  return (
    <div
      className={clsx(
        'flex h-[155px] shrink-0 flex-col items-center justify-center gap-1 rounded-surface border border-dashed px-4 text-center',
        dropping ? 'border-primary-ink/30 bg-primary/5' : 'border-border',
      )}
    >
      <p className="text-sm font-semibold text-muted-foreground">{dropping ? DROP_HERE_TEXT : EMPTY_COLUMN_TITLE}</p>
      {!dropping && <p className="text-xs text-muted-foreground">{text}</p>}
    </div>
  );
}

function LoadMore({ onLoad, loading }: { onLoad: () => void; loading: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Infinite scroll inside the column: loading starts when the button scrolls into view.
  useEffect(() => {
    const node = ref.current;
    if (!node || loading) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoad();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onLoad, loading]);
  return (
    <div ref={ref} className="flex justify-center py-1">
      <Button variant="ghost" size="sm" onClick={onLoad} loading={loading}>
        Load more applications
      </Button>
    </div>
  );
}

function Column({
  column,
  prefs,
  onPrefsChange,
  activeFrom,
  renderCard,
  onLoadMore,
  loadingMore,
  filtered,
}: {
  column: BoardColumn;
  prefs: ColumnPrefs;
  onPrefsChange: (prefs: ColumnPrefs) => void;
  /** The column the dragged card comes from (no highlight over its own column). */
  activeFrom: Source | null;
  renderCard: (application: ApplicationSummary) => ReactNode;
  onLoadMore: (status: ApplicationStatus) => void;
  loadingMore: boolean;
  /** A search or filter narrows the board. */
  filtered: boolean;
}) {
  const { status } = column;
  const info = STATUS_INFO[status];
  const { setNodeRef, isOver } = useDroppable({ id: COLUMN_ID(status), data: { status } });
  const dropping = isOver && activeFrom !== null && activeFrom !== status;
  const loadMore = useCallback(() => onLoadMore(status), [onLoadMore, status]);
  return (
    <section aria-label={`${info.label}, ${column.total}`} data-column={status} className="flex h-full w-[300px] shrink-0 flex-col sm:w-[320px]">
      <header className="flex h-8 shrink-0 items-center gap-2 pr-0.5 pl-4">
        <StatusIcon status={status} size={16} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">{info.label}</h2>
        <span className="ml-1 text-xs text-muted-foreground tabular-nums">{column.total}</span>
        <IconButton
          label="Hide column"
          size="sm"
          className="ml-auto"
          icon={<EyeSlashIcon size={18} />}
          onClick={() => onPrefsChange(hideColumn(prefs, status))}
        />
      </header>
      <div
        ref={setNodeRef}
        className={clsx(
          'mt-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain rounded-surface p-0.5 pb-4 transition-colors duration-150',
          dropping && column.items.length > 0 && 'bg-primary/5 outline outline-1 outline-primary-ink/30',
        )}
      >
        {column.items.length === 0 ? (
          <EmptyColumn text={filtered ? NO_MATCH_COLUMN_TEXT : emptyColumnText(status)} dropping={dropping} />
        ) : (
          column.items.map(renderCard)
        )}
        {column.nextCursor && <LoadMore onLoad={loadMore} loading={loadingMore} />}
      </div>
    </section>
  );
}

export interface ArchivedColumnModel {
  /** null while the first page loads. */
  items: ApplicationSummary[] | null;
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onHide: () => void;
}

/** The Archived column: archived cards (restore by dragging them out), and a drop target that archives. */
function ArchivedColumn({
  model,
  activeFrom,
  renderCard,
  filtered,
}: {
  model: ArchivedColumnModel;
  activeFrom: Source | null;
  renderCard: (application: ApplicationSummary) => ReactNode;
  filtered: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: ARCHIVED_ID });
  const dropping = isOver && activeFrom !== null && activeFrom !== 'archived';
  const items = model.items ?? [];
  return (
    <section aria-label={`Archived, ${model.total}`} data-column="archived" className="flex h-full w-[300px] shrink-0 flex-col sm:w-[320px]">
      <header className="flex h-8 shrink-0 items-center gap-2 pr-0.5 pl-4">
        <ArchiveIcon size={16} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Archived</h2>
        <span className="ml-1 text-xs text-muted-foreground tabular-nums">{model.total}</span>
        <IconButton label="Hide column" size="sm" className="ml-auto" icon={<EyeSlashIcon size={18} />} onClick={model.onHide} />
      </header>
      <div
        ref={setNodeRef}
        className={clsx(
          'mt-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain rounded-surface p-0.5 pb-4 transition-colors duration-150',
          dropping && items.length > 0 && 'bg-primary/5 outline outline-1 outline-primary-ink/30',
        )}
      >
        {model.items === null ? (
          <Skeleton className="h-[155px] w-full" rounded="surface" />
        ) : items.length === 0 ? (
          <EmptyColumn text={filtered ? NO_MATCH_COLUMN_TEXT : 'Move applications into archived.'} dropping={dropping} />
        ) : (
          items.map(renderCard)
        )}
        {model.hasMore && <LoadMore onLoad={model.onLoadMore} loading={model.loadingMore} />}
      </div>
    </section>
  );
}

export interface BoardViewProps {
  columns: BoardColumn[] | null;
  /** The columns to show, in order (visibleColumns). */
  visible: readonly ApplicationStatus[];
  prefs: ColumnPrefs;
  onPrefsChange: (prefs: ColumnPrefs) => void;
  handlers: CardHandlers;
  openId: string | null;
  selectMode: boolean;
  selected: ReadonlySet<string>;
  onLoadMore: (status: ApplicationStatus) => void;
  loadingMore: ApplicationStatus | null;
  /** A card was dropped on another column. */
  onDrop: (application: ApplicationSummary, to: ApplicationStatus) => void;
  /** The Archived column, when it is shown. */
  archived: ArchivedColumnModel | null;
  /** A card was dropped on the Archived column. */
  onArchiveDrop: (application: ApplicationSummary) => void;
  /** An archived card was dropped on a status column. */
  onRestoreDrop: (application: ApplicationSummary, to: ApplicationStatus) => void;
  refreshing: boolean;
  /** A search or filter narrows the board: empty columns say so, and a board with no match at all says it once. */
  filtered: boolean;
}

/** Simplify's board: 320 px status columns side by side, cards dragged between them (dnd-kit). */
export function BoardView({
  columns,
  visible,
  prefs,
  onPrefsChange,
  handlers,
  openId,
  selectMode,
  selected,
  onLoadMore,
  loadingMore,
  onDrop,
  archived,
  onArchiveDrop,
  onRestoreDrop,
  refreshing,
  filtered,
}: BoardViewProps) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
      coordinateGetter: columnCoordinates,
    }),
  );
  const [active, setActive] = useState<ApplicationSummary | null>(null);
  const justDropped = useRef(false);

  const consumeDragClick = useCallback(() => {
    if (!justDropped.current) return false;
    justDropped.current = false;
    return true;
  }, []);

  const onDragStart = (event: DragStartEvent) => {
    const application = event.active.data.current?.application as ApplicationSummary | undefined;
    setActive(application ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const application = event.active.data.current?.application as ApplicationSummary | undefined;
    setActive(null);
    // The click that ends a mouse drag must not open the card.
    justDropped.current = true;
    window.setTimeout(() => {
      justDropped.current = false;
    }, 0);
    if (!application || !event.over) return;
    if (event.over.id === ARCHIVED_ID) {
      if (!application.archivedAt) onArchiveDrop(application);
      return;
    }
    const to = statusOf(event.over.id);
    if (to === null) return;
    if (application.archivedAt) onRestoreDrop(application, to);
    else if (to !== application.currentStatus) onDrop(application, to);
  };

  const label = (id: string | number) => {
    for (const column of columns ?? []) {
      const found = column.items.find((item) => item.id === id);
      if (found) return found.title;
    }
    return archived?.items?.find((item) => item.id === id)?.title ?? 'The application';
  };
  const columnName = (id: string | number | undefined) => {
    if (id === ARCHIVED_ID) return 'Archived';
    const status = statusOf(id);
    return status !== null ? STATUS_INFO[status].label : null;
  };
  const announcements: Announcements = {
    onDragStart: ({ active: dragged }) =>
      `Picked up ${label(dragged.id)}. Use the left and right arrow keys to move it to another status, Space to drop it, Escape to cancel.`,
    onDragOver: ({ active: dragged, over }) => {
      const name = columnName(over?.id);
      return name ? `${label(dragged.id)} is over ${name}.` : `${label(dragged.id)} is not over a column.`;
    },
    onDragEnd: ({ active: dragged, over }) => {
      const name = columnName(over?.id);
      return name ? `${label(dragged.id)} was dropped in ${name}.` : `${label(dragged.id)} was dropped.`;
    },
    onDragCancel: ({ active: dragged }) => `Moving ${label(dragged.id)} was cancelled.`,
  };

  const byStatus = new Map((columns ?? []).map((column) => [column.status, column] as const));
  const activeFrom = active ? sourceOf(active) : null;

  const renderCard = (application: ApplicationSummary) => (
    <ApplicationCard
      key={application.id}
      application={application}
      handlers={handlers}
      selected={openId === application.id}
      selectMode={selectMode}
      checked={selected.has(application.id)}
      draggingAny={active !== null}
      consumeDragClick={consumeDragClick}
    />
  );

  // Nothing anywhere matches the search or filters: one message (the list's) instead of a row of empty columns.
  const nothingMatches =
    filtered &&
    columns !== null &&
    columns.every((column) => column.total === 0) &&
    (archived === null || (archived.items !== null && archived.items.length === 0));
  if (nothingMatches) {
    return (
      <div className="px-4 pt-1 sm:px-6 lg:px-[35px]">
        <div className="rounded-surface border border-border bg-surface shadow-soft">
          <EmptyState title={NO_MATCH_TITLE} description={NO_MATCH_TEXT} />
        </div>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisions}
      // Scroll the board only when the pointer is near its edges (dnd-kit's default zone is 20% of its width, which
      // keeps scrolling while a card waits over the first or last visible column).
      autoScroll={{ threshold: { x: 0.08, y: 0.15 }, acceleration: 8 }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'Press Enter to open this application. To move it, press Space, use the left and right arrow keys to choose a status, then press Space again to drop it.',
        },
      }}
    >
      <div
        aria-busy={refreshing || undefined}
        className="flex h-full min-h-0 gap-3 overflow-x-auto overflow-y-hidden px-4 pt-1 sm:px-6 lg:px-[35px]"
      >
        {columns === null
          ? visible.map((status) => <ColumnSkeleton key={status} status={status} />)
          : visible.map((status) => {
              const column = byStatus.get(status) ?? { status, total: 0, items: [] };
              return (
                <Column
                  key={status}
                  column={column}
                  prefs={prefs}
                  onPrefsChange={onPrefsChange}
                  activeFrom={activeFrom}
                  renderCard={renderCard}
                  onLoadMore={onLoadMore}
                  loadingMore={loadingMore === status}
                  filtered={filtered}
                />
              );
            })}
        {archived && <ArchivedColumn model={archived} activeFrom={activeFrom} renderCard={renderCard} filtered={filtered} />}
        <div aria-hidden="true" className="w-px shrink-0" />
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className={clsx(CARD_SURFACE, 'w-[300px] rotate-[1.5deg] cursor-grabbing border-primary-ink/40 shadow-popover sm:w-[320px]')}>
            <CardBody application={active} />
          </div>
        ) : null}
      </DragOverlay>
      {refreshing && (
        <span className="sr-only" role="status">
          <Spinner label="Updating the board" />
        </span>
      )}
    </DndContext>
  );
}

function ColumnSkeleton({ status }: { status: ApplicationStatus }) {
  return (
    <section aria-hidden="true" className="flex h-full w-[300px] shrink-0 flex-col sm:w-[320px]">
      <header className="flex h-8 items-center gap-2 pl-4">
        <StatusIcon status={status} size={16} className="text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">{STATUS_INFO[status].label}</span>
      </header>
      <div className="mt-3 flex flex-col gap-3 p-0.5">
        {[0, 1].map((index) => (
          <div key={index} className={clsx(CARD_SURFACE, 'border-border')}>
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-8" rounded="control" />
              <Skeleton className="h-3.5 w-32" />
            </div>
            <Skeleton className="mt-4 h-3.5 w-48" />
            <Skeleton className="mt-3 h-3 w-24" />
          </div>
        ))}
      </div>
    </section>
  );
}
