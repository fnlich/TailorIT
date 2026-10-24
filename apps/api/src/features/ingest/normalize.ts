import { createHash } from 'node:crypto';
import {
  COMPANY_SIZE_IDS,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  LEADERSHIP,
  SALARY_PERIODS,
  WORK_ARRANGEMENTS,
  companySizeBucket,
  currencyForCountry,
  formatLocation,
  htmlToText,
  inferEmploymentType,
  inferWorkArrangement,
  isJobCategoryId,
  isJobSubcategoryId,
  linkKey,
  normalizeCompanyName,
  normalizeIndustry,
  normalizeJobText,
  parseLocations,
  parseSalary,
  subcategoryParent,
  tidyText,
  toAnnualUsd,
  type CompanySizeId,
  type EmploymentType,
  type ExperienceLevel,
  type Leadership,
  type ParsedLocation,
  type SalaryPeriod,
  type WorkArrangement,
} from '@tailorit/shared';
import { analyzeDeterministic, type AnalysisDraft } from '../job-analysis/deterministic';
import { sanitizeDescription, textToHtml } from './html';
import { IngestError, type ProvidedAnalysis, type RawCompany, type RawPosting, type RawSalary } from './types';

// Turns an adapter's RawPosting into the row TailorIT stores (pure: no database, no clock). Structured source fields
// always win; the shared parsers read the title, the location strings and the text for whatever the source left out.

/**
 * Bump when normalisation changes what it stores, so every posting is rewritten on its source's next run (the
 * analyses' facets are filled and Claude's facts put back as each one is written: ingest/store.ts `writeAnalyses`).
 * 2: the description gives the work arrangement only when it says how the role is worked ("remote monitoring",
 * "on-site interviews" and "hybrid cloud" set nothing); the location text is read as before.
 */
export const NORMALIZE_VERSION = 2;

const MAX_TITLE = 300;
const MAX_TEXT = 100_000;
const MAX_HTML = 200_000;

export interface NormalizedCompany {
  name: string;
  nameKey: string;
  tagline: string | null;
  about: string | null;
  website: string | null;
  sizeBucket: CompanySizeId | null;
  industry: string | null;
  headquarters: string | null;
  foundedYear: number | null;
  stage: string | null;
  funding: string | null;
  links: Array<{ label: string; url: string }>;
  sponsorsH1b: boolean | null;
  logoPath: string | null;
}

export interface NormalizedSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
  raw: string | null;
  annualUsdMin: number | null;
  annualUsdMax: number | null;
}

export interface NormalizedPosting {
  sourceJobId: string;
  title: string;
  /** normalizeJobTitle-like key for the cross-source dedupe. */
  titleKey: string;
  company: NormalizedCompany;
  descriptionHtml: string;
  descriptionText: string;
  applyUrl: string;
  linkKey: string | null;
  contentHash: string;
  employmentType: EmploymentType;
  workArrangement: WorkArrangement | null;
  experienceLevels: ExperienceLevel[];
  leadership: Leadership | null;
  categoryId: string | null;
  subcategoryIds: string[];
  /** undefined: the source has not said yet (keep what is stored); null: no salary. */
  salary: NormalizedSalary | null | undefined;
  /** True when the salary came from the pay supplement (Greenhouse): it marks the posting as pay-checked. */
  payChecked: boolean;
  sponsorsH1b: boolean | null;
  requiresClearance: boolean | null;
  degree: string | null;
  industry: string | null;
  locations: ParsedLocation[];
  locationsText: string;
  primaryLocation: string;
  locationCount: number;
  postedAt: string | null;
  sourceUpdatedAt: string | null;
  verified: boolean;
  active: boolean;
  deterministic: AnalysisDraft;
  provided: ProvidedAnalysis | null;
}

/** A stable JSON text: object keys sorted at every depth, undefined dropped. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** What a posting's change check compares: everything the adapter read except the per-posting supplement. */
export function sourceHashOf(raw: RawPosting): string {
  const { supplement: _supplement, ...listed } = raw;
  return sha256(`v${NORMALIZE_VERSION}\n${stableStringify(listed)}`);
}

/** jobs.content_hash: SHA-256 of the description's whitespace-normalised text (shared normalizeJobText). */
export function contentHashOf(text: string): string {
  return sha256(normalizeJobText(text));
}

/** An instant as ISO UTC, from ISO text, a date, or epoch milliseconds; null when unreadable. */
export function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date =
    value instanceof Date
      ? value
      : typeof value === 'number'
        ? new Date(value)
        : typeof value === 'string'
          ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? `${value.trim()}T00:00:00Z` : value.trim())
          : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  return year >= 1990 && year <= 2200 ? date.toISOString() : null;
}

