import { fileSizeRefusal } from '../../resume-editor/files';

/*
 * The upload dialog's queue, free of React: the files picked and how each one is doing, which go next (two at a time,
 * the most the server reads at once), and what each answer does to the queue. A busy server (429) pauses the whole
 * queue for the time it asks; a server that cannot be reached pauses it too, and after a few tries the queue stops.
 * `useUploadQueue` does the sending, one request per file (the server takes one file at a time).
 */

/** Files one upload takes; past this the rest are left out, with a warning. */
export const MAX_FILES_PER_UPLOAD = 50;
/** Requests in flight at once: the server's file reader works on two files at a time. */
export const UPLOAD_CONCURRENCY = 2;
/** "Server busy" answers one file may get before it fails. */
export const MAX_BUSY_TRIES = 4;
/** The wait when a busy answer names none (the file reader asks for 15 s). */
export const BUSY_RETRY_SECONDS = 15;
/** The longest a busy answer may hold the queue. */
export const MAX_RETRY_SECONDS = 120;
/** The waits after the server could not be reached; once more and the queue stops. */
export const OFFLINE_RETRY_SECONDS: readonly number[] = [10, 20];

export const NOT_A_RESUME_FILE = 'Only PDF and Word files can be uploaded.';

/** What the queue needs of a file (a browser `File` has it all). */
export interface QueueFile {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly lastModified: number;
}

export type RowStatus =
  | { kind: 'ready' }
  | { kind: 'uploading' }
  /** Sent again at `until`: the server was busy, or could not be reached. */
  | { kind: 'waiting'; until: number; reason: 'busy' | 'offline' }
  | { kind: 'done'; resumeId: string | null; label: string }
  /** `retryable`: sending the same file again may work (busy, unreachable, a server error); never for a refusal. */
  | { kind: 'failed'; message: string; retryable: boolean }
  /** Not sent: Stop was pressed, or the queue stopped. */
  | { kind: 'stopped' };

export interface UploadRow<F extends QueueFile = QueueFile> {
  /** The file's name, size and time: the same file picked twice is one row. */
  key: string;
  file: F;
  status: RowStatus;
  /** Busy answers so far for this file. */
  busyTries: number;
  /** Times the server could not be reached while this file was sent. */
  offlineTries: number;
  /**
   * The answer never arrived, or was a server error: the server may have kept the file, so the list is read again
   * before the file is sent again (no resume is made twice).
   */
  checkFirst: boolean;
}

export type HaltReason = 'stopped' | 'offline' | 'full' | 'signed_out';

export interface UploadQueue<F extends QueueFile = QueueFile> {
  rows: readonly UploadRow<F>[];
  /** 'idle' while files are picked; 'running' from Upload until nothing is left to send; then 'finished'. */
  phase: 'idle' | 'running' | 'finished';
  /** Nothing starts before this time (ms). */
  pausedUntil: number;
  pauseReason: 'busy' | 'offline' | null;
  /** Why the run stopped before every file was sent; `message` is the server's sentence when it gave one. */
  halt: { reason: HaltReason; message: string | null } | null;
  /** Counts the runs, so the end of each is reported once. */
  run: number;
}

export interface UploadFailure {
  /** HTTP status; 0 when the server never answered. */
  status: number;
  code?: string;
  message: string;
  retryAfterSeconds?: number;
  /** The server could not be reached (offline, stopped, or the proxy gave up). */
  unreachable?: boolean;
}

const RESUME_EXTENSION = /\.(pdf|docx?)$/i;
const RESUME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** A PDF or Word file by its extension or its type (a .doc goes too: the server explains why it cannot read one). */
export function isResumeFile(file: Pick<QueueFile, 'name' | 'type'>): boolean {
  return RESUME_EXTENSION.test(file.name.trim()) || RESUME_TYPES.has(file.type);
}

/** Why the browser will not send a file (not a PDF or Word file, too large), or null. */
export function browserRefusal(file: Pick<QueueFile, 'name' | 'type' | 'size'>): string | null {
  if (!isResumeFile(file)) return NOT_A_RESUME_FILE;
  return fileSizeRefusal(file);
}

export function fileKey(file: QueueFile): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

export function emptyQueue<F extends QueueFile = QueueFile>(): UploadQueue<F> {
  return { rows: [], phase: 'idle', pausedUntil: 0, pauseReason: null, halt: null, run: 0 };
}

/** Still part of the run: waiting to go, in flight, or waiting to go again. */
function isActive(row: UploadRow<QueueFile>): boolean {
  const kind = row.status.kind;
  return kind === 'ready' || kind === 'uploading' || kind === 'waiting';
}

