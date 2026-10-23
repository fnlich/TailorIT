import {
  STATUS,
  trackerFilterChips,
  type ApplicationStatus,
  type EmploymentType,
  type FilterChip,
  type SortOrder,
  type TrackerSort,
  type TrackerTab,
  type TrackerView,
} from '@tailorit/shared';

/*
 * The tracker page's state outside React: the URL (`?view=board|list|chart&tab=active|archived&app=<id>&edit=1`) and
 * the Options-menu filters, with the query the API reads for them. Pure, so it is unit-tested.
 */

export interface TrackerUrlState {
  view: TrackerView;
  tab: TrackerTab;
  /** The application whose detail sheet is open. */
  app: string | null;
  /** The detail opens in edit mode (after "Add"). */
  edit: boolean;
}

interface ParamsReader {
  get(name: string): string | null;
}

export function readTrackerUrl(params: ParamsReader): TrackerUrlState {
  const view = params.get('view');
  const app = params.get('app')?.trim() || null;
  return {
    view: view === 'list' || view === 'chart' ? view : 'board',
    tab: params.get('tab') === 'archived' ? 'archived' : 'active',
    app: app && app.length <= 64 ? app : null,
    edit: params.get('edit') === '1',
  };
}

/** Archived is always a list; the URL keeps the last view so going back to Active restores it. */
export function effectiveView(state: Pick<TrackerUrlState, 'view' | 'tab'>): TrackerView {
  return state.tab === 'archived' ? 'list' : state.view;
}

/** The query string for a state: defaults are left out, other parameters are kept as they are. */
export function trackerSearch(state: TrackerUrlState, current?: URLSearchParams): string {
  const params = new URLSearchParams(current);
  const put = (name: string, value: string | null) => (value === null ? params.delete(name) : params.set(name, value));
  put('view', state.view === 'board' ? null : state.view);
  put('tab', state.tab === 'active' ? null : state.tab);
  put('app', state.app);
  put('edit', state.app && state.edit ? '1' : null);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * Picking a view from the segmented control: Board or Chart while on Archived goes back to Active; List keeps the
 * tab.
 */
export function chooseView(state: TrackerUrlState, view: TrackerView): TrackerUrlState {
  if (view !== 'list' && state.tab === 'archived') return { ...state, view, tab: 'active' };
  return { ...state, view };
}

// ------------------------------------------------------------------------------------------------------ filters

export interface FilterState {
  statuses: ApplicationStatus[];
  jobType: EmploymentType | null;
  favorites: boolean;
  /** Applied from / until, "YYYY-MM-DD". */
  from: string | null;
  until: string | null;
  sort: TrackerSort;
  order: SortOrder;
}

export const DEFAULT_FILTERS: FilterState = {
  statuses: [],
  jobType: null,
  favorites: false,
  from: null,
  until: null,
  sort: 'tracked',
  order: 'desc',
};

/** The query parameters of the board, list and export endpoints. */
export function filterQuery(filters: FilterState, q: string): Record<string, string | number | undefined> {
  const search = q.trim();
  return {
    q: search || undefined,
    statuses: filters.statuses.length > 0 ? filters.statuses.join(',') : undefined,
    jobType: filters.jobType ?? undefined,
    favorites: filters.favorites ? 1 : undefined,
    from: filters.from ?? undefined,
    until: filters.until ?? undefined,
    sort: filters.sort,
    order: filters.order,
  };
}

/** A stable key for React Query. */
export function filterKey(filters: FilterState, q: string): string {
  return JSON.stringify(filterQuery(filters, q));
}

/** The chips under the toolbar ("From Oct 22", "Full-Time", "Applied", "Favorites", "Sort: title (asc)"). */
export function filterChips(filters: FilterState): FilterChip[] {
  return trackerFilterChips({
    statuses: filters.statuses,
    jobType: filters.jobType ?? undefined,
    favorites: filters.favorites,
    from: filters.from ?? undefined,
    until: filters.until ?? undefined,
    sort: filters.sort,
    order: filters.order,
  });
}

/** How many filters narrow the results (the Options pill's count; the sort is not a filter). */
export function activeFilterCount(filters: FilterState): number {
  return filterChips(filters).filter((chip) => chip.key !== 'sort').length;
}

/** Whether any filter or a non-default sort is set ("Clear all filters" shows). */
export function hasFilters(filters: FilterState): boolean {
  return filterChips(filters).length > 0;
}

/** Removing one chip. */
export function withoutChip(filters: FilterState, chip: FilterChip): FilterState {
  switch (chip.key) {
    case 'from':
      return { ...filters, from: null };
    case 'until':
      return { ...filters, until: null };
    case 'jobType':
      return { ...filters, jobType: null };
    case 'favorites':
      return { ...filters, favorites: false };
    case 'sort':
      return { ...filters, sort: DEFAULT_FILTERS.sort, order: DEFAULT_FILTERS.order };
    case 'status':
      return { ...filters, statuses: filters.statuses.filter((status) => status !== chip.status) };
  }
}

/** Ticking or unticking a status in the Status filter, kept in status order. */
export function toggleStatus(statuses: readonly ApplicationStatus[], status: ApplicationStatus, on: boolean): ApplicationStatus[] {
  const next = new Set(statuses);
  if (on) next.add(status);
  else next.delete(status);
  return [...next].sort((a, b) => a - b);
}

/** The status a new application starts in (Simplify: Applied). */
export const DEFAULT_NEW_STATUS: ApplicationStatus = STATUS.applied;

/** Simplify's select-mode count: "3 Job(s) Selected". */
export function selectedLabel(count: number): string {
  return `${count} Job(s) Selected`;
}
