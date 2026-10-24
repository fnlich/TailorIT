import puppeteer, { TimeoutError, type Browser, type HTTPRequest, type Page } from 'puppeteer-core';
import type { AppDeps } from '../context';
import { AppError } from '../http/errors';
import { defaultBrowserLookup, locateBrowser, MISSING_BROWSER_MESSAGE, type BrowserLocation } from './browser';

// PDF printing and PNG screenshots of HTML documents, through one shared headless Chrome. The browser starts on first
// use and again after it goes away; at most PDF_MAX_CONCURRENCY pages render at once. Every page runs with JavaScript
// off and the network shut (only data: URLs and about:blank load), so a document cannot run code or call out, even
// when it holds text a model or a user wrote.

export interface PdfMargin {
  top?: string | number;
  right?: string | number;
  bottom?: string | number;
  left?: string | number;
}

export interface PrintPdfOptions {
  /** Paper size when the document's own @page size is not preferred. Default A4. */
  format?: 'A4' | 'Letter';
  margin?: PdfMargin;
  /** Use the document's @page size instead of `format`. Default false. */
  preferCSSPageSize?: boolean;
  /** Print background colours and images. Default true (templates rely on them). */
  printBackground?: boolean;
  /**
   * Stops waiting for a free page, or the render itself, when it aborts: the promise rejects with the signal's reason
   * as it is (not wrapped), and the page and its slot are freed.
   */
  signal?: AbortSignal;
  /**
   * The longest to wait for a free page while every slot is busy. Past it the call gives up without rendering:
   * 429 `rate_limited` (with retryAfterSeconds). Default: wait as long as it takes.
   */
  waitMs?: number;
}

export interface ScreenshotOptions {
  /** Viewport in CSS pixels. */
  width: number;
  height: number;
  clip?: { x: number; y: number; width: number; height: number };
  /** Default 1. */
  deviceScaleFactor?: number;
  /** The whole document instead of the viewport (ignored with `clip`). */
  fullPage?: boolean;
  /** Which CSS media applies. Default screen; 'print' matches how the PDF lays out. */
  media?: 'print' | 'screen';
}

export interface PdfService {
  /** Prints HTML to a PDF. Throws 503 `browser_unavailable` or 500 `render_failed`. */
  printPdf(html: string, options?: PrintPdfOptions): Promise<Buffer>;
  /** Renders HTML and returns a PNG. Same errors as printPdf. */
  screenshotPng(html: string, options: ScreenshotOptions): Promise<Buffer>;
  /** Whether a browser is installed (or configured) to render with. Does not start it. */
  available(): boolean;
  executablePath(): string | null;
  /** Closes the browser; the next render starts a new one. */
  close(): Promise<void>;
}

declare module '../context' {
  interface AppServices {
    /** PDF and screenshot rendering (core/pdf, registered by features/files). */
    pdf?: PdfService;
  }
}

/** The render service, for features that need it (registered by the files feature at startup). */
export function getPdfService(deps: Pick<AppDeps, 'services'>): PdfService {
  const service = deps.services.pdf;
  if (!service) throw new AppError('internal', 'PDF rendering is not set up on this server.');
  return service;
}

export interface AcquireOptions {
  /** Gives up waiting when it aborts: rejects with the signal's reason, and no slot is taken. */
  signal?: AbortSignal;
  /** Gives up after this many ms without a free slot: rejects with SlotWaitTimeout, and no slot is taken. */
  timeoutMs?: number;
}

/** No slot came free within `AcquireOptions.timeoutMs`. */
export class SlotWaitTimeout extends Error {
  constructor(readonly waitedMs: number) {
    super(`No slot came free within ${waitedMs} ms.`);
    this.name = 'SlotWaitTimeout';
  }
}

