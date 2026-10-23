import { z } from 'zod';
import { IsoDate } from '../core/list';
import { formatMDYY, isFutureDate, type DateInput } from '../format/dates';
import {
  APPLICATION_STATUSES,
  ApplicationStatusSchema,
  STATUS,
  STATUS_INFO,
  TERMINAL_STATUSES,
  isApplicationStatus,
  isTerminalStatus,
  type ApplicationStatus,
} from './statuses';

// The status rules (Simplify's): every application keeps one event per status it reached, each with its own editable
// date, and its current status is the highest of them. These functions take and return event lists; the API stores
// them in `application_status_events` and denormalizes `currentStatus` onto the application.

export const StatusEventSchema = z.object({
  status: ApplicationStatusSchema,
  occurredOn: IsoDate,
});
export type StatusEvent = z.infer<typeof StatusEventSchema>;

/** The events with one per status (the last one given wins) in status order; unknown statuses dropped. */
export function normalizeEvents(events: readonly StatusEvent[]): StatusEvent[] {
  const byStatus = new Map<ApplicationStatus, StatusEvent>();
  for (const event of events) {
    if (event && isApplicationStatus(event.status)) byStatus.set(event.status, { ...event });
  }
  return APPLICATION_STATUSES.filter((status) => byStatus.has(status)).map((status) => byStatus.get(status)!);
}

/** The highest status among the events; Saved for an application with none. */
export function currentStatus(events: readonly StatusEvent[]): ApplicationStatus {
  let current: ApplicationStatus = STATUS.saved;
  for (const event of events) if (isApplicationStatus(event.status) && event.status > current) current = event.status;
  return current;
}

/**
 * The fixed parts of every rule: Saved always present, Applied present beneath any later stage, one terminal at most
 * (`keep` when it is one, else the highest held, as the current status reads).
 */
function withInvariants(byStatus: Map<ApplicationStatus, StatusEvent>, keep: ApplicationStatus, date: string) {
  const held = TERMINAL_STATUSES.filter((terminal) => byStatus.has(terminal));
  const kept = isTerminalStatus(keep) ? keep : held[held.length - 1];
  for (const terminal of held) if (terminal !== kept) byStatus.delete(terminal);
  if (!byStatus.has(STATUS.saved)) byStatus.set(STATUS.saved, { status: STATUS.saved, occurredOn: date });
  const beyondApplied = keep > STATUS.applied || [...byStatus.keys()].some((status) => status > STATUS.applied);
  if (beyondApplied && !byStatus.has(STATUS.applied)) {
    byStatus.set(STATUS.applied, { status: STATUS.applied, occurredOn: date });
  }
}

function sortedEvents(byStatus: Map<ApplicationStatus, StatusEvent>): StatusEvent[] {
  return APPLICATION_STATUSES.filter((status) => byStatus.has(status)).map((status) => byStatus.get(status)!);
}

/**
 * Moves an application to `next` on `date` ("YYYY-MM-DD"):
 * - every event above `next` is removed, events below it are kept with their dates;
 * - a terminal status removes the other terminal ones;
 * - Saved is added when missing (creating an application = moving an empty list);
 * - moving above Applied adds Applied when missing;
 * - `next` gets an event dated `date` unless it already has one, which keeps its own date.
 */
export function applyStatusChange(
  events: readonly StatusEvent[],
  next: ApplicationStatus,
  date: string,
): StatusEvent[] {
  const byStatus = new Map(normalizeEvents(events).map((event) => [event.status, event] as const));
  for (const status of [...byStatus.keys()]) if (status > next) byStatus.delete(status);
  withInvariants(byStatus, next, date);
  if (!byStatus.has(next)) byStatus.set(next, { status: next, occurredOn: date });
  return sortedEvents(byStatus);
}

/** The events of a new application created in `status` (default Saved). */
export function initialEvents(status: ApplicationStatus = STATUS.saved, date: string): StatusEvent[] {
  return applyStatusChange([], status, date);
}

/**
 * Dates a step in the timeline ("Add date" or the pencil): an existing event takes the new date; a missing one is
 * added, with the rules that keep the list whole (Applied beneath a later stage, one terminal). Adding a step above
 * the current status makes it current.
 */
