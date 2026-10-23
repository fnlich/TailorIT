import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFParse } from 'pdf-parse';
import { PNG } from 'pngjs';
import type { Browser } from 'puppeteer-core';
import {
  browserCandidates,
  createPdfService,
  defaultBrowserLookup,
  locateBrowser,
  MISSING_BROWSER_MESSAGE,
  Semaphore,
  type BrowserLocation,
} from '../src/core/pdf/index';
import { AppError } from '../src/core/http/errors';
import { createTestContext, type TestContext } from './helpers';

const FOUND: BrowserLocation = { executablePath: 'C:\\chrome.exe', source: 'installed', label: 'Google Chrome', exists: true };

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

describe('finding a browser', () => {
  const windowsEnv = {
    PROGRAMFILES: 'C:\\Program Files',
    'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\k\\AppData\\Local',
  };

  it('prefers Chrome, then per-user Chrome, then Edge on Windows', () => {
    expect(browserCandidates('win32', windowsEnv).map((c) => c.path)).toEqual([
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Users\\k\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]);
    const onlyEdge = locateBrowser({
      configuredPath: null,
      platform: 'win32',
      env: windowsEnv,
      isFile: (p) => p.endsWith('msedge.exe'),
    });
    expect(onlyEdge).toEqual({
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      source: 'installed',
      label: 'Microsoft Edge',
      exists: true,
    });
  });

  it('knows the usual macOS and Linux places', () => {
    expect(browserCandidates('darwin', { HOME: '/Users/k' })[0]!.path).toBe(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    );
    expect(browserCandidates('linux', {}).map((c) => c.path)).toContain('/usr/bin/google-chrome-stable');
  });

  it('honours CHROME_PATH even when it is wrong, and reports none when nothing is installed', () => {
    const configured = locateBrowser({ configuredPath: 'D:\\chrome.exe', platform: 'win32', env: {}, isFile: () => false });
    expect(configured).toMatchObject({ executablePath: 'D:\\chrome.exe', source: 'CHROME_PATH', exists: false });
    expect(locateBrowser({ configuredPath: null, platform: 'linux', env: {}, isFile: () => false })).toBeNull();
  });
});

