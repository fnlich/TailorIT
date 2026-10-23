import {
  containsTerm,
  maskFalseFriends,
  inferLeadership,
  parseLocations,
  placeFtJobField,
  spellingsOf,
  US_STATES,
  type ExperienceLevel,
  type KeywordGroup,
  type Leadership,
  type ParsedLocation,
  type SalaryPeriod,
  type WorkArrangement,
} from '@tailorit/shared';
import { MAX_HIGH_KEYWORDS, MAX_LOW_KEYWORDS } from '../../job-analysis/deterministic';
import { readLake, type LakeRow } from '../lake';
import type { ProvidedAnalysis, RawPosting, SourceAdapter } from '../types';
import { isRecord, str, type Json } from './common';

// free_tailor's Job Data Lake as postings (docs/research/simplify-jobs-and-ft-jobs.md A1): one lake row per company +
// job field, plain-text descriptions, no location or live flag. The row's stored analysis becomes an analysis with
// source 'ft_lake'. Rows older than FT_LAKE_MAX_AGE_DAYS are kept inactive.

/** Bump when the lake analysis mapping changes. */
export const FT_LAKE_ANALYSIS_VERSION = 1;

const ARRANGEMENT: Record<string, WorkArrangement> = { remote: 'remote', hybrid: 'hybrid', on_site: 'onsite', onsite: 'onsite' };

const PERIOD: Record<string, SalaryPeriod> = {
  annual: 'year',
  yearly: 'year',
  year: 'year',
  monthly: 'month',
  month: 'month',
  weekly: 'week',
  week: 'week',
  daily: 'day',
  day: 'day',
  hourly: 'hour',
  hour: 'hour',
};

/** free_tailor seniority words as experience levels (intern -> Entry ... staff/principal/lead/director/vp -> Expert). */
const SENIORITY_LEVELS: Record<string, ExperienceLevel[]> = {
  intern: ['entry'],
  entry: ['entry'],
  junior: ['junior'],
  mid: ['mid'],
  senior: ['senior'],
  staff: ['expert'],
  principal: ['expert'],
  lead: ['expert'],
  director: ['expert'],
  vp: ['expert'],
};

const MANAGING = new Set(['manager', 'director', 'vp']);

function parseAnalysis(text: string | null): Json | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function record(value: unknown): Json {
  return isRecord(value) ? value : {};
}

function words(value: unknown): string[] {
  return Array.isArray(value) ? value.map(str).filter((item): item is string => Boolean(item)) : [];
}