/** Can be sent by the next Upload / Try again: never sent, stopped, or failed in a way that may pass next time. */
export function isSendable(row: UploadRow<QueueFile>): boolean {
  const { status } = row;
  return status.kind === 'ready' || status.kind === 'stopped' || (status.kind === 'failed' && status.retryable);
}

function withRow<F extends QueueFile>(queue: UploadQueue<F>, row: UploadRow<F>): UploadQueue<F> {
  return { ...queue, rows: queue.rows.map((item) => (item.key === row.key ? row : item)) };
}

/** Files changed after a run: back to picking, so the footer offers to upload what can still be sent. */
function reopened<F extends QueueFile>(queue: UploadQueue<F>): UploadQueue<F> {
  return queue.phase === 'finished' ? { ...queue, phase: 'idle', halt: null } : queue;
}

/** The run is over once nothing is left to send or in flight. */
function finished<F extends QueueFile>(queue: UploadQueue<F>): UploadQueue<F> {
  if (queue.phase !== 'running' || queue.rows.some(isActive)) return queue;
  return { ...queue, phase: 'finished', pausedUntil: 0, pauseReason: null };
}

/** Stops the run: files not sent yet become "Not uploaded"; files in flight finish. */
function halted<F extends QueueFile>(queue: UploadQueue<F>, reason: HaltReason, message: string | null): UploadQueue<F> {
  return {
    ...queue,
    halt: { reason, message },
    pausedUntil: 0,
    pauseReason: null,
    rows: queue.rows.map((row) =>
      row.status.kind === 'ready' || row.status.kind === 'waiting' ? { ...row, status: { kind: 'stopped' } } : row,
    ),
  };
}

function paused<F extends QueueFile>(queue: UploadQueue<F>, until: number, reason: 'busy' | 'offline'): UploadQueue<F> {
  return until > queue.pausedUntil ? { ...queue, pausedUntil: until, pauseReason: reason } : queue;
}

export interface AddOutcome<F extends QueueFile> {
  queue: UploadQueue<F>;
  added: number;
  /** The same file picked again: dropped without a word. */
  duplicates: number;
  /** Past MAX_FILES_PER_UPLOAD. */
  leftOut: number;
}

/**
 * Adds picked files in order. A file the browser will not send (not a PDF or Word file, too large) joins as a failed
 * row with the reason. Nothing is added while a run is under way.
 */
export function addFiles<F extends QueueFile>(
  queue: UploadQueue<F>,
  files: readonly F[],
  max: number = MAX_FILES_PER_UPLOAD,
): AddOutcome<F> {
  if (queue.phase === 'running') return { queue, added: 0, duplicates: 0, leftOut: 0 };
  const rows = [...queue.rows];
  const keys = new Set(rows.map((row) => row.key));
  let added = 0;
  let duplicates = 0;
  let leftOut = 0;
  for (const file of files) {
    const key = fileKey(file);
    if (keys.has(key)) {
      duplicates += 1;
      continue;
    }
    if (rows.length >= max) {
      leftOut += 1;
      continue;
    }
    keys.add(key);
    const refusal = browserRefusal(file);
    rows.push({
      key,
      file,
      status: refusal ? { kind: 'failed', message: refusal, retryable: false } : { kind: 'ready' },
      busyTries: 0,
      offlineTries: 0,
      checkFirst: false,
    });
    added += 1;
  }
  if (added === 0) return { queue, added, duplicates, leftOut };
  return { queue: reopened({ ...queue, rows }), added, duplicates, leftOut };
}

/** Removes a row (never one in flight). */
export function removeRow<F extends QueueFile>(queue: UploadQueue<F>, key: string): UploadQueue<F> {
  const row = queue.rows.find((item) => item.key === key);
  if (!row || row.status.kind === 'uploading') return queue;
  const next = { ...queue, rows: queue.rows.filter((item) => item.key !== key) };
  return queue.phase === 'running' ? finished(next) : reopened(next);
}

/** Upload / Try again: every row that can still be sent goes back in line, and the run starts. */
export function startRun<F extends QueueFile>(queue: UploadQueue<F>): UploadQueue<F> {
  if (queue.phase === 'running' || !queue.rows.some(isSendable)) return queue;
  return {
    ...queue,
    phase: 'running',
    run: queue.run + 1,
    halt: null,
    pausedUntil: 0,
    pauseReason: null,
    rows: queue.rows.map((row) =>
      isSendable(row) ? { ...row, status: { kind: 'ready' }, busyTries: 0, offlineTries: 0 } : row,
    ),
  };
}

/** Stop: nothing new starts; the files in flight finish. */
export function stopRun<F extends QueueFile>(queue: UploadQueue<F>): UploadQueue<F> {
  if (queue.phase !== 'running') return queue;
  return finished(halted(queue, 'stopped', null));
}

