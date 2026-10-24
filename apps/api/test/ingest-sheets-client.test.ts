import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSpreadsheetRef } from '@tailorit/shared';
import { AppError } from '../src/core/http/errors';
import { createMemoryLogger } from '../src/core/log';
import { repoRoot } from '../src/core/paths';
import { SHEETS_READONLY_SCOPE } from '../src/features/ingest/sheets/account';
import {
  SPREADSHEET_FIELDS,
  createGoogleSheetsClient,
  toSheetValues,
  type GoogleSheetsClientOptions,
  type SheetCallOptions,
} from '../src/features/ingest/sheets/client';
import { quoteSheetTitle } from '../src/features/ingest/sheets/table';

// Work package WP12: the real Google Sheets client (google-auth-library JWT + fetch), with the network stubbed: the
// token endpoint and the Sheets API answer from the test. Nothing here reaches Google.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEET_ID = '1ClientTestAbCdEfGhIjKlMnOpQrStUvWxYz012';
const CLIENT_EMAIL = 'reader@tailorit-test-project.iam.gserviceaccount.com';
const pair = () =>
  generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const { privateKey: PRIVATE_KEY, publicKey: PUBLIC_KEY } = pair();
const keyJson = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'service_account',
    project_id: 'tailorit-test-project',
    private_key_id: 'kid-0123456789abcdef',
    private_key: PRIVATE_KEY,
    client_email: CLIENT_EMAIL,
    token_uri: TOKEN_URL,
    ...overrides,
  });

let dir: string;
let keyFile: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tailorit-sheets-client-'));
  keyFile = join(dir, 'service-account-key.json');
  writeFileSync(keyFile, keyJson());
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** Waits until the request's signal aborts, then fails as fetch does. */
const hang = (init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

interface Recorded {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

type Handler = (call: number, url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

/** A fake network for the token endpoint and the Sheets API; every request is recorded. */
function network(handlers: { token?: Handler; sheets?: Handler }) {
  const requests: Recorded[] = [];
  let tokens = 0;
  let sheets = 0;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push({ url: url.href, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: init?.body ? String(init.body) : '' });
    if (url.href === TOKEN_URL) {
      tokens += 1;
      return handlers.token
        ? handlers.token(tokens, url, init)
        : json(200, { access_token: `ya29.test-token-${tokens}`, expires_in: 3600, token_type: 'Bearer' });
    }
    if (url.origin === 'https://sheets.googleapis.com' && handlers.sheets) {
      sheets += 1;
      return handlers.sheets(sheets, url, init);
    }
    throw new TypeError(`fetch failed: unexpected ${url.href}`);
  }) as typeof globalThis.fetch;
  return { fetch, requests, counts: () => ({ tokens, sheets }) };
}

function clientOf(net: ReturnType<typeof network>, options: Partial<GoogleSheetsClientOptions> = {}) {
  const log = createMemoryLogger();
  const sleeps: number[] = [];
  const sheets = createGoogleSheetsClient({
    keyFile,
    userAgent: 'TailorIT test',
    log,
    fetch: net.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...options,
  });
  return { sheets, log, sleeps };
}

const call = (): SheetCallOptions => ({ signal: new AbortController().signal });

const META = {
  spreadsheetId: SHEET_ID,
  properties: { title: 'Jobs', locale: 'en_US' },
  sheets: [
    { properties: { title: "It's", gridProperties: { rowCount: 1000, columnCount: 26 } } },
    { properties: { sheetId: 9, title: 'Chart', index: 1, sheetType: 'OBJECT' } },
    { properties: { sheetId: 5, title: 'Old', index: 2, hidden: true, sheetType: 'GRID', gridProperties: { rowCount: 50, columnCount: 4 } } },
  ],
};
const metadataOk: Handler = () => json(200, META);

/** The error a promise rejects with (fails the test when it resolves). */
async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as Error).cause).toBeUndefined();
    return error as AppError;
  }
  throw new Error('expected the call to fail');
}

