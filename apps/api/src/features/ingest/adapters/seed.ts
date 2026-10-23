import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { COMPANY_SIZE_IDS, EMPLOYMENT_TYPES, SALARY_PERIODS, WORK_ARRANGEMENTS } from '@tailorit/shared';
import { staticDir } from '../../../core/paths';
import { paragraphsHtml, sectionHtml } from '../html';
import { IngestError, type RawPosting, type SourceAdapter } from '../types';
import { str } from './common';

// The demo data set (static/seed/companies.json + jobs.json): fictional companies and postings with clear sections.
// Dates are days before the source's anchor (set when the seed source is created), so a re-run changes nothing until
// `seed:jobs --refresh` moves the anchor to now.

const SeedCompanySchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  tagline: z.string().min(1),
  about: z.string().min(1),
  size: z.enum(COMPANY_SIZE_IDS),
  industry: z.string().min(1),
  headquarters: z.string().min(1),
  foundedYear: z.number().int(),
  stage: z.string().optional(),
  funding: z.string().optional(),
  sponsorsH1b: z.boolean().optional(),
});
export type SeedCompany = z.infer<typeof SeedCompanySchema>;

const SeedJobSchema = z.object({
  id: z.string().regex(/^seed-[a-z0-9-]+$/),
  company: z.string(),
  title: z.string().min(1),
  department: z.string().optional(),
  postedDaysAgo: z.number().min(0).max(400),
  updatedDaysAgo: z.number().min(0).max(400).optional(),
  locations: z.array(z.string()),
  workArrangement: z.enum(WORK_ARRANGEMENTS).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  salary: z
    .object({
      min: z.number().nullable(),
      max: z.number().nullable(),
      currency: z.string().length(3),
      period: z.enum(SALARY_PERIODS),
    })
    .nullable()
    .optional(),
  about: z.array(z.string()).min(1),
  responsibilities: z.array(z.string()).min(1),
  requirements: z.array(z.string()).min(1),
  niceToHave: z.array(z.string()).optional(),
  benefits: z.array(z.string()).optional(),
  requiresClearance: z.boolean().optional(),
  closed: z.boolean().optional(),
});
export type SeedJob = z.infer<typeof SeedJobSchema>;

export interface SeedData {
  companies: SeedCompany[];
  jobs: SeedJob[];
}

let cached: SeedData | null = null;

/** The seed files, parsed and checked once. */
export function loadSeedData(): SeedData {
  if (cached) return cached;
  const read = (name: string) => {
    try {
      return JSON.parse(readFileSync(staticDir('seed', name), 'utf8')) as unknown;
    } catch (error) {
      throw new IngestError(`The demo data file static/seed/${name} could not be read: ${(error as Error).message}`);
    }
  };
  const companies = z.array(SeedCompanySchema).safeParse(read('companies.json'));
  if (!companies.success) throw new IngestError(`static/seed/companies.json is not valid: ${companies.error.issues[0]?.message}`);
  const jobs = z.array(SeedJobSchema).safeParse(read('jobs.json'));
  if (!jobs.success) {
    const issue = jobs.error.issues[0];
    throw new IngestError(`static/seed/jobs.json is not valid at ${issue?.path.join('.')}: ${issue?.message}`);
  }
  const keys = new Set(companies.data.map((company) => company.key));
  const unknown = jobs.data.find((job) => !keys.has(job.company));
  if (unknown) throw new IngestError(`static/seed/jobs.json: ${unknown.id} names an unknown company "${unknown.company}".`);
  cached = { companies: companies.data, jobs: jobs.data };
  return cached;
}

const DAY_MS = 86_400_000;

/** One seed job as a posting, dated from `anchor`. */
export function seedPosting(job: SeedJob, company: SeedCompany, anchor: Date, index: number): RawPosting {
  // A different hour per job, so "Recently posted" has no ties.
  const at = (daysAgo: number) => new Date(anchor.getTime() - daysAgo * DAY_MS - ((index * 37) % 600) * 60_000).toISOString();
  const html = [
    '<h3>About the role</h3>',
    paragraphsHtml(job.about),
    sectionHtml('Responsibilities', job.responsibilities),
    sectionHtml('Requirements', job.requirements),
    sectionHtml('Nice to have', job.niceToHave ?? []),
    sectionHtml('Benefits', job.benefits ?? []),
    `<h3>About ${company.name}</h3>`,
    paragraphsHtml([company.about, `${company.name} is an equal opportunity employer.`]),
  ]
    .filter(Boolean)
    .join('\n');
  return {
    sourceJobId: job.id,
    title: job.title,
    company: {
      name: company.name,
      tagline: company.tagline,
      about: company.about,
      website: `https://${company.key}.example`,
      sizeBucket: company.size,
      industry: company.industry,
      headquarters: company.headquarters,
      foundedYear: company.foundedYear,
      stage: company.stage ?? null,
      funding: company.funding ?? null,
      sponsorsH1b: company.sponsorsH1b ?? null,
      links: [{ label: 'Website', url: `https://${company.key}.example` }],
    },
    descriptionHtml: html,
    sections: { requirements: job.requirements, responsibilities: job.responsibilities, desired: job.niceToHave ?? [] },
    url: `https://careers.${company.key}.example/jobs/${job.id.replace(/^seed-/, '')}`,
    locations: job.locations,
    workArrangement: job.workArrangement ?? null,
    employmentType: job.employmentType ?? null,
    department: job.department ?? null,
    salary: job.salary ? { ...job.salary, raw: null } : null,
    sponsorsH1b: company.sponsorsH1b ?? null,
    requiresClearance: job.requiresClearance ?? null,
    postedAt: at(job.postedDaysAgo),
    updatedAt: at(job.updatedDaysAgo ?? job.postedDaysAgo),
    active: job.closed !== true,
  };
}

export const seedAdapter: SourceAdapter = {
  kind: 'seed',
  async fetch(source, ctx) {
    const data = loadSeedData();
    const anchorText = str(source.config.anchor);
    const anchor = anchorText && !Number.isNaN(Date.parse(anchorText)) ? new Date(anchorText) : ctx.deps.now();
    const companies = new Map(data.companies.map((company) => [company.key, company]));
    const postings = data.jobs.map((job, index) => seedPosting(job, companies.get(job.company)!, anchor, index));
    ctx.log(`Demo data: ${data.companies.length} companies, ${postings.length} postings dated from ${anchor.toISOString()}.`);
    return { postings, complete: true, failures: [] };
  },
};
