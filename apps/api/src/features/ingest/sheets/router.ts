import { performance } from 'node:perf_hooks';
import { Router, type Response } from 'express';
import {
  IMPORT_FIELD_LABEL,
  REQUIRED_IMPORT_FIELDS,
  SheetImportBodySchema,
  SheetPreviewBodySchema,
  defaultSheetSourceName,
  importFieldInfo,
  isDayTabTitle,
  parseSpreadsheetRef,
  sheetTabDate,
  spreadsheetUrl,
  type ImportMapping,
  type ImportMappingInput,
  type SheetPreview,
  type SheetSourceConfig,
} from '@tailorit/shared';
import { requireAdmin, userOf } from '../../../core/auth/guards';
import { nowIso, todayIso, type AppDeps } from '../../../core/context';
import { AppError, asyncHandler, conflict, validationFailed } from '../../../core/http/errors';
import { parseInput } from '../../../core/http/validate';
import { postingsFromTable } from '../adapters/tabular';
import { storeAndRunImport } from '../imports';
import { requireIngest } from '../service';
import { findSheetSource, findSourceRecord } from '../sources';
import { cleanMapping, guessMapping } from '../tabular';
import { requireSheets, type SheetsClient } from './client';
import { SHEETS_MESSAGES, sheetsUnavailable } from './errors';
import { SHEET_IMPORT_TIMING, createSheetReadCache, readSheetTab, type CachedSheetRead, type SheetRead, type TabRequest } from './read';
import { parseSheetTab, sheetFileName, type ParsedSheetTab } from './table';

// Admin > Import jobs > Google Sheet (mounted at /api/admin/import/sheets; administrators only). A one-time,
// read-only import of one tab: preview it (saves nothing), then import it, which reads the tab again and stores a CSV
// copy as a csv source with config.sheet. Nothing is ever written to Google, and no source is ever scheduled.

/** Built tables kept per read (a header row tried and the one before). */
const PARSED_PER_READ = 2;

/** POST bodies' common reading: the link, the account, and the tab asked for. */
interface SheetTarget {
  client: SheetsClient;
  request: TabRequest;
}