describe('sign-in and requests', () => {
  it('signs in as the service account with the read-only scope, and asks for exactly the tab list and the cells', async () => {
    let assertion = '';
    const net = network({
      token: (_call, _url, init) => {
        const form = new URLSearchParams(String(init?.body));
        expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
        assertion = form.get('assertion') ?? '';
        return json(200, { access_token: 'ya29.first', expires_in: 3600, token_type: 'Bearer' });
      },
      sheets: (_call, url) =>
        url.pathname.includes('/values/') ? json(200, { range: "'It''s'!A1:C3", majorDimension: 'ROWS', values: [['a', 'b'], [], ['c', 7]] }) : json(200, META),
    });
    const { sheets } = clientOf(net);
    const info = await sheets.spreadsheet(SHEET_ID, call());
    expect(info).toEqual({
      spreadsheetId: SHEET_ID,
      title: 'Jobs',
      locale: 'en_US',
      tabs: [
        { gid: 0, title: "It's", index: 0, hidden: false, rowCount: 1000, columnCount: 26 },
        { gid: 5, title: 'Old', index: 2, hidden: true, rowCount: 50, columnCount: 4 },
      ],
    });
    const values = await sheets.values(SHEET_ID, `${quoteSheetTitle("It's")}!1:1000`, call());
    expect(values).toEqual({ range: "'It''s'!A1:C3", firstRow: 1, rows: [['a', 'b'], [], ['c', '7']] });
    expect(net.counts()).toEqual({ tokens: 1, sheets: 2 });

    const [header, payload, signature] = assertion.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString('utf8'))).toMatchObject({ alg: 'RS256' });
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(claims).toMatchObject({ iss: CLIENT_EMAIL, scope: SHEETS_READONLY_SCOPE, aud: TOKEN_URL });
    expect(Number(claims.exp) - Number(claims.iat)).toBe(3600);
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), PUBLIC_KEY, Buffer.from(signature!, 'base64url'))).toBe(true);

    const [token, metadata, cells] = net.requests;
    expect(token).toMatchObject({ url: TOKEN_URL, method: 'POST' });
    const metadataUrl = new URL(metadata!.url);
    expect(`${metadataUrl.origin}${metadataUrl.pathname}`).toBe(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`);
    expect(metadataUrl.searchParams.get('fields')).toBe(SPREADSHEET_FIELDS);
    expect(metadata!.method).toBe('GET');
    expect(metadata!.headers.get('authorization')).toBe('Bearer ya29.first');
    expect(metadata!.headers.get('user-agent')).toBe('TailorIT test');
    expect(cells!.url).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/'It''s'!1%3A1000?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`,
    );
    expect(cells!.method).toBe('GET');
  });

  it('reads the first row from the answered range, even when the tab title holds "!"', () => {
    expect(toSheetValues({ range: "'A!1'!A5:B6", values: [['x']] })).toEqual({ range: "'A!1'!A5:B6", firstRow: 5, rows: [['x']] });
    expect(toSheetValues({ range: "'Tab'!A1:Z1000" })).toEqual({ range: "'Tab'!A1:Z1000", firstRow: 1, rows: [] });
  });

  it('asks for one token per key, a fresh one after a 401, and one after the key file changes', async () => {
    const used: string[] = [];
    const net = network({
      sheets: (n, _url, init) => {
        used.push(new Headers(init?.headers).get('authorization') ?? '');
        return n === 1
          ? json(401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } })
          : json(200, META);
      },
    });
    const { sheets } = clientOf(net);
    await sheets.spreadsheet(SHEET_ID, call());
    expect(net.counts()).toEqual({ tokens: 2, sheets: 2 });
    await sheets.spreadsheet(SHEET_ID, call());
    await sheets.spreadsheet(SHEET_ID, call());
    expect(net.counts()).toEqual({ tokens: 2, sheets: 4 });

    // A key rotated while the server runs: a new sign-in with the new key, no restart.
    writeFileSync(keyFile, keyJson({ private_key: pair().privateKey, private_key_id: 'kid-rotated' }));
    await sheets.spreadsheet(SHEET_ID, call());
    expect(net.counts()).toEqual({ tokens: 3, sheets: 5 });
    expect(used).toEqual([
      'Bearer ya29.test-token-1',
      'Bearer ya29.test-token-2',
      'Bearer ya29.test-token-2',
      'Bearer ya29.test-token-2',
      'Bearer ya29.test-token-3',
    ]);
  });

  it('answers 503 after a second 401 in a row', async () => {
    const net = network({ sheets: () => json(401, { error: { code: 401, status: 'UNAUTHENTICATED' } }) });
    const error = await failure(clientOf(net).sheets.spreadsheet(SHEET_ID, call()));
    expect(error).toMatchObject({ code: 'sheets_unavailable', status: 503 });
    expect(error.message).toBe(`Google did not accept TailorIT's sign-in as ${CLIENT_EMAIL}. Check the key file, then try again.`);
    expect(net.counts()).toEqual({ tokens: 2, sheets: 2 });
  });

  it('never retries the token request itself: one call when Google fails, does not answer, or cannot be reached', async () => {
    const down = network({ token: () => new Response('Service Unavailable', { status: 503 }), sheets: metadataOk });
    const unavailable = await failure(clientOf(down).sheets.spreadsheet(SHEET_ID, call()));
    expect(unavailable).toMatchObject({ code: 'sheets_unavailable', status: 503, retryAfterSeconds: 30 });
    expect(unavailable.message).toBe("Google's sign-in service is not answering right now (HTTP 503). Try again in a minute.");
    expect(down.counts()).toEqual({ tokens: 1, sheets: 0 });

    const offline = network({
      token: () => {
        throw new TypeError('fetch failed');
      },
      sheets: metadataOk,
    });
    const unreachable = await failure(clientOf(offline).sheets.spreadsheet(SHEET_ID, call()));
    expect(unreachable.message).toBe("TailorIT could not reach Google to sign in. Check this server's internet connection, then try again.");
    expect(offline.counts()).toEqual({ tokens: 1, sheets: 0 });

    const silent = network({ token: (_call, _url, init) => hang(init), sheets: metadataOk });
    const timedOut = await failure(clientOf(silent, { timeouts: { tokenMs: 50 } }).sheets.spreadsheet(SHEET_ID, call()));
    expect(timedOut.code).toBe('sheets_unavailable');
    expect(silent.counts()).toEqual({ tokens: 1, sheets: 0 });
  });
});

