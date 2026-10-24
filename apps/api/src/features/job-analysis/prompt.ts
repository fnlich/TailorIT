import { createHash } from 'node:crypto';
import { z } from 'zod';
import { JOB_CATEGORIES } from '@tailorit/shared';
import type { PromptModule } from '../../ai/index';

// The `job_analysis` prompt: a posting read for Simplify's "About the job" summary, the resume keyword card and the
// resume fit (soft skills, certifications and industries, required years). The rule it is built on (free_tailor's
// keyword extractor, reworded): take what the posting says, in the posting's own words; never what such a role usually
// involves.
//
// Bump the version only when the answers already stored must be asked for again: every job without an analysis of
// the new version goes back to Claude. A new optional field keeps it (softSkills, terms and requiredYears were added
// to version 1: older answers lack them, and the rule-based reading stands in), and JOB_ANALYSIS_PROMPT_HASH records
// on each new row which wording produced it.

export const JOB_ANALYSIS_PROMPT_VERSION = 1;

/** Characters of posting text sent to the model. */
export const MAX_PROMPT_TEXT = 30_000;

export interface JobAnalysisPromptInput {
  title: string;
  company: string;
  locations: string;
  description: string;
}

function taxonomyLines(): string {
  return JOB_CATEGORIES.map((category) => {
    const subs = category.subcategories.map((entry) => entry.id).join(', ');
    return `- ${category.id} (${category.label})${subs ? `: ${subs}` : ''}`;
  }).join('\n');
}

const SYSTEM = `You read one job posting and return a structured analysis of it for a job-search site. Two things are
built from your answer: a short summary a candidate reads instead of the whole posting, and a keyword checklist that
is matched, word for word, against the candidate's resume.

THE RULE: report what the posting says, in the posting's own words. Nothing implied, nothing a role like this usually
involves, nothing a similar posting would have said. A short posting gets a short answer; an empty list is a correct
answer for a section the posting does not have.

SUMMARY (display bullets)
- summary.requirements: what the posting says a candidate must have: required skills, experience, education,
  certifications. One bullet per requirement, close to the posting's wording, at most 20 words each.
- summary.responsibilities: the work the role does, one bullet per duty the posting describes, starting with a verb
  ("Design and maintain backend services"), at most 20 words each.
- summary.desiredQualifications: what the posting calls preferred, a plus, nice to have or a bonus. Never repeat a
  requirement here.
- Up to 10 bullets per list. Leave out benefits, pay, perks, company history, the mission statement, EEO and
  legal text, and how to apply.

KEYWORDS (matched literally against resumes)
- keywords.high: the terms the posting makes central: repeated, marked required, or named in the requirements.
- keywords.low: other skills, tools, technologies, methods and domain terms the posting names.
- Each keyword is {"term": ..., "synonyms": [...]}. "term" is spelled exactly as the posting spells it. When the
  posting uses an abbreviation with one standard expansion, or an expansion with one standard abbreviation, put the
  other form in "synonyms" ("CI/CD" with "continuous integration", "LLMs" with "large language models", "Kubernetes"
  with "K8s"). Synonyms are only other names of the very same thing, never related skills.
- Skip: company, product and brand names of the hiring company, places, team names, job titles, legal or visa text,
  pay and benefits, and recruiting phrases ("fast-paced", "rockstar").
- Up to 15 high and 15 low keywords. Every term or one of its synonyms must appear in the posting.

SOFT SKILLS AND OTHER KEYWORDS
- softSkills: the personal and interpersonal skills the posting asks of the candidate ("communication",
  "collaboration", "mentoring", "attention to detail"), named as the posting names them, from its requirements and
  duties. Never a tool or a technology, and nothing from the company description, benefits or EEO text. Up to 15.
- terms.certifications: certifications and licences the posting names ("AWS Certified Solutions Architect", "CISSP",
  "PMP"), as it writes them. Up to 8.
- terms.domains: the industries the role or the company is in, when the posting says so ("fintech", "healthcare",
  "insurance", "logistics"). Never "technology" or "software". Up to 4.
- [] for a list the posting gives nothing for.

FACTS (null when the posting does not say)
- experienceLevels: any of "entry", "junior", "mid", "senior", "expert", from the title and the years asked for
  (0-1 years entry, 2-3 junior, 3-5 mid, 5-8 senior, 8+ expert; intern and new-grad roles are entry; staff,
  principal, lead, director and above are expert). [] when neither says.
- leadership: "manager" when the role manages people, otherwise "ic".
- minYears: the fewest years of experience the posting asks for, as a number.
- requiredYears: the years of experience the requirements ask for in general, as a number ("7+ years of backend
  experience, including 3+ years leading teams" is 7). Only a number of years the posting writes.
- category: {"id": one category id below, "subcategoryIds": the subcategory ids of that category that fit}.
- workArrangement: "remote", "hybrid" or "onsite", only when the posting says how this role is worked (where the
  person works); null when it does not say. Remote tools or monitoring, remote customers or teams, on-site
  interviews and hybrid cloud are not arrangements.
- employmentType: "full_time", "part_time", "contract" or "internship".
- salary: {"min", "max", "currency" (ISO code such as "USD"), "period" ("year", "month", "week", "day" or "hour")}
  only when the posting states pay; numbers exactly as stated, never estimated.
- sponsorsH1b: true when the posting offers visa sponsorship, false when it says it does not.
- requiresClearance: true when a security clearance is required, false when the posting says none is needed.
- degree: the lowest degree the posting requires ("High School", "Associate's", "Bachelor's", "Master's", "PhD").

CATEGORIES (id (label): subcategory ids)
${taxonomyLines()}

Answer with this shape:
{"summary":{"requirements":[],"responsibilities":[],"desiredQualifications":[]},
 "keywords":{"high":[{"term":"","synonyms":[]}],"low":[]},
 "softSkills":[],"terms":{"certifications":[],"domains":[]},
 "experienceLevels":[],"leadership":null,"minYears":null,"requiredYears":null,
 "category":{"id":null,"subcategoryIds":[]},
 "workArrangement":null,"employmentType":null,
 "salary":null,"sponsorsH1b":null,"requiresClearance":null,"degree":null}`;

