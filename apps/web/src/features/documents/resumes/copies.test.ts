import { ResumeCopyBatchIdSchema, type ResumeCopiesPause, type ResumeCopy } from '@tailorit/shared/resume';
import { describe, expect, it } from 'vitest';
import {
  activeLine,
  activeTitle,
  copiesActive,
  copyChoiceFixed,
  copyMadeSince,
  copyStateText,
  copyTemplateChoice,
  finishedNotice,
  groupCopies,
  newCopyBatchId,
  pauseText,
  readyCopyIds,
  retryCopiesText,
  stopCopiesText,
} from './copies';
import { addFiles, emptyQueue, markFailed, markUploaded, markUploading, startRun, stopRun, type QueueFile, type UploadQueue } from './uploadQueue';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');
/** Intl may put a narrow no-break space before AM/PM; compare it as a plain space. */
const plain = (text: string) => text.replace(/\s/g, ' ');
const AI_FAILED = 'The AI request failed. Please try again.';
const UNREADABLE =
  'We could not read enough text from that file to make an editable copy. It may be a scan or an image; upload a PDF or Word file with selectable text.';
const NO_ROOM = 'You can keep up to 500 resumes. Delete resumes you no longer need, then try again.';

let made = 0;

/** A copy as the server lists it: one that failed did so for a reason that may pass, unless told otherwise. */
function copy(state: ResumeCopy['state'], patch: Partial<ResumeCopy> = {}): ResumeCopy {
  made += 1;
  return {
    id: `c${made}`,
    batchId: 'b1',
    label: `Resume_${made}`,
    state,
    resumeId: state === 'ready' ? `r${made}` : null,
    error: state === 'failed' ? AI_FAILED : null,
    retryable: state === 'failed' || state === 'stopped',
    ...patch,
  };
}

const batchOf = (...items: ResumeCopy[]) => groupCopies(items)[0]!;

