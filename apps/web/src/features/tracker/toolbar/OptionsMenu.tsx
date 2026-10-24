'use client';

import { useState } from 'react';
import { DayPicker, type Matcher } from 'react-day-picker';
import 'react-day-picker/style.css';
import {
  APPLICATION_STATUSES,
  SORT_ORDER_LABEL,
  STATUS_INFO,
  TRACKER_SORT_LABEL,
  toDate,
  toIsoDate,
  type ApplicationStatus,
  type EmploymentType,
  type SortOrder,
  type TrackerSort,
  type TrackerView,
} from '@tailorit/shared';
import { FilterPill } from '@/components/ui/FilterPill';
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuTrigger,
} from '@/components/ui/Menu';
import {
  ArchiveIcon,
  CopyIcon,
  DownloadSimpleIcon,
  FileZipIcon,
  SlidersHorizontalIcon,
  UploadSimpleIcon,
} from '@/components/ui/icons';
import { useNow } from '@/lib/useNow';
import { activeFilterCount, hasFilters, toggleStatus, DEFAULT_FILTERS, type FilterState } from '../state';
import { StatusIcon } from '../status';

const JOB_TYPES: Array<{ value: EmploymentType; label: string }> = [
  { value: 'internship', label: 'Internship' },
  { value: 'full_time', label: 'Full-Time' },
  { value: 'part_time', label: 'Part-Time' },
  { value: 'contract', label: 'Contract' },
];

/** A single-date calendar inside a submenu ("Applied from ›" / "Applied until ›"). */
function DateFilter({
  value,
  min,
  max,
  onPick,
}: {
  value: string | null;
  min: Date | null;
  max: Date;
  onPick: (date: string) => void;
}) {
  const selected = toDate(value) ?? undefined;
  const disabled: Matcher[] = [{ after: max }];
  if (min) disabled.push({ before: min });
  return (
    // The calendar keeps its arrow keys (the menu would move its highlight); Escape and Tab still reach the menu.
    <div
      className="px-1 pt-1"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
      }}
    >
      <DayPicker
        className="ti-day-picker"
        mode="single"
        captionLayout="dropdown"
        startMonth={new Date(2015, 0)}
        endMonth={max}
        defaultMonth={selected ?? max}
        selected={selected}
        onSelect={(date) => {
          const iso = toIsoDate(date ?? null);
          if (iso) onPick(iso);
        }}
        disabled={disabled}
      />
    </div>
  );
}

export interface ColumnChoice {
  status: ApplicationStatus;
  count: number;
  visible: boolean;
}