/** The rows to send now: none while paused or stopped, and never more than `limit` in flight. */
export function nextToStart<F extends QueueFile>(
  queue: UploadQueue<F>,
  now: number,
  limit: number = UPLOAD_CONCURRENCY,
): UploadRow<F>[] {
  if (queue.phase !== 'running' || queue.halt || queue.pausedUntil > now) return [];
  const free = limit - queue.rows.filter((row) => row.status.kind === 'uploading').length;
  if (free <= 0) return [];
  return queue.rows
    .filter((row) => row.status.kind === 'ready' || (row.status.kind === 'waiting' && row.status.until <= now))
    .slice(0, free);
}

export function markUploading<F extends QueueFile>(queue: UploadQueue<F>, key: string): UploadQueue<F> {
  const row = queue.rows.find((item) => item.key === key);
  return row ? withRow(queue, { ...row, status: { kind: 'uploading' } }) : queue;
}

export function markUploaded<F extends QueueFile>(
  queue: UploadQueue<F>,
  key: string,
  result: { resumeId: string | null; label: string },
): UploadQueue<F> {
  const row = queue.rows.find((item) => item.key === key);
  if (!row) return queue;
  return finished(withRow(queue, { ...row, checkFirst: false, status: { kind: 'done', ...result } }));
}

function retrySeconds(asked: number | undefined): number {
  const seconds = asked !== undefined && Number.isFinite(asked) && asked > 0 ? asked : BUSY_RETRY_SECONDS;
  return Math.min(Math.ceil(seconds), MAX_RETRY_SECONDS);
}

/**
 * What a failed request does:
 * - busy (429): the file waits the time the server asks and the whole queue pauses; the fourth busy answer fails it;
 * - unreachable: the same, 10 s then 20 s, and the list is read again before it is re-sent; the third time the queue
 *   stops;
 * - a server error (5xx): the file fails (Try again may send it) and the list is read first;
 * - signed out (401) or no room for more resumes (409): the file fails and the queue stops, the rest "Not uploaded";
 * - any other refusal: only that file fails.
 */
export function markFailed<F extends QueueFile>(
  queue: UploadQueue<F>,
  key: string,
  failure: UploadFailure,
  now: number,
): UploadQueue<F> {
  const row = queue.rows.find((item) => item.key === key);
  if (!row) return queue;
  const failed = (retryable: boolean, change: Partial<UploadRow<F>> = {}): UploadRow<F> => ({
    ...row,
    ...change,
    status: { kind: 'failed', message: failure.message, retryable },
  });

  const busy = failure.status === 429 || failure.code === 'rate_limited';
  const unreachable = !busy && (failure.unreachable === true || failure.status === 0);
  if ((busy || unreachable) && queue.halt) {
    // The run was stopped meanwhile: the file is not tried again.
    return finished(withRow(queue, { ...row, checkFirst: row.checkFirst || unreachable, status: { kind: 'stopped' } }));
  }
  if (busy) {
    const busyTries = row.busyTries + 1;
    if (busyTries >= MAX_BUSY_TRIES) return finished(withRow(queue, failed(true, { busyTries })));
    const until = now + retrySeconds(failure.retryAfterSeconds) * 1000;
    return paused(withRow(queue, { ...row, busyTries, status: { kind: 'waiting', until, reason: 'busy' } }), until, 'busy');
  }
  if (unreachable) {
    const offlineTries = row.offlineTries + 1;
    const wait = OFFLINE_RETRY_SECONDS[offlineTries - 1];
    if (wait === undefined) {
      return finished(halted(withRow(queue, failed(true, { offlineTries, checkFirst: true })), 'offline', failure.message));
    }
    const until = now + wait * 1000;
    return paused(
      withRow(queue, { ...row, offlineTries, checkFirst: true, status: { kind: 'waiting', until, reason: 'offline' } }),
      until,
      'offline',
    );
  }
  if (failure.status >= 500) return finished(withRow(queue, failed(true, { checkFirst: true })));
  if (failure.status === 401) return finished(halted(withRow(queue, failed(false)), 'signed_out', failure.message));
  if (failure.status === 409) return finished(halted(withRow(queue, failed(false)), 'full', failure.message));
  return finished(withRow(queue, failed(false)));
}

// ------------------------------------------------------------------------------------------------- counting

export interface QueueCounts {
  total: number;
  done: number;
  /** Ready, stopped, or failed in a way that may pass next time: what Upload / Try again would send. */
  sendable: number;
  uploading: number;
  waiting: number;
}

