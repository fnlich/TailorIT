'use client';

import { useState, type ReactNode } from 'react';
import { APPLICATION_STATUSES, STATUS_INFO, type ApplicationStatus, type TrackerTab, type TrackerView } from '@tailorit/shared';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { SearchPill } from '@/components/ui/SearchPill';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ArchiveIcon, ArrowCounterClockwiseIcon, CaretDownIcon, ChartLineIcon, KanbanIcon, PlusIcon, RowsIcon, TrashIcon } from '@/components/ui/icons';
import { filterChips, selectedLabel, withoutChip, DEFAULT_FILTERS, type FilterState } from '../state';
import { StatusIcon } from '../status';

/** Row 1: Active (N) | Archived (N) and "+ Add application". */
export function TabsRow({
  tab,
  counts,
  onTabChange,
  onAdd,
}: {
  tab: TrackerTab;
  counts: { active: number; archived: number } | undefined;
  onTabChange: (tab: TrackerTab) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <SegmentedControl
        aria-label="Applications"
        value={tab}
        onValueChange={onTabChange}
        items={[
          { value: 'active', label: `Active (${counts?.active ?? 0})` },
          { value: 'archived', label: `Archived (${counts?.archived ?? 0})` },
        ]}
      />
      <Button icon={<PlusIcon size={16} weight="bold" />} onClick={onAdd}>
        Add application
      </Button>
    </div>
  );
}

/** Row 2: search, Board | List | Chart, Options. */
export function SearchRow({
  view,
  search,
  onSearchChange,
  onViewChange,
  options,
}: {
  view: TrackerView;
  search: string;
  onSearchChange: (value: string) => void;
  onViewChange: (view: TrackerView) => void;
  options: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
      {view === 'chart' ? (
        <div className="hidden flex-1 sm:block" />
      ) : (
        <SearchPill
          value={search}
          onValueChange={onSearchChange}
          placeholder="Search for roles or companies"
          className="w-full min-w-0 sm:flex-1"
        />
      )}
      <SegmentedControl
        aria-label="Tracker view"
        value={view}
        onValueChange={onViewChange}
        items={[
          { value: 'board', label: 'Board', icon: <KanbanIcon size={16} /> },
          { value: 'list', label: 'List', icon: <RowsIcon size={16} /> },
          { value: 'chart', label: 'Chart', icon: <ChartLineIcon size={16} /> },
        ]}
      />
      {options}
    </div>
  );
}

/** The removable chips of the active filters, and "Clear all filters". */
export function FilterChipsRow({ filters, onChange }: { filters: FilterState; onChange: (filters: FilterState) => void }) {
  const chips = filterChips(filters);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
      {chips.map((chip) => (
        <Chip
          key={`${chip.key}-${chip.status ?? ''}`}
          tone="neutral"
          size="sm"
          icon={chip.status ? <StatusIcon status={chip.status} size={14} /> : undefined}
          onRemove={() => onChange(withoutChip(filters, chip))}
          removeLabel={`Remove ${chip.label}`}
        >
          {chip.label}
        </Chip>
      ))}
      <Button variant="link" size="sm" onClick={() => onChange(DEFAULT_FILTERS)}>
        Clear all filters
      </Button>
    </div>
  );
}

export type BulkKind = 'archive' | 'unarchive' | 'delete' | { status: ApplicationStatus };

const CONFIRM: Record<'archive' | 'unarchive' | 'delete', { title: string; description: string; label: string; tone: 'primary' | 'destructive' }> = {
  delete: {
    title: 'Delete Applications',
    description: "Are you sure you want to delete all these applications? You won't be able to undo this action.",
    label: 'Delete',
    tone: 'destructive',
  },
  archive: {
    title: 'Archive Applications',
    description: 'Are you sure you want to archive all these applications?',
    label: 'Archive',
    tone: 'primary',
  },
  unarchive: {
    title: 'Unarchive Applications',
    description: 'Are you sure you want to unarchive all these applications?',
    label: 'Unarchive',
    tone: 'primary',
  },
};

/** "Manage jobs": the select-mode bar with its bulk actions and Simplify's confirmations. */
export function ManageBar({
  tab,
  count,
  total,
  allSelected,
  onSelectAll,
  onBulk,
  onDone,
}: {
  tab: TrackerTab;
  count: number;
  total: number;
  allSelected: boolean;
  onSelectAll: (selected: boolean) => void;
  onBulk: (kind: BulkKind) => Promise<void>;
  onDone: () => void;
}) {
  const [pending, setPending] = useState<BulkKind | null>(null);
  const none = count === 0;
  const confirm =
    pending === null
      ? null
      : typeof pending === 'object'
        ? {
            title: 'Warning',
            description: `Are you sure you want to update the status of these ${count} applications?`,
            label: 'Update',
            tone: 'primary' as const,
          }
        : CONFIRM[pending];
  return (
    <div
      role="toolbar"
      aria-label="Manage jobs"
      className="flex min-h-9 flex-wrap items-center gap-3 rounded-full border border-border bg-surface py-1 pr-1.5 pl-4 shadow-soft"
    >
      <Checkbox
        checked={allSelected && total > 0}
        indeterminate={!allSelected && count > 0}
        disabled={total === 0}
        aria-label="Select all applications"
        onCheckedChange={(next) => onSelectAll(next)}
      />
      <span className="text-sm font-medium text-foreground" aria-live="polite">
        {selectedLabel(count)}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          icon={<ArchiveIcon size={14} />}
          disabled={none || tab === 'archived'}
          onClick={() => setPending('archive')}
        >
          Archive
        </Button>
        <Button
          variant="outline"
          size="sm"
          icon={<ArrowCounterClockwiseIcon size={14} />}
          disabled={none || tab === 'active'}
          onClick={() => setPending('unarchive')}
        >
          Unarchive
        </Button>
        <Button variant="destructive-outline" size="sm" icon={<TrashIcon size={14} />} disabled={none} onClick={() => setPending('delete')}>
          Delete
        </Button>
        <Menu>
          <MenuTrigger
            disabled={none}
            render={<Button variant="outline" size="sm" trailingIcon={<CaretDownIcon size={12} />} />}
          >
            Update Status
          </MenuTrigger>
          <MenuContent width="w-52" align="end">
            {APPLICATION_STATUSES.map((status) => (
              <MenuItem key={status} icon={<StatusIcon status={status} size={16} />} onClick={() => setPending({ status })}>
                {STATUS_INFO[status].label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
        <Button size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={confirm?.title ?? ''}
        description={confirm?.description}
        confirmLabel={confirm?.label ?? 'OK'}
        tone={confirm?.tone ?? 'primary'}
        onConfirm={async () => {
          if (pending !== null) await onBulk(pending);
        }}
      />
    </div>
  );
}
