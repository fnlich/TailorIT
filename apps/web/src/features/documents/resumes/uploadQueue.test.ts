import type { ResumeSummary } from '@tailorit/shared/resume';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, UNREACHABLE_MESSAGE } from '../../../lib/api';
import { copyChoiceFixed } from './copies';
import {
  MAX_BUSY_TRIES,
  NOT_A_RESUME_FILE,
  addFiles,
  emptyQueue,
  findKeptUpload,
  haltText,
  labelFromFileName,
  leftOutText,
  markFailed,
  markUploaded,
  markUploading,
  nextToStart,
  queueCounts,
  queueStatusText,
  removeRow,
  retryButtonText,
  rowStatusText,
  startRun,
  stopRun,
  uploadButtonText,
  type QueueFile,
  type UploadQueue,
} from './uploadQueue';
import { UploadRunner, type RunOutcome, type SendOptions, type UploadAnswer, type UploadedResume } from './useUploadQueue';

const T0 = Date.parse('2026-10-24T12:00:00.000Z');

function file(name: string, patch: Partial<QueueFile> = {}): QueueFile {
  return { name, size: 120_000, type: name.endsWith('.pdf') ? 'application/pdf' : '', lastModified: 1, ...patch };
}

function queueOf(...names: string[]): UploadQueue {
  return addFiles(emptyQueue(), names.map((name) => file(name))).queue;
}

const keyOf = (queue: UploadQueue, name: string) => queue.rows.find((row) => row.file.name === name)!.key;
const statusOf = (queue: UploadQueue, name: string) => queue.rows.find((row) => row.file.name === name)!.status;

/** Marks every row nextToStart offers as sent; returns their names. */
function sendNext(queue: UploadQueue, now = T0): { queue: UploadQueue; sent: string[] } {
  const rows = nextToStart(queue, now);
  let next = queue;
  for (const row of rows) next = markUploading(next, row.key);
  return { queue: next, sent: rows.map((row) => row.file.name) };
}

const busy = { status: 429, code: 'rate_limited', message: 'The server is busy reading other files.', retryAfterSeconds: 12 };
const offline = { status: 0, code: 'internal', message: UNREACHABLE_MESSAGE, unreachable: true };