export function cleanUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function text(value: unknown, max = 2000): string | null {
  const tidy = tidyText(value);
  return tidy ? tidy.slice(0, max) : null;
}

export function normalizeCompany(raw: RawCompany): NormalizedCompany {
  const name = text(raw.name, 200);
  if (!name) throw new IngestError('The posting names no company.');
  const nameKey = normalizeCompanyName(name) || name.toLowerCase().replace(/\s+/g, '');
  const size =
    raw.sizeBucket && (COMPANY_SIZE_IDS as readonly string[]).includes(raw.sizeBucket)
      ? raw.sizeBucket
      : companySizeBucket(raw.employees ?? null);
  const founded = typeof raw.foundedYear === 'number' && raw.foundedYear >= 1600 && raw.foundedYear <= 2200 ? raw.foundedYear : null;
  return {
    name,
    nameKey,
    tagline: text(raw.tagline, 300),
    about: raw.about?.trim() ? raw.about.trim().slice(0, 5000) : null,
    website: cleanUrl(raw.website),
    sizeBucket: size,
    industry: raw.industry ? (normalizeIndustry(raw.industry) ?? null) : null,
    headquarters: text(raw.headquarters, 200),
    foundedYear: founded,
    stage: text(raw.stage, 100),
    funding: text(raw.funding, 100),
    links: (raw.links ?? [])
      .map((link) => ({ label: text(link.label, 60) ?? '', url: cleanUrl(link.url) ?? '' }))
      .filter((link) => link.label && link.url),
    sponsorsH1b: typeof raw.sponsorsH1b === 'boolean' ? raw.sponsorsH1b : null,
    logoPath: text(raw.logoPath, 500),
  };
}

const SALARY_CUE =
  /\b(?:salary|salaries|compensation|pay(?:\s+range)?|base\s+pay|wage|hourly\s+rate|ote|on-target|earnings|stipend|annual\s+(?:base|salary)|starting\s+at|ctc|lpa)\b/i;

/**
 * A salary stated in the description: the first line that talks about pay and carries an amount with a currency
 * ("The estimated salary range for this position is $135,000 - $200,000/year"), or a short line that is nothing but
 * a plausible range ("$110K–$160K, depending on experience", "$100-130/hr"). Null when no line does. Funding rounds
 * and revenue figures ("$1M - $5M ARR") are not salaries.
 */