export function createSheetImportRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAdmin);
  const { db } = deps;
  const timing = () => ({ ...SHEET_IMPORT_TIMING, ...deps.services.sheetsTiming });
  const cache = createSheetReadCache(
    () => deps.now().getTime(),
    () => timing().cacheTtlMs,
  );
  /** One read of Google in flight per admin: a new one replaces (aborts) the last. */
  const reads = new Map<string, AbortController>();

  function targetOf(url: string, gid: number | undefined): SheetTarget {
    const ref = parseSpreadsheetRef(url);
    if (!ref.ok) throw validationFailed(ref.message, { url: ref.message });
    const client = requireSheets(deps);
    const account = client.account();
    if (!account.configured) throw sheetsUnavailable(account.problem ?? 'Google Sheet import is not set up on this server.');
    return { client, request: { spreadsheetId: ref.spreadsheetId, gid: gid ?? ref.gid, strictGid: gid !== undefined } };
  }

  /** Reads the tab from Google within the time budget, stopped early when the browser goes away or a newer read starts. */
  async function freshRead(userId: string, res: Response, { client, request }: SheetTarget): Promise<SheetRead> {
    const { readBudgetMs } = timing();
    reads.get(userId)?.abort(conflict('A newer read of a Google Sheet replaced this one.'));
    const controller = new AbortController();
    reads.set(userId, controller);
    const onClose = () => {
      if (!res.writableEnded) controller.abort(new AppError('validation_failed', 'The read of the sheet was cancelled.'));
    };
    res.on('close', onClose);
    const timer = setTimeout(
      () => controller.abort(sheetsUnavailable(SHEETS_MESSAGES.timeout(readBudgetMs))),
      readBudgetMs,
    );
    try {
      return await readSheetTab(client, request, { signal: controller.signal, deadline: Date.now() + readBudgetMs }, () => nowIso(deps));
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
      if (reads.get(userId) === controller) reads.delete(userId);
    }
  }

  /** The tab's copy and table for a header row (the CSV is written and read back once per read and header row). */
  function parse(read: SheetRead, headerRow: number): ParsedSheetTab {
    const parsed = parseSheetTab(read.values, {
      headerRow,
      tabTitle: read.tab.title,
      gridRowCount: read.tab.rowCount,
      lastRowRead: read.lastRowRead,
    });
    deps.log.debug(
      `[sheets] parsed tab ${read.tab.gid} of ${read.spreadsheet.spreadsheetId} from header row ${headerRow}: ${parsed.table.rows.length} rows`,
    );
    return parsed;
  }

  function parsedOf(entry: CachedSheetRead, headerRow: number): ParsedSheetTab {
    const known = entry.parsed.get(headerRow);
    if (known) return known;
    const parsed = parse(entry.read, headerRow);
    entry.parsed.set(headerRow, parsed);
    while (entry.parsed.size > PARSED_PER_READ) entry.parsed.delete(entry.parsed.keys().next().value!);
    return parsed;
  }

  /**
   * The mapping in use (the guess, then the admin's choices over it), and whether every row takes the tab's date. The
   * tab date is on by default only for a day tab ("10/22/2026") when, after the admin's choices, no column gives a
   * posted date; while it is on no column is used for it.
   */
  function mappingOf(read: SheetRead, columns: readonly string[], input: ImportMappingInput | undefined, fromTabAsked: boolean | undefined) {
    const guessed = guessMapping(columns);
    const mapping: ImportMapping = input ? cleanMapping({ ...guessed, ...input }, columns) : guessed;
    const tabDate = sheetTabDate(read.tab.title, todayIso(deps));
    const fromTab = tabDate !== null && (fromTabAsked ?? (isDayTabTitle(read.tab.title) && !mapping.postedAt));
    if (fromTab) mapping.postedAt = null;
    return { mapping, tabDate, fromTab, postedAt: fromTab ? `${tabDate}T00:00:00.000Z` : null };
  }

  /** The source that already holds this tab, or the one that holds another import under the name in use. */
  function existingOf(read: SheetRead, sourceName: string): SheetPreview['existingSource'] {
    const sameTab = findSheetSource(db, read.spreadsheet.spreadsheetId, read.tab.gid);
    const named = findSourceRecord(db, 'csv', sourceName);
    const describe = (source: NonNullable<typeof named>, sameSheet: boolean) => ({ id: source.id, name: source.name, lastRunAt: source.lastRunAt, sameSheet });
    if (named && named.id !== sameTab?.id) return describe(named, false);
    return sameTab ? describe(sameTab, true) : null;
  }

  /** GET /api/admin/import/sheets/account: whether a key is set up, and the address to share sheets with. */
  router.get('/account', (_req, res) => {
    res.json(requireSheets(deps).account());
  });

  /**
   * POST /api/admin/import/sheets/preview: reads the tab (or reuses the last read with `refresh: false`) and answers
   * the import preview plus the spreadsheet's tabs, the header row and notes. Saves nothing.
   */
  router.post(
    '/preview',
    asyncHandler(async (req, res) => {
      const admin = userOf(req);
      const body = parseInput(SheetPreviewBodySchema, req.body ?? {}, 'sheet');
      const target = targetOf(body.url, body.gid);
      const { spreadsheetId, gid } = target.request;
      let entry = body.refresh === false ? cache.get(admin.id, spreadsheetId, gid) : null;
      entry ??= cache.set(admin.id, await freshRead(admin.id, res, target));
      const { read } = entry;
      const headerRow = body.headerRow ?? 1;
      const { snapshot, table } = parsedOf(entry, headerRow);
      const { mapping, tabDate, fromTab, postedAt } = mappingOf(read, table.columns, body.mapping, body.postedAtFromTab);
      const check = postingsFromTable(table, mapping, { postedAt });
      const sameTab = findSheetSource(db, read.spreadsheet.spreadsheetId, read.tab.gid);
      const sourceName = body.name || sameTab?.name || defaultSheetSourceName(read.spreadsheet.title, read.tab.title);
      const preview: SheetPreview = {
        fileName: sheetFileName(read.spreadsheet.title, read.tab.title),
        format: 'csv',
        columns: table.columns,
        mapping,
        fields: importFieldInfo(),
        rowCount: table.rows.length,
        jobCount: check.postings.length,
        sample: table.rows.slice(0, 5).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value.slice(0, 300)]))),
        missingRequired: REQUIRED_IMPORT_FIELDS.filter((field) => !mapping[field]),
        problems: check.failures.slice(0, 20).map((failure) => failure.message),
        spreadsheetId: read.spreadsheet.spreadsheetId,
        spreadsheetTitle: read.spreadsheet.title,
        url: spreadsheetUrl(read.spreadsheet.spreadsheetId, read.tab.gid),
        tabs: read.spreadsheet.tabs,
        tab: read.tab,
        headerRow,
        suggestedHeaderRow: snapshot.suggestedHeaderRow,
        tabDate,
        postedAtFromTab: fromTab,
        sourceName,
        existingSource: existingOf(read, sourceName),
        notes: [...read.notes, ...snapshot.notes],
        readAt: read.readAt,
      };
      res.json(preview);
    }),
  );

  /**
   * POST /api/admin/import/sheets/jobs: reads the tab again (never a preview's copy), stores the copy as a csv source
   * and imports it, as a file import does. 201 { source, run, runId } when the run ended in time; 202 with run null for
   * a large tab, or when the run would outlast the time left (the run continues; Runs shows it).
   */
  router.post(
    '/jobs',
    asyncHandler(async (req, res) => {
      const started = performance.now();
      const admin = userOf(req);
      const body = parseInput(SheetImportBodySchema, req.body ?? {}, 'import');
      const target = targetOf(body.url, body.gid);
      const { spreadsheetId, gid } = target.request;
      // A running import of this tab, or under this name, answers at once rather than after reading Google.
      const service = requireIngest(deps);
      const known = [gid === null ? null : findSheetSource(db, spreadsheetId, gid), body.name ? findSourceRecord(db, 'csv', body.name) : null];
      if (known.some((source) => source && service.isRunning(source.id))) throw conflict('This import is running. Wait for it to finish.');

      const read = await freshRead(admin.id, res, target);
      cache.clear(admin.id);
      const { snapshot, table } = parse(read, body.headerRow ?? 1);
      const { mapping, tabDate, fromTab } = mappingOf(read, table.columns, body.mapping, body.postedAtFromTab);
      const missing = REQUIRED_IMPORT_FIELDS.filter((field) => !mapping[field]);
      if (missing.length) {
        throw validationFailed(`Choose the column for ${missing.map((field) => IMPORT_FIELD_LABEL[field].toLowerCase()).join(', ')}.`);
      }
      const sameTab = findSheetSource(db, read.spreadsheet.spreadsheetId, read.tab.gid);
      const sheet: SheetSourceConfig = {
        spreadsheetId: read.spreadsheet.spreadsheetId,
        gid: read.tab.gid,
        tabTitle: read.tab.title,
        spreadsheetTitle: read.spreadsheet.title,
        url: spreadsheetUrl(read.spreadsheet.spreadsheetId, read.tab.gid),
        headerRow: snapshot.headerRow,
        postedAt: fromTab ? tabDate : null,
        readAt: read.readAt,
      };
      const result = await storeAndRunImport(deps, {
        kind: 'csv',
        sourceName: body.name || sameTab?.name || defaultSheetSourceName(read.spreadsheet.title, read.tab.title),
        fileName: sheetFileName(read.spreadsheet.title, read.tab.title),
        text: snapshot.text,
        mapping,
        rowCount: table.rows.length,
        sheet,
        waitMs: timing().responseBudgetMs - (performance.now() - started),
      });
      res.status(result.status).json(result.body);
    }),
  );

  return router;
}
