'use client';

import type { ResumeSummary } from '@tailorit/shared/resume';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError } from '../../../lib/api';
import {
  addFiles,
  emptyQueue,
  findKeptUpload,
  labelFromFileName,
  markFailed,
  markUploaded,
  markUploading,
  nextToStart,
  queueCounts,
  removeRow,
  startRun,
  stopRun,
  type AddOutcome,
  type UploadFailure,
  type UploadQueue,
  type UploadRow,
} from './uploadQueue';

/** One stored upload, as the Resumes tab takes it in. */
export interface UploadedResume {
  id: string | null;
  label: string;
  /** The stored upload as the list shows it. */
  summary: ResumeSummary | null;
  /** The AI import when "Make an editable copy with AI" was ticked and it started. */
  taskId: string | null;
  /** Why the editable copy asked for could not start; the upload is kept either way. */
  copyError: string | null;
}

/**
 * How a run sends its files: one file as before (its name and the editable copy as chosen), or several (each named
 * after its file by the server, never an AI copy).
 */
export type SendOptions = { mode: 'single'; title: string; parse: boolean } | { mode: 'multi' };

/** POST /api/resumes/upload's answer as `uploadResume` reads it. */
export interface UploadAnswer {
  resume: ResumeSummary | null;
  taskId: string | null;
  copyError: string | null;
}

/** The end of a run (Upload or Try again), reported once. */
export interface RunOutcome {
  mode: SendOptions['mode'];
  /** Stored in this run, in the order they finished. */
  uploaded: UploadedResume[];
  /** Rows in the dialog that are not uploaded (failed, refused or stopped). */
  notUploaded: number;
  /** Every file in the dialog is uploaded. */
  allDone: boolean;
}

export interface UploadQueueHandlers {
  send: (file: File, options: SendOptions) => Promise<UploadAnswer>;
  /** The account's resumes now, to find a file the server kept although its answer never arrived. */
  list: () => Promise<readonly ResumeSummary[]>;
  /** The resume ids the list held when the first run started, or null when unknown. */
  knownIds: () => ReadonlySet<string> | null;
  onUploaded: (result: UploadedResume) => void;
  onRunEnd: (outcome: RunOutcome) => void;
}

export interface QueueView {
  queue: UploadQueue<File>;
  /** When the view was taken (ms): "trying again in 12 s" counts down with it. */
  now: number;
}

const UNEXPECTED = 'Upload failed. Please try again.';

function failureOf(error: unknown): UploadFailure {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message || UNEXPECTED,
      retryAfterSeconds: error.retryAfterSeconds,
      unreachable: error.isUnreachable,
    };
  }
  // A failure in this page, not an answer: it may pass on a second try.
  return { status: 500, message: UNEXPECTED };
}

/**
 * Sends the queue's files, two at a time, outside React: the queue lives here and React reads it as an external store
 * (no effect starts an upload, so a re-render or StrictMode's second mount never sends a file twice). A pause wakes
 * itself up; a one-second tick drives the countdown while a file waits. Exported for its tests; pages use the hook.
 */
