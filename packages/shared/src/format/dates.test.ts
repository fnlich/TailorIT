import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  editedAgo,
  formatEnUsDateTime,
  formatLongDate,
  formatMD,
  formatMDYY,
  formatMDYYYY,
  formatMediumDate,
  formatShortDate,
  isFutureDate,
  monthNumber,
  parseFlexibleDate,
  relativeOrDash,
  relativeTime,
  toDate,
  toIsoDate,
  weekdayOf,
} from './dates';

// Local-time constructors keep these tests independent of the machine's time zone.
const NOW = new Date(2026, 9, 22, 12, 0, 0);
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('calendar dates', () => {
  it('reads YYYY-MM-DD as that local day', () => {
    const date = toDate('2026-10-22');
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(9);
    expect(date?.getDate()).toBe(22);
  });

  it('refuses days that do not exist', () => {
    expect(toDate('2026-02-31')).toBeNull();
    expect(toDate('not a date')).toBeNull();
    expect(toDate('')).toBeNull();
    expect(toDate(null)).toBeNull();
  });

  it('round-trips through toIsoDate', () => {
    expect(toIsoDate('2026-01-05')).toBe('2026-01-05');
    expect(toIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('date formats', () => {
  it.each([
    [formatShortDate, 'Oct 22'],
    [formatMediumDate, 'Oct 22, 2026'],
    [formatLongDate, 'October 22, 2026'],
    [formatMDYY, '10/22/26'],
    [formatMDYYYY, '10/22/2026'],
    [formatMD, '10/22'],
  ])('%o formats the tracker date', (format, expected) => {
    expect(format('2026-10-22')).toBe(expected);
  });

  it('pads two-digit years and leaves months unpadded', () => {
    expect(formatMDYY('2005-03-07')).toBe('3/7/05');
    expect(formatMDYYYY('2005-03-07')).toBe('3/7/2005');
  });

  it('returns empty text for unreadable input', () => {
    expect(formatShortDate('nope')).toBe('');
    expect(formatMDYY(undefined)).toBe('');
  });

  it('prints en-US date-time with AM/PM', () => {
    expect(formatEnUsDateTime(new Date(2026, 9, 22, 15, 4, 5))).toBe('10/22/2026, 3:04:05 PM');
    expect(formatEnUsDateTime(new Date(2026, 9, 22, 0, 0, 9))).toBe('10/22/2026, 12:00:09 AM');
    expect(formatEnUsDateTime(new Date(2026, 9, 22, 12, 30, 0))).toBe('10/22/2026, 12:30:00 PM');
  });
});

describe('relativeTime', () => {
  it.each([
    [0, 'just now'],
    [59 * 1000, 'just now'],
    [MIN, '1 minute ago'],
    [5 * MIN, '5 minutes ago'],
    [2 * HOUR, '2 hours ago'],
    [DAY, '1 day ago'],
    [3 * DAY, '3 days ago'],
    [29 * DAY, '29 days ago'],
    [45 * DAY, '1 month ago'],
    [150 * DAY, '5 months ago'],
    [364 * DAY, '11 months ago'],
    [400 * DAY, '1 year ago'],
    [800 * DAY, '2 years ago'],
  ])('%i ms ago reads %s', (elapsed, expected) => {
    expect(relativeTime(ago(elapsed), NOW)).toBe(expected);
  });

  it('reads a future time as just now', () => {
    expect(relativeTime(new Date(NOW.getTime() + HOUR), NOW)).toBe('just now');
  });

  it('prints a dash when there is no date', () => {
    expect(relativeOrDash(null, NOW)).toBe('-');
    expect(relativeOrDash(ago(2 * HOUR), NOW)).toBe('2 hours ago');
  });
});

describe('editedAgo', () => {
  it('follows free_tailor under a week', () => {
    expect(editedAgo(ago(10 * 1000), NOW)).toBe('Edited just now');
    expect(editedAgo(ago(MIN), NOW)).toBe('Edited 1 minute ago');
    expect(editedAgo(ago(6 * HOUR), NOW)).toBe('Edited 6 hours ago');
    expect(editedAgo(ago(6 * DAY), NOW)).toBe('Edited 6 days ago');
  });

  it('prints the date from seven days on', () => {
    expect(editedAgo(new Date(2026, 9, 15, 12, 0, 0), NOW)).toBe('Edited 10/15/2026');
  });

  it('is null for a missing time', () => {
    expect(editedAgo(undefined, NOW)).toBeNull();
  });
});

describe('day arithmetic', () => {
  it('counts calendar days', () => {
    expect(daysBetween('2026-10-01', '2026-10-22')).toBe(21);
    expect(daysBetween('2026-10-22', '2026-10-01')).toBe(-21);
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });

  it('knows a future day', () => {
    expect(isFutureDate('2026-10-23', NOW)).toBe(true);
    expect(isFutureDate('2026-10-22', NOW)).toBe(false);
    expect(isFutureDate('2026-10-21', NOW)).toBe(false);
  });

  it('names the weekday', () => {
    expect(weekdayOf('2026-10-22')).toBe('Thursday');
    expect(weekdayOf('2026-10-26')).toBe('Monday');
  });
});

describe('parseFlexibleDate', () => {
  it.each([
    ['2026-10-22', '2026-10-22'],
    ['2026/10/22', '2026-10-22'],
    ['2026-10-22T08:15:00Z', '2026-10-22'],
    ['10/22/2026', '2026-10-22'],
    ['10/22/26', '2026-10-22'],
    ['1/5/2026', '2026-01-05'],
    ['22/10/2026', '2026-10-22'],
    ['10-22-2026', '2026-10-22'],
    ['22.10.2026', '2026-10-22'],
    ['Oct 22, 2026', '2026-10-22'],
    ['October 22 2026', '2026-10-22'],
    ['Sept. 3, 2026', '2026-09-03'],
    ['22 Oct 2026', '2026-10-22'],
    ['3rd March 2026', '2026-03-03'],
    ['Oct 2026', '2026-10-01'],
    ['10/22/2026 10:30', '2026-10-22'],
    ['10/22/2026 3:04 PM', '2026-10-22'],
    ['22-Oct-2026', '2026-10-22'],
    ['Oct 22,2026', '2026-10-22'],
    ['2026-10-22 08:15:00', '2026-10-22'],
    ['22-Oct-26', '2026-10-22'],
    ['Thursday, October 22, 2026', '2026-10-22'],
    ['  oct   22 ,  2026 ', '2026-10-22'],
  ])('reads %s', (text, expected) => {
    expect(parseFlexibleDate(text)).toBe(expected);
  });

  it.each(['', 'yesterday', '13/13/2026', '2026-02-30', 'Foo 22, 2026', '2026', '2026-10-22 garbage', '2026-10/22'])(
    'refuses %s',
    (text) => {
    expect(parseFlexibleDate(text)).toBeNull();
    },
  );
});

describe('monthNumber', () => {
  it('reads month names and abbreviations in any case', () => {
    expect(monthNumber('Jan')).toBe(1);
    expect(monthNumber('jan.')).toBe(1);
    expect(monthNumber('September')).toBe(9);
    expect(monthNumber('Sept')).toBe(9);
    expect(monthNumber(' DEC ')).toBe(12);
    expect(monthNumber('Smarch')).toBeNull();
    expect(monthNumber('')).toBeNull();
  });
});