export function setEventDate(events: readonly StatusEvent[], status: ApplicationStatus, date: string): StatusEvent[] {
  const byStatus = new Map(normalizeEvents(events).map((event) => [event.status, event] as const));
  byStatus.set(status, { status, occurredOn: date });
  withInvariants(byStatus, status, date);
  return sortedEvents(byStatus);
}

/** The refusal shown when a step cannot be cleared. */
export const CANNOT_CLEAR_SAVED = "Saved can't be cleared; change its date instead.";
export const CANNOT_CLEAR_APPLIED = "Applied can't be cleared while a later stage has a date.";

/** Why a step's date cannot be cleared, or null when it can (Saved never; Applied not beneath a later stage). */
export function clearEventBlocker(events: readonly StatusEvent[], status: ApplicationStatus): string | null {
  if (status === STATUS.saved) return CANNOT_CLEAR_SAVED;
  if (status === STATUS.applied && events.some((event) => event.status > STATUS.applied)) return CANNOT_CLEAR_APPLIED;
  return null;
}

/** Clears a step ("Clear" in the date popover): the event is removed unless `clearEventBlocker` refuses. */
export function removeStatusEvent(events: readonly StatusEvent[], status: ApplicationStatus): StatusEvent[] {
  const list = normalizeEvents(events);
  if (clearEventBlocker(list, status)) return list;
  return list.filter((event) => event.status !== status);
}

/** The date a status was reached, or null. With repeated events the last one wins, as in `normalizeEvents`. */
export function eventDate(events: readonly StatusEvent[], status: ApplicationStatus): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.status === status) return events[index]!.occurredOn;
  }
  return null;
}

/** "Dates can't be in the future." for a date after today; null when it is fine. */
export const FUTURE_DATE_MESSAGE = "Dates can't be in the future.";
export function eventDateBlocker(date: string, now: DateInput): string | null {
  return isFutureDate(date, now) ? FUTURE_DATE_MESSAGE : null;
}

// -------------------------------------------------------------------------------------------------- stepper

export type StepperTone = 'default' | 'success' | 'muted';

export interface StepperStep {
  status: ApplicationStatus;
  label: string;
  /** An event exists for this step (a filled dot, a coloured connector into it). */
  reached: boolean;
  current: boolean;
  /** "YYYY-MM-DD", or null when not reached. */
  date: string | null;
  /** "10/22/26", or '' when not reached. */
  dateLabel: string;
}

export interface StepperModel {
  steps: StepperStep[];
  tone: StepperTone;
  current: ApplicationStatus;
}

const BASE_STEPS: readonly ApplicationStatus[] = [STATUS.saved, STATUS.applied, STATUS.screen, STATUS.interviewing, STATUS.offer];

/** Offer or Accepted turns the stepper green; Withdrawn, Ghosted or Rejected turns it grey. */
export function stepperTone(current: ApplicationStatus): StepperTone {
  if (current === STATUS.offer || current === STATUS.accepted) return 'success';
  if (isTerminalStatus(current)) return 'muted';
  return 'default';
}

function step(events: readonly StatusEvent[], status: ApplicationStatus, current: ApplicationStatus, label: string) {
  const date = eventDate(events, status);
  return { status, label, reached: date !== null, current: status === current, date, dateLabel: date ? formatMDYY(date) : '' };
}

/**
 * The list view's stepper: Saved - Applied - Screen - Interview - Offer, plus a sixth step labelled with the terminal
 * status when the application ended in one.
 */
export function stepperModel(events: readonly StatusEvent[]): StepperModel {
  const current = currentStatus(events);
  const statuses = isTerminalStatus(current) ? [...BASE_STEPS, current] : BASE_STEPS;
  return {
    steps: statuses.map((status) => step(events, status, current, STATUS_INFO[status].stepLabel)),
    tone: stepperTone(current),
    current,
  };
}

/**
 * The detail view's vertical timeline: Saved, Applied, Screen, Interviewing and Offer always, plus any terminal
 * status that occurred, with the board's labels.
 */
export function timelineModel(events: readonly StatusEvent[]): StepperModel {
  const current = currentStatus(events);
  const terminals = TERMINAL_STATUSES.filter((status) => eventDate(events, status) !== null);
  return {
    steps: [...BASE_STEPS, ...terminals].map((status) => step(events, status, current, STATUS_INFO[status].label)),
    tone: stepperTone(current),
    current,
  };
}
