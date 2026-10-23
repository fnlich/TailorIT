import { decodeHtmlEntities, htmlToText } from '@tailorit/shared';
import { IngestHttpError } from '../http';
import { IngestError, type FetchFailure, type RawPosting, type RawSalary, type SourceAdapter } from '../types';
import { arrangementOf, configText, isRecord, num, periodOf, records, str, type Json } from './common';

// Greenhouse job boards: GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true (content is entity-escaped
// HTML). Pay ranges are only on the per-job endpoint (?pay_transparency=true): asked for postings never checked
// before, at most PAY_CHECKS_PER_RUN a run.

export const GREENHOUSE_API = 'https://boards-api.greenhouse.io/v1/boards';
export const PAY_CHECKS_PER_RUN = 50;

/** The board token as typed: a token, or a board URL (boards.greenhouse.io/acme, job-boards.greenhouse.io/acme). */
export function greenhouseToken(input: string): string {
  const text = input.trim();
  const fromUrl = /greenhouse\.io\/(?:v1\/boards\/|embed\/job_board\?for=)?([A-Za-z0-9_-]+)/i.exec(text);
  return (fromUrl?.[1] ?? text).replace(/[^A-Za-z0-9_-]/g, '');
}

interface MetadataReading {
  arrangement: string | null;
  employment: string | null;
  salary: RawSalary | null;
  salaryText: string | null;
}

function metadataValueText(value: unknown): string | null {
  if (Array.isArray(value)) return value.map(str).filter(Boolean).join(', ') || null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return str(value);
}

/** What a board's custom fields say about pay, arrangement and type (names vary by board). */
function readMetadata(metadata: Json[]): MetadataReading {
  const out: MetadataReading = { arrangement: null, employment: null, salary: null, salaryText: null };
  for (const entry of metadata) {
    const name = str(entry.name)?.toLowerCase() ?? '';
    const value = entry.value;
    if (/salary|compensation|pay\b|pay range|base pay|wage/.test(name)) {
      if (isRecord(value) && (num(value.min_value) !== null || num(value.max_value) !== null)) {
        out.salary = { min: num(value.min_value), max: num(value.max_value), currency: str(value.unit), period: null };
      } else if (isRecord(value) && num(value.value) !== null) {
        out.salary = { min: num(value.value), max: num(value.value), currency: str(value.unit), period: null };
      } else {
        out.salaryText ??= metadataValueText(value);
      }
    } else if (/workplace|remote|location type|work type|arrangement|work model|work location/.test(name)) {
      out.arrangement ??= metadataValueText(value);
    } else if (/employment|job type|time type|commitment|position type|schedule/.test(name)) {
      out.employment ??= metadataValueText(value);
    }
  }
  return out;
}

/** The pay range of a per-job answer: the first range's currency, its lowest minimum and highest maximum. */
export function payRangeOf(detail: unknown): RawSalary | null {
  if (!isRecord(detail)) return null;
  const ranges = records(detail.pay_input_ranges);
  if (ranges.length === 0) return null;
  const currency = str(ranges[0]!.currency_type) ?? 'USD';
  const same = ranges.filter((range) => (str(range.currency_type) ?? 'USD') === currency);
  const mins = same.map((range) => num(range.min_cents)).filter((value): value is number => value !== null && value > 0);
  const maxes = same.map((range) => num(range.max_cents)).filter((value): value is number => value !== null && value > 0);
  if (mins.length === 0 && maxes.length === 0) return null;
  const min = mins.length ? Math.min(...mins) / 100 : null;
  const max = maxes.length ? Math.max(...maxes) / 100 : null;
  const blurb = htmlToText(decodeHtmlEntities(String(same[0]!.blurb ?? '')));
  const top = max ?? min ?? 0;
  const period = /\bhour(?:ly)?\b|\bper hour\b/i.test(blurb) || top < 1000 ? 'hour' : periodOf(same[0]!.title) ?? 'year';
  const title = str(same[0]!.title);
  return { min, max, currency, period, raw: title ? `${title}` : null };
}