export function OptionsMenu({
  view,
  filters,
  onFiltersChange,
  onListView,
  columns,
  onColumnToggle,
  archivedColumn,
  onArchivedToggle,
  onManage,
  onImport,
  onExport,
  onBuildResumes,
  buildingResumes,
  onArchiveAll,
}: {
  view: TrackerView;
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  /** Picking a status filter switches to the list (Simplify). */
  onListView: () => void;
  columns: ColumnChoice[];
  onColumnToggle: (status: ApplicationStatus, visible: boolean) => void;
  archivedColumn: { count: number; visible: boolean };
  onArchivedToggle: (visible: boolean) => void;
  onManage: () => void;
  onImport: () => void;
  onExport: () => void;
  /** "Build resumes (zip)": every active Saved application's resume in one zip. */
  onBuildResumes: () => void;
  /** A zip is being built (the entry waits for it). */
  buildingResumes: boolean;
  onArchiveAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const now = useNow();
  const today = new Date(now);
  const count = activeFilterCount(filters);
  const set = (patch: Partial<FilterState>) => onFiltersChange({ ...filters, ...patch });
  const showFilters = view !== 'chart';

  return (
    <Menu open={open} onOpenChange={setOpen}>
      {/*
        Opens on hover like Simplify's (a mouse resting on it for 100 ms), and still on click, Enter, Space or the arrow
        keys. A hover-opened menu closes when the pointer leaves it; a click inside keeps it open.
      */}
      <MenuTrigger
        openOnHover
        render={
          <FilterPill
            label="Options"
            icon={<SlidersHorizontalIcon size={16} />}
            count={count}
            active={count > 0}
            aria-label={count > 0 ? `Options, ${count} filters applied` : 'Options'}
          />
        }
      />
      <MenuContent align="end" width="w-60" aria-label="Options">
        {showFilters && (
          <>
            <MenuGroup label="Filters">
              <MenuSub label="Applied from">
                <MenuSubContent width="w-auto">
                  <DateFilter
                    value={filters.from}
                    min={null}
                    max={toDate(filters.until) ?? today}
                    onPick={(date) => {
                      set({ from: date });
                      setOpen(false);
                    }}
                  />
                  <MenuSeparator />
                  <MenuItem disabled={!filters.from} onClick={() => set({ from: null })}>
                    Clear applied from
                  </MenuItem>
                </MenuSubContent>
              </MenuSub>
              <MenuSub label="Applied until">
                <MenuSubContent width="w-auto">
                  <DateFilter
                    value={filters.until}
                    min={toDate(filters.from)}
                    max={today}
                    onPick={(date) => {
                      set({ until: date });
                      setOpen(false);
                    }}
                  />
                  <MenuSeparator />
                  <MenuItem disabled={!filters.until} onClick={() => set({ until: null })}>
                    Clear applied until
                  </MenuItem>
                </MenuSubContent>
              </MenuSub>
              <MenuSub label="Job type">
                <MenuSubContent width="w-52">
                  <MenuRadioGroup
                    value={filters.jobType ?? ''}
                    onValueChange={(value) => set({ jobType: (value || null) as EmploymentType | null })}
                  >
                    {JOB_TYPES.map((type) => (
                      <MenuRadioItem key={type.value} value={type.value}>
                        {type.label}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                  <MenuSeparator />
                  <MenuItem disabled={!filters.jobType} onClick={() => set({ jobType: null })}>
                    Clear job type
                  </MenuItem>
                </MenuSubContent>
              </MenuSub>
              <MenuSub label="Status">
                <MenuSubContent width="w-56">
                  {APPLICATION_STATUSES.map((status) => (
                    <MenuCheckboxItem
                      key={status}
                      checked={filters.statuses.includes(status)}
                      icon={<StatusIcon status={status} size={16} />}
                      onCheckedChange={(on) => {
                        set({ statuses: toggleStatus(filters.statuses, status, on) });
                        if (on) onListView();
                      }}
                    >
                      {STATUS_INFO[status].label}
                    </MenuCheckboxItem>
                  ))}
                  <MenuSeparator />
                  <MenuItem disabled={filters.statuses.length === 0} onClick={() => set({ statuses: [] })}>
                    Clear status
                  </MenuItem>
                </MenuSubContent>
              </MenuSub>
              {hasFilters(filters) && (
                <MenuItem onClick={() => onFiltersChange(DEFAULT_FILTERS)}>Clear all filters</MenuItem>
              )}
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup label="View options">
              <MenuCheckboxItem checked={filters.favorites} onCheckedChange={(on) => set({ favorites: on })}>
                Show only favorites
              </MenuCheckboxItem>
              {view === 'board' && (
                <MenuSub label={`Visible columns (${columns.filter((column) => column.visible).length + (archivedColumn.visible ? 1 : 0)})`}>
                  <MenuSubContent width="w-60">
                    {columns.map((column) => (
                      <MenuCheckboxItem
                        key={column.status}
                        checked={column.visible}
                        icon={<StatusIcon status={column.status} size={16} />}
                        onCheckedChange={(on) => onColumnToggle(column.status, on)}
                      >
                        {STATUS_INFO[column.status].label}
                        <span className="ml-1 text-muted-foreground tabular-nums">({column.count})</span>
                      </MenuCheckboxItem>
                    ))}
                    <MenuCheckboxItem
                      checked={archivedColumn.visible}
                      icon={<ArchiveIcon size={16} />}
                      onCheckedChange={onArchivedToggle}
                    >
                      Archived
                      <span className="ml-1 text-muted-foreground tabular-nums">({archivedColumn.count})</span>
                    </MenuCheckboxItem>
                  </MenuSubContent>
                </MenuSub>
              )}
              <MenuSub label="Sort by">
                <MenuSubContent width="w-52">
                  <MenuRadioGroup value={filters.sort} onValueChange={(sort) => set({ sort: sort as TrackerSort })}>
                    {(Object.keys(TRACKER_SORT_LABEL) as TrackerSort[]).map((sort) => (
                      <MenuRadioItem key={sort} value={sort}>
                        {TRACKER_SORT_LABEL[sort]}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                  <MenuSeparator />
                  <MenuRadioGroup value={filters.order} onValueChange={(order) => set({ order: order as SortOrder })}>
                    {(Object.keys(SORT_ORDER_LABEL) as SortOrder[]).map((order) => (
                      <MenuRadioItem key={order} value={order}>
                        {SORT_ORDER_LABEL[order]}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuSubContent>
              </MenuSub>
            </MenuGroup>
            <MenuSeparator />
          </>
        )}
        <MenuGroup label="Actions">
          <MenuItem icon={<CopyIcon size={16} />} onClick={onManage}>
            Manage jobs
          </MenuItem>
          <MenuItem icon={<DownloadSimpleIcon size={16} />} onClick={onImport}>
            Import CSV
          </MenuItem>
          <MenuItem icon={<UploadSimpleIcon size={16} />} onClick={onExport}>
            Export CSV
          </MenuItem>
          <MenuItem icon={<FileZipIcon size={16} />} disabled={buildingResumes} onClick={onBuildResumes}>
            {buildingResumes ? 'Building resumes...' : 'Build resumes (zip)'}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<ArchiveIcon size={16} />} onClick={onArchiveAll}>
            Archive all applications
          </MenuItem>
        </MenuGroup>
      </MenuContent>
    </Menu>
  );
}
