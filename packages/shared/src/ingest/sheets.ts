import { z } from 'zod';
import { IsoDate, IsoDateTime } from '../core/list';
import { parseFlexibleDate } from '../format/dates';
import { ImportMappingInputSchema, ImportPreviewSchema } from './imports';

// The Google Sheet import (Admin > Import jobs > Google Sheet): a one-time, read-only copy of one tab, stored as a csv
// job source whose config carries `sheet`. TailorIT never writes to Google. Pure: no network, no URL type (this
// package's lib is ES only), so links are read with regular expressions.

/** Rows below the header row that one tab may hold. */
export const SHEET_MAX_ROWS = 10_000;
/** The header row is one of the first rows of a tab. */
export const SHEET_MAX_HEADER_ROW = 20;
/** The most text the copy of one tab may hold, in MB. */
export const SHEET_MAX_MB = 20;
/** How Sources and Runs name a source imported from a Google Sheet. */
export const SHEET_SOURCE_LABEL = 'Google Sheet';
/** A Google spreadsheet id, as it appears in /spreadsheets/d/<id>/. */
export const SPREADSHEET_ID_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;
/** A tab id (the `gid` of a link) is a non-negative 32-bit integer. */
export const MAX_SHEET_GID = 2_147_483_647;

const Gid = z.number().int().min(0).max(MAX_SHEET_GID);

/** GET /api/admin/import/sheets/account: whether the server has a key, and the address to share sheets with. */
export const SheetAccountSchema = z.object({
  configured: z.boolean(),
  /** The service account's address: share a sheet with it as a Viewer. */
  clientEmail: z.string().nullable(),
  projectId: z.string().nullable(),
  /** Where the server looks for the key file. */
  keyFile: z.string(),
  /** Why the import is off, as a sentence; null when configured. */
  problem: z.string().nullable(),
});
export type SheetAccount = z.infer<typeof SheetAccountSchema>;

/** One tab of a spreadsheet (grid tabs only; chart sheets hold no cells). */
export const SheetTabSchema = z.object({
  gid: Gid,
  title: z.string(),
  index: z.number().int(),
  hidden: z.boolean(),
  rowCount: z.number().int(),
  columnCount: z.number().int(),
});
export type SheetTab = z.infer<typeof SheetTabSchema>;

const HEADER_ROW_MESSAGE = `Choose a header row from 1 to ${SHEET_MAX_HEADER_ROW}.`;

const SheetRequestSchema = z.object({
  url: z.string().trim().min(1, 'Paste the link of the Google Sheet.').max(2000, 'That link is too long.'),
  /** The tab to read; without it, the link's tab (or the newest day tab, else the first). */
  gid: Gid.optional(),
  /** The row that holds the column names (1 to 20). Default 1. */
  headerRow: z
    .number({ error: HEADER_ROW_MESSAGE })
    .int(HEADER_ROW_MESSAGE)
    .min(1, HEADER_ROW_MESSAGE)
    .max(SHEET_MAX_HEADER_ROW, HEADER_ROW_MESSAGE)
    .optional(),
  /** Every row's posted date is the date in the tab's name. Default: on for day tabs ("10/22/2026") when no column is mapped. */
  postedAtFromTab: z.boolean().optional(),
  mapping: ImportMappingInputSchema.optional(),
});

const SourceName = z.string().trim().max(100, 'Keep the name under 100 characters.');

/** POST /api/admin/import/sheets/preview. `refresh: false` reuses the last read (a new mapping, header row or option). */
export const SheetPreviewBodySchema = SheetRequestSchema.extend({
  refresh: z.boolean().optional(),
  /** The source name the admin typed, so the preview can say whether it is taken. */
  name: SourceName.optional(),
});
export type SheetPreviewBody = z.infer<typeof SheetPreviewBodySchema>;

/** POST /api/admin/import/sheets/jobs: reads the tab again and imports it. */
export const SheetImportBodySchema = SheetRequestSchema.extend({ name: SourceName.optional() });
export type SheetImportBody = z.infer<typeof SheetImportBodySchema>;

/** `config.sheet` of a csv source imported from a Google Sheet: where the stored copy came from. */
export const SheetSourceConfigSchema = z.object({
  spreadsheetId: z.string().regex(SPREADSHEET_ID_PATTERN),
  gid: Gid,
  tabTitle: z.string(),
  spreadsheetTitle: z.string(),
  /** The tab's address (.../edit#gid=N). */
  url: z.string(),
  headerRow: z.number().int().min(1).max(SHEET_MAX_HEADER_ROW),
  /** Every row's posted date (from the tab's name), or null when rows carry their own. */
  postedAt: IsoDate.nullable(),
  /** When TailorIT read the tab. "Run now" imports this copy again; it never reads the sheet. */
  readAt: IsoDateTime,
});
export type SheetSourceConfig = z.infer<typeof SheetSourceConfigSchema>;