/** One listed job as a RawPosting (the company name and pay come from the caller). */
export function greenhousePosting(job: Json, companyName: string): RawPosting | null {
  const id = str(job.id);
  const title = str(job.title);
  const url = str(job.absolute_url);
  if (!id || !title || !url) return null;
  const metadata = readMetadata(records(job.metadata));
  const location = isRecord(job.location) ? str(job.location.name) : null;
  const offices = records(job.offices)
    .map((office) => str(office.location) ?? str(office.name))
    .filter((name): name is string => Boolean(name));
  return {
    sourceJobId: id,
    title,
    company: { name: str(job.company_name) ?? companyName },
    descriptionHtml: decodeHtmlEntities(String(job.content ?? '')),
    url,
    // The location line names the places; offices only when it is empty.
    locations: location ? [location] : offices,
    workArrangement: arrangementOf(metadata.arrangement),
    arrangementText: metadata.arrangement,
    employmentText: metadata.employment,
    department: records(job.departments).map((department) => str(department.name)).find(Boolean) ?? null,
    salary: metadata.salary,
    salaryText: metadata.salaryText,
    postedAt: str(job.first_published) ?? str(job.updated_at),
    updatedAt: str(job.updated_at),
    salaryPending: true,
  };
}

export const greenhouseAdapter: SourceAdapter = {
  kind: 'greenhouse',
  async fetch(source, ctx) {
    const token = greenhouseToken(configText(source.config, 'token', 'Greenhouse board token'));
    const base = `${GREENHOUSE_API}/${encodeURIComponent(token)}`;
    const listing = await ctx.http.getJson(`${base}/jobs?content=true`, { signal: ctx.signal, allow: [404] });
    if (listing.status === 404) {
      throw new IngestError(`Greenhouse has no job board "${token}". Check the board token (boards.greenhouse.io/<token>).`);
    }
    if (!isRecord(listing.data) || !Array.isArray(listing.data.jobs)) {
      throw new IngestError(`Greenhouse board "${token}" answered without a job list.`);
    }
    // The board's display name, for postings that carry none (best effort: the listing is what matters).
    let boardName: string | null = null;
    try {
      const board = await ctx.http.getJson(base, { signal: ctx.signal, allow: [404] });
      if (isRecord(board.data)) boardName = str(board.data.name);
    } catch (error) {
      if (ctx.signal.aborted) throw error;
    }
    const companyName = str(source.config.companyName) ?? boardName ?? token;

    const failures: FetchFailure[] = [];
    const postings: RawPosting[] = [];
    for (const job of records(listing.data.jobs)) {
      const posting = greenhousePosting(job, companyName);
      if (posting) {
        if (str(source.config.companyName)) posting.company.name = companyName;
        postings.push(posting);
      } else {
        failures.push({ sourceJobId: str(job.id) ?? undefined, message: 'A listed job has no id, title or link.' });
      }
    }
    ctx.log(`Greenhouse board ${token}: ${postings.length} listed jobs.`);

    const toCheck = postings.filter((posting) => ctx.needsPayCheck(posting.sourceJobId)).slice(0, PAY_CHECKS_PER_RUN);
    let checked = 0;
    for (const posting of toCheck) {
      try {
        const detail = await ctx.http.getJson(`${base}/jobs/${encodeURIComponent(posting.sourceJobId)}?pay_transparency=true`, {
          signal: ctx.signal,
          allow: [404],
        });
        if (detail.status === 404) continue;
        posting.supplement = { salary: payRangeOf(detail.data) };
        checked += 1;
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        const status = error instanceof IngestHttpError ? ` (HTTP ${error.status})` : '';
        ctx.log(`Pay range of job ${posting.sourceJobId} could not be read${status}; it is asked for again next run.`);
      }
    }
    if (toCheck.length) ctx.log(`Checked pay ranges of ${checked} of ${toCheck.length} new jobs.`);
    return { postings, complete: true, failures };
  },
};