export class UploadRunner {
  private queue: UploadQueue<File> = emptyQueue<File>();
  private view: QueueView = { queue: this.queue, now: 0 };
  private readonly listeners = new Set<() => void>();
  private handlers: UploadQueueHandlers | null = null;
  private options: SendOptions = { mode: 'multi' };
  /** Rows with a request out: a row is never sent twice at once. */
  private readonly inFlight = new Set<string>();
  /** The list's ids when the first run started (undefined until then; null when unknown). */
  private known: ReadonlySet<string> | null | undefined = undefined;
  /** Resume ids this dialog has counted as its own uploads. */
  private readonly claimed = new Set<string>();
  private uploaded: UploadedResume[] = [];
  private reportedRun = 0;
  private wake: ReturnType<typeof setTimeout> | undefined;
  private ticker: ReturnType<typeof setInterval> | undefined;
  private attached = false;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): QueueView => this.view;

  readonly setHandlers = (handlers: UploadQueueHandlers): void => {
    this.handlers = handlers;
  };

  readonly attach = (): void => {
    this.attached = true;
    this.pump();
  };

  /** Unmounted: timers stop and nothing new starts (requests in flight still finish and are reported). */
  readonly detach = (): void => {
    this.attached = false;
    clearTimeout(this.wake);
    this.wake = undefined;
    this.syncTicker();
  };

  readonly add = (files: readonly File[]): AddOutcome<File> => {
    const outcome = addFiles(this.queue, files);
    this.commit(outcome.queue);
    return outcome;
  };

  readonly remove = (key: string): void => {
    this.commit(removeRow(this.queue, key));
    this.pump();
  };

  /** Upload / Try again. */
  readonly start = (options: SendOptions): void => {
    const next = startRun(this.queue);
    if (next === this.queue) return;
    this.options = options;
    this.uploaded = [];
    if (this.known === undefined) this.known = this.handlers?.knownIds() ?? null;
    this.commit(next);
    this.pump();
  };

  readonly stop = (): void => {
    this.commit(stopRun(this.queue));
    this.pump();
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private commit(queue: UploadQueue<File>): void {
    if (queue === this.queue) return;
    this.queue = queue;
    this.view = { queue, now: Date.now() };
    this.emit();
    this.reportIfFinished();
  }

  /** Starts what may start now, and wakes up when a pause ends. */
  private pump(): void {
    clearTimeout(this.wake);
    this.wake = undefined;
    if (!this.attached) return;
    const now = Date.now();
    for (const row of nextToStart(this.queue, now)) {
      if (!this.inFlight.has(row.key)) void this.launch(row);
    }
    const { queue } = this;
    if (queue.phase === 'running' && queue.pausedUntil > now) {
      this.wake = setTimeout(() => this.pump(), queue.pausedUntil - now + 25);
    }
    this.syncTicker();
  }

  private syncTicker(): void {
    const counting = this.attached && this.queue.phase === 'running' && this.queue.rows.some((row) => row.status.kind === 'waiting');
    if (counting && this.ticker === undefined) {
      this.ticker = setInterval(() => {
        this.view = { queue: this.queue, now: Date.now() };
        this.emit();
      }, 1000);
    } else if (!counting && this.ticker !== undefined) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  private async launch(row: UploadRow<File>): Promise<void> {
    const handlers = this.handlers;
    if (!handlers) return;
    this.inFlight.add(row.key);
    this.commit(markUploading(this.queue, row.key));
    try {
      const result = (row.checkFirst ? await this.findKept(row, handlers) : null) ?? (await this.send(row, handlers));
      this.uploaded.push(result);
      try {
        handlers.onUploaded(result);
      } catch (error) {
        console.error('[uploads] could not show an upload', error);
      }
      this.commit(markUploaded(this.queue, row.key, { resumeId: result.id, label: result.label }));
    } catch (error) {
      this.commit(markFailed(this.queue, row.key, failureOf(error), Date.now()));
    } finally {
      this.inFlight.delete(row.key);
      this.pump();
    }
  }

  /** The label the server gives this file: the name typed (one file), else the file's own name. */
  private expectedLabel(row: UploadRow<File>): string {
    return this.options.mode === 'single' && this.options.title.trim()
      ? this.options.title.trim().slice(0, 120)
      : labelFromFileName(row.file.name);
  }

  private async send(row: UploadRow<File>, handlers: UploadQueueHandlers): Promise<UploadedResume> {
    const answer = await handlers.send(row.file, this.options);
    if (answer.resume) this.claimed.add(answer.resume.id);
    return {
      id: answer.resume?.id ?? null,
      label: answer.resume?.label ?? this.expectedLabel(row),
      summary: answer.resume,
      taskId: answer.taskId,
      copyError: answer.copyError,
    };
  }

  /** Before sending again a file whose answer never arrived: the upload the server kept anyway, if any. */
  private async findKept(row: UploadRow<File>, handlers: UploadQueueHandlers): Promise<UploadedResume | null> {
    if (!this.known) return null;
    const kept = findKeptUpload(await handlers.list(), this.expectedLabel(row), this.known, this.claimed);
    if (!kept) return null;
    this.claimed.add(kept.id);
    return { id: kept.id, label: kept.label, summary: kept, taskId: null, copyError: null };
  }

  private reportIfFinished(): void {
    const { queue } = this;
    if (queue.phase !== 'finished' || queue.run === this.reportedRun) return;
    this.reportedRun = queue.run;
    const counts = queueCounts(queue);
    const outcome: RunOutcome = {
      mode: this.options.mode,
      uploaded: this.uploaded,
      notUploaded: counts.total - counts.done,
      allDone: counts.done === counts.total,
    };
    this.uploaded = [];
    try {
      this.handlers?.onRunEnd(outcome);
    } catch (error) {
      console.error('[uploads] could not report the end of an upload', error);
    }
  }
}

/**
 * The upload dialog's queue: `queue` to draw, `add` / `remove` files, `start` (Upload, Try again) and `stop`. Files go
 * two at a time; see uploadQueue.ts for pauses, retries and stops. The handlers may change on every render.
 */
export function useUploadQueue(handlers: UploadQueueHandlers): QueueView & {
  add: UploadRunner['add'];
  remove: UploadRunner['remove'];
  start: UploadRunner['start'];
  stop: UploadRunner['stop'];
} {
  const [runner] = useState(() => new UploadRunner());
  useEffect(() => {
    runner.setHandlers(handlers);
  });
  useEffect(() => {
    runner.attach();
    return runner.detach;
  }, [runner]);
  const view = useSyncExternalStore(runner.subscribe, runner.getSnapshot, runner.getSnapshot);
  return { ...view, add: runner.add, remove: runner.remove, start: runner.start, stop: runner.stop };
}
