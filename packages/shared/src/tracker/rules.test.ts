import { describe, expect, it } from 'vitest';
import {
  applyStatusChange,
  clearEventBlocker,
  currentStatus,
  eventDateBlocker,
  initialEvents,
  normalizeEvents,
  removeStatusEvent,
  setEventDate,
  stepperModel,
  stepperTone,
  timelineModel,
  type StatusEvent,
} from './rules';
import { APPLICATION_STATUSES, STATUS, TERMINAL_STATUSES, emptyColumnText, parseStatus, type ApplicationStatus } from './statuses';

const D0 = '2026-10-01';
const D1 = '2026-10-10';
const ev = (status: ApplicationStatus, occurredOn = D0): StatusEvent => ({ status, occurredOn });
const statuses = (events: StatusEvent[]) => events.map((event) => event.status);

/** A realistic history that reached `status`: Saved, Applied, then the stages up to it. */
function historyAt(status: ApplicationStatus): StatusEvent[] {
  if (status === STATUS.saved) return [ev(1)];
  const path: ApplicationStatus[] = [1, 2];
  for (const stage of [11, 12, 13] as const) if (stage <= status && status < 21) path.push(stage);
  if (status >= 21) path.push(12, status);
  return path.map((code) => ev(code));
}

describe('applyStatusChange: every transition keeps the rules', () => {
  const pairs = APPLICATION_STATUSES.flatMap((from) => APPLICATION_STATUSES.map((to) => [from, to] as const));
  it.each(pairs)('%i -> %i', (from, to) => {
    const before = historyAt(from);
    const after = applyStatusChange(before, to, D1);
    expect(currentStatus(after)).toBe(to);
    expect(statuses(after)).toContain(STATUS.saved);
    if (to > STATUS.applied) expect(statuses(after)).toContain(STATUS.applied);
    expect(after.every((event) => event.status <= to)).toBe(true);
    expect(after.filter((event) => (TERMINAL_STATUSES as readonly number[]).includes(event.status)).length).toBeLessThanOrEqual(1);
    // Events below the new status keep their own dates.
    for (const event of before.filter((held) => held.status < to)) {
      if ((TERMINAL_STATUSES as readonly number[]).includes(event.status) && event.status !== to) continue;
      expect(after).toContainEqual(event);
    }
    // Sorted, one per status.
    expect(statuses(after)).toEqual([...new Set(statuses(after))].sort((a, b) => a - b));
  });
});

describe('applyStatusChange: specific moves', () => {
  it('creates with a Saved event, and Applied when created as Applied', () => {
    expect(initialEvents(STATUS.saved, D0)).toEqual([ev(1)]);
    expect(initialEvents(STATUS.applied, D0)).toEqual([ev(1), ev(2)]);
    expect(initialEvents(undefined, D0)).toEqual([ev(1)]);
  });

  it('auto-adds Applied when moving above it', () => {
    expect(applyStatusChange([ev(1)], STATUS.interviewing, D1)).toEqual([ev(1), ev(2, D1), ev(12, D1)]);
  });

  it('removes the events above the new status', () => {
    const events = [ev(1), ev(2), ev(11), ev(12)];
    expect(applyStatusChange(events, STATUS.applied, D1)).toEqual([ev(1), ev(2)]);
  });

  it('keeps an Offer below a Rejected', () => {
    const events = [ev(1), ev(2), ev(12), ev(13)];
    expect(applyStatusChange(events, STATUS.rejected, D1)).toEqual([ev(1), ev(2), ev(12), ev(13), ev(23, D1)]);
  });

  it('keeps one terminal status', () => {
    const rejected = [ev(1), ev(2), ev(23)];
    expect(applyStatusChange(rejected, STATUS.accepted, D1)).toEqual([ev(1), ev(2), ev(24, D1)]);
    const withdrawn = [ev(1), ev(2), ev(21)];
    expect(applyStatusChange(withdrawn, STATUS.ghosted, D1)).toEqual([ev(1), ev(2), ev(22, D1)]);
    expect(applyStatusChange([ev(1), ev(2), ev(22)], STATUS.withdrawn, D1)).toEqual([ev(1), ev(2), ev(21, D1)]);
  });

  it('keeps the date of a status it already has', () => {
    expect(applyStatusChange([ev(1), ev(2), ev(12)], STATUS.applied, D1)).toEqual([ev(1), ev(2)]);
    expect(applyStatusChange([ev(1), ev(2)], STATUS.applied, D1)).toEqual([ev(1), ev(2)]);
  });

  it('adds a missing Saved to an imported history', () => {
    expect(applyStatusChange([ev(2)], STATUS.screen, D1)).toEqual([ev(1, D1), ev(2), ev(11, D1)]);
  });
});