describe('retries', () => {
  it('tries once more after a 429, a 5xx or a network error, and then gives the right answer', async () => {
    const answers = (list: Array<Response | 'network'>): Handler => (n) => {
      const answer = list[Math.min(n, list.length) - 1]!;
      if (answer === 'network') throw new TypeError('fetch failed');
      return answer;
    };
    const busy = () => json(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, { 'retry-after': '7' });

    for (const first of [busy(), json(503, { error: { code: 503, status: 'UNAVAILABLE' } }), 'network' as const]) {
      const net = network({ sheets: answers([first, json(200, META)]) });
      const { sheets } = clientOf(net);
      expect((await sheets.spreadsheet(SHEET_ID, call())).title).toBe('Jobs');
      expect(net.counts()).toEqual({ tokens: 1, sheets: 2 });
    }

    const limited = network({ sheets: answers([busy(), busy()]) });
    const limitedClient = clientOf(limited);
    const rateLimited = await failure(limitedClient.sheets.spreadsheet(SHEET_ID, call()));
    expect(rateLimited).toMatchObject({ code: 'rate_limited', status: 429, retryAfterSeconds: 7 });
    expect(rateLimited.message).toBe('Google Sheets is limiting how often TailorIT reads sheets. Try again in a minute.');
    expect(limitedClient.sleeps).toEqual([7000]);
    expect(limited.counts().sheets).toBe(2);

    const plain = network({ sheets: () => json(429, { error: { code: 429 } }) });
    expect(await failure(clientOf(plain).sheets.spreadsheet(SHEET_ID, call()))).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 60 });

    const patient = network({ sheets: answers([json(503, {}, { 'retry-after': '120' }), json(200, META)]) });
    const patientClient = clientOf(patient);
    await patientClient.sheets.spreadsheet(SHEET_ID, call());
    expect(patientClient.sleeps).toEqual([10_000]);

    const broken = network({ sheets: () => json(500, { error: { code: 500, status: 'INTERNAL' } }) });
    const down = await failure(clientOf(broken).sheets.spreadsheet(SHEET_ID, call()));
    expect(down).toMatchObject({ code: 'sheets_unavailable', status: 503, retryAfterSeconds: 30 });
    expect(down.message).toBe('Google Sheets is not answering right now (HTTP 500). Try again in a minute.');
    expect(broken.counts().sheets).toBe(2);

    const offline = network({ sheets: answers(['network', 'network']) });
    const unreachable = await failure(clientOf(offline).sheets.spreadsheet(SHEET_ID, call()));
    expect(unreachable.message).toBe("TailorIT could not reach Google Sheets. Check this server's internet connection, then try again in a minute.");
    expect(offline.counts().sheets).toBe(2);
  });

  it('skips a retry the time left cannot hold', async () => {
    const net = network({ sheets: () => json(503, { error: { code: 503 } }) });
    const { sheets, sleeps } = clientOf(net, { now: () => 1_000_000 });
    const error = await failure(sheets.spreadsheet(SHEET_ID, { signal: new AbortController().signal, deadline: 1_000_000 + 2500 }));
    expect(error.message).toMatch(/HTTP 503/);
    expect(net.counts().sheets).toBe(1);
    expect(sleeps).toEqual([]);
  });
});

