'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DotsSixVerticalIcon } from '@phosphor-icons/react/DotsSixVertical';
import { clsx } from 'clsx';
import { useMemo, type ReactNode } from 'react';
import { CARD_TOOLS } from './SectionCard';

/** Cards move in one column: the drag keeps to the vertical axis. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/**
 * The section cards as a sortable list (dnd-kit): dragged by each card's grip (pointer, touch or keyboard: Space to
 * lift, arrows to move, Space to drop), with announcements that name the sections. A drop calls `onReorder` with the
 * new order; the cards themselves stay mounted, so an open card stays open.
 */
export function SortableSections({
  order,
  labelOf,
  onReorder,
  children,
}: {
  order: readonly string[];
  labelOf: (ref: string) => string;
  onReorder: (next: string[], moved: string) => void;
  /** One card: its ref, the grip to put in its head, and whether it is the one being dragged. */
  children: (ref: string, grip: ReactNode, dragging: boolean) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const announcements = useMemo<Announcements>(() => {
    const position = (id: string | number) => `${order.indexOf(String(id)) + 1} of ${order.length}`;
    return {
      onDragStart: ({ active }) => `Picked up ${labelOf(String(active.id))}, position ${position(active.id)}.`,
      onDragOver: ({ active, over }) =>
        over ? `${labelOf(String(active.id))} is over position ${position(over.id)}.` : `${labelOf(String(active.id))} is outside the list.`,
      onDragEnd: ({ active, over }) =>
        over ? `${labelOf(String(active.id))} dropped at position ${position(over.id)}.` : `${labelOf(String(active.id))} dropped.`,
      onDragCancel: ({ active }) => `Moving ${labelOf(String(active.id))} was cancelled.`,
    };
  }, [order, labelOf]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove([...order], from, to), String(active.id));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: 'To move a section, press Space, use the arrow keys to move it, then press Space again to drop it. Escape cancels.',
        },
      }}
    >
      <SortableContext items={[...order]} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-3">
          {order.map((ref) => (
            <SortableSlot key={ref} id={ref} label={labelOf(ref)}>
              {(grip, dragging) => children(ref, grip, dragging)}
            </SortableSlot>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableSlot({ id, label, children }: { id: string; label: string; children: (grip: ReactNode, dragging: boolean) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const grip = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`Drag to reorder ${label}`}
      className={clsx(
        'flex h-9 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-subtle-foreground hover:bg-hover hover:text-foreground active:cursor-grabbing',
        CARD_TOOLS,
      )}
    >
      <DotsSixVerticalIcon size={18} weight="bold" />
    </button>
  );
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={clsx('relative', isDragging && 'z-20')}>
      {children(grip, isDragging)}
    </div>
  );
}
