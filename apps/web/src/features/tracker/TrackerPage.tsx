'use client';

import { useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Suspense, useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import {
  APPLICATION_STATUSES,
  RESUME_ZIP_MAX_APPLICATIONS,
  hideColumn,
  showColumn,
  visibleColumns,
  type ApplicationDetail,
  type ApplicationStatus,
  type ApplicationSummary,
  type TrackerTab,
  type TrackerView,
} from '@tailorit/shared';
import { PAGE_GUTTER } from '@/components/shell/layout';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Notice } from '@/components/ui/Notice';
import { PageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { userMessage } from '@/lib/api';
import type { CardHandlers } from './board/ApplicationCard';
import { BoardView } from './board/BoardView';
import { ChartView } from './chart/ChartView';
import { celebrateIfReached } from './confetti';
import { ImportCsvDialog } from './csv/ImportCsvDialog';
import { downloadExport } from './csv/exportCsv';
import {
  invalidateApplications,
  localToday,
  trackerApi,
  useApplicationList,
  useBoard,
  useCounts,
  useInsights,
  useMoveStatus,
  useSankey,
  useToggleFavorite,
  type ColumnLimits,
} from './data';
import { DetailSheet } from './detail/DetailSheet';
import { useArchivedColumn, useColumnPrefs, useDebouncedValue, useTrackerUrl } from './hooks';
import { ListView, type ListEmptyKind } from './list/ListView';
import { AddApplicationSheet } from './sheets/AddApplicationSheet';
import { activeFilterCount, chooseView, effectiveView, filterKey, DEFAULT_FILTERS, type FilterState } from './state';
import { FilterChipsRow, ManageBar, SearchRow, TabsRow, type BulkKind } from './toolbar/Toolbar';
import { OptionsMenu } from './toolbar/OptionsMenu';
import { buildingProgress, buildingTitle, buildResumeZip, resumeZipRun, zipOutcomeText } from './zip/resumeZip';

const EMPTY_LIMITS: ColumnLimits = {};
const EMPTY_SELECTION: ReadonlySet<string> = new Set();
/** The API takes at most 500 ids per bulk request. */
const BULK_CHUNK = 500;
const PAGE_STEP = 25;

/**
 * Whether this tab is building a resume zip, and its last status. It lives outside the page: a build keeps going when
 * the tracker is left, and the tracker shows it again when it is opened anew.
 */
function useResumeZipRun() {
  return useSyncExternalStore(resumeZipRun.subscribe, resumeZipRun.get, resumeZipRun.get);
}

/** The waiting toast's line, kept current as the build reports progress. */
function ZipProgressLine() {
  return <>{buildingProgress(useResumeZipRun().build)}</>;
}

/**
 * The Job Tracker (Simplify's): Active / Archived, Board | List | Chart, search, the Options menu, Add application
 * and the application detail, with the state in the URL: ?view=board|list|chart&tab=active|archived&app=<id>.
 */
function Tracker() {
  const client = useQueryClient();
  const toast = useToast();
  const [url, setUrl] = useTrackerUrl();
  const view = effectiveView(url);

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search, 500);
  const key = filterKey(filters, q);
  // "Load more" per column (and which column asked last), forgotten when the search or filters change.
  const [limitState, setLimitState] = useState<{ key: string; limits: ColumnLimits; loading: ApplicationStatus | null }>({
    key,
    limits: EMPTY_LIMITS,
    loading: null,
  });
  const limits = limitState.key === key ? limitState.limits : EMPTY_LIMITS;
  const loadingColumn = limitState.key === key ? limitState.loading : null;
  const [prefs, setPrefs] = useColumnPrefs();
  const [archivedShown, setArchivedShown] = useArchivedColumn();

  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState<{ key: string; ids: ReadonlySet<string> }>(() => ({ key, ids: new Set() }));
  // A new search or filter starts a new selection (rows that left the screen are never acted on).
  const selected = selection.key === key ? selection.ids : EMPTY_SELECTION;
  const setSelected = (update: ReadonlySet<string> | ((current: ReadonlySet<string>) => ReadonlySet<string>)) =>
    setSelection((current) => {
      const base = current.key === key ? current.ids : EMPTY_SELECTION;
      return { key, ids: typeof update === 'function' ? update(base) : update };
    });
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [archiveAllOpen, setArchiveAllOpen] = useState(false);
  const [lastApp, setLastApp] = useState<string | null>(url.app);

  const counts = useCounts();
  const board = useBoard(filters, q, limits, view === 'board');
  const list = useApplicationList(url.tab, filters, q, view === 'list');
  const archivedList = useApplicationList('archived', filters, q, view === 'board' && archivedShown);
  const sankey = useSankey(view === 'chart');
  const insights = useInsights(view === 'chart');
  const move = useMoveStatus({ onMoved: (result, previous) => celebrateIfReached(result.currentStatus, previous) });
  const favorite = useToggleFavorite();

  const columns = board.data?.columns ?? null;
  const totals = useMemo(
    () => Object.fromEntries((columns ?? []).map((column) => [column.status, column.total])) as Record<number, number>,
    [columns],
  );
  const visible = visibleColumns(prefs, totals);
  const listItems = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? null, [list.data]);
  const archivedItems = useMemo(() => archivedList.data?.pages.flatMap((page) => page.items) ?? null, [archivedList.data]);
  // "Select all" takes what is on screen: the shown columns' cards (and the Archived column's), or the list's rows.
  const loadedIds =
    view === 'board'
      ? [
          ...(columns ?? []).filter((column) => visible.includes(column.status)).flatMap((column) => column.items),
          ...(archivedShown ? (archivedItems ?? []) : []),
        ].map((item) => item.id)
      : view === 'list'
        ? (listItems ?? []).map((item) => item.id)
        : [];

  // ------------------------------------------------------------------------------------------------- actions

  const openApplication = useCallback(
    (id: string, edit = false) => {
      setLastApp(id);
      setUrl({ ...url, app: id, edit });
    },
    [setUrl, url],
  );

  const changeTab = (tab: TrackerTab) => {
    setSelected(new Set());
    setUrl({ ...url, tab });
  };

  const changeView = (next: TrackerView) => {
    setUrl(chooseView(url, next));
  };

  const moveApplication = (application: ApplicationSummary, status: ApplicationStatus) => {
    if (status === application.currentStatus) return;
    // Moving a card into a hidden column on the board shows that column from now on (Simplify).
    if (view === 'board' && !visible.includes(status)) setPrefs(showColumn(prefs, status));
    move.mutate(
      { id: application.id, status, from: application.currentStatus },
      { onError: (error) => toast.error(userMessage(error, "We couldn't move the application. Please try again.")) },
    );
  };

  const setArchived = async (application: ApplicationSummary, archived: boolean) => {
    try {
      if (archived) await trackerApi.archive(application.id);
      else await trackerApi.restore(application.id);
      void invalidateApplications(client);
      toast.toast({
        type: 'success',
        title: archived ? 'Application archived' : 'Application restored',
        action: {
          label: 'Undo',
          onClick: () => void setArchived(application, !archived),
        },
      });
    } catch (error) {
      toast.error(userMessage(error, "We couldn't update the application. Please try again."));
    }
  };

  /** An archived card dropped on a status column: restored, and moved when the column is another status. */
  const restoreInto = async (application: ApplicationSummary, status: ApplicationStatus) => {
    try {
      await trackerApi.restore(application.id);
      if (status !== application.currentStatus) {
        if (!visible.includes(status)) setPrefs(showColumn(prefs, status));
        const result = await trackerApi.status(application.id, status);
        celebrateIfReached(result.currentStatus, application.currentStatus);
      }
      toast.success('Application restored');
    } catch (error) {
      toast.error(userMessage(error, "We couldn't restore the application. Please try again."));
    } finally {
      void invalidateApplications(client);
    }
  };

  const handlers: CardHandlers = {
    onOpen: (application) => openApplication(application.id),
    onMove: moveApplication,
    onArchive: (application) => void setArchived(application, true),
    onRestore: (application) => void setArchived(application, false),
    onToggleFavorite: (application) => favorite.mutate({ id: application.id, favorite: !application.favorite }),
    onToggleSelected: (application, on) =>
      setSelected((current) => {
        const next = new Set(current);
        if (on) next.add(application.id);
        else next.delete(application.id);
        return next;
      }),
  };

  const loadMoreColumn = useCallback(
    (status: ApplicationStatus) => {
      setLimitState((current) => {
        const base = current.key === key ? current.limits : EMPTY_LIMITS;
        return { key, limits: { ...base, [status]: (base[status] ?? PAGE_STEP) + PAGE_STEP }, loading: status };
      });
    },
    [key],
  );

  const bulk = async (kind: BulkKind) => {
    const onScreen = new Set(loadedIds);
    const ids = [...selected].filter((id) => onScreen.has(id));
    const action = typeof kind === 'object' ? 'status' : kind;
    let affected = 0;
    try {
      for (let start = 0; start < ids.length; start += BULK_CHUNK) {
        const answer = await trackerApi.bulk({
          ids: ids.slice(start, start + BULK_CHUNK),
          action,
          ...(typeof kind === 'object' ? { status: kind.status, occurredOn: localToday() } : {}),
        });
        affected += answer.affected;
      }
    } finally {
      void invalidateApplications(client);
    }
    setSelected(new Set());
    const word = { archive: 'archived', unarchive: 'restored', delete: 'deleted', status: 'updated' }[action];
    toast.success(`${affected} ${affected === 1 ? 'application' : 'applications'} ${word}`);
  };

  const exportCsv = async () => {
    const id = toast.info('Exporting CSV…');
    try {
      const name = await downloadExport(url.tab, filters, q);
      toast.dismiss(id);
      toast.success('Export ready', name);
    } catch (error) {
      toast.dismiss(id);
      toast.error(userMessage(error, "We couldn't export your applications. Please try again."));
    }
  };

  const buildingResumes = useResumeZipRun().running;

  /**
   * "Build resumes": a zip of each application's resume. `ids`: the Manage jobs selection (only what is on screen, as
   * the bulk actions do); null: every active Saved application. The waiting toast stays until the zip is saved.
   */
  const buildResumes = async (ids: string[] | null) => {
    if (resumeZipRun.get().running) return;
    if (ids === null && counts.data && (counts.data.byStatus['1'] ?? 0) === 0) {
      toast.info('No Saved applications', 'Save jobs from the Jobs page, or select applications in Manage jobs.');
      return;
    }
    if (ids !== null && ids.length === 0) return;
    if (ids !== null && ids.length > RESUME_ZIP_MAX_APPLICATIONS) {
      toast.error(
        `Select at most ${RESUME_ZIP_MAX_APPLICATIONS} applications`,
        `One zip holds up to ${RESUME_ZIP_MAX_APPLICATIONS} resumes. Select fewer and build again.`,
      );
      return;
    }
    resumeZipRun.set({ running: true, build: null });
    const waiting = toast.toast({
      type: 'info',
      title: buildingTitle(ids?.length ?? null),
      description: <ZipProgressLine />,
      timeout: 0,
    });
    try {
      const ready = await buildResumeZip({ ids, onProgress: (build) => resumeZipRun.set({ running: true, build }) });
      toast.dismiss(waiting);
      toast.toast({ type: 'success', title: 'Resumes ready', description: zipOutcomeText(ready), timeout: 10_000 });
    } catch (error) {
      toast.dismiss(waiting);
      toast.error("We couldn't build your resumes", userMessage(error, 'Please try again.'));
    } finally {
      resumeZipRun.set({ running: false, build: resumeZipRun.get().build });
      // Building first makes the selection's pending resume choices, which the detail sheets show.
      void invalidateApplications(client);
    }
  };

  const buildSelectedResumes = () => {
    const onScreen = new Set(loadedIds);
    void buildResumes([...selected].filter((id) => onScreen.has(id)));
  };

  const filtered = q.trim() !== '' || activeFilterCount(filters) > 0;
  const emptyKind: ListEmptyKind = filtered ? 'no-match' : url.tab === 'archived' ? 'archived' : 'first';

  return (
    <div className={clsx('flex flex-col', view === 'board' ? 'h-[calc(100dvh-63px)] min-h-[560px]' : 'min-h-full')}>
      <h1 className="sr-only">Job Tracker</h1>
      <div className={clsx(PAGE_GUTTER, 'flex shrink-0 flex-col gap-3 pt-4', view === 'board' ? 'pb-5' : 'pb-6')}>
        <TabsRow tab={url.tab} counts={counts.data} onTabChange={changeTab} onAdd={() => setAddOpen(true)} />
        <SearchRow
          view={view}
          search={search}
          onSearchChange={setSearch}
          onViewChange={changeView}
          options={
            <OptionsMenu
              view={view}
              filters={filters}
              onFiltersChange={setFilters}
              onListView={() => setUrl({ ...url, view: 'list' })}
              columns={APPLICATION_STATUSES.map((status) => ({
                status,
                count: totals[status] ?? 0,
                visible: visible.includes(status),
              }))}
              onColumnToggle={(status, on) => setPrefs(on ? showColumn(prefs, status) : hideColumn(prefs, status))}
              archivedColumn={{ count: counts.data?.archived ?? 0, visible: archivedShown }}
              onArchivedToggle={setArchivedShown}
              onManage={() => {
                if (view === 'chart') setUrl({ ...url, view: 'list' });
                setSelectMode(true);
              }}
              onImport={() => setImportOpen(true)}
              onExport={() => void exportCsv()}
              onBuildResumes={() => void buildResumes(null)}
              buildingResumes={buildingResumes}
              onArchiveAll={() => setArchiveAllOpen(true)}
            />
          }
        />
        {selectMode && view !== 'chart' && (
          <ManageBar
            tab={url.tab}
            count={selected.size}
            total={loadedIds.length}
            allSelected={loadedIds.length > 0 && loadedIds.every((id) => selected.has(id))}
            onSelectAll={(on) => setSelected(on ? new Set(loadedIds) : new Set())}
            onBulk={bulk}
            onBuildResumes={buildSelectedResumes}
            buildingResumes={buildingResumes}
            onDone={() => {
              setSelectMode(false);
              setSelected(new Set());
            }}
          />
        )}
        {view !== 'chart' && <FilterChipsRow filters={filters} onChange={setFilters} />}
      </div>

      {view === 'board' && board.isError && !board.data && (
        <div className={PAGE_GUTTER}>
          <LoadFailure error={board.error} onRetry={() => void board.refetch()} />
        </div>
      )}
      {view === 'board' && !(board.isError && !board.data) && (
        <div className="min-h-0 flex-1">
          <BoardView
            columns={columns}
            visible={visible}
            prefs={prefs}
            onPrefsChange={setPrefs}
            handlers={handlers}
            openId={url.app}
            selectMode={selectMode}
            selected={selected}
            onLoadMore={loadMoreColumn}
            loadingMore={board.isPlaceholderData ? loadingColumn : null}
            onDrop={moveApplication}
            archived={
              archivedShown
                ? {
                    items: archivedItems,
                    total: archivedList.data?.pages[0]?.total ?? counts.data?.archived ?? 0,
                    hasMore: Boolean(archivedList.hasNextPage),
                    loadingMore: archivedList.isFetchingNextPage,
                    onLoadMore: () => void archivedList.fetchNextPage(),
                    onHide: () => setArchivedShown(false),
                  }
                : null
            }
            onArchiveDrop={(application) => void setArchived(application, true)}
            onRestoreDrop={(application, status) => void restoreInto(application, status)}
            refreshing={board.isFetching}
            filtered={filtered}
          />
        </div>
      )}
      {view === 'list' && (
        <div className={clsx(PAGE_GUTTER, 'pb-12')}>
          {list.isError && !list.data ? (
            <LoadFailure error={list.error} onRetry={() => void list.refetch()} />
          ) : (
            <ListView
              items={listItems}
              loading={list.isLoading}
              empty={emptyKind}
              handlers={handlers}
              openId={url.app}
              selectMode={selectMode}
              selected={selected}
              hasMore={Boolean(list.hasNextPage)}
              loadingMore={list.isFetchingNextPage}
              failed={list.isFetchNextPageError}
              onLoadMore={() => void list.fetchNextPage()}
              onAdd={() => setAddOpen(true)}
            />
          )}
        </div>
      )}
      {view === 'chart' && (
        <div className={PAGE_GUTTER}>
          <ChartView
            sankey={sankey.data}
            insights={insights.data}
            loading={sankey.isLoading}
            error={sankey.error ?? insights.error}
          />
        </div>
      )}

      <AddApplicationSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={(application: ApplicationDetail) => {
          void invalidateApplications(client);
          toast.success('Application added');
          openApplication(application.id, true);
        }}
      />
      <DetailSheet
        id={url.app ?? lastApp}
        open={url.app !== null}
        initialEdit={url.edit}
        onEditConsumed={() => setUrl({ ...url, edit: false })}
        onClose={() => setUrl({ ...url, app: null, edit: false })}
      />
      <ImportCsvDialog open={importOpen} onOpenChange={setImportOpen} />
      <ConfirmDialog
        open={archiveAllOpen}
        onOpenChange={setArchiveAllOpen}
        title="Archive all applications"
        description="Are you sure you want to archive all applications?"
        confirmLabel="Archive"
        tone="primary"
        onConfirm={async () => {
          const { archived } = await trackerApi.archiveAll();
          void invalidateApplications(client);
          toast.success(`${archived} ${archived === 1 ? 'application' : 'applications'} archived`);
        }}
      />
    </div>
  );
}

/** A read that failed, with its sentence and a way to try again. */
function LoadFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Notice
      tone="error"
      action={
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {userMessage(error, "We couldn't load your applications. Please try again.")}
    </Notice>
  );
}

export function TrackerPage() {
  return (
    <Suspense fallback={<PageSpinner label="Loading your applications..." />}>
      <Tracker />
    </Suspense>
  );
}