describe('what Google says, for the admin', () => {
  const answering = (status: number, body: unknown) => network({ sheets: () => json(status, body) });

  it('tells a sheet that is not shared from the Sheets API being off (checked first)', async () => {
    const denied = await failure(
      clientOf(answering(403, { error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } })).sheets.spreadsheet(SHEET_ID, call()),
    );
    expect(denied).toMatchObject({ code: 'validation_failed', status: 400 });
    expect(denied.fields).toEqual({
      url: `TailorIT can't open this spreadsheet. In Google Sheets, click Share, add ${CLIENT_EMAIL} as a Viewer, then read the sheet again.`,
    });

    // The body Google sends when an API is switched off (as free_tailor's tests record it): it says PERMISSION_DENIED too.
    const disabledBody = {
      error: {
        code: 403,
        message: 'Google Sheets API has not been used in project 12345 before or it is disabled.',
        status: 'PERMISSION_DENIED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'SERVICE_DISABLED',
            metadata: {
              service: 'sheets.googleapis.com',
              consumer: 'projects/12345',
              activationUrl: 'https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=12345',
            },
          },
        ],
      },
    };
    const disabled = await failure(clientOf(answering(403, disabledBody)).sheets.spreadsheet(SHEET_ID, call()));
    expect(disabled).toMatchObject({ code: 'sheets_unavailable', status: 503 });
    expect(disabled.message).toBe(
      'The Google Sheets API is turned off for the Cloud project tailorit-test-project. Turn it on at https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=12345, wait a minute, then read the sheet again.',
    );

    writeFileSync(keyFile, keyJson({ project_id: 'my project&x' }));
    const legacy = await failure(
      clientOf(answering(403, { error: { code: 403, errors: [{ reason: 'accessNotConfigured' }] } })).sheets.spreadsheet(SHEET_ID, call()),
    );
    expect(legacy.message).toContain('https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=my%20project%26x');
  });

  it('names the link for a missing spreadsheet or an Excel file, and the tab for a range that no longer fits', async () => {
    const missing = await failure(clientOf(answering(404, { error: { code: 404, status: 'NOT_FOUND' } })).sheets.spreadsheet(SHEET_ID, call()));
    expect(missing.fields).toEqual({ url: 'Google has no spreadsheet at that link. Check the link, and that the sheet is not in the trash.' });

    const excel = await failure(
      clientOf(answering(400, { error: { code: 400, message: 'This operation is not supported for this document', status: 'FAILED_PRECONDITION' } })).sheets.spreadsheet(
        SHEET_ID,
        call(),
      ),
    );
    expect(excel.fields?.url).toMatch(/^That file is not a Google Sheets spreadsheet \(an Excel file stored in Drive, for example\)\./);

    const range = await failure(
      clientOf(answering(400, { error: { code: 400, message: "Unable to parse range: 'Gone'!1:1000", status: 'INVALID_ARGUMENT' } })).sheets.values(
        SHEET_ID,
        "'Gone'!1:1000",
        call(),
      ),
    );
    expect(range).toMatchObject({ code: 'validation_failed', status: 400 });
    expect(range.fields).toEqual({ gid: 'This tab changed while TailorIT read it. Read the sheet again.' });
  });

  it('explains a refused sign-in: the clock, an unknown account, a rejected key', async () => {
    const refusing = (body: Record<string, string>, headers: Record<string, string> = {}) =>
      network({ token: () => json(400, body, headers), sheets: metadataOk });
    const now = Date.parse('2026-10-24T10:00:00.000Z');
    const clock = await failure(
      clientOf(
        refusing(
          {
            error: 'invalid_grant',
            error_description: 'Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. Check your iat and exp values in the JWT claim.',
          },
          { date: new Date(now - 7 * 60_000).toUTCString() },
        ),
        { now: () => now },
      ).sheets.spreadsheet(SHEET_ID, call()),
    );
    expect(clock).toMatchObject({ code: 'sheets_unavailable', status: 503 });
    expect(clock.message).toBe(
      "Google refused the sign-in because this computer's clock is off by about 7 minutes. Turn on automatic time (Windows: Settings > Time & language > Date & time > Set time automatically), then try again.",
    );

    for (const body of [{ error: 'invalid_grant', error_description: 'Invalid grant: account not found' }, { error: 'invalid_client', error_description: 'The OAuth client was not found.' }]) {
      const unknown = await failure(clientOf(refusing(body)).sheets.spreadsheet(SHEET_ID, call()));
      expect(unknown.message).toBe(
        `Google does not know the service account ${CLIENT_EMAIL} (it may have been deleted). Create a key for an active service account and replace ${keyFile}.`,
      );
    }

    // "appropriate" is not "iat": only the word iat points at the clock.
    for (const description of ['Invalid JWT Signature.', 'The appropriate key was not presented.']) {
      const rejected = await failure(clientOf(refusing({ error: 'invalid_grant', error_description: description })).sheets.spreadsheet(SHEET_ID, call()));
      expect(rejected.message).toBe(
        `Google rejected the key of ${CLIENT_EMAIL}: it may have been deleted or disabled. Create a new JSON key for the service account and replace ${keyFile}.`,
      );
    }
  });

  it('refuses to read without a usable key, and reads a key saved later', async () => {
    unlinkSync(keyFile);
    const net = network({ sheets: metadataOk });
    const { sheets } = clientOf(net);
    expect(sheets.account()).toMatchObject({ configured: false, keyFile });
    const error = await failure(sheets.spreadsheet(SHEET_ID, call()));
    expect(error).toMatchObject({ code: 'sheets_unavailable', status: 503 });
    expect(error.message).toMatch(/^There is no Google service account key at /);
    expect(net.requests).toEqual([]);
    writeFileSync(keyFile, keyJson());
    expect(sheets.account()).toMatchObject({ configured: true, clientEmail: CLIENT_EMAIL, projectId: 'tailorit-test-project' });
    expect((await sheets.spreadsheet(SHEET_ID, call())).title).toBe('Jobs');
  });
});