function seniorityOf(analysis: Json | null): string {
  const filter = record(analysis?.filter);
  const meta = record(analysis?.jobMeta);
  const word = (str(filter.seniority) ?? str(meta.seniority) ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  return word === 'not_specified' || word === 'unknown' ? '' : word;
}

/** "Location: McLean, VA (Remote)" in the posting text. */
const LOCATION_LINE = /^\s*(?:job\s+|work\s+)?location(?:\(s\))?\s*[:\-–]\s*(.{2,120})$/gim;

/**
 * The first "Location: ..." line that names a real place (a state, a country, or remote work); a form label copied
 * with the posting ("Location : Address") is not one.
 */
export function placeLine(text: string): string | null {
  for (const match of text.matchAll(LOCATION_LINE)) {
    const value = match[1]!.trim();
    const places = parseLocations(value);
    if (places.some((place) => place.countryCode || place.region || place.isRemote)) return value;
  }
  return null;
}

/** Where the lake's analysis says the job is: its US state, or the US (remote or not); nothing outside the US. */
export function lakePlaces(analysis: Json | null, arrangement: WorkArrangement | null): ParsedLocation[] {
  const filter = record(analysis?.filter);
  const region = (str(filter.region) ?? '').toLowerCase();
  const state = (str(filter.usState) ?? str(filter.us_state) ?? '').toUpperCase();
  if (arrangement === 'remote' && region === 'us') {
    return [{ raw: 'Remote - US', city: null, region: null, countryCode: 'US', isRemote: true }];
  }
  if (/^[A-Z]{2}$/.test(state) && US_STATES[state]) {
    return [{ raw: `${US_STATES[state]}, US`, city: null, region: state, countryCode: 'US', isRemote: false }];
  }
  if (region === 'us') return [{ raw: 'United States', city: null, region: null, countryCode: 'US', isRemote: false }];
  return [];
}

function group(term: string): KeywordGroup {
  return { term: term.slice(0, 120), synonyms: [] };
}

/** Keeps the groups the posting itself carries (by any spelling), each once, up to `max`. */
function present(terms: readonly string[], text: string, seen: Set<string>, max: number): KeywordGroup[] {
  const out: KeywordGroup[] = [];
  for (const term of terms) {
    if (out.length >= max) break;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    const candidate = group(term);
    if (!spellingsOf(candidate).some((spelling) => containsTerm(text, spelling))) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

/** The lake's stored analysis as TailorIT's: mustInclude -> high; technologies, tools and technical skills -> low. */
export function lakeAnalysis(analysis: Json, text: string, levels: ExperienceLevel[], placement: ReturnType<typeof placeFtJobField>, extras: Json, model: string | null): ProvidedAnalysis {
  const keywords = record(analysis.keywords);
  const skills = record(analysis.skills);
  const seen = new Set<string>();
  const masked = maskFalseFriends(text);
  const high = present(words(keywords.mustInclude), masked, seen, MAX_HIGH_KEYWORDS);
  const low = present(
    [...words(analysis.technologies), ...words(skills.technologies), ...words(skills.tools), ...words(skills.technical)],
    masked,
    seen,
    MAX_LOW_KEYWORDS,
  );
  const responsibilities = words(analysis.responsibilities)
    .slice(0, 12)
    .map((phrase) => phrase.charAt(0).toUpperCase() + phrase.slice(1));
  return {
    source: 'ft_lake',
    version: FT_LAKE_ANALYSIS_VERSION,
    model,
    keywords: { high, low },
    responsibilities,
    experienceLevels: levels,
    categoryId: placement?.categoryId ?? null,
    subcategoryIds: placement ? [placement.subcategoryId] : [],
    extras,
  };
}

/** One lake row as a posting. `now` and `maxAgeDays` decide whether it is still live. */
export function lakePosting(row: LakeRow, now: Date, maxAgeDays: number): RawPosting | null {
  const url = str(row.job_url);
  const title = str(row.title);
  const company = str(row.company);
  if (!url || !title || !company) return null;
  const analysis = parseAnalysis(row.analysis_json);
  const text = String(row.job_description ?? '');
  const filter = record(analysis?.filter);
  const arrangement =
    ARRANGEMENT[(row.job_type ?? '').toLowerCase()] ?? ARRANGEMENT[(str(filter.jobType) ?? '').toLowerCase()] ?? null;
  const seniority = seniorityOf(analysis);
  const levels = SENIORITY_LEVELS[seniority] ?? [];
  const leadership: Leadership = MANAGING.has(seniority) ? 'manager' : inferLeadership(title);
  const placement = placeFtJobField(row.job_field_id);
  const freshest = Math.max(Date.parse(row.updated_at) || 0, Date.parse(row.last_seen_at ?? '') || 0, Date.parse(row.created_at) || 0);
  const active = freshest > 0 && now.getTime() - freshest <= maxAgeDays * 86_400_000;
  const industry = str(row.industry);
  const locationLine = placeLine(text);
  const meta = record(analysis?.jobMeta);
  return {
    sourceJobId: String(row.id),
    title,
    company: { name: company, industry: industry && industry !== 'not_specified' && industry !== 'other' ? industry : null },
    descriptionText: text,
    url,
    locations: locationLine ? [locationLine] : [],
    places: lakePlaces(analysis, arrangement),
    workArrangement: arrangement,
    experienceLevels: levels,
    leadership,
    categoryId: placement?.categoryId ?? null,
    subcategoryIds: placement ? [placement.subcategoryId] : [],
    salary:
      row.salary_min !== null || row.salary_max !== null || str(row.salary_raw)
        ? {
            min: row.salary_min,
            max: row.salary_max,
            currency: str(row.salary_currency),
            period: PERIOD[(row.salary_period ?? '').toLowerCase()] ?? null,
            raw: str(row.salary_raw),
          }
        : null,
    requiresClearance: row.clearance === 1 ? true : row.clearance === 0 ? false : null,
    industry: industry && industry !== 'not_specified' ? industry : null,
    department: str(meta.department),
    postedAt: row.created_at,
    updatedAt: row.updated_at,
    verified: false,
    active,
    analysis: analysis
      ? lakeAnalysis(
          analysis,
          text,
          levels,
          placement,
          { lakeId: row.id, seniority: seniority || null, jobField: row.job_field_id, department: str(meta.department) },
          str(row.model_id),
        )
      : null,
  };
}

export const ftLakeAdapter: SourceAdapter = {
  kind: 'ft_lake',
  async fetch(source, ctx) {
    const path = str(source.config.path) ?? ctx.deps.config.ingest.ftLakeDbPath;
    const snapshot = readLake(path);
    const now = ctx.deps.now();
    const maxAge = ctx.deps.config.ingest.ftLakeMaxAgeDays;
    const postings: RawPosting[] = [];
    const failures = [];
    for (const row of snapshot.rows) {
      const posting = lakePosting(row, now, maxAge);
      if (posting) postings.push(posting);
      else failures.push({ sourceJobId: String(row.id), message: `Lake row ${row.id} has no title, company or link.` });
    }
    const stale = postings.filter((posting) => posting.active === false).length;
    ctx.log(
      `free_tailor lake at ${path}: ${snapshot.total} rows, ${snapshot.withAnalysis} with an analysis` +
        `${stale ? `, ${stale} older than ${maxAge} days (kept inactive)` : ''}.`,
    );
    return { postings, complete: true, failures };
  },
};