export function salaryFromText(description: string): RawSalary | null {
  for (const line of description.split(/\n+/)) {
    const cued = SALARY_CUE.test(line);
    if (line.length > (cued ? 600 : 160)) continue;
    const parsed = parseSalary(line);
    if (!parsed || parsed.currency === null) continue;
    const top = parsed.max ?? parsed.min ?? 0;
    // A "salary" of $5 or $40M is a misread (a stipend line's day count, a funding round).
    if (top < 10 || top > 5_000_000) continue;
    if (!cued) {
      // Without a word about pay, only a full range of salary proportions counts.
      if (parsed.min === null || parsed.max === null || parsed.max > parsed.min * 3 || top > 1_000_000) continue;
    }
    return { ...parsed, raw: line.trim().slice(0, 200) };
  }
  return null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** A salary with its yearly US-dollar range; null when it states no amount (and has no text worth keeping). */
export function normalizeSalary(raw: RawSalary | null | undefined, countryCode: string | null): NormalizedSalary | null {
  if (!raw) return null;
  let min = finiteOrNull(raw.min);
  let max = finiteOrNull(raw.max);
  if (min === 0) min = null;
  if (max === 0) max = null;
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  const period = raw.period && (SALARY_PERIODS as readonly string[]).includes(raw.period) ? raw.period : null;
  const currencyText = typeof raw.currency === 'string' ? raw.currency.trim().toUpperCase() : '';
  const currency = /^[A-Z]{3}$/.test(currencyText) ? currencyText : min !== null || max !== null ? (currencyForCountry(countryCode) ?? 'USD') : null;
  const rawText = text(raw.raw ?? null, 200);
  if (min === null && max === null && !rawText) return null;
  const annual = toAnnualUsd(min, max, currency, period);
  return { min, max, currency, period, raw: rawText, annualUsdMin: annual?.min ?? null, annualUsdMax: annual?.max ?? null };
}

const CLEARANCE_REQUIRED =
  /\b(?:active|current|existing)\s+(?:(?:dod|us|u\.s\.)\s+)?(?:secret|top\s+secret|ts\/sci|ts|security)\s+clearance\b|\bmust\s+(?:hold|have|possess|maintain|be\s+able\s+to\s+(?:obtain|get))\s+(?:an?\s+)?(?:active\s+)?(?:(?:secret|top\s+secret|ts\/sci|security|government)\s+)?clearance\b|\bclearance\s+(?:is\s+)?required\b|\brequires?\s+(?:an?\s+)?(?:active\s+)?(?:secret|top\s+secret|ts\/sci|security)\s+clearance\b|\bts\/sci\b|\bpolygraph\b/i;
const NO_CLEARANCE = /\bno\s+(?:security\s+)?clearance\s+(?:is\s+)?(?:required|needed)\b|\bclearance\s+(?:is\s+)?not\s+required\b/i;

/** True when the text says a security clearance is required; null when it does not say. */
export function inferClearance(description: string): boolean | null {
  if (NO_CLEARANCE.test(description)) return false;
  return CLEARANCE_REQUIRED.test(description) ? true : null;
}

const NO_SPONSORSHIP =
  /\b(?:(?:not|unable\s+to|cannot|can['’]?t|won['’]?t|will\s+not|do(?:es)?\s+not)\s+(?:offer|provide|sponsor|support)\s+(?:visa\s+|h-?1b\s+|work\s+visa\s+|employment\s+visa\s+)?sponsorship|(?:visa|h-?1b)\s+sponsorship\s+(?:is\s+)?(?:not\s+(?:available|offered|provided)|unavailable)|without\s+(?:the\s+need\s+for\s+)?(?:current\s+or\s+future\s+)?(?:visa\s+)?sponsorship|no\s+(?:visa\s+|h-?1b\s+)?sponsorship)\b/i;
const SPONSORSHIP =
  /\b(?:(?:visa|h-?1b)\s+sponsorship\s+(?:is\s+)?(?:available|offered|provided)|(?:we|will)\s+(?:offer|provide|sponsor)\s+(?:visa\s+|h-?1b\s+)?sponsorship|sponsors?\s+h-?1b)\b/i;

/** Whether the posting offers visa sponsorship, when it says. */
export function inferSponsorship(description: string): boolean | null {
  if (NO_SPONSORSHIP.test(description)) return false;
  return SPONSORSHIP.test(description) ? true : null;
}

const DEGREES: ReadonlyArray<readonly [string, RegExp]> = [
  ['High School', /\b(?:high\s+school\s+(?:diploma|degree|education)|ged)\b/i],
  ["Associate's", /\bassociate['’]?s?\s+degree\b/i],
  ["Bachelor's", /\b(?:bachelor['’]?s?|b\.?s\.?c?|b\.?a\.?|b\.?eng|undergraduate)\s*(?:degree|in\b|of\b)|\bbachelor['’]?s\b|\bfour[\s-]year\s+degree\b/i],
  ["Master's", /\b(?:master['’]?s?|m\.?s\.?c?|m\.?eng|mba)\s*(?:degree|in\b|of\b)|\bmaster['’]?s\b/i],
  ['PhD', /\b(?:ph\.?\s?d|doctorate|doctoral\s+degree)\b/i],
];

/** The lowest degree the requirements name ("Bachelor's"), or null. */
export function inferDegree(requirements: string): string | null {
  for (const [degree, pattern] of DEGREES) if (pattern.test(requirements)) return degree;
  return null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** The title as a dedupe key: lower case, punctuation as spaces, whitespace collapsed. */
export function titleKeyOf(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function placesOf(raw: RawPosting): ParsedLocation[] {
  const parsed = parseLocations((raw.locations ?? []).filter((item) => typeof item === 'string' && item.trim()));
  const places = parsed.length > 0 ? parsed : (raw.places ?? []);
  const hint = typeof raw.countryHint === 'string' && /^[A-Za-z]{2}$/.test(raw.countryHint) ? raw.countryHint.toUpperCase() : null;
  if (!hint) return places;
  // "Remote" on a US posting is "Remote in USA"; a place in another country keeps its own.
  return places.map((place) => (place.countryCode || (!place.city && !place.region && !place.isRemote) ? place : { ...place, countryCode: hint }));
}

/**
 * One posting as stored. Throws IngestError for a posting that cannot be a job (no title, no company, no link).
 * `now` is only used to judge nothing here; dates come from the source.
 */
export function normalizePosting(raw: RawPosting): NormalizedPosting {
  const title = text(raw.title, MAX_TITLE);
  if (!title) throw new IngestError('The posting has no title.');
  const company = normalizeCompany(raw.company);
  const applyUrl = cleanUrl(raw.url);
  if (!applyUrl) throw new IngestError(`"${title}" has no link to the original posting.`);
  const sourceJobId = String(raw.sourceJobId ?? '').trim().slice(0, 300);
  if (!sourceJobId) throw new IngestError(`"${title}" has no id.`);

  const html = (
    raw.descriptionHtml?.trim()
      ? sanitizeDescription(raw.descriptionHtml)
      : raw.descriptionText?.trim()
        ? textToHtml(raw.descriptionText)
        : ''
  ).slice(0, MAX_HTML);
  const descriptionText = htmlToText(html).slice(0, MAX_TEXT);

  const locations = placesOf(raw);
  const formatted = locations.map(formatLocation).filter(Boolean);
  const primaryCountry = locations.find((place) => place.countryCode)?.countryCode ?? null;

  const plainText = !raw.descriptionHtml?.trim() && Boolean(raw.descriptionText?.trim());
  const deterministic = analyzeDeterministic({
    title,
    html,
    // A plain-text posting is read as written: its blank lines end sections. Keywords come from the same words.
    text: plainText ? String(raw.descriptionText) : descriptionText,
    sections: raw.sections ?? null,
    department: raw.department ?? null,
    preferText: plainText,
  });
  const requirementsText = deterministic.requirements.join('\n');

  // The source's field, then the location and CSV arrangement text (any "Remote", "Hybrid", "On-site" there says it),
  // then the description read strictly: empty unless it says in so many words how this role is worked.
  const locationWords = [...(raw.locations ?? []), raw.arrangementText ?? ''].join(' ; ');
  const allRemote = locations.length > 0 && locations.every((place) => place.isRemote);
  const workArrangement =
    oneOf(raw.workArrangement, WORK_ARRANGEMENTS) ??
    inferWorkArrangement(null, locationWords) ??
    (allRemote ? 'remote' : null) ??
    inferWorkArrangement(descriptionText.slice(0, 6000), null, { strict: true });

  const employmentType =
    oneOf(raw.employmentType, EMPLOYMENT_TYPES) ??
    (raw.employmentText ? inferEmploymentType(raw.employmentText, null) : null) ??
    inferEmploymentType(title, descriptionText) ??
    'full_time';

  const givenLevels = (raw.experienceLevels ?? []).filter((level) => (EXPERIENCE_LEVELS as readonly string[]).includes(level));
  const categoryId = raw.categoryId && isJobCategoryId(raw.categoryId) ? raw.categoryId : deterministic.categoryId;
  const subcategoryIds =
    raw.categoryId && isJobCategoryId(raw.categoryId)
      ? (raw.subcategoryIds ?? []).filter((id) => isJobSubcategoryId(id) && subcategoryParent(id) === raw.categoryId)
      : deterministic.subcategoryIds;

  // Salary: the pay supplement, then the structured field, then a salary text, then the description.
  const supplied = raw.supplement?.salary;
  const structured = supplied ?? raw.salary ?? null;
  const fromText = structured ? null : raw.salaryText ? parseSalary(raw.salaryText) : null;
  const textSalary = fromText ? { ...fromText, raw: raw.salaryText ?? null } : null;
  const described = structured || textSalary ? null : salaryFromText(descriptionText);
  const chosen = structured ?? textSalary ?? described;
  let salary: NormalizedSalary | null | undefined = normalizeSalary(chosen, primaryCountry);
  if (!salary && raw.salaryPending && supplied === undefined) salary = undefined;

  return {
    sourceJobId,
    title,
    titleKey: titleKeyOf(title),
    company,
    descriptionHtml: html,
    descriptionText,
    applyUrl,
    linkKey: linkKey(applyUrl),
    contentHash: contentHashOf(descriptionText),
    employmentType,
    workArrangement,
    experienceLevels: givenLevels.length > 0 ? givenLevels : deterministic.experienceLevels,
    leadership: oneOf(raw.leadership, LEADERSHIP) ?? deterministic.leadership,
    categoryId,
    subcategoryIds,
    salary,
    payChecked: supplied !== undefined,
    sponsorsH1b: typeof raw.sponsorsH1b === 'boolean' ? raw.sponsorsH1b : inferSponsorship(descriptionText),
    requiresClearance: typeof raw.requiresClearance === 'boolean' ? raw.requiresClearance : inferClearance(descriptionText),
    degree: text(raw.degree, 60) ?? inferDegree(requirementsText || descriptionText),
    industry: raw.industry ? (normalizeIndustry(raw.industry) ?? null) : company.industry,
    locations,
    locationsText: formatted.join('; '),
    primaryLocation: formatted[0] ?? '',
    locationCount: locations.length,
    postedAt: isoOrNull(raw.postedAt),
    sourceUpdatedAt: isoOrNull(raw.updatedAt) ?? isoOrNull(raw.postedAt),
    verified: raw.verified !== false,
    active: raw.active !== false,
    deterministic,
    provided: raw.analysis ?? null,
  };
}
