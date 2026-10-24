import {
  categorizeTitle,
  extractJobFacets,
  extractKeywords,
  inferExperienceLevels,
  inferLeadership,
  inferMinYears,
  inferRequiredYears,
  maskFalseFriends,
  OTHER_CATEGORY_ID,
  termPattern,
  type ExperienceLevel,
  type JobKeywords,
  type JobTerms,
  type KeywordGroup,
  type Leadership,
  type SkillLists,
} from '@tailorit/shared';
import { getSkillLibrary } from '../../core/skills-vocabulary';
import { emptySections, extractSections, mergeSections, type PostingSections } from './sections';

// The free analysis every posting gets at ingest (docs/ARCHITECTURE.md §9, job-analysis policy 1): the summary
// sections from its headings and lists, keywords from the skill library's vocabulary, the level, leadership, years
// and category rules, and the posting's facets (soft skills, certifications and industries, required years). No AI.
// Bump DETERMINISTIC_VERSION when an existing field's output for the same posting would change. A new field is not a
// reason: rows stored before it was read are filled in place (job-analysis/store.ts `fillFacets`), at the next ingest
// or when the analysis is next read, because a bump would have every posting re-read by the lazy path, which lacks
// the source's own sections, department and plain-text reading.

/** 2: keywords are labelled as the posting writes them ("AWS services", not the library's "Aws Services"). */
export const DETERMINISTIC_VERSION = 2;

/** Keyword caps, as the AI analysis's. */
export const MAX_HIGH_KEYWORDS = 15;
export const MAX_LOW_KEYWORDS = 15;

/**
 * How `text` writes `term` (a whole word or phrase, found as the job match finds it): its most frequent spelling
 * there, the first one on a tie, spaces tidied. Null when the text does not carry the term.
 */
export function postingSpelling(term: string, text: string): string | null {
  const pattern = termPattern(term, { global: true });
  if (!pattern) return null;
  const tally = new Map<string, number>();
  let best: string | null = null;
  for (const match of text.matchAll(pattern)) {
    const spelled = match[0].replace(/\s+/g, ' ');
    const count = (tally.get(spelled) ?? 0) + 1;
    tally.set(spelled, count);
    if (best === null || count > (tally.get(best) ?? 0)) best = spelled;
  }
  return best;
}

/**
 * Keywords labelled as the posting writes them ("AWS services", "observability"); a term the posting does not
 * write itself (it carries a synonym) keeps the skill library's spelling, else its own. `text` is the posting's
 * title and text.
 */
export function inPostingCase(keywords: JobKeywords, text: string): JobKeywords {
  const masked = maskFalseFriends(text);
  const library = getSkillLibrary().byKey;
  const relabel = (group: KeywordGroup): KeywordGroup => {
    const term = postingSpelling(group.term, masked) ?? library.get(group.term.toLowerCase())?.skill ?? group.term;
    if (term === group.term) return group;
    return { term, synonyms: group.synonyms.filter((synonym) => synonym.toLowerCase() !== term.toLowerCase()) };
  };
  return { high: keywords.high.map(relabel), low: keywords.low.map(relabel) };
}

/** What a posting asks for beside its keywords (job_analyses soft_skills, terms and required_years). */
export interface JobFacetsDraft {
  /** Soft skills, by their canonical names. */
  softSkills: string[];
  /** The certifications and industries (INDUSTRIES ids) it names. */
  terms: JobTerms;
  /** The years of experience its requirements ask for; null when it does not say. */
  requiredYears: number | null;
}

/** What an analysis says about a posting, before it is stored (job_analyses columns). */
export interface AnalysisDraft {
  requirements: string[];
  responsibilities: string[];
  desired: string[];
  keywords: JobKeywords;
  experienceLevels: ExperienceLevel[];
  leadership: Leadership | null;
  minYears: number | null;
  categoryId: string | null;
  subcategoryIds: string[];
  extras: Record<string, unknown>;
  /** The facets (JobFacetsDraft). Left out or null: not read (an analysis made before they were, a lake one). */
  softSkills?: string[] | null;
  terms?: JobTerms | null;
  requiredYears?: number | null;
}

