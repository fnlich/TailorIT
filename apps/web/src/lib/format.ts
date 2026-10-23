/*
 * Date and number wording used across the app. Pure functions: callers pass `now` (see useNow) so a render never
 * reads the clock itself.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function toTime(value: string | number | Date | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const time = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * Simplify's table wording: "just now", "5 minutes ago", "3 hours ago", "1 day ago", "2 months ago", "1 year ago".
 * Returns `empty` (Simplify's "-") for a missing date; a time ahead of the clock reads "just now".
 */
export function relativeTime(value: string | number | Date | null | undefined, now: number, empty = '-'): string {
  const time = toTime(value);
  if (time === null) return empty;
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${plural(Math.floor(elapsed / MINUTE), 'minute')} ago`;
  if (elapsed < DAY) return `${plural(Math.floor(elapsed / HOUR), 'hour')} ago`;
  const days = Math.floor(elapsed / DAY);
  if (days < 30) return `${plural(days, 'day')} ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${plural(Math.max(1, months), 'month')} ago`;
  return `${plural(Math.floor(days / 365.25), 'year')} ago`;
}

/** free_tailor's card line: "Edited just now" … "Edited 6 days ago", then "Edited Oct 22, 2026". */
export function editedLine(value: string | number | Date | null | undefined, now: number): string {
  const time = toTime(value);
  if (time === null) return 'Not edited yet';
  const elapsed = Math.max(0, now - time);
  if (elapsed < 7 * DAY) {
    const ago = relativeTime(time, now);
    return ago === 'just now' ? 'Edited just now' : `Edited ${ago}`;
  }
  return `Edited ${formatDate(time)}`;
}

/** "Oct 22, 2026". */
export function formatDate(value: string | number | Date | null | undefined, empty = '-'): string {
  const time = toTime(value);
  if (time === null) return empty;
  return new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Oct 22" (tracker cards: "Added Oct 22"). */
export function formatMonthDay(value: string | number | Date | null | undefined, empty = '-'): string {
  const time = toTime(value);
  if (time === null) return empty;
  return new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "10/22/26" (stepper dates, "Applied 10/22/26"). */
export function formatShortDate(value: string | number | Date | null | undefined, empty = '-'): string {
  const time = toTime(value);
  if (time === null) return empty;
  const date = new Date(time);
  return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(-2)}`;
}

/** "$120k" for whole thousands, "$95,500" otherwise. */
export function formatSalary(amount: number | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '';
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  if (amount >= 1000 && amount % 1000 === 0) return `${symbol}${amount / 1000}k`;
  return `${symbol}${Math.round(amount).toLocaleString('en-US')}`;
}

/** "1 resume" / "3 resumes". */
export function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
