import { JWT } from 'google-auth-library';
import { MAX_SHEET_GID, type SheetAccount, type SheetTab } from '@tailorit/shared';
import type { AppDeps } from '../../../core/context';
import { AppError, validationFailed } from '../../../core/http/errors';
import type { Logger } from '../../../core/log';
import { retryAfterMs, sleepFor } from '../http';
import { SHEETS_READONLY_SCOPE, createKeyFileReader, toSheetAccount, type KeyFileState, type ServiceAccountKey } from './account';
import {
  SHEETS_MESSAGES,
  fromGoogleResponse,
  fromTokenFailure,
  googleStatusOf,
  sheetsUnavailable,
  tokenFailureSummary,
  type GoogleErrorContext,
  type SheetsOperation,
} from './errors';

// The Google Sheets reader of the Sheet import: read-only, two GET requests per read (the tab list, then one tab's
// cells). Sign-in is a service account JWT from google-auth-library with its own retries off, so one token request is
// one call; data requests are plain fetch calls with a timeout, one retry on 429/5xx/network, and a cap on the size of
// an answer. Nothing it logs or throws contains a token, the signed assertion, a key or a raw Google error.

export const SHEETS_API = 'https://sheets.googleapis.com/v4';
export const SPREADSHEET_FIELDS =
  'spreadsheetId,properties(title,locale),sheets(properties(sheetId,title,index,hidden,sheetType,gridProperties(rowCount,columnCount)))';
/** Google's answer for one tab is JSON around at most SHEET_MAX_MB of text. */
export const MAX_RESPONSE_BYTES = 40 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 64 * 1024;

export interface SpreadsheetInfo {
  spreadsheetId: string;
  title: string;
  locale: string | null;
  /** Grid tabs (hidden ones included), in the order the spreadsheet shows them. */
  tabs: SheetTab[];
}

export interface SheetValues {
  /** The range Google answered for ("'10/22/2026'!A1:J120"). */
  range: string;
  /** The sheet row of rows[0]. */
  firstRow: number;
  /** Rows as the sheet shows them (formatted text); a blank row in between is []; trailing blanks are left out. */
  rows: string[][];
}

export interface SheetCallOptions {
  signal: AbortSignal;
  /** Epoch ms (Date.now) after which no new attempt starts and no retry waits. */
  deadline?: number;
}

/** The seam tests replace: deps.services.sheets. */
export interface SheetsClient {
  /** Whether a usable key is there, and the address to share sheets with. Reads the key file (cached). */
  account(): SheetAccount;
  spreadsheet(spreadsheetId: string, options: SheetCallOptions): Promise<SpreadsheetInfo>;
  values(spreadsheetId: string, range: string, options: SheetCallOptions): Promise<SheetValues>;
}

declare module '../../../core/context' {
  interface AppServices {
    /** The Google Sheet import's reader (work package WP12). */
    sheets?: SheetsClient;
  }
}

export interface GoogleSheetsClientOptions {
  keyFile: string;
  userAgent: string;
  log: Logger;
  /** Both the token request and the Sheets API calls use it (tests stub it). Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Replaces the JWT sign-in (tests). `fresh` asks for a new token after Google refused one. */
  accessToken?: (key: ServiceAccountKey, options: { signal: AbortSignal; fresh: boolean }) => Promise<string>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** The clock of deadlines and the clock-skew message. Default Date.now. */
  now?: () => number;
  timeouts?: { tokenMs?: number; metadataMs?: number; valuesMs?: number };
  maxResponseBytes?: number;
}

/** The Sheets reader, or a 503 a person can read. */
export function requireSheets(deps: Pick<AppDeps, 'services'>): SheetsClient {
  const client = deps.services.sheets;
  if (!client) throw sheetsUnavailable('Google Sheet import is not set up on this server.');
  return client;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const numberOf = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const cellText = (value: unknown): string => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));

