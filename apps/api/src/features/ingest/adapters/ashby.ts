import { parseLocations, type EmploymentType } from '@tailorit/shared';
import { IngestError, type FetchFailure, type RawPosting, type RawSalary, type SourceAdapter } from '../types';
import { arrangementOf, configText, isRecord, nameFromSlug, num, periodOf, records, str, type Json } from './common';

// Ashby job boards: GET api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true (can be slow: the
// request timeout is INGEST_HTTP_TIMEOUT_MS). Unlisted postings are skipped; pay is the Salary component.

export const ASHBY_API = 'https://api.ashbyhq.com/posting-api/job-board';

/** The board name as typed: a name or a jobs.ashbyhq.com URL. */
export function ashbyBoard(input: string): string {
  const text = input.trim();
  const fromUrl = /ashbyhq\.com\/(?:posting-api\/job-board\/)?([A-Za-z0-9_.%-]+)/i.exec(text);
  return decodeURIComponent(fromUrl?.[1] ?? text).replace(/[^A-Za-z0-9_. -]/g, '');
}

const EMPLOYMENT: Record<string, EmploymentType> = {
  fulltime: 'full_time',
  parttime: 'part_time',
  intern: 'internship',
  internship: 'internship',
  contract: 'contract',
  contractor: 'contract',
  temporary: 'contract',
};

function employmentOf(value: unknown): EmploymentType | null {
  const key = str(value)?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
  return EMPLOYMENT[key] ?? null;
}

/** The Salary components of every tier: their lowest minimum and highest maximum, in the first one's currency. */
export function ashbySalary(compensation: unknown): { salary: RawSalary | null; text: string | null } {
  if (!isRecord(compensation)) return { salary: null, text: null };
  const components = [
    ...records(compensation.compensationTiers).flatMap((tier) => records(tier.components)),
    ...records(compensation.summaryComponents),
  ].filter((component) => str(component.compensationType)?.toLowerCase() === 'salary');
  const text = str(compensation.scrapeableCompensationSalarySummary) ?? str(compensation.compensationTierSummary);
  if (components.length === 0) return { salary: null, text };
  const currency = str(components[0]!.currencyCode);
  const same = components.filter((component) => str(component.currencyCode) === currency);
  const mins = same.map((component) => num(component.minValue)).filter((value): value is number => value !== null && value > 0);
  const maxes = same.map((component) => num(component.maxValue)).filter((value): value is number => value !== null && value > 0);
  if (mins.length === 0 && maxes.length === 0) return { salary: null, text };
  return {
    salary: {
      min: mins.length ? Math.min(...mins) : null,
      max: maxes.length ? Math.max(...maxes) : null,
      currency,
      period: periodOf(components[0]!.interval) ?? 'year',
      raw: text,
    },
    text,
  };
}

function countryOf(address: unknown): string | null {
  if (!isRecord(address) || !isRecord(address.postalAddress)) return null;
  const country = str(address.postalAddress.addressCountry);
  if (!country) return null;
  return parseLocations(country)[0]?.countryCode ?? null;
}

/** One listed posting as a RawPosting; null when it lacks an id, a title or a link. */
export function ashbyPosting(job: Json, companyName: string): RawPosting | null {
  const id = str(job.id);
  const title = str(job.title);
  const url = str(job.jobUrl) ?? str(job.applyUrl);
  if (!id || !title || !url) return null;
  const arrangement = arrangementOf(job.workplaceType) ?? (job.isRemote === true ? 'remote' : null);
  const remote = arrangement === 'remote';
  // "Europe" on a remote posting is "Remote - Europe": the place is where the remote work may happen.
  const place = (value: string | null) => (value && remote && !/remote/i.test(value) ? `Remote - ${value}` : value);
  const locations = [
    place(str(job.location)),
    ...records(job.secondaryLocations).map((secondary) => place(str(secondary.location))),
  ].filter((value): value is string => Boolean(value));
  const { salary, text } = ashbySalary(job.compensation);
  return {
    sourceJobId: id,
    title,
    company: { name: companyName },
    descriptionHtml: str(job.descriptionHtml),
    descriptionText: str(job.descriptionHtml) ? null : str(job.descriptionPlain),
    url,
    locations,
    countryHint: countryOf(job.address),
    workArrangement: arrangement,
    employmentType: employmentOf(job.employmentType),
    department: str(job.team) ?? str(job.department),
    salary,
    salaryText: salary ? null : text,
    postedAt: str(job.publishedAt),
    updatedAt: str(job.updatedAt) ?? str(job.publishedAt),
  };
}

export const ashbyAdapter: SourceAdapter = {
  kind: 'ashby',
  async fetch(source, ctx) {
    const board = ashbyBoard(configText(source.config, 'board', 'Ashby job board name'));
    const url = `${ASHBY_API}/${encodeURIComponent(board)}?includeCompensation=true`;
    const answer = await ctx.http.getJson(url, { signal: ctx.signal, allow: [404] });
    if (answer.status === 404 || !isRecord(answer.data) || !Array.isArray(answer.data.jobs)) {
      throw new IngestError(`Ashby has no job board "${board}". Check the board name (jobs.ashbyhq.com/<name>).`);
    }
    const companyName = str(source.config.companyName) ?? nameFromSlug(board);
    const postings: RawPosting[] = [];
    const failures: FetchFailure[] = [];
    let unlisted = 0;
    for (const job of records(answer.data.jobs)) {
      if (job.isListed === false) {
        unlisted += 1;
        continue;
      }
      const posting = ashbyPosting(job, companyName);
      if (posting) postings.push(posting);
      else failures.push({ sourceJobId: str(job.id) ?? undefined, message: 'A listed posting has no id, title or link.' });
    }
    ctx.log(`Ashby board ${board}: ${postings.length} listed postings${unlisted ? `, ${unlisted} unlisted skipped` : ''}.`);
    return { postings, complete: true, failures };
  },
};
