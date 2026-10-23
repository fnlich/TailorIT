// Date display helpers shared by the web app and the API. Every function is pure: "now" is always passed in.
//
// Two kinds of value reach these helpers. Timestamps (ISO-8601 UTC, epoch milliseconds or Date objects) are shown in
// the viewer's local time. Calendar dates ("YYYY-MM-DD": status-event dates, applied dates) are days, not instants, so
// they are read as that day in local time and never shift to the day before west of Greenwich.

/** A Date, epoch milliseconds, an ISO timestamp, or a calendar date "YYYY-MM-DD". */
export type DateInput = Date | number | string;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
/** Indexed by `Date.getDay()` (0 = Sunday). */
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** A local Date for that calendar day, or null when the parts are not a real day (2026-02-31). */
function calendarDay(year: number, month: number, day: number): Date | null {
  const date = new Date(2000, 0, 1);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/** The input as a Date (a calendar date at local midnight), or null for anything unreadable. */
export function toDate(input: DateInput | null | undefined): Date | null {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : new Date(input.getTime());
  if (typeof input === 'number') return Number.isFinite(input) ? new Date(input) : null;
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text) return null;
  const calendar = CALENDAR_DATE.exec(text);
  if (calendar) return calendarDay(Number(calendar[1]), Number(calendar[2]), Number(calendar[3]));
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** "2026-10-22": the local calendar day of the input, or null. */
export function toIsoDate(input: DateInput | null | undefined): string | null {
  const date = toDate(input);
  if (!date) return null;
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** "Oct 22" (tracker cards: "Added Oct 22"); '' for an unreadable input. */
export function formatShortDate(input: DateInput | null | undefined): string {
  const date = toDate(input);
  return date ? `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}` : '';
}

/** "Oct 22, 2026". */
export function formatMediumDate(input: DateInput | null | undefined): string {
  const date = toDate(input);
  return date ? `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}` : '';
}

/** "October 22, 2026" (the date line of a letter). */
export function formatLongDate(input: DateInput | null | undefined): string {
  const date = toDate(input);
  return date ? `${MONTHS_LONG[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}` : '';
}

/** "10/22/26" (stepper dates, the "Applied 10/22/26" chip). */
export function formatMDYY(input: DateInput | null | undefined): string {
  const date = toDate(input);
  return date ? `${date.getMonth() + 1}/${date.getDate()}/${pad2(date.getFullYear() % 100)}` : '';
}

/** "10/22/2026" (en-US `toLocaleDateString()`, written out so every runtime prints the same). */
export function formatMDYYYY(input: DateInput | null | undefined): string {
  const date = toDate(input);
  return date ? `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}` : '';
}

/** "10/22" (the stepper on narrow screens). */
export function formatMD(input: DateInput | null | undefined): string {
  const date = toDate(input);
  return date ? `${date.getMonth() + 1}/${date.getDate()}` : '';
}

/** "10/22/2026, 3:04:05 PM": en-US `toLocaleString()` with a plain space before AM/PM on every runtime. */
export function formatEnUsDateTime(input: DateInput | null | undefined): string {
  const date = toDate(input);
  if (!date) return '';
  const hours = date.getHours();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const time = `${hour12}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ${hours < 12 ? 'AM' : 'PM'}`;
  return `${formatMDYYYY(date)}, ${time}`;
}

function count(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

/**
 * "just now", "5 minutes ago", "2 hours ago", "1 day ago", "3 days ago", "5 months ago", "2 years ago". A time ahead
 * of `now` reads "just now" (clocks drift). '' for an unreadable input.
 */
export function relativeTime(input: DateInput | null | undefined, now: DateInput): string {
  const date = toDate(input);
  const reference = toDate(now);
  if (!date || !reference) return '';
  const elapsed = Math.max(0, reference.getTime() - date.getTime());
  if (elapsed < MINUTE_MS) return 'just now';
  if (elapsed < HOUR_MS) return `${count(Math.floor(elapsed / MINUTE_MS), 'minute')} ago`;
  if (elapsed < DAY_MS) return `${count(Math.floor(elapsed / HOUR_MS), 'hour')} ago`;
  const days = Math.floor(elapsed / DAY_MS);
  if (days < 30) return `${count(days, 'day')} ago`;
  if (days < 365) return `${count(Math.min(11, Math.max(1, Math.floor(days / 30))), 'month')} ago`;
  return `${count(Math.floor(days / 365), 'year')} ago`;
}

/** `relativeTime`, or "-" when there is no date (Simplify's "Last Edited" column before any content edit). */
export function relativeOrDash(input: DateInput | null | undefined, now: DateInput): string {
  return relativeTime(input, now) || '-';
}

/**
 * free_tailor's "Edited ..." line: "Edited just now", "Edited 5 minutes ago", "Edited 6 hours ago", "Edited 3 days ago"
 * under a week, then the date itself ("Edited 10/15/2026"). Null for a missing or unreadable time.
 */
export function editedAgo(input: DateInput | null | undefined, now: DateInput): string | null {
  const date = toDate(input);
  const reference = toDate(now);
  if (!date || !reference) return null;
  const elapsed = Math.max(0, reference.getTime() - date.getTime());
  if (elapsed < MINUTE_MS) return 'Edited just now';
  if (elapsed < HOUR_MS) return `Edited ${count(Math.floor(elapsed / MINUTE_MS), 'minute')} ago`;
  if (elapsed < DAY_MS) return `Edited ${count(Math.floor(elapsed / HOUR_MS), 'hour')} ago`;
  if (elapsed < 7 * DAY_MS) return `Edited ${count(Math.floor(elapsed / DAY_MS), 'day')} ago`;
  return `Edited ${formatMDYYYY(date)}`;
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier); null when either is unreadable. */
export function daysBetween(from: DateInput | null | undefined, to: DateInput | null | undefined): number | null {
  const start = toDate(from);
  const end = toDate(to);
  if (!start || !end) return null;
  // Compared as UTC days built from the local parts, so a DST change in between never makes a day 23 hours long.
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endDay - startDay) / DAY_MS);
}

/** Whether the calendar day of `input` is after the calendar day of `now`. */
export function isFutureDate(input: DateInput | null | undefined, now: DateInput): boolean {
  const days = daysBetween(now, input);
  return days !== null && days > 0;
}

/** The weekday name of the input's calendar day, or null. */
export function weekdayOf(input: DateInput | null | undefined): Weekday | null {
  const date = toDate(input);
  return date ? (WEEKDAYS[date.getDay()] ?? null) : null;
}

const MONTH_BY_NAME = new Map<string, number>(
  MONTHS_LONG.flatMap((name, index) => [
    [name.toLowerCase(), index + 1],
    [name.slice(0, 3).toLowerCase(), index + 1],
  ]),
);
MONTH_BY_NAME.set('sept', 9);

function isoOf(year: number, month: number, day: number): string | null {
  const date = calendarDay(year, month, day);
  return date ? toIsoDate(date) : null;
}

function fullYear(text: string): number {
  const year = Number(text);
  // Two-digit years: 00-69 are 20xx, 70-99 are 19xx (the spreadsheet convention).
  return text.length <= 2 ? (year < 70 ? 2000 + year : 1900 + year) : year;
}

/** An optional time after a date: "T08:15:00Z", " 10:30", " 3:04 PM". */
const TIME_SUFFIX = String.raw`(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?: ?[AaPp][Mm])?(?:Z|[+-]\d{2}:?\d{2})?)?`;
const ISO_LIKE = new RegExp(String.raw`^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})${TIME_SUFFIX}$`);
const NUMERIC_MDY = new RegExp(String.raw`^(\d{1,2})([/-])(\d{1,2})\2(\d{2}|\d{4})${TIME_SUFFIX}$`);

/**
 * A date as people type it into a spreadsheet, as "YYYY-MM-DD", or null. Read: "2026-10-22", "2026/10/22", ISO
 * timestamps (their own calendar part), "10/22/2026", "10/22/26", "10/22/2026 10:30", "10-22-2026", "22.10.2026",
 * "Oct 22, 2026", "Oct 22,2026", "October 22 2026", "22 Oct 2026", "22-Oct-2026" and "Oct 2026" (the 1st). Slashes
 * read month first, as in the US, unless the first number cannot be a month ("22/10/2026"). Separators must agree.
 */
export function parseFlexibleDate(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const value = text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/ ,/g, ',')
    // "Thursday, October 22, 2026": the weekday adds nothing.
    .replace(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,? /i, '');
  if (!value) return null;

  let match = ISO_LIKE.exec(value);
  if (match) return isoOf(Number(match[1]), Number(match[3]), Number(match[4]));

  match = NUMERIC_MDY.exec(value);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[3]);
    const year = fullYear(match[4]!);
    return first > 12 ? isoOf(year, second, first) : isoOf(year, first, second);
  }

  match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  if (match) return isoOf(Number(match[3]), Number(match[2]), Number(match[1]));

  match = /^([A-Za-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?:, ?| )(\d{4})$/.exec(value);
  if (match) {
    const month = MONTH_BY_NAME.get(match[1]!.toLowerCase());
    return month ? isoOf(Number(match[3]), month, Number(match[2])) : null;
  }

  match = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]+)\.?(?:, ?|[ -])(\d{4}|\d{2})$/.exec(value);
  if (match) {
    const month = MONTH_BY_NAME.get(match[2]!.toLowerCase());
    return month ? isoOf(fullYear(match[3]!), month, Number(match[1])) : null;
  }

  match = /^([A-Za-z]+)\.? (\d{4})$/.exec(value);
  if (match) {
    const month = MONTH_BY_NAME.get(match[1]!.toLowerCase());
    return month ? isoOf(Number(match[2]), month, 1) : null;
  }
  return null;
}