/** A counting semaphore with a FIFO queue. A waiter that gives up leaves the queue, so it never holds a slot. */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly size: number) {}

  async acquire(options: AcquireOptions = {}): Promise<void> {
    const { signal, timeoutMs } = options;
    signal?.throwIfAborted();
    if (this.active < this.size) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      // Each of these runs only after the executor has defined them all.
      const settle = () => {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      // `release` hands the slot over by calling this; from then on the slot is the caller's.
      const granted = () => {
        settle();
        resolve();
      };
      const giveUp = (reason: unknown) => {
        const index = this.queue.indexOf(granted);
        if (index === -1) return; // already handed a slot
        this.queue.splice(index, 1);
        settle();
        reject(reason);
      };
      const onAbort = () => giveUp(signal?.reason);
      this.queue.push(granted);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => giveUp(new SlotWaitTimeout(timeoutMs)), Math.max(0, timeoutMs));
        timer.unref?.();
      }
    });
  }

  /** Hands the slot straight to the next waiter, or frees it. */
  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.active = Math.max(0, this.active - 1);
  }

  get inUse(): number {
    return this.active;
  }

  get waiting(): number {
    return this.queue.length;
  }
}

export type BrowserLauncher = (location: BrowserLocation, timeoutMs: number) => Promise<Browser>;

export interface PdfServiceOptions {
  /** Starts a browser (tests pass a fake). */
  launch?: BrowserLauncher;
  /** Finds the executable (tests pass a fixed answer). */
  locate?: () => BrowserLocation | null;
}

