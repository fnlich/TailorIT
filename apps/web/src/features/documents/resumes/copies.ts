import type { ResumeCopiesPause, ResumeCopiesResponse, ResumeCopy } from '@tailorit/shared/resume';
import { FALLBACK_TEMPLATE_ID } from '../../resume-editor/draft';
import type { UploadQueue } from './uploadQueue';

/*
 * The editable copies of several uploads (GET /api/resumes/copies), free of React: the Upload dialog's batch id and
 * template choice, and when that choice is fixed; the copies grouped by batch and counted, and which were just made;
 * and the words of each batch's notice on the Resumes tab.
 */

/** How often the copies are read again while one waits or is being made. */
export const COPY_POLL_MS = 3000;

/** The server's sentence for a failure that names none. */
const COPY_FAILED = 'The AI request failed. Please try again.';

/**
 * One Upload dialog's id for its runs of several files: 32 hex characters. `getRandomValues` works over plain http
 * too (`randomUUID` needs a secure context, and the app may be served on a LAN address).
 */
export function newCopyBatchId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The template the copies start on: the one picked while it is offered, else Professional Two-Column, else the first. */
export function copyTemplateChoice(templates: ReadonlyArray<{ id: string }>, picked: string | null): string | null {
  if (picked && templates.some((template) => template.id === picked)) return picked;
  if (templates.some((template) => template.id === FALLBACK_TEMPLATE_ID)) return FALLBACK_TEMPLATE_ID;
  return templates[0]?.id ?? null;
}

/**
 * The Upload dialog's copy choice (the box and the template) is fixed once a file of its upload is on the server, or
 * may be (its answer never came): Try again and files added later then ask for the same copy, and a kept upload found
 * again before a file is sent twice has the copy that was asked for. Before then nothing is stored, so it can change.
 */
export function copyChoiceFixed(queue: Pick<UploadQueue, 'rows'>): boolean {
  return queue.rows.some((row) => row.status.kind === 'done' || row.checkFirst);
}

export interface CopyCounts {
  total: number;
  ready: number;
  making: number;
  waiting: number;
  failed: number;
  stopped: number;
  /** What Try again would make: the stopped copies and those that failed for a reason that may pass. */
  retryable: number;
}

/** The copies of one Upload dialog, in the order the server lists them. */
export interface CopyBatch {
  batchId: string;
  items: ResumeCopy[];
  counts: CopyCounts;
  /** A copy waits or is being made. */
  active: boolean;
}

function countCopies(items: readonly ResumeCopy[]): CopyCounts {
  const counts: CopyCounts = { total: items.length, ready: 0, making: 0, waiting: 0, failed: 0, stopped: 0, retryable: 0 };
  for (const item of items) {
    counts[item.state] += 1;
    if (item.state === 'stopped' || (item.state === 'failed' && item.retryable)) counts.retryable += 1;
  }
  return counts;
}

/** The copies by batch, each batch where its first copy is listed. */
export function groupCopies(items: readonly ResumeCopy[]): CopyBatch[] {
  const byBatch = new Map<string, ResumeCopy[]>();
  for (const item of items) {
    const batch = byBatch.get(item.batchId);
    if (batch) batch.push(item);
    else byBatch.set(item.batchId, [item]);
  }
  return Array.from(byBatch, ([batchId, batch]) => {
    const counts = countCopies(batch);
    return { batchId, items: batch, counts, active: counts.waiting + counts.making > 0 };
  });
}

/** A copy waits or is being made: the copies are read again. */
export function copiesActive(view: ResumeCopiesResponse | null | undefined): boolean {
  return Boolean(view?.items.some((item) => item.state === 'waiting' || item.state === 'making'));
}

/** The copies made (ready) in a view, by id. */
export function readyCopyIds(view: ResumeCopiesResponse): ReadonlySet<string> {
  return new Set(view.items.filter((item) => item.state === 'ready').map((item) => item.id));
}

/**
 * A copy is ready that was not in the view before, so the resume list is read again; nothing on the first view
 * (`before` null). Ids, not a count: Dismiss takes a batch's ready copies out of the view, which would hide one made
 * meanwhile in another batch.
 */
export function copyMadeSince(before: ReadonlySet<string> | null, ready: ReadonlySet<string>): boolean {
  if (!before) return false;
  for (const id of ready) if (!before.has(id)) return true;
  return false;
}

// ------------------------------------------------------------------------------------------------ the words

/** The bold line while copies are made: "Making editable copies with AI: 1 of 4 ready. 3 stopped." */
export function activeTitle(batch: CopyBatch): string {
  const { total, ready, failed, stopped } = batch.counts;
  if (total === 1) return 'Making an editable copy with AI.';
  let title = `Making editable copies with AI: ${ready} of ${total} ready.`;
  if (failed > 0) title += ` ${failed} could not be made.`;
  if (stopped > 0) title += ` ${stopped} stopped.`;
  return title;
}

/**
 * The line under it: why the copies wait, that the rest were stopped, or how long it takes. Times are the browser's,
 * or in `timeZone` (tests).
 */
