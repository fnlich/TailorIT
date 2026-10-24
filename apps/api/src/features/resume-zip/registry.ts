import { randomUUID } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { resumeZipFileName, type ResumeZipAccepted, type ResumeZipBody, type ResumeZipBuild } from '@tailorit/shared';
import type { AppDeps } from '../../core/context';
import { AppError, conflict } from '../../core/http/errors';
import { buildResumeZip, prepareResumeZip, RESUME_ZIP_MAX_BYTES, type ZipBuildOptions, type ZipCounts } from './build';

// The resume ZIP builds (work package WP11), kept in memory. POST starts one in the background and answers 202 at once
// (a build can take minutes; no request waits on it), the page polls its status, then downloads the file with a
// Content-Length. One build runs at a time on the server (429 for another account meanwhile) and one per account
// (409). A finished zip lives in its own folder under <DATA_DIR>/resume-zips/ until it is downloaded once, until it
// expires (`keepMs`), or until the server starts again (the registry does not outlive the process).

export interface ResumeZipOptions extends ZipBuildOptions {
  /** The whole build, from the choices to the last byte; past it the build is stopped. */
  deadlineMs: number;
  /** How long a ready zip (and a failed build's status) is kept. */
  keepMs: number;
  /** Retry-After of the 429 while another account's build runs. */
  busyRetrySeconds: number;
}

export const DEFAULT_RESUME_ZIP_OPTIONS: ResumeZipOptions = {
  maxBytes: RESUME_ZIP_MAX_BYTES,
  deadlineMs: 10 * 60_000,
  pdfReserveMs: 2 * 60_000,
  pdfWaitMs: 60_000,
  drainBudgetMs: 20_000,
  keepMs: 60 * 60_000,
  busyRetrySeconds: 15,
};

const BUSY_ACCOUNT = 'Your resumes are already being built. Wait for that download to finish, then try again.';
const NOT_AVAILABLE = 'That zip is no longer available. Build your resumes again.';
const STILL_BUILDING = 'Your resumes are still being built. Download them once they are ready.';
const NOT_MADE = 'That zip could not be made. Build your resumes again.';
const TOOK_TOO_LONG = 'Building your resumes took too long, so it was stopped. Select fewer applications and try again.';
const STOPPED = 'Building your resumes was stopped because the server is restarting. Please try again.';
const FAILED = "We couldn't build your resumes. Please try again.";
const RESTARTING = 'The server is restarting. Please try again in a moment.';