const launchChrome: BrowserLauncher = (location, timeoutMs) =>
  puppeteer.launch({
    executablePath: location.executablePath,
    headless: true,
    // DevTools over stdio pipes instead of a local port that any process on the machine could connect to.
    pipe: true,
    // Chrome's sandbox needs kernel features that containers and root lack on Linux; elsewhere it stays on.
    args: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    timeout: timeoutMs,
    // The API's own shutdown closes the browser (the files feature's stop); puppeteer still kills it on process exit.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });

class RenderTimeout extends Error {}

/**
 * Rejects when `ms` pass first, or with the signal's reason when it aborts first. A late failure of `work` is swallowed
 * rather than left unhandled.
 */
function withDeadline<T>(work: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  work.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    // Aborted already (say, while the browser was starting): no listener would ever hear it.
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    timer = setTimeout(() => reject(new RenderTimeout(`Rendering took longer than ${ms} ms.`)), ms);
    if (signal) {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  return Promise.race([work, deadline]).finally(() => {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  });
}

/** The wait limit of printPdf passed: every page stayed busy rendering for others. */
function busyError(waitedMs: number): AppError {
  const seconds = Math.max(1, Math.round(waitedMs / 1000));
  return new AppError(
    'rate_limited',
    `PDF export is busy right now (no page came free within ${seconds} second${seconds === 1 ? '' : 's'}). ` +
      'Please try again in a moment.',
    { retryAfterSeconds: 10 },
  );
}

/** How a render may be stopped: an abort signal, and a wait limit for a free page. */
interface RenderControl {
  signal?: AbortSignal;
  waitMs?: number;
}

function renderError(error: unknown, timeoutMs: number): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof RenderTimeout || error instanceof TimeoutError) {
    const seconds = Math.max(1, Math.round(timeoutMs / 1000));
    return new AppError(
      'render_failed',
      `The document took longer than ${seconds} second${seconds === 1 ? '' : 's'} to render, so it was stopped. ` +
        'Please try again.',
      { cause: error },
    );
  }
  return new AppError('render_failed', 'We could not render that document. Please try again.', { cause: error });
}

/** Scripts off; every request that is not a data: URL or about:blank is aborted before it leaves the browser. */
async function lockDown(page: Page, timeoutMs: number): Promise<void> {
  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(timeoutMs);
  await page.setJavaScriptEnabled(false);
  // The handler goes on before interception does, so no request can be held without one to answer it.
  page.on('request', (request: HTTPRequest) => {
    if (request.isInterceptResolutionHandled()) return;
    const url = request.url();
    const allowed = url.startsWith('data:') || url === 'about:blank';
    (allowed ? request.continue() : request.abort('blockedbyclient')).catch(() => undefined);
  });
  await page.setRequestInterception(true);
}

export function createPdfService(deps: AppDeps, options: PdfServiceOptions = {}): PdfService {
  const { pdfTimeoutMs: timeoutMs, pdfMaxConcurrency, chromePath } = deps.config.render;
  const locate = options.locate ?? (() => locateBrowser(defaultBrowserLookup(chromePath)));
  const launch = options.launch ?? launchChrome;
  const slots = new Semaphore(pdfMaxConcurrency);
  let browser: Browser | null = null;
  let launching: Promise<Browser> | null = null;

  async function startBrowser(): Promise<Browser> {
    const location = locate();
    if (!location) throw new AppError('browser_unavailable', MISSING_BROWSER_MESSAGE);
    if (!location.exists) {
      throw new AppError(
        'browser_unavailable',
        `CHROME_PATH in .env points to ${location.executablePath}, but there is no browser there. ` +
          'Fix the path, or clear it to use an installed Chrome or Edge.',
      );
    }
    let started: Browser;
    try {
      started = await launch(location, timeoutMs);
    } catch (error) {
      throw new AppError(
        'browser_unavailable',
        `PDF export could not start ${location.label}. Please try again, or set CHROME_PATH in .env to a working ` +
          'Chrome or Edge.',
        { cause: error },
      );
    }
    browser = started;
    // A crashed or closed browser is replaced on the next render.
    started.once('disconnected', () => {
      if (browser === started) browser = null;
    });
    deps.log.info(`[pdf] started ${location.label} (${location.executablePath})`);
    return started;
  }

  function getBrowser(): Promise<Browser> {
    if (browser?.connected) return Promise.resolve(browser);
    launching ??= startBrowser().finally(() => {
      launching = null;
    });
    return launching;
  }

  async function withPage<T>(work: (page: Page) => Promise<T>, control: RenderControl = {}): Promise<T> {
    const { signal, waitMs } = control;
    try {
      await slots.acquire({ signal, timeoutMs: waitMs });
    } catch (error) {
      if (error instanceof SlotWaitTimeout) throw busyError(error.waitedMs);
      throw error;
    }
    const opened: { page?: Page; abandoned?: boolean } = {};
    try {
      signal?.throwIfAborted();
      // Starting the browser has its own timeout (and its own error); the deadline covers the render itself.
      const current = await getBrowser();
      const job = (async () => {
        const page = await current.newPage();
        if (opened.abandoned) {
          await page.close().catch(() => undefined);
          throw new RenderTimeout('Rendering was abandoned.');
        }
        opened.page = page;
        await lockDown(page, timeoutMs);
        return work(page);
      })();
      return await withDeadline(job, timeoutMs, signal);
    } catch (error) {
      // A stop asked for by the caller is passed on as it is, so the caller can tell it from a failed render.
      if (signal?.aborted && error === signal.reason) throw error;
      throw renderError(error, timeoutMs);
    } finally {
      opened.abandoned = true;
      await opened.page?.close().catch(() => undefined);
      slots.release();
    }
  }

  return {
    printPdf(html, printOptions = {}) {
      return withPage(
        async (page) => {
          await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
          const pdf = await page.pdf({
            format: printOptions.format ?? 'A4',
            margin: printOptions.margin,
            preferCSSPageSize: printOptions.preferCSSPageSize ?? false,
            printBackground: printOptions.printBackground ?? true,
            timeout: timeoutMs,
          });
          return Buffer.from(pdf);
        },
        { signal: printOptions.signal, waitMs: printOptions.waitMs },
      );
    },

    screenshotPng(html, shot) {
      return withPage(async (page) => {
        await page.setViewport({
          width: Math.max(1, Math.round(shot.width)),
          height: Math.max(1, Math.round(shot.height)),
          deviceScaleFactor: shot.deviceScaleFactor ?? 1,
        });
        if (shot.media) await page.emulateMediaType(shot.media);
        await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
        const png = await page.screenshot({
          type: 'png',
          ...(shot.clip ? { clip: shot.clip } : { fullPage: shot.fullPage ?? false }),
        });
        return Buffer.from(png);
      });
    },

    available() {
      return locate()?.exists ?? false;
    },

    executablePath() {
      return locate()?.executablePath ?? null;
    },

    async close() {
      if (launching) await launching.catch(() => undefined);
      const current = browser;
      browser = null;
      if (!current) return;
      try {
        await current.close();
      } catch (error) {
        deps.log.warn('[pdf] the browser did not close cleanly', error);
      }
    },
  };
}