export function queueCounts(queue: UploadQueue<QueueFile>): QueueCounts {
  const counts: QueueCounts = { total: queue.rows.length, done: 0, sendable: 0, uploading: 0, waiting: 0 };
  for (const row of queue.rows) {
    if (row.status.kind === 'done') counts.done += 1;
    if (row.status.kind === 'uploading') counts.uploading += 1;
    if (row.status.kind === 'waiting') counts.waiting += 1;
    if (isSendable(row)) counts.sendable += 1;
  }
  return counts;
}

// ------------------------------------------------------------------------------------------------- the words

const files = (count: number) => (count === 1 ? 'file' : 'files');

export function secondsLeft(until: number, now: number): number {
  return Math.max(1, Math.ceil((until - now) / 1000));
}

/** A row's status: Ready, Uploading..., Server busy..., Uploaded, the error sentence, or Not uploaded. */
export function rowStatusText(row: UploadRow<QueueFile>, now: number): string {
  const { status } = row;
  switch (status.kind) {
    case 'ready':
      return 'Ready';
    case 'uploading':
      return 'Uploading...';
    case 'waiting':
      return status.reason === 'busy'
        ? `Server busy, trying again in ${secondsLeft(status.until, now)} s`
        : `No connection, trying again in ${secondsLeft(status.until, now)} s`;
    case 'done':
      return 'Uploaded';
    case 'failed':
      return status.message;
    case 'stopped':
      return 'Not uploaded';
  }
}

/** The line above the rows: "7 files ready to upload.", "3 of 7 uploaded...", "5 uploaded, 2 not uploaded." */
export function queueStatusText(queue: UploadQueue<QueueFile>, now: number): string {
  const counts = queueCounts(queue);
  if (counts.total === 0) return '';
  if (queue.phase === 'idle') {
    return counts.sendable > 0 ? `${counts.sendable} ${files(counts.sendable)} ready to upload.` : '';
  }
  if (queue.phase === 'running') {
    if (queue.halt?.reason === 'stopped') return 'Stopping. The files already being uploaded will finish.';
    // No countdown here (the line is announced; each waiting row counts down instead).
    if (queue.pausedUntil > now) {
      return queue.pauseReason === 'offline'
        ? "We can't reach the server. Trying again in a moment."
        : 'The server is busy. Trying again in a moment.';
    }
    return `${counts.done} of ${counts.total} uploaded...`;
  }
  if (counts.done === counts.total) return `${counts.total} of ${counts.total} uploaded.`;
  return `${counts.done} uploaded, ${counts.total - counts.done} not uploaded.`;
}

/** "Upload 7 files" / "Upload 1 file". */
export function uploadButtonText(count: number): string {
  return `Upload ${count} ${files(count)}`;
}

/** "Try again (2)". */
export function retryButtonText(count: number): string {
  return `Try again (${count})`;
}

/** The warning when more files were picked than one upload takes. */
export function leftOutText(leftOut: number, max: number = MAX_FILES_PER_UPLOAD): string {
  return `Up to ${max} files can be uploaded at a time, so ${leftOut} ${leftOut === 1 ? 'file was' : 'files were'} not added.`;
}

/** Why the run stopped early, for the notice above the rows; null when nothing needs saying (Stop pressed). */
export function haltText(halt: UploadQueue<QueueFile>['halt']): string | null {
  if (!halt || halt.reason === 'stopped') return null;
  if (halt.reason === 'offline') return "We can't reach the server right now, so the upload stopped. Try again in a moment.";
  return halt.message;
}

// ------------------------------------------------------------------------------------------------ the names

/** A file name as the server stores it: NFC, no control characters, single spaces, trimmed. */
export function tidyName(value: string): string {
  return value.normalize('NFC').replace(/\p{Cc}+/gu, '').replace(/\s+/g, ' ').trim();
}

/** The label the server gives an upload sent without a name: its file name without .pdf, .doc or .docx. */
export function labelFromFileName(name: string): string {
  return tidyName(name).replace(RESUME_EXTENSION, '').trim();
}

/**
 * After an answer that never arrived: the upload the server kept anyway, if any. It is an uploaded resume with the
 * expected label that was not in the list when the dialog opened (`known`) and is not one this dialog already counted
 * (`claimed`).
 */
export function findKeptUpload<T extends { id: string; kind: string; label: string }>(
  list: readonly T[],
  label: string,
  known: ReadonlySet<string>,
  claimed: ReadonlySet<string>,
): T | null {
  const wanted = tidyName(label);
  return (
    list.find(
      (item) => item.kind === 'uploaded' && !known.has(item.id) && !claimed.has(item.id) && tidyName(item.label) === wanted,
    ) ?? null
  );
}