describe('picking files', () => {
  it('drops the same file picked twice, refuses what cannot be sent, and caps the batch', () => {
    const { queue, added, duplicates } = addFiles(emptyQueue(), [
      file('a.pdf'),
      file('a.pdf'),
      file('notes.txt', { type: 'text/plain' }),
      file('big.pdf', { size: 6 * 1024 * 1024 }),
      file('old.doc', { type: 'application/msword' }),
      file('cv', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    ]);
    expect(added).toBe(5);
    expect(duplicates).toBe(1);
    expect(statusOf(queue, 'a.pdf')).toEqual({ kind: 'ready' });
    expect(statusOf(queue, 'notes.txt')).toEqual({ kind: 'failed', message: NOT_A_RESUME_FILE, retryable: false });
    expect(statusOf(queue, 'big.pdf')).toMatchObject({ kind: 'failed', retryable: false });
    expect((statusOf(queue, 'big.pdf') as { message: string }).message).toContain('5 MB or larger');
    // A .doc goes to the server, which says why it cannot read one; a Word file is known by its type too.
    expect(statusOf(queue, 'old.doc')).toEqual({ kind: 'ready' });
    expect(statusOf(queue, 'cv')).toEqual({ kind: 'ready' });

    const capped = addFiles(emptyQueue(), Array.from({ length: 53 }, (_, index) => file(`r${index}.pdf`)));
    expect(capped.queue.rows).toHaveLength(50);
    expect(capped.leftOut).toBe(3);
    expect(leftOutText(3)).toBe('Up to 50 files can be uploaded at a time, so 3 files were not added.');
    expect(leftOutText(1)).toBe('Up to 50 files can be uploaded at a time, so 1 file was not added.');
  });

  it('adds nothing while a run is under way; changing files after a run goes back to picking', () => {
    const running = startRun(queueOf('a.pdf'));
    expect(addFiles(running, [file('b.pdf')]).queue).toBe(running);
    const done = markUploaded(markUploading(running, keyOf(running, 'a.pdf')), keyOf(running, 'a.pdf'), { resumeId: 'r1', label: 'a' });
    expect(done.phase).toBe('finished');
    expect(addFiles(done, [file('b.pdf')]).queue.phase).toBe('idle');
    expect(removeRow(done, keyOf(done, 'a.pdf')).phase).toBe('idle');
  });

  it('never removes a file in flight', () => {
    const { queue } = sendNext(startRun(queueOf('a.pdf', 'b.pdf')));
    expect(removeRow(queue, keyOf(queue, 'a.pdf'))).toBe(queue);
  });
});

describe('sending', () => {
  it('sends at most two at a time, in order, and finishes when nothing is left', () => {
    let queue = startRun(queueOf('a.pdf', 'b.pdf', 'c.pdf'));
    let step = sendNext(queue);
    expect(step.sent).toEqual(['a.pdf', 'b.pdf']);
    queue = step.queue;
    expect(sendNext(queue).sent).toEqual([]);
    queue = markUploaded(queue, keyOf(queue, 'a.pdf'), { resumeId: 'r1', label: 'a' });
    step = sendNext(queue);
    expect(step.sent).toEqual(['c.pdf']);
    queue = step.queue;
    queue = markUploaded(queue, keyOf(queue, 'b.pdf'), { resumeId: 'r2', label: 'b' });
    expect(queue.phase).toBe('running');
    queue = markUploaded(queue, keyOf(queue, 'c.pdf'), { resumeId: 'r3', label: 'c' });
    expect(queue.phase).toBe('finished');
    expect(queueStatusText(queue, T0)).toBe('3 of 3 uploaded.');
  });

  it('offers nothing before Upload is pressed', () => {
    expect(nextToStart(queueOf('a.pdf'), T0)).toEqual([]);
  });

  it('a busy server pauses the whole queue for the time it asks; the fourth busy answer fails the file', () => {
    let { queue } = sendNext(startRun(queueOf('a.pdf', 'b.pdf', 'c.pdf')));
    queue = markFailed(queue, keyOf(queue, 'a.pdf'), busy, T0);
    expect(statusOf(queue, 'a.pdf')).toEqual({ kind: 'waiting', until: T0 + 12_000, reason: 'busy' });
    expect(queue.pausedUntil).toBe(T0 + 12_000);
    // b is still in flight; c waits with the rest of the queue.
    expect(nextToStart(queue, T0 + 11_999)).toEqual([]);
    expect(queueStatusText(queue, T0)).toBe('The server is busy. Trying again in a moment.');
    expect(rowStatusText(queue.rows[0]!, T0 + 4_200)).toBe('Server busy, trying again in 8 s');
    expect(nextToStart(queue, T0 + 12_000).map((row) => row.file.name)).toEqual(['a.pdf']);

    for (let tries = 2; tries <= MAX_BUSY_TRIES; tries += 1) {
      queue = markUploading(queue, keyOf(queue, 'a.pdf'));
      queue = markFailed(queue, keyOf(queue, 'a.pdf'), busy, T0);
    }
    expect(statusOf(queue, 'a.pdf')).toEqual({ kind: 'failed', message: busy.message, retryable: true });
  });

  it('waits 15 s when a busy answer names no time, and at most two minutes', () => {
    let { queue } = sendNext(startRun(queueOf('a.pdf')));
    queue = markFailed(queue, keyOf(queue, 'a.pdf'), { ...busy, retryAfterSeconds: undefined }, T0);
    expect(queue.pausedUntil).toBe(T0 + 15_000);
    queue = markUploading(queue, keyOf(queue, 'a.pdf'));
    queue = markFailed(queue, keyOf(queue, 'a.pdf'), { ...busy, retryAfterSeconds: 3600 }, T0);
    expect(queue.pausedUntil).toBe(T0 + 120_000);
  });

  it('a server out of reach pauses the queue 10 s then 20 s (reading the list first), then stops it', () => {
    let { queue } = sendNext(startRun(queueOf('a.pdf', 'b.pdf', 'c.pdf')));
    queue = markFailed(queue, keyOf(queue, 'a.pdf'), offline, T0);
    expect(statusOf(queue, 'a.pdf')).toEqual({ kind: 'waiting', until: T0 + 10_000, reason: 'offline' });
    expect(queue.rows[0]!.checkFirst).toBe(true);
    expect(queueStatusText(queue, T0)).toBe("We can't reach the server. Trying again in a moment.");
    expect(rowStatusText(queue.rows[0]!, T0)).toBe('No connection, trying again in 10 s');
    queue = markUploading(queue, keyOf(queue, 'a.pdf'));
    queue = markFailed(queue, keyOf(queue, 'a.pdf'), offline, T0 + 10_000);
    expect(queue.pausedUntil).toBe(T0 + 30_000);
    queue = markUploading(queue, keyOf(queue, 'a.pdf'));
    queue = markFailed(queue, keyOf(queue, 'a.pdf'), offline, T0 + 30_000);
    expect(statusOf(queue, 'a.pdf')).toEqual({ kind: 'failed', message: UNREACHABLE_MESSAGE, retryable: true });
    expect(statusOf(queue, 'c.pdf')).toEqual({ kind: 'stopped' });
    expect(queue.halt?.reason).toBe('offline');
    expect(haltText(queue.halt)).toBe("We can't reach the server right now, so the upload stopped. Try again in a moment.");
    // b was in flight: the run ends when it does.
    expect(queue.phase).toBe('running');
    queue = markUploaded(queue, keyOf(queue, 'b.pdf'), { resumeId: 'r2', label: 'b' });
    expect(queue.phase).toBe('finished');
    expect(queueStatusText(queue, T0)).toBe('1 uploaded, 2 not uploaded.');
  });

  it('a refusal fails only that file; a server error may be tried again after the list is read', () => {
    let { queue } = sendNext(startRun(queueOf('old.doc', 'b.pdf')));
    queue = markFailed(queue, keyOf(queue, 'old.doc'), { status: 415, code: 'unsupported_file', message: 'Old Word files (.doc) cannot be read.' }, T0);
    expect(statusOf(queue, 'old.doc')).toEqual({ kind: 'failed', message: 'Old Word files (.doc) cannot be read.', retryable: false });
    queue = markFailed(queue, keyOf(queue, 'b.pdf'), { status: 500, code: 'internal', message: 'Something went wrong.' }, T0);
    expect(statusOf(queue, 'b.pdf')).toEqual({ kind: 'failed', message: 'Something went wrong.', retryable: true });
    expect(queue.rows[1]!.checkFirst).toBe(true);
    expect(queue.halt).toBeNull();
    expect(queueCounts(queue).sendable).toBe(1);
  });

  it('a full account (409) or a lost session (401) stops the queue', () => {
    let { queue } = sendNext(startRun(queueOf('a.pdf', 'b.pdf', 'c.pdf')));
    const full = 'You can keep up to 500 resumes. Delete resumes you no longer need, then try again.';
    queue = markFailed(queue, keyOf(queue, 'a.pdf'), { status: 409, code: 'conflict', message: full }, T0);
    expect(queue.halt).toEqual({ reason: 'full', message: full });
    expect(haltText(queue.halt)).toBe(full);
    expect(statusOf(queue, 'c.pdf')).toEqual({ kind: 'stopped' });
    expect(nextToStart(queue, T0)).toEqual([]);

    let other = sendNext(startRun(queueOf('a.pdf', 'b.pdf', 'c.pdf'))).queue;
    other = markFailed(other, keyOf(other, 'a.pdf'), { status: 401, code: 'not_signed_in', message: 'Sign in to do that.' }, T0);
    expect(other.halt?.reason).toBe('signed_out');
    expect(statusOf(other, 'a.pdf')).toMatchObject({ kind: 'failed', retryable: false });
  });

  it('Stop sends nothing new; files in flight finish, and a busy answer after Stop is not tried again', () => {
    let { queue } = sendNext(startRun(queueOf('a.pdf', 'b.pdf', 'c.pdf')));
    queue = stopRun(queue);
    expect(statusOf(queue, 'c.pdf')).toEqual({ kind: 'stopped' });
    expect(queueStatusText(queue, T0)).toBe('Stopping. The files already being uploaded will finish.');
    expect(haltText(queue.halt)).toBeNull();
    queue = markFailed(queue, keyOf(queue, 'a.pdf'), busy, T0);
    expect(statusOf(queue, 'a.pdf')).toEqual({ kind: 'stopped' });
    expect(queue.phase).toBe('running');
    queue = markUploaded(queue, keyOf(queue, 'b.pdf'), { resumeId: 'r2', label: 'b' });
    expect(queue.phase).toBe('finished');
    expect(rowStatusText(queue.rows[2]!, T0)).toBe('Not uploaded');
  });

  it('Try again sends what may pass now (stopped, busy, unreachable, server error), never a refusal', () => {
    let queue = addFiles(emptyQueue(), [file('notes.txt', { type: 'text/plain' }), file('a.pdf'), file('b.pdf'), file('c.pdf')]).queue;
    queue = sendNext(startRun(queue)).queue;
    queue = markFailed(queue, keyOf(queue, 'a.pdf'), { status: 502, message: 'Bad gateway.' }, T0);
    queue = markFailed(queue, keyOf(queue, 'b.pdf'), { status: 415, message: 'Not a resume.' }, T0);
    queue = stopRun(queue);
    expect(queue.phase).toBe('finished');
    expect(queueCounts(queue).sendable).toBe(2);
    expect(retryButtonText(2)).toBe('Try again (2)');

    const again = startRun(queue);
    expect(again.phase).toBe('running');
    expect(again.run).toBe(queue.run + 1);
    expect(statusOf(again, 'a.pdf')).toEqual({ kind: 'ready' });
    expect(statusOf(again, 'c.pdf')).toEqual({ kind: 'ready' });
    expect(statusOf(again, 'b.pdf')).toMatchObject({ kind: 'failed', retryable: false });
    expect(statusOf(again, 'notes.txt')).toMatchObject({ kind: 'failed', retryable: false });
    // The server may have kept a: the list is still read before it is sent again.
    expect(again.rows.find((row) => row.file.name === 'a.pdf')!.checkFirst).toBe(true);
  });
});

describe('the words', () => {
  it('says how each file and the whole upload are doing', () => {
    const queue = queueOf('a.pdf', 'b.pdf');
    expect(queueStatusText(queue, T0)).toBe('2 files ready to upload.');
    expect(rowStatusText(queue.rows[0]!, T0)).toBe('Ready');
    const sent = sendNext(startRun(queue)).queue;
    expect(rowStatusText(sent.rows[0]!, T0)).toBe('Uploading...');
    expect(queueStatusText(sent, T0)).toBe('0 of 2 uploaded...');
    const one = markUploaded(sent, keyOf(sent, 'a.pdf'), { resumeId: 'r1', label: 'a' });
    expect(rowStatusText(one.rows[0]!, T0)).toBe('Uploaded');
    expect(queueStatusText(one, T0)).toBe('1 of 2 uploaded...');
    expect(uploadButtonText(7)).toBe('Upload 7 files');
    expect(uploadButtonText(1)).toBe('Upload 1 file');
  });

  it('names an upload after its file, as the server does', () => {
    expect(labelFromFileName('Jane  Doe_CV.PDF')).toBe('Jane Doe_CV');
    expect(labelFromFileName('resume.final.docx')).toBe('resume.final');
    expect(labelFromFileName('notes.txt')).toBe('notes.txt');
  });

  it('finds an upload the server kept although its answer never arrived', () => {
    const list = [
      { id: 'old', kind: 'uploaded', label: 'Jane_CV' },
      { id: 'mine', kind: 'uploaded', label: 'Jane_CV' },
      { id: 'built', kind: 'built', label: 'Other' },
    ];
    expect(findKeptUpload(list, 'Jane_CV', new Set(['old']), new Set())?.id).toBe('mine');
    expect(findKeptUpload(list, 'Jane_CV', new Set(['old']), new Set(['mine']))).toBeNull();
    expect(findKeptUpload(list, 'Other', new Set(), new Set())).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------- runner

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function summary(id: string, label: string): ResumeSummary {
  const stamp = '2026-10-24T12:00:00.000Z';
  return { id, kind: 'uploaded', label, title: null, templateId: null, templateName: null, isDefault: false, fileKind: 'pdf', nameOnResume: '', createdAt: stamp, updatedAt: stamp, lastEditedAt: null };
}

const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf', lastModified: 1 });

async function flush() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

function harness(options: { list?: ResumeSummary[] } = {}) {
  const runner = new UploadRunner();
  const sends: Array<{ name: string; options: SendOptions; answer: Deferred<UploadAnswer> }> = [];
  const uploaded: UploadedResume[] = [];
  const ends: RunOutcome[] = [];
  let inFlight = 0;
  let mostInFlight = 0;
  const list = vi.fn(async () => options.list ?? []);
  runner.setHandlers({
    send: (sent, sendOptions) => {
      const answer = deferred<UploadAnswer>();
      sends.push({ name: sent.name, options: sendOptions, answer });
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      return answer.promise.finally(() => {
        inFlight -= 1;
      });
    },
    list,
    knownIds: () => new Set(['old']),
    onUploaded: (result) => uploaded.push(result),
    onRunEnd: (outcome) => ends.push(outcome),
  });
  runner.attach();
  const answer = (name: string, value: UploadAnswer | Error) => {
    const sent = [...sends].reverse().find((item) => item.name === name)!;
    if (value instanceof Error) sent.answer.reject(value);
    else sent.answer.resolve(value);
  };
  const stored = (name: string, id: string): UploadAnswer => ({ resume: summary(id, name.replace(/\.pdf$/, '')), taskId: null, copyError: null });
  return { runner, sends, uploaded, ends, list, answer, stored, mostInFlight: () => mostInFlight };
}

describe('the runner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends two at a time and reports the end of the run once, with what was stored', async () => {
    const test = harness();
    test.runner.add(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'].map(pdf));
    test.runner.start({ mode: 'multi', copy: null });
    expect(test.sends.map((item) => item.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(test.sends[0]!.options).toEqual({ mode: 'multi', copy: null });
    test.answer('b.pdf', test.stored('b.pdf', 'rb'));
    await flush();
    expect(test.sends.map((item) => item.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    test.answer('a.pdf', test.stored('a.pdf', 'ra'));
    test.answer('c.pdf', test.stored('c.pdf', 'rc'));
    await flush();
    expect(test.ends).toEqual([]);
    test.answer('d.pdf', test.stored('d.pdf', 'rd'));
    await flush();
    expect(test.mostInFlight()).toBe(2);
    expect(test.uploaded.map((item) => item.id)).toEqual(['rb', 'ra', 'rc', 'rd']);
    expect(test.ends).toHaveLength(1);
    expect(test.ends[0]).toMatchObject({ mode: 'multi', notUploaded: 0, allDone: true, copies: false });
    expect(test.ends[0]!.uploaded).toHaveLength(4);
    expect(test.runner.getSnapshot().queue.phase).toBe('finished');
  });

  it('passes one file\'s name and copy choice, and says why a copy could not start', async () => {
    const test = harness();
    test.runner.add([pdf('Jane.pdf')]);
    test.runner.start({ mode: 'single', title: 'Jane Finance', copy: { templateId: 'navy-rule' } });
    expect(test.sends[0]!.options).toEqual({ mode: 'single', title: 'Jane Finance', copy: { templateId: 'navy-rule' } });
    test.answer('Jane.pdf', { resume: summary('r1', 'Jane Finance'), taskId: null, copyError: 'The AI is busy.' });
    await flush();
    expect(test.uploaded[0]).toMatchObject({ id: 'r1', label: 'Jane Finance', taskId: null, copyError: 'The AI is busy.' });
    expect(test.ends[0]).toMatchObject({ mode: 'single', allDone: true, copies: true });
  });

  it('a run of several files with copies sends the same template and batch with every file, Try again included, and says so at its end', async () => {
    const test = harness();
    const copy = { templateId: 'navy-rule', batchId: '0123456789abcdef0123456789abcdef' };
    test.runner.add(['a.pdf', 'b.pdf', 'c.pdf'].map(pdf));
    test.runner.start({ mode: 'multi', copy });
    test.answer('a.pdf', test.stored('a.pdf', 'ra'));
    test.answer('b.pdf', new ApiError({ status: 500, code: 'internal', message: 'Something went wrong.' }));
    await flush();
    test.answer('c.pdf', test.stored('c.pdf', 'rc'));
    await flush();
    expect(test.ends).toEqual([expect.objectContaining({ mode: 'multi', copies: true, notUploaded: 1, allDone: false })]);

    // Try again in the same dialog: the file that failed goes again with the same template and batch.
    test.runner.start({ mode: 'multi', copy });
    await flush();
    expect(test.sends.map((item) => item.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf', 'b.pdf']);
    test.answer('b.pdf', test.stored('b.pdf', 'rb'));
    await flush();
    expect(test.sends.map((item) => item.options)).toEqual(Array.from({ length: 4 }, () => ({ mode: 'multi', copy })));
    expect(test.ends).toHaveLength(2);
    expect(test.ends[1]).toMatchObject({ mode: 'multi', copies: true, notUploaded: 0, allDone: true });
    expect(test.ends[1]!.uploaded.map((item) => item.id)).toEqual(['rb']);
  });

  it('a busy answer holds the whole queue for the time asked, then it goes on by itself', async () => {
    vi.useFakeTimers({ now: T0 });
    const test = harness();
    test.runner.add(['a.pdf', 'b.pdf', 'c.pdf'].map(pdf));
    test.runner.start({ mode: 'multi', copy: null });
    test.answer('a.pdf', new ApiError({ status: 429, code: 'rate_limited', message: 'Busy.', retryAfterSeconds: 3 }));
    await flush();
    test.answer('b.pdf', test.stored('b.pdf', 'rb'));
    await flush();
    // b finished, but the queue is paused: neither c nor a goes yet.
    expect(test.sends.map((item) => item.name)).toEqual(['a.pdf', 'b.pdf']);
    await vi.advanceTimersByTimeAsync(2_900);
    expect(test.sends).toHaveLength(2);
    expect(test.runner.getSnapshot().now).toBeGreaterThan(T0);
    await vi.advanceTimersByTimeAsync(200);
    expect(test.sends.map((item) => item.name)).toEqual(['a.pdf', 'b.pdf', 'a.pdf', 'c.pdf']);
    test.runner.detach();
  });

  it('reads the list before sending again a file whose answer never arrived, and never makes it twice', async () => {
    vi.useFakeTimers({ now: T0 });
    const test = harness({ list: [summary('old', 'a'), summary('kept', 'a')] });
    test.runner.add([pdf('a.pdf')]);
    test.runner.start({ mode: 'multi', copy: null });
    test.answer('a.pdf', new ApiError({ status: 0, code: 'internal', message: UNREACHABLE_MESSAGE }));
    await flush();
    expect(test.list).not.toHaveBeenCalled();
    // The server may hold the file now: the dialog keeps its copy choice, so a kept upload matches what was asked.
    expect(copyChoiceFixed(test.runner.getSnapshot().queue)).toBe(true);
    await vi.advanceTimersByTimeAsync(10_100);
    // The server had kept it: found in the list (not among the resumes known before), so it is not sent again.
    expect(test.list).toHaveBeenCalledTimes(1);
    expect(test.sends).toHaveLength(1);
    expect(test.uploaded.map((item) => item.id)).toEqual(['kept']);
    expect(test.ends[0]).toMatchObject({ allDone: true });
  });

  it('sends the file again when the list does not have it', async () => {
    vi.useFakeTimers({ now: T0 });
    const test = harness({ list: [summary('old', 'a')] });
    test.runner.add([pdf('a.pdf')]);
    test.runner.start({ mode: 'multi', copy: null });
    test.answer('a.pdf', new ApiError({ status: 503, code: 'internal', message: UNREACHABLE_MESSAGE }));
    await flush();
    await vi.advanceTimersByTimeAsync(10_100);
    expect(test.list).toHaveBeenCalledTimes(1);
    expect(test.sends).toHaveLength(2);
    test.answer('a.pdf', test.stored('a.pdf', 'new'));
    await flush();
    expect(test.uploaded.map((item) => item.id)).toEqual(['new']);
  });

  it('Stop lets the files in flight finish, sends nothing new, and Try again sends the rest', async () => {
    const test = harness();
    test.runner.add(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'].map(pdf));
    test.runner.start({ mode: 'multi', copy: null });
    test.runner.stop();
    test.answer('a.pdf', test.stored('a.pdf', 'ra'));
    test.answer('b.pdf', test.stored('b.pdf', 'rb'));
    await flush();
    expect(test.sends.map((item) => item.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(test.ends).toEqual([expect.objectContaining({ notUploaded: 2, allDone: false })]);
    expect(test.ends[0]!.uploaded.map((item) => item.id)).toEqual(['ra', 'rb']);

    test.runner.start({ mode: 'multi', copy: null });
    expect(test.sends.map((item) => item.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf']);
    test.answer('c.pdf', test.stored('c.pdf', 'rc'));
    test.answer('d.pdf', test.stored('d.pdf', 'rd'));
    await flush();
    expect(test.ends).toHaveLength(2);
    expect(test.ends[1]).toMatchObject({ notUploaded: 0, allDone: true });
    expect(test.ends[1]!.uploaded.map((item) => item.id)).toEqual(['rc', 'rd']);
  });

  it('starts nothing while detached (unmounted)', () => {
    const test = harness();
    test.runner.detach();
    test.runner.add([pdf('a.pdf')]);
    test.runner.start({ mode: 'multi', copy: null });
    expect(test.sends).toHaveLength(0);
    test.runner.attach();
    expect(test.sends).toHaveLength(1);
  });
});