function busyServer(seconds: number): AppError {
  return new AppError(
    'rate_limited',
    `TailorIT is building another zip of resumes right now. Please try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
    { retryAfterSeconds: seconds },
  );
}

interface Build {
  id: string;
  userId: string;
  status: ResumeZipBuild['status'];
  done: number;
  total: number;
  counts: ZipCounts;
  fileName: string;
  error: { code: string; message: string } | null;
  /** When the status (and a ready file) is forgotten, in ms on the app's clock; null while building. */
  forgetAt: number | null;
  dir: string;
  file: string | null;
  size: number;
  /** Aborted by shutdown (the deadline is a separate timeout signal). */
  stop: AbortController;
  /** The background work; settles (never rejects) when the build is done. */
  work: Promise<void>;
  /** Downloads reading the file now: its folder is removed only once none does. */
  downloads: number;
  /** Out of the registry: downloaded, expired, replaced by a newer build, or shut down. */
  forgotten: boolean;
}

/** A ready zip handed to the router for one download. */
export interface ZipDownload {
  path: string;
  size: number;
  fileName: string;
  /** Call once when the response ends; `complete` when the whole file was sent (the zip is then removed). */
  finish(complete: boolean): void;
}

export interface ResumeZipService {
  /** <DATA_DIR>/resume-zips: one folder per build. */
  readonly root: string;
  /** POST: answers what it can from stored data (400/404/409/413/429), then builds in the background. */
  start(userId: string, body: ResumeZipBody): ResumeZipAccepted;
  /** GET: the build's progress (404 when it is not the account's, or no longer kept). */
  status(userId: string, buildId: string): ResumeZipBuild;
  /** GET …/file: the ready zip (404 when unknown or failed, 409 while building). */
  download(userId: string, buildId: string): ZipDownload;
  /** Forgets expired builds and removes their files. */
  sweep(): Promise<void>;
  /** Settles when the build's background work is done (tests). */
  settled(buildId: string): Promise<void>;
  /** At startup: removes what an earlier run left on disk (its builds went with it). */
  clearLeftovers(): void;
  /** At shutdown: stops the running builds and removes every zip. */
  stop(): Promise<void>;
}

declare module '../../core/context' {
  interface AppServices {
    /** The resume ZIP builds (work package WP11). */
    resumeZip?: ResumeZipService;
  }
}

/** The calendar day at an offset east of UTC: the zip is named after the person's date, not the server's. */
function localDay(now: Date, tzOffsetMinutes: number): string {
  return new Date(now.getTime() + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function createResumeZipService(deps: AppDeps, overrides: Partial<ResumeZipOptions> = {}): ResumeZipService {
  const options: ResumeZipOptions = { ...DEFAULT_RESUME_ZIP_OPTIONS, ...overrides };
  const root = join(deps.config.dataDir, 'resume-zips');
  const builds = new Map<string, Build>();
  let stopping = false;
  const clock = () => deps.now().getTime();

  /** Removes a build's folder, unless a download still reads it (that download's end does it). Idempotent. */
  async function removeFiles(build: Build): Promise<void> {
    if (build.downloads > 0) return;
    try {
      await rm(build.dir, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
      deps.log.warn(`[resume-zip] could not remove ${build.dir}`, error);
    }
  }

  /** Takes a build out of the registry (at once) and removes its files (once no download reads them). */
  function forget(build: Build): Promise<void> {
    build.forgotten = true;
    if (builds.get(build.id) === build) builds.delete(build.id);
    return removeFiles(build);
  }

  function ownBuild(userId: string, buildId: string): Build {
    const build = builds.get(buildId);
    // Another account's build is "no longer available" exactly like one that never existed.
    if (!build || build.userId !== userId || build.forgotten) throw new AppError('not_found', NOT_AVAILABLE);
    return build;
  }

  function failureOf(build: Build, signal: AbortSignal, error: unknown): { code: string; message: string } {
    if (build.stop.signal.aborted) return { code: 'internal', message: STOPPED };
    if (signal.aborted) return { code: 'internal', message: TOOK_TOO_LONG };
    if (error instanceof AppError) return { code: error.code, message: error.message };
    return { code: 'internal', message: FAILED };
  }

  async function run(build: Build, input: { applicationIds: string[]; leftOut: number; tzOffsetMinutes: number }) {
    const started = Date.now();
    const signal = AbortSignal.any([build.stop.signal, AbortSignal.timeout(options.deadlineMs)]);
    try {
      const result = await buildResumeZip(
        deps,
        {
          userId: build.userId,
          applicationIds: input.applicationIds,
          leftOut: input.leftOut,
          tzOffsetMinutes: input.tzOffsetMinutes,
          dir: build.dir,
          signal,
          deadlineAt: started + options.deadlineMs,
          progress: {
            setTotal: (total) => {
              build.total = total;
              build.done = Math.min(build.done, total);
            },
            advance: (count) => {
              build.done = Math.min(build.total, build.done + count);
            },
          },
        },
        options,
      );
      build.file = result.file;
      build.size = result.size;
      build.counts = result.counts;
      build.done = build.total;
      build.status = 'ready';
      const { counts } = result;
      deps.log.info(
        `[resume-zip] build ${build.id} for account ${build.userId}: ${counts.included} resumes (${counts.skipped} ` +
          `skipped, ${counts.word} Word files, ${counts.usedDefault} default) in ${((Date.now() - started) / 1000).toFixed(1)} s`,
      );
    } catch (error) {
      build.status = 'failed';
      build.error = failureOf(build, signal, error);
      if (error instanceof AppError && error.status < 500) {
        deps.log.info(`[resume-zip] build ${build.id} for account ${build.userId}: ${error.message}`);
      } else {
        deps.log.error(`[resume-zip] build ${build.id} for account ${build.userId} failed`, error);
      }
      await removeFiles(build);
    } finally {
      build.forgetAt = clock() + options.keepMs;
      // Forgotten while it ran (a shutdown, a newer build): nothing of it stays on disk.
      if (build.forgotten) await removeFiles(build);
    }
  }

  const service: ResumeZipService = {
    root,

    start(userId, body) {
      if (stopping) throw new AppError('internal', RESTARTING);
      void service.sweep();
      const all = [...builds.values()];
      if (all.some((build) => build.userId === userId && build.status === 'building')) throw conflict(BUSY_ACCOUNT);
      // Everything a person can fix is answered now, from stored data, before anything is read from disk.
      const scope = prepareResumeZip(deps.db, userId, body.ids, options.maxBytes);
      if (all.some((build) => build.status === 'building')) throw busyServer(options.busyRetrySeconds);
      // One zip per account: a new build replaces the last one, downloaded or not.
      for (const build of all) if (build.userId === userId) void forget(build);

      const id = randomUUID();
      const tzOffsetMinutes = body.tzOffsetMinutes ?? 0;
      const build: Build = {
        id,
        userId,
        status: 'building',
        done: 0,
        total: scope.applications.length,
        counts: { included: 0, skipped: 0, word: 0, leftOut: scope.leftOut, usedDefault: 0 },
        fileName: resumeZipFileName(localDay(deps.now(), tzOffsetMinutes)),
        error: null,
        forgetAt: null,
        dir: join(root, id),
        file: null,
        size: 0,
        stop: new AbortController(),
        work: Promise.resolve(),
        downloads: 0,
        forgotten: false,
      };
      builds.set(id, build);
      build.work = run(build, {
        applicationIds: scope.applications.map((application) => application.id),
        leftOut: scope.leftOut,
        tzOffsetMinutes,
      }).catch((error: unknown) => deps.log.error(`[resume-zip] build ${id} could not finish cleanly`, error));
      return { buildId: id };
    },

    status(userId, buildId) {
      const build = ownBuild(userId, buildId);
      return {
        buildId: build.id,
        status: build.status,
        done: build.done,
        total: build.total,
        counts: { ...build.counts },
        fileName: build.fileName,
        error: build.error,
        expiresAt: build.status === 'ready' && build.forgetAt !== null ? new Date(build.forgetAt).toISOString() : null,
      };
    },

    download(userId, buildId) {
      const build = ownBuild(userId, buildId);
      if (build.status === 'building') throw conflict(STILL_BUILDING);
      if (build.status === 'failed' || !build.file) throw new AppError('not_found', NOT_MADE);
      build.downloads += 1;
      let finished = false;
      return {
        path: build.file,
        size: build.size,
        fileName: build.fileName,
        finish(complete) {
          if (finished) return;
          finished = true;
          build.downloads -= 1;
          // Downloaded once: the zip goes. One forgotten meanwhile goes once no download reads it.
          if (complete || build.forgotten) void forget(build);
        },
      };
    },

    async sweep() {
      const now = clock();
      const expired = [...builds.values()].filter(
        (build) => build.status !== 'building' && build.forgetAt !== null && build.forgetAt <= now,
      );
      await Promise.all(expired.map(forget));
    },

    async settled(buildId) {
      await builds.get(buildId)?.work;
    },

    clearLeftovers() {
      let names: string[];
      try {
        names = readdirSync(root);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') deps.log.warn(`[resume-zip] could not read ${root}`, error);
        return;
      }
      for (const name of names) {
        if (builds.has(name)) continue;
        try {
          rmSync(join(root, name), { recursive: true, force: true, maxRetries: 3 });
        } catch (error) {
          deps.log.warn(`[resume-zip] could not remove ${join(root, name)}, left by an earlier run`, error);
        }
      }
    },

    async stop() {
      stopping = true;
      const running = [...builds.values()].filter((build) => build.status === 'building');
      for (const build of running) build.stop.abort(new Error('The server is shutting down.'));
      // A stopped build settles within moments (its renders and reads stop with the signal); never hang shutdown.
      await Promise.race([Promise.all(running.map((build) => build.work)), sleep(5_000, undefined, { ref: false })]);
      await Promise.all([...builds.values()].map(forget));
    },
  };
  return service;
}