/** The tab list of a spreadsheets.get answer: grid tabs only (chart sheets have no cells), sorted by position. */
export function toSpreadsheetInfo(data: unknown, spreadsheetId: string): SpreadsheetInfo {
  const json = isRecord(data) ? data : {};
  const properties = isRecord(json.properties) ? json.properties : {};
  const tabs: SheetTab[] = [];
  const sheets = Array.isArray(json.sheets) ? json.sheets : [];
  sheets.forEach((sheet, position) => {
    const p = isRecord(sheet) && isRecord(sheet.properties) ? sheet.properties : null;
    if (!p) return;
    if (typeof p.sheetType === 'string' && p.sheetType !== 'GRID') return;
    // Google leaves out fields that hold their default (sheetId 0, index 0, hidden false).
    const gid = numberOf(p.sheetId) ?? 0;
    if (!Number.isInteger(gid) || gid < 0 || gid > MAX_SHEET_GID) return;
    const grid = isRecord(p.gridProperties) ? p.gridProperties : {};
    tabs.push({
      gid,
      title: typeof p.title === 'string' ? p.title : `Sheet ${position + 1}`,
      index: numberOf(p.index) ?? position,
      hidden: p.hidden === true,
      rowCount: Math.max(0, Math.trunc(numberOf(grid.rowCount) ?? 0)),
      columnCount: Math.max(0, Math.trunc(numberOf(grid.columnCount) ?? 0)),
    });
  });
  tabs.sort((a, b) => a.index - b.index);
  const title = typeof properties.title === 'string' && properties.title.trim() ? properties.title.trim() : 'Untitled spreadsheet';
  return {
    spreadsheetId: typeof json.spreadsheetId === 'string' && json.spreadsheetId ? json.spreadsheetId : spreadsheetId,
    title,
    locale: typeof properties.locale === 'string' ? properties.locale : null,
    tabs,
  };
}

/** The cells of a values.get answer. The first row is read from the answered range ("'Tab'!A3:J9" starts at 3). */
export function toSheetValues(data: unknown): SheetValues {
  const json = isRecord(data) ? data : {};
  const range = typeof json.range === 'string' ? json.range : '';
  // A tab's title may hold "!", the cell reference after the last one cannot.
  const start = /^\$?[A-Za-z]*\$?(\d+)/.exec(range.slice(range.lastIndexOf('!') + 1))?.[1];
  const firstRow = start ? Math.max(1, Number(start)) : 1;
  const rows = Array.isArray(json.values) ? json.values.map((row) => (Array.isArray(row) ? row.map(cellText) : [])) : [];
  return { range, firstRow, rows };
}

/** Resolves like `promise`, or rejects with the signal's reason as soon as it aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Why a read stopped: the reason its owner gave (a newer read, the time budget), else a plain sentence. */
function stopped(signal: AbortSignal): AppError {
  return signal.reason instanceof AppError ? signal.reason : sheetsUnavailable('The read of the sheet was stopped. Try again.');
}

class BodyTooLarge extends Error {}