describe('limits', () => {
  it('stops waiting at the time limit and when the read is stopped', async () => {
    const silent = network({ sheets: (_call, _url, init) => hang(init) });
    const timedOut = await failure(clientOf(silent, { timeouts: { metadataMs: 60 } }).sheets.spreadsheet(SHEET_ID, call()));
    expect(timedOut).toMatchObject({ code: 'sheets_unavailable', status: 503 });
    expect(timedOut.message).toBe('Google Sheets did not answer within 1 seconds. Try again; a very large tab may need to be split.');
    expect(silent.counts().sheets).toBe(1);

    const controller = new AbortController();
    const reason = new AppError('conflict', 'A newer read of a Google Sheet replaced this one.');
    const pending = clientOf(network({ sheets: (_call, _url, init) => hang(init) })).sheets.spreadsheet(SHEET_ID, { signal: controller.signal });
    setTimeout(() => controller.abort(reason), 20);
    await expect(pending).rejects.toBe(reason);
  });

  it('refuses an answer larger than the cap, counted while it streams', async () => {
    const big = { range: "'Tab'!A1:A100", values: Array.from({ length: 100 }, () => ['x'.repeat(100)]) };
    const streamed = network({ sheets: () => new Response(JSON.stringify(big), { status: 200 }) });
    const tooLarge = await failure(clientOf(streamed, { maxResponseBytes: 2048 }).sheets.values(SHEET_ID, "'Tab'!1:100", call()));
    expect(tooLarge).toMatchObject({ code: 'validation_failed', status: 400 });
    expect(tooLarge.fields).toEqual({
      gid: 'This tab is too large to import at once (Google sent more than 2 KB). Split it into smaller tabs and import each one.',
    });
    const declared = network({ sheets: () => json(200, big, { 'content-length': String(50 * 1024 * 1024) }) });
    expect((await failure(clientOf(declared).sheets.values(SHEET_ID, "'Tab'!1:100", call()))).fields?.gid).toMatch(/more than 40 MB/);
  });
});