export function activeLine(batch: CopyBatch, paused: ResumeCopiesPause | null, now: number, timeZone?: string): string {
  const one = batch.counts.total === 1;
  if (paused && batch.counts.waiting > 0) return pauseText(paused, now, one, timeZone);
  if (batch.counts.waiting === 0 && batch.counts.stopped > 0) return 'The copy being made now will finish; the rest were stopped.';
  return one
    ? 'This can take a minute. You can leave this page; it carries on.'
    : 'They are made one at a time, so this can take a while. You can leave this page; they carry on.';
}

/** A time's calendar day, as a count of days (in the browser's time zone, or `timeZone`). */
function dayOf(at: number, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000;
}

/**
 * When the copies go on: "They go on at about 3:40 PM." today, with the day when it is another one ("tomorrow at
 * about 3:40 PM", "Thursday at about 3:40 PM" within the week, else "Nov 2 at about 3:40 PM"; a weekly usage window
 * can hold them for days), and "in a minute or two" when that is under two minutes away or not known.
 */
function goesOnText(until: string | null, now: number, one: boolean, timeZone?: string): string {
  const at = until ? Date.parse(until) : Number.NaN;
  const subject = one ? 'It goes' : 'They go';
  if (!Number.isFinite(at) || at - now < 2 * 60_000) return `${subject} on in a minute or two.`;
  const clock = `at about ${new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })}`;
  const days = dayOf(at, timeZone) - dayOf(now, timeZone);
  if (days < 1) return `${subject} on ${clock}.`;
  if (days === 1) return `${subject} on tomorrow ${clock}.`;
  const day = new Date(at).toLocaleDateString('en-US', days < 7 ? { weekday: 'long', timeZone } : { month: 'short', day: 'numeric', timeZone });
  return `${subject} on ${day} ${clock}.`;
}

/** Why the copies in line wait (`one`: a batch of one copy); times as in `activeLine`. */
export function pauseText(paused: ResumeCopiesPause, now: number, one: boolean, timeZone?: string): string {
  const goesOn = goesOnText(paused.until, now, one, timeZone);
  switch (paused.reason) {
    case 'off':
      return `AI features are turned off on this server, so ${one ? 'the copy is' : 'the copies are'} not being made.`;
    case 'limit':
      return `The AI usage limit was reached, so ${one ? 'the copy is' : 'the copies are'} waiting. ${goesOn}`;
    case 'hold':
      return `AI is paused for a few minutes, so ${one ? 'the copy is' : 'the copies are'} waiting. ${goesOn}`;
    case 'warning':
      return (
        `The AI usage limit is nearly reached, so ${one ? 'the copy waits' : 'the copies wait'} until it resets. ${goesOn} ` +
        '"Make editable copy" on an upload makes that one now.'
      );
  }
}

/** A copy's state in the details list: "Waiting", "Being made...", "Ready", why it was not made, or "Stopped". */
export function copyStateText(item: Pick<ResumeCopy, 'state' | 'error'>): string {
  switch (item.state) {
    case 'waiting':
      return 'Waiting';
    case 'making':
      return 'Being made...';
    case 'ready':
      return 'Ready';
    case 'failed':
      return item.error || COPY_FAILED;
    case 'stopped':
      return 'Stopped';
  }
}

export interface FinishedNotice {
  tone: 'success' | 'warning' | 'error';
  title: string;
  body: string;
}

/** The notice of a batch with nothing left to make: all ready, some, or none. */
export function finishedNotice(batch: CopyBatch): FinishedNotice {
  const { total, ready, failed, stopped } = batch.counts;
  const [first] = batch.items;
  if (total === 1 && first) {
    if (first.state === 'ready') {
      return { tone: 'success', title: 'Your editable copy is ready', body: `The AI read ${first.label} into a resume you can edit.` };
    }
    if (first.state === 'failed') {
      return {
        tone: 'error',
        title: `The editable copy of ${first.label} could not be made`,
        body: `${copyStateText(first)} Your upload is kept as it is.`,
      };
    }
    return {
      tone: 'warning',
      title: `The editable copy of ${first.label} was not made`,
      body: 'It was stopped before it was made. Your upload is kept as it is.',
    };
  }
  if (ready === total) {
    return {
      tone: 'success',
      title: `${total} editable copies are ready`,
      body: 'Each one is a new resume you can edit, listed with your resumes. The uploaded files are kept as they are.',
    };
  }
  const parts: string[] = [];
  if (failed > 0) {
    const reasons = new Set(batch.items.filter((item) => item.state === 'failed').map(copyStateText));
    const [reason] = reasons;
    parts.push(reasons.size === 1 ? `${failed} could not be made: ${reason}` : `${failed} could not be made. Show details says why for each.`);
  }
  if (stopped > 0) parts.push(stopped === 1 ? '1 was stopped before it was made.' : `${stopped} were stopped before they were made.`);
  parts.push('The uploaded files are kept as they are.');
  return {
    tone: ready > 0 || failed === 0 ? 'warning' : 'error',
    title: ready > 0 ? `${ready} of ${total} editable copies are ready` : 'No editable copies were made',
    body: parts.join(' '),
  };
}

/** The button that stops the copies still waiting. */
export function stopCopiesText(batch: CopyBatch): string {
  return batch.counts.total === 1 ? 'Stop' : 'Stop the rest';
}

/** The button that puts the copies not made back in line: "Try again (3)". */
export function retryCopiesText(batch: CopyBatch): string {
  return batch.counts.total === 1 ? 'Try again' : `Try again (${batch.counts.retryable})`;
}