/** A response body as text, counted while it streams: more than `cap` bytes throws BodyTooLarge. */
async function readBody(response: Response, cap: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    await response.body?.cancel().catch(() => undefined);
    throw new BodyTooLarge();
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/** "40 MB", "64 KB". */
function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

export function createGoogleSheetsClient(options: GoogleSheetsClientOptions): SheetsClient {
  const { log } = options;
  const readKey = createKeyFileReader(options.keyFile);
  const doFetch: typeof globalThis.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const sleep = options.sleep ?? sleepFor;
  const clock = options.now ?? Date.now;
  const timeouts = { tokenMs: 15_000, metadataMs: 20_000, valuesMs: 60_000, ...options.timeouts };
  const maxBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  /** One signer per key: a new key (or a token Google refused) gets a new one. */
  let signer: { fingerprint: string; jwt: JWT } | null = null;

  const usableKey = (): Extract<KeyFileState, { ok: true }> => {
    const state = readKey();
    if (!state.ok) throw sheetsUnavailable(state.problem);
    return state;
  };
  const contextOf = (state: Extract<KeyFileState, { ok: true }>): GoogleErrorContext => ({
    clientEmail: state.key.clientEmail,
    projectId: state.key.projectId,
    keyFile: state.keyFile,
  });

  async function accessToken(state: Extract<KeyFileState, { ok: true }>, signal: AbortSignal, fresh: boolean): Promise<string> {
    if (options.accessToken) return options.accessToken(state.key, { signal, fresh });
    if (fresh || !signer || signer.fingerprint !== state.fingerprint) {
      signer = {
        fingerprint: state.fingerprint,
        jwt: new JWT({
          email: state.key.clientEmail,
          key: state.key.privateKey,
          keyId: state.key.privateKeyId ?? undefined,
          scopes: [SHEETS_READONLY_SCOPE],
          // The SDK's request interceptors log token answers when GOOGLE_SDK_NODE_LOGGING is set: leave them out.
          useAuthRequestParameters: false,
          transporterOptions: {
            timeout: timeouts.tokenMs,
            fetchImplementation: doFetch,
            // gaxios would retry the token POST 3 times (and twice more without an answer) on its own.
            retryConfig: { retry: 0, noResponseRetries: 0 },
          },
        }),
      };
    }
    const { jwt } = signer;
    try {
      const { token } = await untilAborted(jwt.getAccessToken(), signal);
      if (!token) throw new Error('Google answered without an access token.');
      return token;
    } catch (error) {
      if (signal.aborted) throw stopped(signal);
      if (signer?.jwt === jwt) signer = null;
      log.warn(`[sheets] sign-in as ${state.key.clientEmail} failed: ${tokenFailureSummary(error)}`);
      throw fromTokenFailure(error, contextOf(state), clock());
    }
  }

  /** One GET to the Sheets API, as JSON. */
  async function getJson(
    operation: SheetsOperation,
    spreadsheetId: string,
    url: string,
    timeoutMs: number,
    request: SheetCallOptions,
  ): Promise<unknown> {
    const state = usableKey();
    const ctx = contextOf(state);
    const { signal, deadline } = request;
    const timeLeft = () => (deadline === undefined ? Number.POSITIVE_INFINITY : deadline - clock());
    let fresh = false;
    let signedInAgain = false;
    let retried = false;
    for (;;) {
      if (signal.aborted) throw stopped(signal);
      const token = await accessToken(state, signal, fresh);
      fresh = false;
      const left = timeLeft();
      if (left < 1000) throw sheetsUnavailable(SHEETS_MESSAGES.outOfTime);
      const attemptMs = Math.floor(Math.min(timeoutMs, left));
      const attempt = AbortSignal.any([signal, AbortSignal.timeout(attemptMs)]);
      const failed = (text: string) => log.warn(`[sheets] ${operation} ${spreadsheetId}: ${text}`);
      let response: Response;
      try {
        response = await doFetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': options.userAgent },
          signal: attempt,
        });
      } catch {
        if (signal.aborted) throw stopped(signal);
        if (attempt.aborted) {
          failed(`no answer within ${attemptMs} ms`);
          throw sheetsUnavailable(SHEETS_MESSAGES.timeout(attemptMs));
        }
        if (!retried && timeLeft() > 2000 + 1000) {
          retried = true;
          failed('network error, trying once more');
          await sleep(2000, signal).catch(() => undefined);
          continue;
        }
        failed('network error');
        throw sheetsUnavailable(SHEETS_MESSAGES.unreachable, 30);
      }
      if (response.status === 401 && !signedInAgain) {
        // A token Google no longer accepts (revoked, or the key changed): sign in once more.
        signedInAgain = true;
        fresh = true;
        await discard(response);
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && !retried) {
        const asked = retryAfterMs(response.headers.get('retry-after'), clock());
        const wait = Math.min(asked ?? (response.status === 429 ? 5000 : 2000), 10_000);
        if (timeLeft() > wait + 1000) {
          retried = true;
          failed(`HTTP ${response.status}, trying once more in ${Math.round(wait / 100) / 10} s`);
          await discard(response);
          await sleep(wait, signal).catch(() => undefined);
          continue;
        }
      }
      if (!response.ok) {
        let body: unknown = null;
        try {
          body = JSON.parse(await readBody(response, MAX_ERROR_BODY_BYTES));
        } catch {
          body = null;
        }
        const googleStatus = googleStatusOf(body);
        failed(`HTTP ${response.status}${googleStatus ? ` ${googleStatus}` : ''}`);
        const asked = retryAfterMs(response.headers.get('retry-after'), clock());
        throw fromGoogleResponse(operation, response.status, body, ctx, asked === null ? undefined : Math.max(1, Math.ceil(asked / 1000)));
      }
      let text: string;
      try {
        text = await readBody(response, maxBytes);
      } catch (error) {
        if (error instanceof BodyTooLarge) {
          failed(`answer larger than ${sizeLabel(maxBytes)}`);
          const message = SHEETS_MESSAGES.tooLarge(sizeLabel(maxBytes));
          throw validationFailed(message, { gid: message });
        }
        if (signal.aborted) throw stopped(signal);
        if (attempt.aborted) {
          failed(`no complete answer within ${attemptMs} ms`);
          throw sheetsUnavailable(SHEETS_MESSAGES.timeout(attemptMs));
        }
        failed('the answer broke off');
        throw sheetsUnavailable(SHEETS_MESSAGES.unreachable, 30);
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        failed('an answer that is not JSON');
        throw sheetsUnavailable(SHEETS_MESSAGES.unreadable, 30);
      }
    }
  }

  return {
    account: () => toSheetAccount(readKey()),

    async spreadsheet(spreadsheetId, request) {
      const url = `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(SPREADSHEET_FIELDS)}`;
      return toSpreadsheetInfo(await getJson('spreadsheets.get', spreadsheetId, url, timeouts.metadataMs, request), spreadsheetId);
    },

    async values(spreadsheetId, range, request) {
      const url =
        `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}` +
        '?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS';
      return toSheetValues(await getJson('values.get', spreadsheetId, url, timeouts.valuesMs, request));
    },
  };
}
