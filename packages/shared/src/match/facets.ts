import { findCertifications, findDomains } from './catalogue';
import type { JobTerms } from './schemas';
import { findSoftSkills, softSkillScanner } from './soft';

// A posting's facets beside its hard-skill keywords: the soft skills it asks for, and its "keywords" in the user's
// sense (the certifications and industries it names). Read from the posting's own sections (requirements,
// responsibilities, desired) when it has them, so equal-opportunity, benefits and "about us" text ("belonging", "visa
// sponsorship", "a nonprofit partner") stay out; from the whole text otherwise.

/** The skill library's lists, as the API loads them. Pass the same arrays every call: scanners are cached per array. */
export interface SkillLists {
  readonly hard: readonly string[];
  readonly soft: readonly string[];
}

export interface JobFacetInput {
  /** The posting's text. */
  text: string;
  /** Its title, read for certifications and industries ("Healthcare Data Analyst"). */
  title?: string | null;
  /** The sections the analysis read (job_analyses requirements, responsibilities, desired). */
  sections?: {
    requirements?: readonly string[];
    responsibilities?: readonly string[];
    desired?: readonly string[];
  } | null;
}

export interface JobFacets {
  softSkills: string[];
  terms: JobTerms;
}

export const MAX_JOB_SOFT_SKILLS = 15;
export const MAX_JOB_CERTIFICATIONS = 8;
export const MAX_JOB_DOMAINS = 4;

/** The text the facets are read from: the sections, one item a line, when there are any; else the whole text. */
export function facetText(input: JobFacetInput): string {
  const sections = input.sections;
  const items = [...(sections?.requirements ?? []), ...(sections?.responsibilities ?? []), ...(sections?.desired ?? [])]
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return items.length > 0 ? items.join('\n') : typeof input.text === 'string' ? input.text : '';
}

/** A posting's soft skills (canonical names, at most 15) and terms (at most 8 certifications and 4 industries). */
export function extractJobFacets(input: JobFacetInput, lists: SkillLists): JobFacets {
  const body = facetText(input);
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const termsText = title ? `${title}\n${body}` : body;
  return {
    softSkills: findSoftSkills(body, softSkillScanner(lists.soft, lists.hard), { max: MAX_JOB_SOFT_SKILLS }),
    terms: {
      certifications: findCertifications(termsText, { max: MAX_JOB_CERTIFICATIONS }),
      domains: findDomains(termsText, MAX_JOB_DOMAINS),
    },
  };
}
