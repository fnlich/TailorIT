import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResumeZipBuild } from '@tailorit/shared/tracker';
import { ApiError } from '../../../lib/api';
import {
  buildingProgress,
  buildingTitle,
  buildResumeZip,
  createStore,
  failedBuildError,
  resumeZipBody,
  zipOutcomeText,
  ZIP_POLL_FAILURES,
} from './resumeZip';

afterEach(() => {
  vi.unstubAllGlobals();
});

const at = (offset: number) => ({ getTimezoneOffset: () => offset }) as Date;

function build(patch: Partial<ResumeZipBuild> = {}): ResumeZipBuild {
  return {
    buildId: 'b1',
    status: 'building',
    done: 0,
    total: 3,
    counts: { included: 0, skipped: 0, word: 0, leftOut: 0, usedDefault: 0 },
    fileName: 'TailorIT_Resumes_2026-10-24.zip',
    error: null,
    expiresAt: null,
    ...patch,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A fetch answering each call with the next response; it records what was asked. */
function fetchSequence(...responses: Array<Response | Error>) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = responses.shift();
    if (!next) throw new Error(`no response left for ${url}`);
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal('fetch', fetch);
  return calls;
}

describe('the request', () => {
  it("sends the selection, or none for every Saved application, with the browser's offset east of UTC", () => {
    expect(resumeZipBody(['a', 'b'], at(300))).toEqual({ ids: ['a', 'b'], tzOffsetMinutes: -300 });
    expect(resumeZipBody(null, at(-330))).toEqual({ tzOffsetMinutes: 330 });
    expect(Object.is(resumeZipBody(null, at(0)).tzOffsetMinutes, 0)).toBe(true);
  });
});

describe('the toasts', () => {
  it('say what is being built and how far it is', () => {
    expect(buildingTitle(null)).toBe('Building resumes for your Saved applications...');
    expect(buildingTitle(1)).toBe('Building resumes for 1 application...');
    expect(buildingTitle(12)).toBe('Building resumes for 12 applications...');
    expect(buildingProgress(null)).toBe('PDFs take a few seconds each.');
    expect(buildingProgress({ done: 4, total: 14 })).toBe('4 of 14 ready. PDFs take a few seconds each.');
  });

  it('sum up what the zip holds and what it does not', () => {
    expect(zipOutcomeText(build({ counts: { included: 1, skipped: 0, word: 0, leftOut: 0, usedDefault: 0 } }))).toBe(
      '1 resume in TailorIT_Resumes_2026-10-24.zip.',
    );
    expect(zipOutcomeText(build({ counts: { included: 12, skipped: 2, word: 1, leftOut: 312, usedDefault: 3 } }))).toBe(
      '12 resumes in TailorIT_Resumes_2026-10-24.zip. 3 applications have no resume linked and got your default resume. ' +
        '1 built resume is a Word file: PDFs could not be made. 2 applications have no resume: see SKIPPED.txt. ' +
        '312 more Saved applications were left out: a zip holds 500.',
    );
    const singular = zipOutcomeText(build({ counts: { included: 2, skipped: 1, word: 2, leftOut: 1, usedDefault: 1 } }));
    expect(singular).toContain('1 application has no resume linked');
    expect(singular).toContain('2 built resumes are Word files');
    expect(singular).toContain('1 application has no resume: see SKIPPED.txt.');
    expect(singular).toContain('1 more Saved application was left out');
  });

  it('never use dashes as punctuation', () => {
    const copy = [
      buildingTitle(null),
      buildingTitle(3),
      buildingProgress({ done: 1, total: 2 }),
      zipOutcomeText(build({ counts: { included: 2, skipped: 1, word: 1, leftOut: 1, usedDefault: 1 } })),
    ].join('\n');
    expect(copy).not.toMatch(/[–—]/);
  });
});

describe('building and downloading', () => {
  it('posts, reads the status until it is ready (through a restart), then saves the file', async () => {
    const calls = fetchSequence(
      json(202, { buildId: 'b1' }),
      json(200, build({ done: 1 })),
      new TypeError('fetch failed'),
      json(502, {}),
      json(200, build({ status: 'ready', done: 3, counts: { included: 3, skipped: 0, word: 0, leftOut: 0, usedDefault: 0 } })),
    );
    const progress: number[] = [];
    const waits: number[] = [];
    const save = vi.fn(async () => undefined);
    const ready = await buildResumeZip({
      ids: ['x', 'y', 'z'],
      onProgress: (status) => progress.push(status.done),
      pollMs: 250,
      wait: async (ms) => {
        waits.push(ms);
      },
      save,
    });
    expect(ready.status).toBe('ready');
    expect(calls[0]).toMatchObject({ url: '/api/applications/resume-zip', method: 'POST' });
    expect(calls[0]!.body).toMatchObject({ ids: ['x', 'y', 'z'] });
    expect(typeof (calls[0]!.body as { tzOffsetMinutes: unknown }).tzOffsetMinutes).toBe('number');
    expect(calls.slice(1).map((call) => `${call.method} ${call.url}`)).toEqual(Array(4).fill('GET /api/applications/resume-zip/b1'));
    expect(progress).toEqual([1, 3]);
    expect(waits).toEqual([250, 250, 250]);
    expect(save).toHaveBeenCalledWith('/api/applications/resume-zip/b1/file', 'TailorIT_Resumes_2026-10-24.zip');
  });

  it("stops with the server's sentence when the build is refused or fails", async () => {
    fetchSequence(json(409, { error: { code: 'conflict', message: 'Your resumes are already being built.' } }));
    const refused = buildResumeZip({ ids: null, save: async () => undefined });
    await expect(refused).rejects.toBeInstanceOf(ApiError);
    await expect(refused).rejects.toMatchObject({ code: 'conflict', message: 'Your resumes are already being built.' });

    const save = vi.fn(async () => undefined);
    fetchSequence(
      json(202, { buildId: 'b1' }),
      json(200, build({ status: 'failed', error: { code: 'not_found', message: 'The resume files for these applications are missing.' } })),
    );
    await expect(buildResumeZip({ ids: null, wait: async () => undefined, save })).rejects.toMatchObject({
      code: 'not_found',
      message: 'The resume files for these applications are missing.',
    });
    expect(save).not.toHaveBeenCalled();

    fetchSequence(json(202, { buildId: 'b1' }), json(404, { error: { code: 'not_found', message: 'That zip is no longer available.' } }));
    await expect(buildResumeZip({ ids: null, wait: async () => undefined, save })).rejects.toMatchObject({
      message: 'That zip is no longer available.',
    });
  });

  it('gives up after the server stops answering several times in a row, and on an abort', async () => {
    const failures = Array.from({ length: ZIP_POLL_FAILURES }, () => new TypeError('fetch failed'));
    fetchSequence(json(202, { buildId: 'b1' }), ...failures);
    await expect(buildResumeZip({ ids: null, wait: async () => undefined, save: async () => undefined })).rejects.toMatchObject({
      status: 0,
    });

    // Stopped while it waits between two status reads.
    const stop = new AbortController();
    fetchSequence(json(202, { buildId: 'b1' }), json(200, build()));
    let waitingStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      waitingStarted = resolve;
    });
    const waiting = buildResumeZip({
      ids: null,
      signal: stop.signal,
      wait: (_ms, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
          waitingStarted();
        }),
      save: async () => undefined,
    });
    await started;
    stop.abort(new Error('left the page'));
    await expect(waiting).rejects.toThrow('left the page');

    // Stopped before it asks again (a fetch that ignores the signal still answers).
    const early = new AbortController();
    fetchSequence(json(202, { buildId: 'b1' }), json(200, build()), json(200, build()));
    const stopped = buildResumeZip({ ids: null, signal: early.signal, wait: async () => early.abort(new Error('gone')) });
    await expect(stopped).rejects.toThrow('gone');
  });

  it('turns an unknown error code into internal, and keeps a store of the running build', () => {
    expect(failedBuildError(build({ status: 'failed', error: { code: 'weird', message: 'Odd.' } }))).toMatchObject({
      code: 'internal',
      message: 'Odd.',
    });
    const store = createStore<number | null>(null);
    const seen: Array<number | null> = [];
    const unsubscribe = store.subscribe(() => seen.push(store.get()));
    store.set(1);
    store.set(null);
    unsubscribe();
    store.set(2);
    expect(seen).toEqual([1, null]);
  });
});