/** The prompt text's hash, stored with each AI analysis (an audit of which wording produced it). */
export const JOB_ANALYSIS_PROMPT_HASH = createHash('sha256').update(SYSTEM).digest('hex').slice(0, 16);

const bulletList = z.array(z.string()).max(60);
const KeywordOutput = z.object({
  term: z.string().trim().min(1).max(200),
  synonyms: z.array(z.string()).max(40).default([]),
});
const loose = z.union([z.string(), z.number(), z.boolean(), z.null()]).optional();
/**
 * A list added after version 1's answers were defined: read as leniently as can be (anything unexpected reads as "not
 * given"), so a slip in it never costs the rest of the answer a repair round. finishAiAnalysis keeps its strings.
 */
const extraList = z.array(z.unknown()).max(200).optional().catch(undefined);

export const JobAnalysisOutputSchema = z.object({
  summary: z.object({
    requirements: bulletList.default([]),
    responsibilities: bulletList.default([]),
    desiredQualifications: bulletList.default([]),
  }),
  keywords: z.object({
    high: z.array(KeywordOutput).max(60).default([]),
    low: z.array(KeywordOutput).max(60).default([]),
  }),
  softSkills: extraList,
  terms: z.object({ certifications: extraList, domains: extraList }).nullable().optional().catch(undefined),
  experienceLevels: z.array(z.string()).max(10).default([]),
  leadership: loose,
  minYears: loose,
  requiredYears: loose,
  category: z
    .object({ id: z.string().nullable().optional(), subcategoryIds: z.array(z.string()).max(30).default([]) })
    .nullable()
    .optional(),
  workArrangement: loose,
  employmentType: loose,
  salary: z
    .object({
      min: z.union([z.number(), z.string(), z.null()]).optional(),
      max: z.union([z.number(), z.string(), z.null()]).optional(),
      currency: z.string().nullable().optional(),
      period: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  sponsorsH1b: loose,
  requiresClearance: loose,
  degree: loose,
});
export type JobAnalysisOutput = z.infer<typeof JobAnalysisOutputSchema>;

export const jobAnalysisPrompt: PromptModule<JobAnalysisPromptInput, JobAnalysisOutput> = {
  kind: 'job_analysis',
  version: JOB_ANALYSIS_PROMPT_VERSION,
  system: () => SYSTEM,
  user: (input) =>
    [
      `Job title: ${input.title}`,
      `Company: ${input.company}`,
      input.locations ? `Location: ${input.locations}` : '',
      '',
      'Job posting:',
      '"""',
      input.description.slice(0, MAX_PROMPT_TEXT),
      '"""',
    ]
      .filter((line, index) => line !== '' || index === 3)
      .join('\n'),
  output: JobAnalysisOutputSchema,
};
