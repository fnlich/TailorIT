import { describe, expect, it } from 'vitest';
import { countLabel, editedLine, formatSalary, formatShortDate, relativeTime } from './format';

const NOW = Date.parse('2026-10-23T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeTime (Simplify wording)', () => {
  it.each([
    [ago(20_000), 'just now'],
    [ago(MIN), '1 minute ago'],
    [ago(5 * MIN), '5 minutes ago'],
    [ago(2 * HOUR), '2 hours ago'],
    [ago(3 * HOUR), '3 hours ago'],
    [ago(DAY), '1 day ago'],
    [ago(3 * DAY), '3 days ago'],
    [ago(65 * DAY), '2 months ago'],
    [ago(800 * DAY), '2 years ago'],
  ])('%s → %s', (value, expected) => {
    expect(relativeTime(value, NOW)).toBe(expected);
  });

  it('prints "-" for a missing date and "just now" for the future', () => {
    expect(relativeTime(null, NOW)).toBe('-');
    expect(relativeTime('not a date', NOW)).toBe('-');
    expect(relativeTime(new Date(NOW + HOUR), NOW)).toBe('just now');
  });
});

describe('editedLine', () => {
  it('says how long ago within a week, then the date', () => {
    expect(editedLine(ago(10_000), NOW)).toBe('Edited just now');
    expect(editedLine(ago(6 * HOUR), NOW)).toBe('Edited 6 hours ago');
    expect(editedLine(ago(10 * DAY), NOW)).toMatch(/^Edited Oct 13, 2026$/);
  });
});

describe('formatters', () => {
  it('formats short dates, salaries and counts', () => {
    expect(formatShortDate(new Date(2026, 9, 22))).toBe('10/22/26');
    expect(formatSalary(120_000)).toBe('$120k');
    expect(formatSalary(95_500)).toBe('$95,500');
    expect(countLabel(1, 'resume', 'resumes')).toBe('1 resume');
    expect(countLabel(3, 'resume', 'resumes')).toBe('3 resumes');
  });
});
