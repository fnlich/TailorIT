import type { SalaryPeriod, WorkArrangement } from '@tailorit/shared';
import { IngestError } from '../types';

// Small readers shared by the board adapters: the board's own JSON is untrusted, so every field is checked.

export type Json = Record<string, unknown>;

export function isRecord(value: unknown): value is Json {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function str(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() ? value.trim() : null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function records(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** A required text value of a source's config ("token", "site", "board"). */
export function configText(config: Record<string, unknown>, key: string, what: string): string {
  const value = str(config[key]);
  if (!value) throw new IngestError(`This source has no ${what}. Edit the source and add it.`);
  return value;
}

/** A board slug as a company name: "palantir" -> "Palantir", "acme-robotics" -> "Acme Robotics". */
export function nameFromSlug(slug: string): string {
  return slug
    .replace(/[-_.]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\p{Ll}/gu, (letter) => letter.toUpperCase());
}

/** Remote / Hybrid / On-site in any board's spelling ("OnSite", "on-site", "In office"). */
export function arrangementOf(value: unknown): WorkArrangement | null {
  const text = str(value)?.toLowerCase().replace(/[\s_-]+/g, '') ?? '';
  if (!text || text === 'unspecified') return null;
  if (text.includes('hybrid')) return 'hybrid';
  if (text.includes('remote')) return 'remote';
  if (/onsite|inoffice|inperson|office/.test(text)) return 'onsite';
  return null;
}

/** A pay interval ("1 YEAR", "per-hour-wage", "hourly") as a salary period. */
export function periodOf(value: unknown): SalaryPeriod | null {
  const text = str(value)?.toLowerCase() ?? '';
  if (/year|annual|yr/.test(text)) return 'year';
  if (/month/.test(text)) return 'month';
  if (/week/.test(text)) return 'week';
  if (/day|daily/.test(text)) return 'day';
  if (/hour/.test(text)) return 'hour';
  return null;
}