describe('event dates', () => {
  it('reads the current status as the highest event', () => {
    expect(currentStatus([ev(1), ev(12), ev(2)])).toBe(12);
    expect(currentStatus([])).toBe(1);
  });

  it('normalizes duplicates and order', () => {
    expect(normalizeEvents([ev(12), ev(1), ev(12, D1)])).toEqual([ev(1), ev(12, D1)]);
  });

  it('dates an existing step, or adds a missing one with the rules', () => {
    expect(setEventDate([ev(1), ev(2), ev(12)], STATUS.applied, D1)).toEqual([ev(1), ev(2, D1), ev(12)]);
    expect(setEventDate([ev(1), ev(2), ev(12)], STATUS.screen, D1)).toEqual([ev(1), ev(2), ev(11, D1), ev(12)]);
    expect(setEventDate([ev(1)], STATUS.offer, D1)).toEqual([ev(1), ev(2, D1), ev(13, D1)]);
    expect(setEventDate([ev(1), ev(2), ev(23)], STATUS.withdrawn, D1)).toEqual([ev(1), ev(2), ev(21, D1)]);
  });

  it('restores a missing Applied when dating any step of a later-stage history', () => {
    expect(setEventDate([ev(1), ev(11)], STATUS.saved, D1)).toEqual([ev(1, D1), ev(2, D1), ev(11)]);
  });

  it('repairs a history holding two terminal statuses on any change', () => {
    expect(setEventDate([ev(1), ev(2), ev(21), ev(22)], STATUS.saved, D1)).toEqual([ev(1, D1), ev(2), ev(22)]);
    expect(setEventDate([ev(1), ev(2), ev(21), ev(22)], STATUS.withdrawn, D1)).toEqual([ev(1), ev(2), ev(21, D1)]);
  });

  it('reads the last of repeated events everywhere', () => {
    const events = [ev(1), ev(2, D0), ev(2, D1)];
    expect(normalizeEvents(events)).toEqual([ev(1), ev(2, D1)]);
    expect(stepperModel(events).steps[1]?.date).toBe(D1);
  });

  it('clears a step unless it is Saved, or Applied beneath a later stage', () => {
    const events = [ev(1), ev(2), ev(11), ev(12)];
    expect(removeStatusEvent(events, STATUS.interviewing)).toEqual([ev(1), ev(2), ev(11)]);
    expect(removeStatusEvent(events, STATUS.saved)).toEqual(events);
    expect(removeStatusEvent(events, STATUS.applied)).toEqual(events);
    expect(clearEventBlocker(events, STATUS.applied)).toMatch(/later stage/);
    expect(clearEventBlocker([ev(1), ev(2)], STATUS.applied)).toBeNull();
  });

  it('blocks future dates', () => {
    expect(eventDateBlocker('2026-10-23', new Date(2026, 9, 22, 12))).toBe("Dates can't be in the future.");
    expect(eventDateBlocker('2026-10-22', new Date(2026, 9, 22, 12))).toBeNull();
  });
});

describe('stepperModel', () => {
  it('shows five steps with dates for the reached ones', () => {
    const model = stepperModel([ev(1, '2026-10-01'), ev(2, '2026-10-05'), ev(12, '2026-10-20')]);
    expect(model.steps.map((step) => step.label)).toEqual(['Saved', 'Applied', 'Screen', 'Interview', 'Offer']);
    expect(model.steps.map((step) => step.reached)).toEqual([true, true, false, true, false]);
    expect(model.steps.map((step) => step.dateLabel)).toEqual(['10/1/26', '10/5/26', '', '10/20/26', '']);
    expect(model.steps.find((step) => step.current)?.status).toBe(12);
    expect(model.tone).toBe('default');
  });

  it('adds a sixth step for a terminal status and greys it', () => {
    const model = stepperModel([ev(1), ev(2), ev(12), ev(23)]);
    expect(model.steps.map((step) => step.label)).toEqual(['Saved', 'Applied', 'Screen', 'Interview', 'Offer', 'Rejected']);
    expect(model.tone).toBe('muted');
  });

  it('turns green on Offer and Accepted', () => {
    expect(stepperModel([ev(1), ev(2), ev(13)]).tone).toBe('success');
    const accepted = stepperModel([ev(1), ev(2), ev(13), ev(24)]);
    expect(accepted.tone).toBe('success');
    expect(accepted.steps.at(-1)?.label).toBe('Accepted');
  });

  it.each([
    [1, 'default'],
    [2, 'default'],
    [11, 'default'],
    [12, 'default'],
    [13, 'success'],
    [21, 'muted'],
    [22, 'muted'],
    [23, 'muted'],
    [24, 'success'],
  ] as const)('tone of %i is %s', (status, tone) => {
    expect(stepperTone(status)).toBe(tone);
  });

  it('lists the timeline with board labels and any terminal that occurred', () => {
    const model = timelineModel([ev(1), ev(2), ev(22)]);
    expect(model.steps.map((step) => step.label)).toEqual(['Saved', 'Applied', 'Screen', 'Interviewing', 'Offer', 'Ghosted']);
  });
});

describe('status helpers', () => {
  it('parses codes, numeric strings and keys', () => {
    expect(parseStatus(12)).toBe(12);
    expect(parseStatus(' 23 ')).toBe(23);
    expect(parseStatus('interviewing')).toBe(12);
    expect(parseStatus('99')).toBeNull();
    expect(parseStatus(3)).toBeNull();
    expect(parseStatus('constructor')).toBeNull();
    expect(parseStatus('__proto__')).toBeNull();
    expect(parseStatus('0x2')).toBeNull();
  });

  it('writes the empty column line in lower case', () => {
    expect(emptyColumnText(12)).toBe('Move applications into interviewing.');
  });
});