/** The skill library's lists as the facet readers take them: the same arrays every call, so their scanners are reused. */
export function jobSkillLists(): SkillLists {
  const library = getSkillLibrary();
  return { hard: library.vocabulary, soft: library.soft };
}

/**
 * A posting's facets: soft skills, certifications and industries read from its sections when it has any (the whole
 * text otherwise, so equal-opportunity and benefits text stays out), and the years of experience its requirements ask
 * for (the general requirement first: "7+ years of backend work, including 3+ years leading teams" is 7).
 */
export function jobFacetsOf(posting: {
  title: string;
  text: string;
  requirements: readonly string[];
  responsibilities: readonly string[];
  desired: readonly string[];
}): JobFacetsDraft {
  const facets = extractJobFacets(
    {
      text: posting.text,
      title: posting.title,
      sections: { requirements: posting.requirements, responsibilities: posting.responsibilities, desired: posting.desired },
    },
    jobSkillLists(),
  );
  return {
    softSkills: facets.softSkills,
    terms: facets.terms,
    requiredYears: inferRequiredYears(posting.requirements.join('\n') || posting.text),
  };
}

export interface DeterministicInput {
  title: string;
  /** Sanitized description HTML (what jobs.description_html stores). */
  html: string;
  /** The description's text (jobs.description_text). */
  text: string;
  /** Sections the source states itself (Lever lists, seed data); they win section by section. */
  sections?: Partial<PostingSections> | null;
  /** The source's department or team, read when the title names no category ("Engineering"). */
  department?: string | null;
  /** The posting was plain text (its HTML was made from it): read sections from the text, blank lines and all. */
  preferText?: boolean;
}

function given(sections: Partial<PostingSections> | null | undefined): PostingSections {
  return {
    requirements: sections?.requirements ?? [],
    responsibilities: sections?.responsibilities ?? [],
    desired: sections?.desired ?? [],
  };
}

/** The deterministic analysis of one posting. Pure apart from reading the (cached) skill library. */
export function analyzeDeterministic(input: DeterministicInput): AnalysisDraft {
  const found =
    input.html.trim() || input.text.trim()
      ? extractSections(input.html, input.text, { preferText: input.preferText })
      : emptySections();
  const sections = mergeSections(given(input.sections), found);
  const requirementsText = [...sections.requirements, ...sections.desired].join('\n');
  // The same array every call: extractKeywords compiles a vocabulary once per array.
  const vocabulary = getSkillLibrary().vocabulary;
  const vocabularyTerms = extractKeywords(input.text, vocabulary, {
    title: input.title,
    requirementsText: sections.requirements.join('\n'),
    maxHigh: MAX_HIGH_KEYWORDS,
    maxLow: MAX_LOW_KEYWORDS,
  });
  const keywords = inPostingCase(vocabularyTerms, `${input.title}\n${input.text}`);
  // Years are stated in the requirements when there are any; the whole text otherwise.
  const yearsText = requirementsText || input.text;
  let category = categorizeTitle(input.title);
  if (category.categoryId === OTHER_CATEGORY_ID && input.department?.trim()) {
    const byDepartment = categorizeTitle(input.department);
    if (byDepartment.categoryId !== OTHER_CATEGORY_ID) category = byDepartment;
  }
  return {
    ...sections,
    keywords,
    experienceLevels: inferExperienceLevels(input.title, yearsText),
    leadership: inferLeadership(input.title),
    minYears: inferMinYears(yearsText),
    categoryId: category.categoryId,
    subcategoryIds: category.subcategoryIds,
    extras: {},
    ...jobFacetsOf({ title: input.title, text: input.text, ...sections }),
  };
}
