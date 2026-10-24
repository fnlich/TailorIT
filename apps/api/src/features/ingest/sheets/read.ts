import { SHEET_MAX_HEADER_ROW, SHEET_MAX_ROWS, isDayTabTitle, parseFlexibleDate, type SheetTab } from '@tailorit/shared';
import { validationFailed } from '../../../core/http/errors';
import type { SheetCallOptions, SheetValues, SheetsClient, SpreadsheetInfo } from './client';
import { quoteSheetTitle, type ParsedSheetTab } from './table';

// Reading one tab: the tab list, the choice of tab, then its cells (two Sheets API calls). Also the per-admin cache
// that lets a new mapping, header row or option reuse the last read instead of asking Google again.

export interface SheetImportTiming {
  /** The longest a read of Google may take: sign-in, the tab list and the cells. */
  readBudgetMs: number;
  /** An import answers 201 only when its run ends this soon after the request came in, else 202 (Next's proxy waits 120 s). */
  responseBudgetMs: number;
  /** How long a read stays reusable for re-mapping (`refresh: false`). */
  cacheTtlMs: number;
}

export const SHEET_IMPORT_TIMING: Readonly<SheetImportTiming> = { readBudgetMs: 75_000, responseBudgetMs: 100_000, cacheTtlMs: 600_000 };

declare module '../../../core/context' {
  interface AppServices {
    /** Overrides of the Sheet import's time limits (tests). Read on every request. */
    sheetsTiming?: Partial<SheetImportTiming>;
  }
}

/** The last row a read asks for: the header row can be row 20, and one row past the limit shows that a tab is too long. */
export const SHEET_READ_ROWS = SHEET_MAX_HEADER_ROW + SHEET_MAX_ROWS + 1;

export interface SheetRead {
  spreadsheet: SpreadsheetInfo;
  tab: SheetTab;
  values: SheetValues;
  lastRowRead: number;
  readAt: string;
  notes: string[];
}

export interface TabRequest {
  spreadsheetId: string;
  gid: number | null;
  /** The gid was chosen in the form (it must exist), not taken from the link (a missing one falls back). */
  strictGid: boolean;
}

/** The newest tab named for a day (free_tailor adds one a day), else the first visible tab, else the first tab. */
function defaultTab(tabs: readonly SheetTab[]): { tab: SheetTab; dayTab: boolean } {
  const visible = tabs.filter((tab) => !tab.hidden);
  let newest: { tab: SheetTab; date: string } | null = null;
  for (const tab of visible) {
    if (!isDayTabTitle(tab.title)) continue;
    const date = parseFlexibleDate(tab.title);
    if (date && (!newest || date > newest.date)) newest = { tab, date };
  }
  if (newest) return { tab: newest.tab, dayTab: true };
  return { tab: visible[0] ?? tabs[0]!, dayTab: false };
}

/** Which tab to read, and a note when it is not the one the link named. */
export function chooseTab(spreadsheet: SpreadsheetInfo, request: Pick<TabRequest, 'gid' | 'strictGid'>): { tab: SheetTab; notes: string[] } {
  const { tabs } = spreadsheet;
  if (tabs.length === 0) {
    const message = 'This spreadsheet has no tab with cells to import.';
    throw validationFailed(message, { url: message });
  }
  if (request.gid !== null) {
    const named = tabs.find((tab) => tab.gid === request.gid);
    if (named) return { tab: named, notes: [] };
    if (request.strictGid) {
      const message = `This spreadsheet has no tab with id ${request.gid}. Pick a tab from the list.`;
      throw validationFailed(message, { gid: message });
    }
    const { tab } = defaultTab(tabs);
    return { tab, notes: [`The link points to a tab that is no longer in this spreadsheet, so "${tab.title}" is shown instead.`] };
  }
  const { tab, dayTab } = defaultTab(tabs);
  const first = tabs.find((candidate) => !candidate.hidden) ?? tabs[0]!;
  return { tab, notes: dayTab && tab.gid !== first.gid ? [`"${tab.title}" is the newest day tab, so it is shown first. Pick another tab from the list.`] : [] };
}

/** Reads a tab: its spreadsheet's tab list, then its cells (bounded by its row count: Google refuses rows past it). */
export async function readSheetTab(
  client: SheetsClient,
  request: TabRequest,
  call: SheetCallOptions,
  readAt: () => string,
): Promise<SheetRead> {
  const spreadsheet = await client.spreadsheet(request.spreadsheetId, call);
  const { tab, notes } = chooseTab(spreadsheet, request);
  // A grid always has a row; 0 means Google did not say, so the whole window is asked for.
  const lastRowRead = tab.rowCount > 0 ? Math.min(tab.rowCount, SHEET_READ_ROWS) : SHEET_READ_ROWS;
  const values = await client.values(request.spreadsheetId, `${quoteSheetTitle(tab.title)}!1:${lastRowRead}`, call);
  return { spreadsheet, tab, values, lastRowRead, readAt: readAt(), notes };
}

/** A read kept for re-mapping, with the tables already built from it (by header row). */
export interface CachedSheetRead {
  read: SheetRead;
  storedAt: number;
  parsed: Map<number, ParsedSheetTab>;
}

export interface SheetReadCache {
  /** The admin's last read when it is of this spreadsheet and tab (any tab when `gid` is null) and still fresh. */
  get(userId: string, spreadsheetId: string, gid: number | null): CachedSheetRead | null;
  set(userId: string, read: SheetRead): CachedSheetRead;
  clear(userId: string): void;
}

/** One read per admin (the latest), in the router's closure: no module-level state. */
export function createSheetReadCache(now: () => number, ttlMs: () => number): SheetReadCache {
  const entries = new Map<string, CachedSheetRead>();
  return {
    get(userId, spreadsheetId, gid) {
      const entry = entries.get(userId);
      if (!entry) return null;
      if (now() - entry.storedAt > ttlMs()) {
        entries.delete(userId);
        return null;
      }
      if (entry.read.spreadsheet.spreadsheetId !== spreadsheetId) return null;
      if (gid !== null && entry.read.tab.gid !== gid) return null;
      return entry;
    },
    set(userId, read) {
      const entry: CachedSheetRead = { read, storedAt: now(), parsed: new Map() };
      entries.set(userId, entry);
      return entry;
    },
    clear(userId) {
      entries.delete(userId);
    },
  };
}
