// The job boards' HTTP client: one request a second per host (shared by every run in this process, so two sources
// on one host take turns), a contact User-Agent, a per-request timeout, Retry-After honoured on 429, and a lenient
// JSON reader (some boards embed raw control characters in their strings).

export class IngestHttpError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = 'IngestHttpError';
    this.status = status;
    this.url = url;
  }
}

export interface HttpAnswer {
  status: number;
  data: unknown;
}

export interface GetJsonOptions {
  signal?: AbortSignal;
  /** Statuses answered instead of thrown (e.g. 404 for "no such board"). */
  allow?: readonly number[];
}

export interface IngestHttp {
  getJson(url: string, options?: GetJsonOptions): Promise<HttpAnswer>;
}

export interface IngestHttpOptions {
  userAgent: string;
  timeoutMs: number;
  /** Minimum gap between two requests to one host. Default 1000 ms. */
  minIntervalMs?: number;
  /** Retries after a 429 or a 5xx. Default 3. */
  maxRetries?: number;
  /** The longest Retry-After honoured; longer waits fail the request. Default 120 s. */
  maxRetryAfterMs?: number;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('The run was stopped.');
}

export function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return signal?.aborted ? Promise.reject(abortError(signal)) : Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal!));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Retry-After as milliseconds: delta-seconds or an HTTP date; null when absent or unreadable. */
export function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const text = header.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

/**
 * JSON.parse, and when that fails, again with raw control characters inside strings escaped (Ashby boards have sent
 * literal tabs and form feeds in descriptions). Throws when the text is not JSON either way.
 */
export function parseJsonLenient(text: string): unknown {
  const body = text.replace(/^\ufeff/, '');
  try {
    return JSON.parse(body);
  } catch (error) {
    let inString = false;
    let escaped = false;
    let out = '';
    for (let index = 0; index < body.length; index += 1) {
      const char = body[index]!;
      const code = char.charCodeAt(0);
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        } else if (code < 0x20) {
          out += `\\u${code.toString(16).padStart(4, '0')}`;
          continue;
        }
      } else if (char === '"') {
        inString = true;
      } else if (code < 0x20 && char !== '\n' && char !== '\r' && char !== '\t') {
        out += ' ';
        continue;
      }
      out += char;
    }
    try {
      return JSON.parse(out);
    } catch {
      throw error;
    }
  }
}

export function createIngestHttp(options: IngestHttpOptions): IngestHttp {
  const minInterval = options.minIntervalMs ?? 1000;
  const maxRetries = options.maxRetries ?? 3;
  const maxRetryAfter = options.maxRetryAfterMs ?? 120_000;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepFor;
  /** The earliest time each host may be asked again; reserved in call order, so waiters keep their turn. */
  const nextSlot = new Map<string, number>();

  async function takeTurn(host: string, signal?: AbortSignal): Promise<void> {
    const at = Math.max(now(), nextSlot.get(host) ?? 0);
    nextSlot.set(host, at + minInterval);
    await sleep(at - now(), signal);
  }

  function holdHost(host: string, ms: number): void {
    nextSlot.set(host, Math.max(nextSlot.get(host) ?? 0, now() + ms));
  }

  async function getJson(url: string, { signal, allow = [] }: GetJsonOptions = {}): Promise<HttpAnswer> {
    const host = new URL(url).host;
    for (let attempt = 0; ; attempt += 1) {
      await takeTurn(host, signal);
      const timeout = AbortSignal.timeout(options.timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response: Response;
      let text: string;
      try {
        response = await doFetch(url, {
          headers: { 'User-Agent': options.userAgent, Accept: 'application/json' },
          signal: combined,
          redirect: 'follow',
        });
        if (response.status === 429 || response.status >= 500) {
          const wait =
            retryAfterMs(response.headers.get('Retry-After'), now()) ?? (response.status === 429 ? 30_000 : 2000 * (attempt + 1));
          await response.body?.cancel().catch(() => undefined);
          if (attempt >= maxRetries || wait > maxRetryAfter) {
            const what = response.status === 429 ? 'is rate limiting us' : `answered HTTP ${response.status}`;
            throw new IngestHttpError(`${host} ${what}; try the run again later.`, response.status, url);
          }
          holdHost(host, wait);
          continue;
        }
        // The body counts toward the timeout too: a board that stalls mid-answer is retried like one that never answered.
        text = await response.text();
      } catch (error) {
        if (error instanceof IngestHttpError) throw error;
        if (signal?.aborted) throw abortError(signal);
        const problem = timeout.aborted
          ? `did not answer within ${Math.round(options.timeoutMs / 1000)} s`
          : `could not be reached: ${(error as Error).message}`;
        if (attempt < maxRetries) {
          holdHost(host, 2000 * (attempt + 1));
          continue;
        }
        throw new IngestHttpError(`${url} ${problem}.`, 0, url);
      }

      if (!response.ok && !allow.includes(response.status)) {
        throw new IngestHttpError(`${url} answered HTTP ${response.status}.`, response.status, url);
      }
      if (!text.trim()) return { status: response.status, data: null };
      try {
        return { status: response.status, data: parseJsonLenient(text) };
      } catch {
        if (!response.ok) return { status: response.status, data: null };
        throw new IngestHttpError(`${url} did not answer with JSON.`, response.status, url);
      }
    }
  }

  return { getJson };
}
