import { AppError, validationFailed } from '../../../core/http/errors';

// What Google's answers mean for the admin, as sentences that say what to do. Google 401/403 never become TailorIT's
// own 401/403 (the web app would send the admin to the sign-in page): a sheet that is not shared is a 400 on the link,
// a key or API problem is a 503 `sheets_unavailable`. No AppError here carries a `cause`: the error middleware logs a
// 5xx's cause, and a google-auth-library error holds the signed assertion in its request config.

export const sheetsUnavailable = (message: string, retryAfterSeconds?: number) =>
  new AppError('sheets_unavailable', message, retryAfterSeconds === undefined ? {} : { retryAfterSeconds });

/** Who asked Google, for the sentences that name the account or the key file. */
export interface GoogleErrorContext {
  clientEmail: string;
  projectId: string | null;
  keyFile: string;
}

export type SheetsOperation = 'spreadsheets.get' | 'values.get';

interface GoogleErrorBody {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  details?: unknown;
  errors?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function errorOf(body: unknown): GoogleErrorBody {
  return isRecord(body) && isRecord(body.error) ? (body.error as GoogleErrorBody) : {};
}

/** Google's own status word ("PERMISSION_DENIED"), or ''. */
export function googleStatusOf(body: unknown): string {
  const status = errorOf(body).status;
  return typeof status === 'string' && /^[A-Z_]{1,40}$/.test(status) ? status : '';
}

/** The reasons an error body gives: details[].reason (AIP-193) and the older errors[].reason. */
function reasonsOf(error: GoogleErrorBody): string[] {
  const reasons: string[] = [];
  for (const list of [error.details, error.errors]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) if (isRecord(item) && typeof item.reason === 'string') reasons.push(item.reason);
  }
  return reasons;
}