describe('Semaphore', () => {
  it('lets `size` holders in and queues the rest in order', async () => {
    const slots = new Semaphore(2);
    await slots.acquire();
    await slots.acquire();
    const order: number[] = [];
    const third = slots.acquire().then(() => order.push(3));
    const fourth = slots.acquire().then(() => order.push(4));
    await Promise.resolve();
    expect(slots.waiting).toBe(2);
    slots.release();
    await third;
    expect(order).toEqual([3]);
    slots.release();
    await fourth;
    expect(order).toEqual([3, 4]);
    expect(slots.inUse).toBe(2);
    slots.release();
    slots.release();
    expect(slots.inUse).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------- the pool, faked --

class FakePage {
  closed = false;
  readonly settings: string[] = [];
  constructor(private readonly behaviour: { content?: () => Promise<void>; onOpen?: () => void }) {
    behaviour.onOpen?.();
  }
  setDefaultTimeout() {}
  setDefaultNavigationTimeout() {}
  async setJavaScriptEnabled(enabled: boolean) {
    this.settings.push(`js:${enabled}`);
  }
  async setRequestInterception(on: boolean) {
    this.settings.push(`intercept:${on}`);
  }
  on() {
    return this;
  }
  async setViewport() {}
  async emulateMediaType() {}
  async setContent() {
    await this.behaviour.content?.();
  }
  async pdf() {
    return new TextEncoder().encode('%PDF-fake');
  }
  async screenshot() {
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  }
  async close() {
    this.closed = true;
  }
}

class FakeBrowser extends EventEmitter {
  connected = true;
  readonly pages: FakePage[] = [];
  constructor(private readonly behaviour: ConstructorParameters<typeof FakePage>[0] = {}) {
    super();
  }
  async newPage() {
    const page = new FakePage(this.behaviour);
    this.pages.push(page);
    return page;
  }
  async close() {
    this.connected = false;
    this.emit('disconnected');
  }
  crash() {
    this.connected = false;
    this.emit('disconnected');
  }
}

function fakePool(options: {
  env?: Record<string, string>;
  locate?: () => BrowserLocation | null;
  behaviour?: ConstructorParameters<typeof FakePage>[0];
  launch?: () => Promise<FakeBrowser>;
}) {
  const ctx = createTestContext({ env: options.env });
  const browsers: FakeBrowser[] = [];
  const pool = createPdfService(ctx.deps, {
    locate: options.locate ?? (() => FOUND),
    launch: async () => {
      const browser = options.launch ? await options.launch() : new FakeBrowser(options.behaviour);
      browsers.push(browser);
      return browser as unknown as Browser;
    },
  });
  return { ctx, pool, browsers };
}

describe('PdfService (fake browser)', () => {
  it('starts the browser on first use, once, and locks every page down', async () => {
    const { ctx, pool, browsers } = fakePool({});
    expect(browsers).toHaveLength(0);
    const [a, b] = await Promise.all([pool.printPdf('<p>a</p>'), pool.screenshotPng('<p>b</p>', { width: 10, height: 10 })]);
    expect(a.toString()).toBe('%PDF-fake');
    expect(b[0]).toBe(0x89);
    expect(browsers).toHaveLength(1);
    expect(browsers[0]!.pages.map((p) => [p.settings, p.closed])).toEqual([
      [['js:false', 'intercept:true'], true],
      [['js:false', 'intercept:true'], true],
    ]);
    ctx.cleanup();
  });

  it('starts a new browser after the old one went away, and after close()', async () => {
    const { ctx, pool, browsers } = fakePool({});
    await pool.printPdf('x');
    browsers[0]!.crash();
    await pool.printPdf('x');
    expect(browsers).toHaveLength(2);
    await pool.close();
    expect(browsers[1]!.connected).toBe(false);
    await pool.printPdf('x');
    expect(browsers).toHaveLength(3);
    await pool.close();
    ctx.cleanup();
  });

  it('renders at most PDF_MAX_CONCURRENCY pages at once', async () => {
    let open = 0;
    let most = 0;
    const { ctx, pool } = fakePool({
      env: { PDF_MAX_CONCURRENCY: '2' },
      behaviour: {
        onOpen: () => {
          open += 1;
          most = Math.max(most, open);
        },
        content: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          open -= 1;
        },
      },
    });
    await Promise.all(Array.from({ length: 6 }, () => pool.printPdf('x')));
    expect(most).toBe(2);
    ctx.cleanup();
  });

  it('says what to install when there is no browser', async () => {
    const { ctx, pool } = fakePool({ locate: () => null });
    expect(pool.available()).toBe(false);
    expect(pool.executablePath()).toBeNull();
    const error = await rejection(pool.printPdf('x'));
    expect(error).toMatchObject({ code: 'browser_unavailable', status: 503, message: MISSING_BROWSER_MESSAGE });
    expect(MISSING_BROWSER_MESSAGE).toBe(
      'PDF export needs Google Chrome or Microsoft Edge. Install one, or set CHROME_PATH in .env.',
    );
    ctx.cleanup();
  });

  it('names a CHROME_PATH that points nowhere, and a browser that will not start', async () => {
    const wrong = fakePool({ locate: () => ({ ...FOUND, source: 'CHROME_PATH', exists: false }) });
    expect(wrong.pool.available()).toBe(false);
    expect((await rejection(wrong.pool.printPdf('x'))).message).toMatch(/^CHROME_PATH in \.env points to C:\\chrome\.exe/);
    wrong.ctx.cleanup();

    const broken = fakePool({ launch: async () => Promise.reject(new Error('spawn EACCES')) });
    const error = await rejection(broken.pool.printPdf('x'));
    expect(error.code).toBe('browser_unavailable');
    expect(error.message).toMatch(/^PDF export could not start Google Chrome\./);
    broken.ctx.cleanup();
  });

  it('turns render failures into render_failed and frees the slot', async () => {
    const { ctx, pool, browsers } = fakePool({
      env: { PDF_MAX_CONCURRENCY: '1' },
      behaviour: { content: async () => Promise.reject(new Error('Target closed')) },
    });
    for (let i = 0; i < 2; i += 1) {
      const error = await rejection(pool.printPdf('x'));
      expect(error).toMatchObject({ code: 'render_failed', status: 500 });
      expect(error.message).toBe('We could not render that document. Please try again.');
    }
    expect(browsers[0]!.pages.every((p) => p.closed)).toBe(true);
    ctx.cleanup();
  });

  it('stops a render that runs past PDF_RENDER_TIMEOUT_MS', async () => {
    const { ctx, pool, browsers } = fakePool({
      env: { PDF_RENDER_TIMEOUT_MS: '1000' },
      behaviour: { content: () => new Promise(() => undefined) },
    });
    const error = await rejection(pool.printPdf('x'));
    expect(error).toMatchObject({
      code: 'render_failed',
      message: 'The document took longer than 1 second to render, so it was stopped. Please try again.',
    });
    expect(browsers[0]!.pages[0]!.closed).toBe(true);
    ctx.cleanup();
  });
});

// ------------------------------------------------------------------------------------------- the pool, live --

const configuredChrome = process.env.CHROME_PATH?.trim() || null;
const chrome = locateBrowser(defaultBrowserLookup(configuredChrome));
const hasChrome = chrome?.exists === true;

describe.skipIf(!hasChrome)(`PdfService (${chrome?.label ?? 'no browser installed'})`, () => {
  let ctx: TestContext;
  let server: Server;
  let origin = '';
  const hits: string[] = [];

  beforeAll(async () => {
    ctx = createTestContext({ env: configuredChrome ? { CHROME_PATH: configuredChrome } : {} });
    server = createServer((req, res) => {
      hits.push(req.url ?? '');
      res.end('body{background:#f00}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await ctx?.deps.services.pdf?.close();
    ctx?.cleanup();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  async function pdfText(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }

  it('prints HTML to a PDF without running scripts or loading anything from the network', async () => {
    const pdf = ctx.deps.services.pdf!;
    expect(pdf.available()).toBe(true);
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="${origin}/style.css">
      <style>@import url("${origin}/import.css"); body { background-image: url("${origin}/bg.png"); }</style>
      <script src="${origin}/script.js"></script>
      </head><body>
      <h1>Hello TailorIT</h1>
      <img src="http://example.com/x.png"><img src="${origin}/img.png">
      <iframe src="${origin}/frame.html"></iframe>
      <script>document.body.innerHTML = '<h1>SCRIPT RAN</h1>'; fetch('${origin}/fetch');</script>
      </body></html>`;
    const buffer = await pdf.printPdf(html, { format: 'Letter', margin: { top: '0.5in', bottom: '0.5in' } });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const text = await pdfText(buffer);
    expect(text).toContain('Hello TailorIT');
    expect(text).not.toContain('SCRIPT RAN');
    expect(hits).toEqual([]);
  });

  it('screenshots HTML: data: images load, scripts do not run', async () => {
    const red = new PNG({ width: 1, height: 1 });
    red.data.set([255, 0, 0, 255]);
    const dataUrl = `data:image/png;base64,${PNG.sync.write(red).toString('base64')}`;
    const html = `<!doctype html><html><body style="margin:0;background:#fff">
      <img src="${dataUrl}" style="position:absolute;left:0;top:0;width:100px;height:100px">
      <div id="box" style="position:absolute;left:100px;top:0;width:100px;height:100px;background:#00ff00"></div>
      <script>document.getElementById('box').style.background = '#0000ff';</script>
      </body></html>`;
    const png = PNG.sync.read(await ctx.deps.services.pdf!.screenshotPng(html, { width: 200, height: 100 }));
    const pixel = (x: number, y: number) => Array.from(png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3));
    expect([png.width, png.height]).toEqual([200, 100]);
    expect(pixel(50, 50)).toEqual([255, 0, 0]);
    expect(pixel(150, 50)).toEqual([0, 255, 0]);
    expect(hits).toEqual([]);
  });

  it('renders several documents at once and starts again after close()', async () => {
    const pdf = ctx.deps.services.pdf!;
    const results = await Promise.all(
      ['one', 'two', 'three'].map((word) => pdf.printPdf(`<p>${word}</p>`, { preferCSSPageSize: true })),
    );
    for (const result of results) expect(result.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    await pdf.close();
    const again = await pdf.printPdf('<p>after close</p>');
    expect(await pdfText(again)).toContain('after close');
  });
});
