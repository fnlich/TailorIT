import type {
  CompanySizeId,
  EmploymentType,
  ExperienceLevel,
  JobKeywords,
  Leadership,
  ParsedLocation,
  SalaryPeriod,
  WorkArrangement,
} from '@tailorit/shared';
import type { AppDeps } from '../../core/context';
import type { IngestHttp } from './http';

// The ingestion pipeline's shapes (docs/ARCHITECTURE.md §8): every adapter turns its source into RawPosting-s; the
// pipeline normalises them with the shared parsers and upserts companies, jobs, locations, links, FTS and analyses.

export const SOURCE_KINDS = ['greenhouse', 'lever', 'ashby', 'csv', 'json', 'ft_lake', 'seed'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Public ATS boards: fetched over HTTP on the daily schedule. */
export const ATS_KINDS = ['greenhouse', 'lever', 'ashby'] as const;
export type AtsKind = (typeof ATS_KINDS)[number];

/** Kinds the daily schedule runs (uploads and the demo seed run by hand). */
export const SCHEDULED_KINDS: readonly SourceKind[] = ['greenhouse', 'lever', 'ashby', 'ft_lake'];

/** Which source's fields win when two describe one job: ATS > CSV/JSON > lake > seed. */
export const SOURCE_PRECEDENCE: Record<SourceKind, number> = {
  greenhouse: 4,
  lever: 4,
  ashby: 4,
  csv: 3,
  json: 3,
  ft_lake: 2,
  seed: 1,
};

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  csv: 'CSV import',
  json: 'JSON import',
  ft_lake: 'free_tailor lake',
  seed: 'Demo seed',
};

export const RUN_TRIGGERS = ['schedule', 'manual', 'upload', 'startup'] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export const RUN_STATUSES = ['running', 'succeeded', 'failed', 'partial'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** A job_sources row, its config parsed. */
export interface SourceRecord {
  id: number;
  kind: SourceKind;
  name: string;
  config: Record<string, unknown>;
  companyId: number | null;
  enabled: boolean;
  schedule: string;
  deactivateMissing: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RawCompany {
  name: string;
  tagline?: string | null;
  about?: string | null;
  website?: string | null;
  sizeBucket?: CompanySizeId | null;
  /** A head count, bucketed with companySizeBucket when no bucket is given. */
  employees?: number | null;
  industry?: string | null;
  headquarters?: string | null;
  foundedYear?: number | null;
  stage?: string | null;
  funding?: string | null;
  links?: Array<{ label: string; url: string }>;
  sponsorsH1b?: boolean | null;
  logoPath?: string | null;
}

export interface RawSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
  raw?: string | null;
}

export interface RawSections {
  requirements?: string[];
  responsibilities?: string[];
  desired?: string[];
}

/** An analysis that comes with the posting (free_tailor's lake), stored as `source = 'ft_lake'`. */
export interface ProvidedAnalysis {
  source: 'ft_lake';
  version: number;
  model?: string | null;
  keywords: JobKeywords;
  requirements?: string[];
  responsibilities?: string[];
  desired?: string[];
  experienceLevels?: ExperienceLevel[];
  leadership?: Leadership | null;
  minYears?: number | null;
  categoryId?: string | null;
  subcategoryIds?: string[];
  extras?: Record<string, unknown>;
}

/** One posting as an adapter read it. Only `sourceJobId`, `title`, `company.name` and `url` are required. */
export interface RawPosting {
  /** Unique within the source (the board's job id, the lake row id, a CSV row's link). */
  sourceJobId: string;
  title: string;
  company: RawCompany;
  /** HTML, entity-decoded but not yet sanitized. */
  descriptionHtml?: string | null;
  /** Plain text, for sources without HTML. */
  descriptionText?: string | null;
  /** Sections the source states itself (Lever lists, seed data). */
  sections?: RawSections | null;
  /** The original posting: Apply always opens it. */
  url: string;
  locations?: string[];
  /** Places the source knows precisely (the lake's region/state), used when `locations` names none. */
  places?: ParsedLocation[];
  /** An ISO country code for places that name none (Lever's `country`). */
  countryHint?: string | null;
  workArrangement?: WorkArrangement | null;
  /** Free text that may say the arrangement (Greenhouse metadata, a CSV column). */
  arrangementText?: string | null;
  employmentType?: EmploymentType | null;
  /** Free text that may say the employment type (Lever's commitment, a CSV column). */
  employmentText?: string | null;
  experienceLevels?: ExperienceLevel[];
  leadership?: Leadership | null;
  categoryId?: string | null;
  subcategoryIds?: string[];
  department?: string | null;
  salary?: RawSalary | null;
  /** A salary as text ("$120k - $150k"), read when `salary` is not given. */
  salaryText?: string | null;
  sponsorsH1b?: boolean | null;
  requiresClearance?: boolean | null;
  degree?: string | null;
  industry?: string | null;
  postedAt?: string | null;
  updatedAt?: string | null;
  /** False when a successful fetch does not prove the posting is live (the lake): last_verified_at stays NULL. */
  verified?: boolean;
  /** False for a posting the source lists as stale (the lake's old rows): the job is kept inactive. */
  active?: boolean;
  analysis?: ProvidedAnalysis | null;
  /** Data fetched for some postings only (Greenhouse pay ranges); not part of the change hash. */
  supplement?: { salary?: RawSalary | null } | null;
  /** True when a supplement may fill the salary later: a posting without one keeps the stored salary. */
  salaryPending?: boolean;
}

export interface FetchFailure {
  sourceJobId?: string;
  message: string;
}

export interface FetchResult {
  postings: RawPosting[];
  /**
   * True when `postings` is the source's whole current listing, so a stored posting that is not in it has closed.
   * False for a listing that stopped part-way (a page failed): nothing is deactivated then.
   */
  complete: boolean;
  /** Postings the adapter could not read; counted as failed, never deactivated. */
  failures: FetchFailure[];
  /** Ids the listing named but the adapter skipped on purpose (unlisted): they count as seen. */
  skippedIds?: string[];
}

export interface AdapterContext {
  deps: AppDeps;
  http: IngestHttp;
  signal: AbortSignal;
  log(line: string): void;
  /** Postings of this source whose pay range has never been checked (Greenhouse's per-job pay request). */
  needsPayCheck(sourceJobId: string): boolean;
}

export interface SourceAdapter {
  kind: SourceKind;
  fetch(source: SourceRecord, ctx: AdapterContext): Promise<FetchResult>;
}

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestError';
  }
}
