import { ERROR_CODES, type ErrorCode } from '@tailorit/shared/core';
import {
  RESUME_ZIP_MAX_APPLICATIONS,
  ResumeZipAcceptedSchema,
  ResumeZipBuildSchema,
  type ResumeZipAccepted,
  type ResumeZipBody,
  type ResumeZipBuild,
} from '@tailorit/shared/tracker';
import { ApiError, api } from '../../../lib/api';
import { downloadFrom } from '../../resume-editor/files';

/*
 * "Build resumes" in the browser (work package WP11). The server builds the zip in the background: POST answers
 * { buildId } at once, the page asks how far it is every second, then downloads the file and saves it under the
 * server's name ("TailorIT_Resumes_2026-10-24.zip"). One build at a time per tab, kept here (not in a component) so
 * the tracker shows it as running again after it was left and opened anew.
 */

export const RESUME_ZIP_PATH = '/api/applications/resume-zip';
/** How often a running build is asked about. */
export const ZIP_POLL_MS = 1_000;
/** Failed status reads in a row (the server unreachable or restarting) before the page gives up waiting. */
export const ZIP_POLL_FAILURES = 5;

/** The request: the selection (or null: every Saved application) and this browser's offset east of UTC. */
export function resumeZipBody(ids: readonly string[] | null, now: Date = new Date()): ResumeZipBody {
  // getTimezoneOffset is west of UTC (300 in New York in winter); `|| 0` turns UTC's -0 into 0.
  const tzOffsetMinutes = -now.getTimezoneOffset() || 0;
  return ids ? { ids: [...ids], tzOffsetMinutes } : { tzOffsetMinutes };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The waiting toast's title: "Building resumes for 12 applications..." */
export function buildingTitle(selected: number | null): string {
  return selected === null
    ? 'Building resumes for your Saved applications...'
    : `Building resumes for ${plural(selected, 'application', 'applications')}...`;
}

/** The waiting toast's line: how far the build is. */
export function buildingProgress(build: Pick<ResumeZipBuild, 'done' | 'total'> | null): string {
  const hint = 'PDFs take a few seconds each.';
  return build && build.total > 0 ? `${build.done} of ${build.total} ready. ${hint}` : hint;
}

/** The "Resumes ready" toast's text: what the zip holds, and what it does not. */
export function zipOutcomeText(build: Pick<ResumeZipBuild, 'counts' | 'fileName'>): string {
  const { included, usedDefault, word, skipped, leftOut } = build.counts;
  const parts = [`${plural(included, 'resume', 'resumes')} in ${build.fileName}.`];
  if (usedDefault > 0) {
    parts.push(`${plural(usedDefault, 'application has', 'applications have')} no resume linked and got your default resume.`);
  }
  if (word > 0) {
    parts.push(`${plural(word, 'built resume is a Word file', 'built resumes are Word files')}: PDFs could not be made.`);
  }
  if (skipped > 0) parts.push(`${plural(skipped, 'application has', 'applications have')} no resume: see SKIPPED.txt.`);
  if (leftOut > 0) {
    parts.push(
      `${plural(leftOut, 'more Saved application was', 'more Saved applications were')} left out: a zip holds ${RESUME_ZIP_MAX_APPLICATIONS}.`,
    );
  }
  return parts.join(' ');
}

// ----------------------------------------------------------------------------------------- the running build

/**
 * The build this tab waits for. `build` is the last status read (null before the first); it stays after the run ends,
 * so the waiting toast keeps its last line while it fades out.
 */
export interface ZipRunState {
  running: boolean;
  build: ResumeZipBuild | null;
}

export interface Store<T> {
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** For useSyncExternalStore: the tracker's buttons and the waiting toast's progress line read it. */
export const resumeZipRun = createStore<ZipRunState>({ running: false, build: null });

function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}

/** A build the server could not finish, as the error the page shows (the server's own sentence). */
export function failedBuildError(build: ResumeZipBuild): ApiError {
  const code = build.error?.code ?? 'internal';
  return new ApiError({
    status: 0,
    code: isErrorCode(code) ? code : 'internal',
    message: build.error?.message || "We couldn't build your resumes. Please try again.",
    path: `${RESUME_ZIP_PATH}/${build.buildId}`,
  });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** A status read that may be tried again: the server did not answer, or answered with a 5xx while restarting. */
function isPassing(error: unknown): boolean {
  return error instanceof ApiError && (error.isUnreachable || error.status >= 500);
}

export interface ZipRun {
  /** The Manage jobs selection, or null for every Saved application. */
  ids: readonly string[] | null;
  /** Each status the server reports while it builds. */
  onProgress?: (build: ResumeZipBuild) => void;
  signal?: AbortSignal;
  /** Tests: the wait between two status reads, and how the file is saved. */
  pollMs?: number;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  save?: (url: string, fallbackName: string) => Promise<void>;
}

/**
 * Builds the zip and saves it: POST, then the status every second until it is ready, then the file. Resolves to the
 * ready build (its counts are the summary). Throws an ApiError with the server's sentence when the build is refused
 * (400/404/409/413/429) or fails, or when the server stops answering.
 */
export async function buildResumeZip(run: ZipRun): Promise<ResumeZipBuild> {
  const { signal } = run;
  const wait = run.wait ?? delay;
  const pollMs = run.pollMs ?? ZIP_POLL_MS;
  const accepted = await api.post<ResumeZipAccepted>(RESUME_ZIP_PATH, resumeZipBody(run.ids), {
    schema: ResumeZipAcceptedSchema,
    signal,
  });
  const path = `${RESUME_ZIP_PATH}/${encodeURIComponent(accepted.buildId)}`;
  let failures = 0;
  for (;;) {
    signal?.throwIfAborted();
    let build: ResumeZipBuild;
    try {
      build = await api.get<ResumeZipBuild>(path, { schema: ResumeZipBuildSchema, signal });
      failures = 0;
    } catch (error) {
      failures += 1;
      if (!isPassing(error) || failures >= ZIP_POLL_FAILURES) throw error;
      await wait(pollMs, signal);
      continue;
    }
    run.onProgress?.(build);
    if (build.status === 'failed') throw failedBuildError(build);
    if (build.status === 'ready') {
      await (run.save ?? downloadFrom)(`${path}/file`, build.fileName);
      return build;
    }
    await wait(pollMs, signal);
  }
}
