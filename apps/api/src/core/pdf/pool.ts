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

/** A counting semaphore with a FIFO queue. */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly size: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.size) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
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

/** Rejects when `ms` pass first. A late failure of `work` is swallowed rather than left unhandled. */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  work.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new RenderTimeout(`Rendering took longer than ${ms} ms.`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
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

  async function withPage<T>(work: (page: Page) => Promise<T>): Promise<T> {
    await slots.acquire();
    const opened: { page?: Page; abandoned?: boolean } = {};
    try {
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
      return await withDeadline(job, timeoutMs);
    } catch (error) {
      throw renderError(error, timeoutMs);
    } finally {
      opened.abandoned = true;
      await opened.page?.close().catch(() => undefined);
      slots.release();
    }
  }

  return {
    printPdf(html, printOptions = {}) {
      return withPage(async (page) => {
        await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
        const pdf = await page.pdf({
          format: printOptions.format ?? 'A4',
          margin: printOptions.margin,
          preferCSSPageSize: printOptions.preferCSSPageSize ?? false,
          printBackground: printOptions.printBackground ?? true,
          timeout: timeoutMs,
        });
        return Buffer.from(pdf);
      });
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