describe('logs', () => {
  it('logs one short line per failure with no key, token or assertion in it', async () => {
    const net = network({
      token: (n) =>
        n === 1
          ? json(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' })
          : json(200, { access_token: 'ya29.secret-token', expires_in: 3600, token_type: 'Bearer' }),
      sheets: () => json(403, { error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } }),
    });
    const { sheets, log } = clientOf(net);
    await failure(sheets.spreadsheet(SHEET_ID, call()));
    await failure(sheets.spreadsheet(SHEET_ID, call()));
    expect(log.lines).toEqual([
      `warn [sheets] sign-in as ${CLIENT_EMAIL} failed: HTTP 400 invalid_grant`,
      `warn [sheets] spreadsheets.get ${SHEET_ID}: HTTP 403 PERMISSION_DENIED`,
    ]);
    const text = log.lines.join('\n');
    expect(text).not.toMatch(/PRIVATE KEY|ya29\.|assertion|eyJ|kid-0123456789abcdef|Invalid JWT Signature/);
  });
});

// A real read, only when TAILORIT_SHEETS_LIVE_URL names a sheet shared with the service account. Saves nothing.
describe.skipIf(!process.env.TAILORIT_SHEETS_LIVE_URL)('live Google Sheets (TAILORIT_SHEETS_LIVE_URL)', () => {
  it('reads the tab list and the first rows of a shared sheet', async () => {
    const ref = parseSpreadsheetRef(process.env.TAILORIT_SHEETS_LIVE_URL ?? '');
    if (!ref.ok) throw new Error(ref.message);
    const liveKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE
      ? resolve(repoRoot(), process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE)
      : join(repoRoot(), 'service-account-key.json');
    const log = createMemoryLogger();
    const sheets = createGoogleSheetsClient({ keyFile: liveKey, userAgent: 'TailorIT live test', log });
    expect(sheets.account().configured).toBe(true);
    const signal = AbortSignal.timeout(60_000);
    const info = await sheets.spreadsheet(ref.spreadsheetId, { signal });
    expect(info.tabs.length).toBeGreaterThan(0);
    const tab = info.tabs.find((candidate) => candidate.gid === ref.gid) ?? info.tabs[0]!;
    const values = await sheets.values(ref.spreadsheetId, `${quoteSheetTitle(tab.title)}!1:${Math.min(tab.rowCount || 20, 20)}`, { signal });
    expect(values.firstRow).toBe(1);
    expect(log.lines.join('\n')).not.toMatch(/PRIVATE KEY|ya29\./);
  }, 90_000);
});