export const SheetPreviewSchema = ImportPreviewSchema.extend({
  spreadsheetId: z.string(),
  spreadsheetTitle: z.string(),
  /** The address of the tab read. */
  url: z.string(),
  tabs: z.array(SheetTabSchema),
  tab: SheetTabSchema,
  headerRow: z.number().int(),
  /** A row that looks more like the header row than the chosen one, or null. */
  suggestedHeaderRow: z.number().int().nullable(),
  /** The date in the tab's name ("10/22/2026" is 2026-10-22), or null. */
  tabDate: IsoDate.nullable(),
  postedAtFromTab: z.boolean(),
  /** The name the import will use when none is typed. */
  sourceName: z.string(),
  /** A source that already holds this tab (sameSheet), or one that holds another import under the chosen name. */
  existingSource: z
    .object({ id: z.number().int(), name: z.string(), lastRunAt: IsoDateTime.nullable(), sameSheet: z.boolean() })
    .nullable(),
  /** Things worth knowing about this tab (a fallback tab, rows not read, cells read as blank). */
  notes: z.array(z.string()),
  readAt: IsoDateTime,
});
export type SheetPreview = z.infer<typeof SheetPreviewSchema>;

// ------------------------------------------------------------------------------------------------------- links

export type SpreadsheetRef = { ok: true; spreadsheetId: string; gid: number | null } | { ok: false; message: string };

export const SHEET_LINK_MESSAGES = {
  empty: 'Paste the link of the Google Sheet.',
  notSheets: 'That is not a Google Sheets link. Paste the address of the sheet (https://docs.google.com/spreadsheets/d/...) or its id.',
  published:
    "That is a \"Publish to the web\" link, which TailorIT can't read. Open the sheet itself and copy the link from the address bar.",
} as const;

/** The /spreadsheets/... path of a docs.google.com address, with the multi-account (/u/1/) and old domain (/a/x/) forms. */
const SHEETS_PATH = String.raw`^\/(?:a\/[^/?#]+\/)?spreadsheets\/(?:u\/\d+\/)?d\/`;
const PUBLISHED_PATH = new RegExp(`${SHEETS_PATH}e\\/`, 'i');
const ID_PATH = new RegExp(`${SHEETS_PATH}([^/?#]+)(?:\\/|$)`, 'i');
const ADDRESS = /^(?:https?:\/\/)?docs\.google\.com(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i;

function gidOf(part: string, pattern: RegExp): number | null {
  const match = pattern.exec(part);
  if (!match) return null;
  const gid = Number(match[1]);
  return Number.isSafeInteger(gid) && gid <= MAX_SHEET_GID ? gid : null;
}

/**
 * The spreadsheet a pasted link (or a bare id) names, and its tab: `#gid=` first, then `?gid=`. Refuses "Publish to
 * the web" links and anything that is not docs.google.com/spreadsheets. Only reads the text: nothing is fetched.
 */
export function parseSpreadsheetRef(input: string): SpreadsheetRef {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) return { ok: false, message: SHEET_LINK_MESSAGES.empty };
  if (SPREADSHEET_ID_PATTERN.test(text)) return { ok: true, spreadsheetId: text, gid: null };
  const address = ADDRESS.exec(text);
  if (!address) return { ok: false, message: SHEET_LINK_MESSAGES.notSheets };
  const path = address[1] ?? '';
  if (PUBLISHED_PATH.test(path)) return { ok: false, message: SHEET_LINK_MESSAGES.published };
  const id = ID_PATH.exec(path)?.[1];
  if (!id || !SPREADSHEET_ID_PATTERN.test(id)) return { ok: false, message: SHEET_LINK_MESSAGES.notSheets };
  const gid = gidOf(address[3] ?? '', /(?:^#|&)gid=(\d{1,10})(?=&|$)/) ?? gidOf(address[2] ?? '', /[?&]gid=(\d{1,10})(?=&|$)/);
  return { ok: true, spreadsheetId: id, gid };
}

/** The address of a spreadsheet, opened at a tab when `gid` is given. */
export function spreadsheetUrl(spreadsheetId: string, gid?: number | null): string {
  const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  return gid === null || gid === undefined ? base : `${base}#gid=${gid}`;
}

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();

/** "Job sheet (10/22/2026)": the source name an import gets when none is typed, at most 100 characters. */
export function defaultSheetSourceName(spreadsheetTitle: string, tabTitle: string): string {
  const title = tidy(spreadsheetTitle) || 'Google Sheet';
  const tab = tidy(tabTitle) || 'Sheet';
  const full = `${title} (${tab})`;
  if (full.length <= 100) return full;
  const suffix = ` (${tab.length > 48 ? `${tab.slice(0, 47).trimEnd()}…` : tab})`;
  return `${title.slice(0, 100 - suffix.length).trimEnd()}${suffix}`;
}

/** A tab named for one day, as free_tailor names them: "10/22/2026" (M/D/YYYY) or "2026-10-22". */
export function isDayTabTitle(title: string): boolean {
  const text = title.trim();
  return /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text) || /^\d{4}-\d{2}-\d{2}$/.test(text);
}

/**
 * The date a tab's name holds ("10/22/2026" is "2026-10-22"), or null when it holds none or names a day more than one
 * day after `today` ("YYYY-MM-DD"): a posted date cannot be in the future.
 */
export function sheetTabDate(tabTitle: string, today: string): string | null {
  const date = parseFlexibleDate(tabTitle);
  if (!date) return null;
  const start = Date.parse(`${today}T00:00:00.000Z`);
  if (Number.isNaN(start)) return date;
  const tomorrow = new Date(start + 86_400_000).toISOString().slice(0, 10);
  return date > tomorrow ? null : date;
}