const CONSOLE_URL = /^https:\/\/console\.(?:developers|cloud)\.google\.com\/[^\s"<>]*$/;

/** The "turn the API on" link Google sends with SERVICE_DISABLED, else the Sheets API page of the project. */
function activationOf(error: GoogleErrorBody, projectId: string | null): { url: string; project: string | null } {
  let url: string | null = null;
  let project = projectId;
  if (Array.isArray(error.details)) {
    for (const item of error.details) {
      if (!isRecord(item) || !isRecord(item.metadata)) continue;
      const { activationUrl, consumer } = item.metadata;
      if (!url && typeof activationUrl === 'string' && CONSOLE_URL.test(activationUrl)) url = activationUrl;
      if (!project && typeof consumer === 'string') project = /^projects\/([A-Za-z0-9-]{1,64})$/.exec(consumer)?.[1] ?? null;
    }
  }
  const library = 'https://console.cloud.google.com/apis/library/sheets.googleapis.com';
  return { url: url ?? (project ? `${library}?project=${encodeURIComponent(project)}` : library), project };
}

export const SHEETS_MESSAGES = {
  share: (clientEmail: string) =>
    `TailorIT can't open this spreadsheet. In Google Sheets, click Share, add ${clientEmail} as a Viewer, then read the sheet again.`,
  notFound: 'Google has no spreadsheet at that link. Check the link, and that the sheet is not in the trash.',
  notSheets:
    "That file is not a Google Sheets spreadsheet (an Excel file stored in Drive, for example). Open it, choose File > Save as Google Sheets, and use the new sheet's link.",
  tabChanged: 'This tab changed while TailorIT read it. Read the sheet again.',
  rateLimited: 'Google Sheets is limiting how often TailorIT reads sheets. Try again in a minute.',
  down: (status: number) => `Google Sheets is not answering right now (HTTP ${status}). Try again in a minute.`,
  unreachable: "TailorIT could not reach Google Sheets. Check this server's internet connection, then try again in a minute.",
  timeout: (ms: number) =>
    `Google Sheets did not answer within ${Math.max(1, Math.round(ms / 1000))} seconds. Try again; a very large tab may need to be split.`,
  outOfTime: 'Google Sheets did not answer in time. Try again; a very large tab may need to be split.',
  signInRefused: (clientEmail: string) => `Google did not accept TailorIT's sign-in as ${clientEmail}. Check the key file, then try again.`,
  tooLarge: (size: string) =>
    `This tab is too large to import at once (Google sent more than ${size}). Split it into smaller tabs and import each one.`,
  unreadable: 'Google Sheets sent an answer TailorIT could not read. Try again in a minute.',
} as const;

/**
 * A Google Sheets API error answer as the error TailorIT answers with. The API being off (SERVICE_DISABLED, which Google
 * also labels PERMISSION_DENIED) is told apart before a sheet that is not shared.
 */
export function fromGoogleResponse(
  operation: SheetsOperation,
  status: number,
  body: unknown,
  ctx: GoogleErrorContext,
  retryAfterSeconds?: number,
): AppError {
  const error = errorOf(body);
  const reasons = reasonsOf(error);
  const googleStatus = googleStatusOf(body);
  const message = typeof error.message === 'string' ? error.message : '';

  if (reasons.includes('SERVICE_DISABLED') || reasons.includes('accessNotConfigured')) {
    const { url, project } = activationOf(error, ctx.projectId);
    return sheetsUnavailable(
      project
        ? `The Google Sheets API is turned off for the Cloud project ${project}. Turn it on at ${url}, wait a minute, then read the sheet again.`
        : `The Google Sheets API is turned off for the service account's Cloud project. Turn it on at ${url}, wait a minute, then read the sheet again.`,
    );
  }
  if (status === 429 || reasons.some((reason) => /^(?:rateLimitExceeded|userRateLimitExceeded|RATE_LIMIT_EXCEEDED)$/.test(reason))) {
    return new AppError('rate_limited', SHEETS_MESSAGES.rateLimited, { retryAfterSeconds: retryAfterSeconds ?? 60 });
  }
  if (status === 401) return sheetsUnavailable(SHEETS_MESSAGES.signInRefused(ctx.clientEmail));
  if (status === 403) {
    if (reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) return sheetsUnavailable(SHEETS_MESSAGES.signInRefused(ctx.clientEmail));
    return validationFailed(SHEETS_MESSAGES.share(ctx.clientEmail), { url: SHEETS_MESSAGES.share(ctx.clientEmail) });
  }
  if (status === 404) return validationFailed(SHEETS_MESSAGES.notFound, { url: SHEETS_MESSAGES.notFound });
  if (status === 400 && (googleStatus === 'FAILED_PRECONDITION' || /not supported for this document/i.test(message))) {
    return validationFailed(SHEETS_MESSAGES.notSheets, { url: SHEETS_MESSAGES.notSheets });
  }
  if (
    status === 400 &&
    operation === 'values.get' &&
    (googleStatus === 'INVALID_ARGUMENT' || /unable to parse range|exceeds grid limits/i.test(message))
  ) {
    // The tab was renamed, deleted or shrunk between reading the tab list and reading its cells.
    return validationFailed(SHEETS_MESSAGES.tabChanged, { gid: SHEETS_MESSAGES.tabChanged });
  }
  if (status >= 500) return sheetsUnavailable(SHEETS_MESSAGES.down(status), 30);
  return sheetsUnavailable(
    `Google Sheets refused the request (HTTP ${status}${googleStatus ? ` ${googleStatus}` : ''}). Read the sheet again in a minute.`,
  );
}

/** The parts of a failed token request this module reads (a google-auth-library / gaxios error). */
interface TokenFailureLike {
  code?: unknown;
  name?: unknown;
  response?: { status?: unknown; data?: unknown; headers?: unknown };
}

function headerOf(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const get = (headers as { get?: unknown }).get;
  if (typeof get === 'function') {
    const value = (get as (key: string) => unknown).call(headers, name);
    return typeof value === 'string' ? value : null;
  }
  const value = (headers as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : null;
}

/** " by about 7 minutes" from the Date header of Google's answer, or '' when it cannot tell. */
function clockOffset(dateHeader: string | null, now: number): string {
  const served = dateHeader ? Date.parse(dateHeader) : Number.NaN;
  if (Number.isNaN(served)) return '';
  const seconds = Math.round(Math.abs(now - served) / 1000);
  if (seconds < 60) return '';
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return ` by about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.round(minutes / 60);
  return ` by about ${hours} hours`;
}

/** What a failed token request said, for one log line: the HTTP status and Google's error code, never its text. */
export function tokenFailureSummary(error: unknown): string {
  const failure = (error ?? {}) as TokenFailureLike;
  const response = failure.response;
  if (!response) {
    const code = typeof failure.code === 'string' ? failure.code : typeof failure.name === 'string' ? failure.name : 'network error';
    return `no answer (${code.replace(/[^\w.-]/g, '').slice(0, 40)})`;
  }
  const data = isRecord(response.data) ? response.data : {};
  const code = typeof data.error === 'string' && /^[a-z_]{1,40}$/.test(data.error) ? ` ${data.error}` : '';
  return `HTTP ${typeof response.status === 'number' ? response.status : '?'}${code}`;
}

/** A failed sign-in (the token request) as the error TailorIT answers with. */
export function fromTokenFailure(error: unknown, ctx: GoogleErrorContext, now: number): AppError {
  const failure = (error ?? {}) as TokenFailureLike;
  const response = failure.response;
  if (!response) {
    return sheetsUnavailable("TailorIT could not reach Google to sign in. Check this server's internet connection, then try again.", 30);
  }
  const status = typeof response.status === 'number' ? response.status : 0;
  const data = isRecord(response.data) ? response.data : {};
  const code = typeof data.error === 'string' ? data.error : '';
  const description = typeof data.error_description === 'string' ? data.error_description : '';
  if (code === 'invalid_grant' && /short-lived|reasonable timeframe|\biat\b/i.test(description)) {
    return sheetsUnavailable(
      `Google refused the sign-in because this computer's clock is off${clockOffset(headerOf(response.headers, 'date'), now)}. Turn on automatic time (Windows: Settings > Time & language > Date & time > Set time automatically), then try again.`,
    );
  }
  if (code === 'invalid_client' || (code === 'invalid_grant' && /account not found|not found|does not exist/i.test(description))) {
    return sheetsUnavailable(
      `Google does not know the service account ${ctx.clientEmail} (it may have been deleted). Create a key for an active service account and replace ${ctx.keyFile}.`,
    );
  }
  if (code === 'invalid_grant' || code === 'unauthorized_client') {
    return sheetsUnavailable(
      `Google rejected the key of ${ctx.clientEmail}: it may have been deleted or disabled. Create a new JSON key for the service account and replace ${ctx.keyFile}.`,
    );
  }
  if (status === 429 || status >= 500) {
    return sheetsUnavailable(`Google's sign-in service is not answering right now (HTTP ${status}). Try again in a minute.`, 30);
  }
  return sheetsUnavailable(SHEETS_MESSAGES.signInRefused(ctx.clientEmail));
}
