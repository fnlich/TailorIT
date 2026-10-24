import type { SheetAccount } from '@tailorit/shared';
import type { SheetCallOptions, SheetsClient, SheetValues, SpreadsheetInfo } from '../src/features/ingest/sheets/client';
import { fromGoogleResponse, type SheetsOperation } from '../src/features/ingest/sheets/errors';

// A stand-in for Google Sheets (deps.services.sheets) that never touches the network. It answers the two calls the
// import makes from in-memory spreadsheets, the way Google does: tabs in order, ranges bounded by the grid, trailing
// blank cells and rows left out, and the same errors the real client throws for an unknown spreadsheet or range.

export const FAKE_CLIENT_EMAIL = 'tailorit-test@tailorit-test-project.iam.gserviceaccount.com';

export interface FakeTab {
  gid: number;
  title: string;
  hidden?: boolean;
  rows: string[][];
  /** The grid's row count (default: 1000, or more when the rows need it, as a new Google sheet has). */
  rowCount?: number;
}

export interface FakeSpreadsheet {
  title: string;
  tabs: FakeTab[];
}

export interface FakeCall {
  operation: SheetsOperation;
  spreadsheetId: string;
  range?: string;
}

export interface FakeSheetsOptions {
  account?: Partial<SheetAccount>;
  /** An error to throw instead of answering a call. */
  fail?: (call: FakeCall) => Error | undefined;
  /** Each call waits this long (and stops when its signal aborts). */
  delayMs?: number;
}

export type FakeSheetsClient = SheetsClient & { calls: string[]; spreadsheets: Record<string, FakeSpreadsheet> };

const CONTEXT = { clientEmail: FAKE_CLIENT_EMAIL, projectId: 'tailorit-test-project', keyFile: 'fake-service-account-key.json' };

function trimTrailing(row: readonly string[]): string[] {
  let length = row.length;
  while (length > 0 && row[length - 1]!.trim() === '') length -= 1;
  return row.slice(0, length);
}

export function fakeSheetsClient(spreadsheets: Record<string, FakeSpreadsheet>, options: FakeSheetsOptions = {}): FakeSheetsClient {
  const calls: string[] = [];
  const wait = (signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      if (!options.delayMs) return resolve();
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, options.delayMs);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  const unknown = (operation: SheetsOperation) =>
    fromGoogleResponse(operation, 404, { error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } }, CONTEXT);
  const badRange = (range: string) =>
    fromGoogleResponse('values.get', 400, { error: { code: 400, message: `Unable to parse range: ${range}`, status: 'INVALID_ARGUMENT' } }, CONTEXT);
  const rowCountOf = (tab: FakeTab) => tab.rowCount ?? Math.max(1000, tab.rows.length);

  return {
    calls,
    spreadsheets,
    account: () => ({
      configured: true,
      clientEmail: FAKE_CLIENT_EMAIL,
      projectId: 'tailorit-test-project',
      keyFile: 'F:\\keys\\service-account-key.json',
      problem: null,
      ...options.account,
    }),

    async spreadsheet(spreadsheetId: string, { signal }: SheetCallOptions): Promise<SpreadsheetInfo> {
      calls.push(`spreadsheets.get ${spreadsheetId}`);
      await wait(signal);
      const failure = options.fail?.({ operation: 'spreadsheets.get', spreadsheetId });
      if (failure) throw failure;
      const sheet = spreadsheets[spreadsheetId];
      if (!sheet) throw unknown('spreadsheets.get');
      return {
        spreadsheetId,
        title: sheet.title,
        locale: 'en_US',
        tabs: sheet.tabs.map((tab, index) => ({
          gid: tab.gid,
          title: tab.title,
          index,
          hidden: tab.hidden ?? false,
          rowCount: rowCountOf(tab),
          columnCount: 26,
        })),
      };
    },

    async values(spreadsheetId: string, range: string, { signal }: SheetCallOptions): Promise<SheetValues> {
      calls.push(`values.get ${spreadsheetId} ${range}`);
      await wait(signal);
      const failure = options.fail?.({ operation: 'values.get', spreadsheetId, range });
      if (failure) throw failure;
      const sheet = spreadsheets[spreadsheetId];
      if (!sheet) throw unknown('values.get');
      const match = /^'((?:[^']|'')*)'!(\d+):(\d+)$/.exec(range);
      if (!match) throw badRange(range);
      const title = match[1]!.replace(/''/g, "'");
      const from = Number(match[2]);
      const to = Number(match[3]);
      const tab = sheet.tabs.find((candidate) => candidate.title === title);
      if (!tab || to > rowCountOf(tab)) throw badRange(range);
      const rows = tab.rows.slice(from - 1, to).map(trimTrailing);
      while (rows.length > 0 && rows[rows.length - 1]!.length === 0) rows.pop();
      return { range: `'${match[1]}'!A${from}:Z${to}`, firstRow: from, rows };
    },
  };
}
