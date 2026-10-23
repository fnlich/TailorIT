import { formatMDYY, formatMediumDate, toDate, type DateInput } from '../format/dates';
import { SALARY_PERIOD_SUFFIX, WORK_ARRANGEMENT_LABEL, type SalaryPeriod, type WorkArrangement } from './enums';
import { CURRENCY_SYMBOL } from './salary';

export const NO_SALARY_LABEL = 'No salary listed';

function trimmed(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
}

/** "120k", "1.25M", "62.50", "60": the amount part of a salary chip. */
export function compactAmount(value: number): string {
  const size = Math.abs(value);
  if (size >= 1_000_000) return `${trimmed(value / 1_000_000, 2)}M`;
  if (size >= 1_000) return `${trimmed(value / 1_000, 1)}k`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** "$", "£", "CA$" ...; an unknown code prints as "XYZ ". */
export function currencySymbol(currency: string | null | undefined): string {
  const code = (currency || 'USD').toUpperCase();
  return Object.hasOwn(CURRENCY_SYMBOL, code) ? CURRENCY_SYMBOL[code]! : `${code} `;
}

const usable = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Simplify's salary text: "$120k - $150k/yr", "£325k - £390k/yr", "$60/hr", "$120k+/yr" (no maximum),
 * "Up to $150k/yr" (no minimum). '' when there is no amount; see `salaryLabel` for the "No salary listed" fallback.
 */
export function formatSalaryRange(
  min: number | null | undefined,
  max: number | null | undefined,
  currency?: string | null,
  period?: SalaryPeriod | null,
): string {
  const symbol = currencySymbol(currency);
  const suffix = period ? SALARY_PERIOD_SUFFIX[period] : '';
  const low = usable(min) ? min : null;
  const high = usable(max) ? max : null;
  if (low === null && high === null) return '';
  if (low !== null && high !== null && compactAmount(low) !== compactAmount(high)) {
    const [from, to] = low <= high ? [low, high] : [high, low];
    return `${symbol}${compactAmount(from)} - ${symbol}${compactAmount(to)}${suffix}`;
  }
  if (low !== null && high === null) return `${symbol}${compactAmount(low)}+${suffix}`;
  if (low === null && high !== null) return `Up to ${symbol}${compactAmount(high)}${suffix}`;
  return `${symbol}${compactAmount((low ?? high)!)}${suffix}`;
}

/** The facts grid's salary line: the range, or "No salary listed". */
export function salaryLabel(
  salary: { min: number | null; max: number | null; currency: string | null; period: SalaryPeriod | null } | null,
): string {
  if (!salary) return NO_SALARY_LABEL;
  return formatSalaryRange(salary.min, salary.max, salary.currency, salary.period) || NO_SALARY_LABEL;
}

/**
 * The card's location line: "Fremont, CA, USA · In Person", with " + N more" when the posting names several places
 * (`count` is the total). No arrangement prints the place alone; no place prints "N locations" or the arrangement.
 */
export function formatLocationLine(
  primary: string | null | undefined,
  count: number,
  arrangement: WorkArrangement | null | undefined,
): string {
  const place = (primary ?? '').trim();
  const others = Math.max(0, count - 1);
  let where = place;
  if (place && others > 0) where = `${place} + ${others} more`;
  else if (!place && count > 1) where = `${count} locations`;
  const how = arrangement ? WORK_ARRANGEMENT_LABEL[arrangement] : '';
  return [where, how].filter(Boolean).join(' · ');
}

export type LiveChipKind = 'posted' | 'updated' | 'live' | 'inactive';

export interface LiveChip {
  kind: LiveChipKind;
  label: string;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Simplify's freshness chip. An inactive posting, or one posted in the last 7 days: "Posted on {date}"; else one
 * updated in the last 7 days: "Updated on {date}"; else "Confirmed live in the last 24 hours" (the daily ATS check
 * keeps `active` honest). An inactive posting with no dates at all reads "No longer accepting applications".
 */
export function liveChip(
  job: { active: boolean; postedAt?: DateInput | null; updatedAt?: DateInput | null },
  now: DateInput,
): LiveChip {
  const reference = toDate(now)?.getTime() ?? Date.now();
  const posted = toDate(job.postedAt ?? null);
  const updated = toDate(job.updatedAt ?? null);
  const recent = (date: Date | null) => date !== null && reference - date.getTime() <= WEEK_MS;
  if ((!job.active || recent(posted)) && posted) return { kind: 'posted', label: `Posted on ${formatMediumDate(posted)}` };
  if (!job.active && updated) return { kind: 'updated', label: `Updated on ${formatMediumDate(updated)}` };
  if (!job.active) return { kind: 'inactive', label: 'No longer accepting applications' };
  if (recent(updated)) return { kind: 'updated', label: `Updated on ${formatMediumDate(updated!)}` };
  return { kind: 'live', label: 'Confirmed live in the last 24 hours' };
}

/** The detail header's chip once the job is tracked as applied: "Applied 10/22/26". */
export function appliedChipLabel(date: DateInput): string {
  const text = formatMDYY(date);
  return text ? `Applied ${text}` : 'Applied';
}