describe('the copies of several uploads', () => {
  it('copyTemplateChoice keeps a choice still offered, else Professional Two-Column, else the first', () => {
    const templates = [{ id: 'navy-rule' }, { id: 'default' }, { id: 'ats-modern-sans' }];
    expect(copyTemplateChoice(templates, 'ats-modern-sans')).toBe('ats-modern-sans');
    expect(copyTemplateChoice(templates, null)).toBe('default');
    expect(copyTemplateChoice(templates, 'no-longer-offered')).toBe('default');
    expect(copyTemplateChoice([{ id: 'navy-rule' }, { id: 'ats-modern-sans' }], null)).toBe('navy-rule');
    expect(copyTemplateChoice([], 'navy-rule')).toBeNull();
  });

  it('newCopyBatchId is 32 hex characters, new each time', () => {
    const ids = Array.from({ length: 20 }, () => newCopyBatchId());
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(ids).size).toBe(ids.length);
    // The server takes it as a batch id.
    expect(ResumeCopyBatchIdSchema.safeParse(ids[0]).success).toBe(true);
  });

  it('groups copies by batch in the order the server lists them, and counts each state', () => {
    const items = [
      copy('ready', { batchId: 'b2' }),
      copy('waiting'),
      copy('making', { batchId: 'b2' }),
      copy('failed'),
      copy('failed', { error: UNREADABLE, retryable: false }),
      copy('stopped'),
    ];
    const batches = groupCopies(items);
    expect(batches.map((batch) => batch.batchId)).toEqual(['b2', 'b1']);
    expect(batches[0]!.items).toEqual([items[0], items[2]]);
    expect(batches[0]).toMatchObject({
      active: true,
      counts: { total: 2, ready: 1, making: 1, waiting: 0, failed: 0, stopped: 0, retryable: 0 },
    });
    // Try again would make the stopped copy and the one that failed for a reason that may pass.
    expect(batches[1]!.counts).toEqual({ total: 4, ready: 0, making: 0, waiting: 1, failed: 2, stopped: 1, retryable: 2 });
    expect(batchOf(copy('ready'), copy('failed'), copy('stopped')).active).toBe(false);
    expect(groupCopies([])).toEqual([]);
  });

  it('words a batch being made: one copy, several, some not made, some stopped', () => {
    const one = batchOf(copy('making'));
    expect(activeTitle(one)).toBe('Making an editable copy with AI.');
    expect(activeLine(one, null, NOW)).toBe('This can take a minute. You can leave this page; it carries on.');
    expect(stopCopiesText(batchOf(copy('waiting')))).toBe('Stop');

    const several = batchOf(copy('ready'), copy('making'), copy('waiting'));
    expect(activeTitle(several)).toBe('Making editable copies with AI: 1 of 3 ready.');
    expect(activeLine(several, null, NOW)).toBe(
      'They are made one at a time, so this can take a while. You can leave this page; they carry on.',
    );
    expect(stopCopiesText(several)).toBe('Stop the rest');

    expect(activeTitle(batchOf(copy('failed'), copy('ready'), copy('making'), copy('waiting')))).toBe(
      'Making editable copies with AI: 1 of 4 ready. 1 could not be made.',
    );
    expect(activeTitle(batchOf(copy('failed'), copy('stopped'), copy('making')))).toBe(
      'Making editable copies with AI: 0 of 3 ready. 1 could not be made. 1 stopped.',
    );

    const stopped = batchOf(copy('making'), copy('stopped'), copy('stopped'), copy('stopped'));
    expect(activeTitle(stopped)).toBe('Making editable copies with AI: 0 of 4 ready. 3 stopped.');
    expect(activeLine(stopped, null, NOW)).toBe('The copy being made now will finish; the rest were stopped.');

    // A pause is said while a copy waits for it, before anything else.
    const hold = { reason: 'hold' as const, until: null };
    expect(activeLine(several, hold, NOW)).toBe('AI is paused for a few minutes, so the copies are waiting. They go on in a minute or two.');
    expect(activeLine(batchOf(copy('waiting')), hold, NOW)).toBe('AI is paused for a few minutes, so the copy is waiting. It goes on in a minute or two.');
    expect(activeLine(batchOf(copy('ready'), copy('making')), hold, NOW)).toBe(
      'They are made one at a time, so this can take a while. You can leave this page; they carry on.',
    );
  });

  it('words a pause: AI off, the usage limit, a pause, a warning; at about a time, or in a minute or two', () => {
    const inAnHour = new Date(NOW + 60 * 60_000).toISOString();
    const soon = new Date(NOW + 90_000).toISOString();
    // Times in UTC, so the words do not depend on the machine's time zone.
    const words = (paused: ResumeCopiesPause, one: boolean) => plain(pauseText(paused, NOW, one, 'UTC'));

    expect(words({ reason: 'off', until: null }, false)).toBe('AI features are turned off on this server, so the copies are not being made.');
    expect(words({ reason: 'off', until: inAnHour }, true)).toBe('AI features are turned off on this server, so the copy is not being made.');

    const limit = words({ reason: 'limit', until: inAnHour }, false);
    expect(limit).toMatch(/at about \d{1,2}:\d{2} [AP]M\./);
    expect(limit).toBe('The AI usage limit was reached, so the copies are waiting. They go on at about 1:00 PM.');
    expect(words({ reason: 'limit', until: soon }, true)).toBe('The AI usage limit was reached, so the copy is waiting. It goes on in a minute or two.');

    expect(words({ reason: 'hold', until: inAnHour }, true)).toBe('AI is paused for a few minutes, so the copy is waiting. It goes on at about 1:00 PM.');
    expect(words({ reason: 'hold', until: null }, false)).toBe('AI is paused for a few minutes, so the copies are waiting. They go on in a minute or two.');

    expect(words({ reason: 'warning', until: inAnHour }, false)).toBe(
      'The AI usage limit is nearly reached, so the copies wait until it resets. They go on at about 1:00 PM. "Make editable copy" on an upload makes that one now.',
    );
    // A time that does not read, or one already gone by: in a minute or two.
    expect(words({ reason: 'warning', until: 'soon' }, true)).toBe(
      'The AI usage limit is nearly reached, so the copy waits until it resets. It goes on in a minute or two. "Make editable copy" on an upload makes that one now.',
    );
    expect(words({ reason: 'hold', until: new Date(NOW - 60_000).toISOString() }, false)).toBe(
      'AI is paused for a few minutes, so the copies are waiting. They go on in a minute or two.',
    );
  });

  it('says the day when the copies go on another day: tomorrow, a weekday within the week, else the date', () => {
    // Monday, Oct 26, 2026, 2:00 PM in UTC.
    const monday = Date.parse('2026-10-26T14:00:00.000Z');
    const limit = (until: string, one = false, timeZone = 'UTC') => plain(pauseText({ reason: 'limit', until }, monday, one, timeZone));
    const waiting = 'The AI usage limit was reached, so the copies are waiting.';

    // The same day: the clock alone.
    expect(limit('2026-10-26T18:40:00.000Z')).toBe(`${waiting} They go on at about 6:40 PM.`);
    expect(limit('2026-10-27T09:05:00.000Z', true)).toBe('The AI usage limit was reached, so the copy is waiting. It goes on tomorrow at about 9:05 AM.');
    expect(limit('2026-10-29T18:40:00.000Z')).toBe(`${waiting} They go on Thursday at about 6:40 PM.`);
    expect(limit('2026-11-01T18:40:00.000Z')).toBe(`${waiting} They go on Sunday at about 6:40 PM.`);
    // A week away the weekday would read as this one: the date instead.
    expect(limit('2026-11-02T18:40:00.000Z')).toBe(`${waiting} They go on Nov 2 at about 6:40 PM.`);
    // The day is the browser's: 1:30 AM on Tuesday in UTC is still Monday evening in Chicago.
    expect(limit('2026-10-27T01:30:00.000Z')).toBe(`${waiting} They go on tomorrow at about 1:30 AM.`);
    expect(limit('2026-10-27T01:30:00.000Z', false, 'America/Chicago')).toBe(`${waiting} They go on at about 8:30 PM.`);

    // A weekly window's warning, read on Monday for a reset on Thursday; the batch's line says it the same way.
    expect(plain(pauseText({ reason: 'warning', until: '2026-10-29T18:40:00.000Z' }, monday, false, 'UTC'))).toBe(
      'The AI usage limit is nearly reached, so the copies wait until it resets. They go on Thursday at about 6:40 PM. "Make editable copy" on an upload makes that one now.',
    );
    expect(plain(activeLine(batchOf(copy('waiting')), { reason: 'hold', until: '2026-10-27T18:40:00.000Z' }, monday, 'UTC'))).toBe(
      'AI is paused for a few minutes, so the copy is waiting. It goes on tomorrow at about 6:40 PM.',
    );
  });

  it('words a finished batch: all ready, some not made (one reason, several reasons, stopped), none made, one copy', () => {
    expect(finishedNotice(batchOf(copy('ready'), copy('ready'), copy('ready')))).toEqual({
      tone: 'success',
      title: '3 editable copies are ready',
      body: 'Each one is a new resume you can edit, listed with your resumes. The uploaded files are kept as they are.',
    });

    const oneReason = batchOf(copy('ready'), copy('ready'), copy('ready'), copy('failed'));
    expect(finishedNotice(oneReason)).toEqual({
      tone: 'warning',
      title: '3 of 4 editable copies are ready',
      body: `1 could not be made: ${AI_FAILED} The uploaded files are kept as they are.`,
    });
    expect(retryCopiesText(oneReason)).toBe('Try again (1)');

    const reasons = batchOf(copy('ready'), copy('failed'), copy('failed', { error: UNREADABLE, retryable: false }));
    expect(finishedNotice(reasons)).toEqual({
      tone: 'warning',
      title: '1 of 3 editable copies are ready',
      body: '2 could not be made. Show details says why for each. The uploaded files are kept as they are.',
    });
    expect(retryCopiesText(reasons)).toBe('Try again (1)');

    const stopped = batchOf(copy('ready'), copy('stopped'), copy('stopped'), copy('stopped'));
    expect(finishedNotice(stopped)).toEqual({
      tone: 'warning',
      title: '1 of 4 editable copies are ready',
      body: '3 were stopped before they were made. The uploaded files are kept as they are.',
    });
    expect(retryCopiesText(stopped)).toBe('Try again (3)');
    expect(finishedNotice(batchOf(copy('ready'), copy('failed'), copy('stopped'))).body).toBe(
      `1 could not be made: ${AI_FAILED} 1 was stopped before it was made. The uploaded files are kept as they are.`,
    );

    // None made: an error when one failed, else a warning.
    expect(finishedNotice(batchOf(copy('failed', { error: NO_ROOM }), copy('failed', { error: NO_ROOM })))).toEqual({
      tone: 'error',
      title: 'No editable copies were made',
      body: `2 could not be made: ${NO_ROOM} The uploaded files are kept as they are.`,
    });
    expect(finishedNotice(batchOf(copy('stopped'), copy('stopped')))).toEqual({
      tone: 'warning',
      title: 'No editable copies were made',
      body: '2 were stopped before they were made. The uploaded files are kept as they are.',
    });

    // One copy.
    expect(finishedNotice(batchOf(copy('ready', { label: 'Jane_Doe' })))).toEqual({
      tone: 'success',
      title: 'Your editable copy is ready',
      body: 'The AI read Jane_Doe into a resume you can edit.',
    });
    const failedOne = batchOf(copy('failed', { label: 'Jane_Doe', error: NO_ROOM }));
    expect(finishedNotice(failedOne)).toEqual({
      tone: 'error',
      title: 'The editable copy of Jane_Doe could not be made',
      body: `${NO_ROOM} Your upload is kept as it is.`,
    });
    expect(retryCopiesText(failedOne)).toBe('Try again');
    expect(finishedNotice(batchOf(copy('stopped', { label: 'Jane_Doe' })))).toEqual({
      tone: 'warning',
      title: 'The editable copy of Jane_Doe was not made',
      body: 'It was stopped before it was made. Your upload is kept as it is.',
    });

    // Each copy in the details list.
    expect([copy('waiting'), copy('making'), copy('ready'), copy('failed', { error: UNREADABLE }), copy('stopped')].map(copyStateText)).toEqual([
      'Waiting',
      'Being made...',
      'Ready',
      UNREADABLE,
      'Stopped',
    ]);
    expect(copyStateText({ state: 'failed', error: null })).toBe(AI_FAILED);
  });

  it('copiesActive only while a copy waits or is being made', () => {
    expect(copiesActive(undefined)).toBe(false);
    expect(copiesActive(null)).toBe(false);
    expect(copiesActive({ items: [], paused: null })).toBe(false);
    expect(copiesActive({ items: [copy('ready'), copy('failed'), copy('stopped')], paused: null })).toBe(false);
    expect(copiesActive({ items: [copy('ready'), copy('waiting')], paused: { reason: 'limit', until: null } })).toBe(true);
    expect(copiesActive({ items: [copy('stopped'), copy('making')], paused: null })).toBe(true);
  });

  it('copyMadeSince a copy is ready that was not in the view before, told by id; not on the first view', () => {
    // Batch A has its 3 copies; batch B has 4 of 5, the last being made.
    const a = [copy('ready', { batchId: 'A' }), copy('ready', { batchId: 'A' }), copy('ready', { batchId: 'A' })];
    const b = Array.from({ length: 4 }, () => copy('ready', { batchId: 'B' }));
    const last = copy('making', { batchId: 'B' });
    const before = readyCopyIds({ items: [...a, ...b, last], paused: null });
    expect(before.size).toBe(7);

    // B's last copy is made while A is dismissed: 5 copies ready instead of 7, one of them new.
    const made: ResumeCopy = { ...last, state: 'ready', resumeId: 'r-last' };
    expect(copyMadeSince(before, readyCopyIds({ items: [...b, made], paused: null }))).toBe(true);
    // Dismiss alone, or the same view again: nothing new.
    expect(copyMadeSince(before, readyCopyIds({ items: [...b, last], paused: null }))).toBe(false);
    expect(copyMadeSince(before, before)).toBe(false);
    // The first view is only noted.
    expect(copyMadeSince(null, readyCopyIds({ items: [...a, made], paused: null }))).toBe(false);
  });

  it("copyChoiceFixed once a file of the dialog's upload is on the server, or may be", () => {
    const pdf = (name: string): QueueFile => ({ name, size: 120_000, type: 'application/pdf', lastModified: 1 });
    const keyOf = (queue: UploadQueue, name: string) => queue.rows.find((row) => row.file.name === name)!.key;
    const sent = (queue: UploadQueue, name: string) => markUploading(queue, keyOf(queue, name));
    const started = startRun(addFiles(emptyQueue(), [pdf('a.pdf'), pdf('b.pdf')]).queue);
    expect(copyChoiceFixed(addFiles(emptyQueue(), [pdf('a.pdf')]).queue)).toBe(false);

    // Nothing stored yet: a file the server refused, or the rest stopped before they went. The choice may change.
    let queue = markFailed(sent(started, 'a.pdf'), keyOf(started, 'a.pdf'), { status: 415, code: 'unsupported_file', message: 'Not a resume.' }, NOW);
    queue = stopRun(queue);
    expect(queue.phase).toBe('finished');
    expect(copyChoiceFixed(queue)).toBe(false);

    // A file stored: the rest of the upload goes with its choice.
    expect(copyChoiceFixed(markUploaded(sent(started, 'a.pdf'), keyOf(started, 'a.pdf'), { resumeId: 'r1', label: 'a' }))).toBe(true);
    // An answer that never came, or a server error: the server may have kept the file, and Try again may find it.
    const lost = markFailed(sent(started, 'a.pdf'), keyOf(started, 'a.pdf'), { status: 0, message: 'No connection.', unreachable: true }, NOW);
    expect(copyChoiceFixed(lost)).toBe(true);
    expect(copyChoiceFixed(markFailed(sent(started, 'b.pdf'), keyOf(started, 'b.pdf'), { status: 502, message: 'Bad gateway.' }, NOW))).toBe(true);
  });
});
