import {
  categorizeTitle,
  extractKeywords,
  inferExperienceLevels,
  inferLeadership,
  inferMinYears,
  maskFalseFriends,
  OTHER_CATEGORY_ID,
  termPattern,
  type ExperienceLevel,
  type JobKeywords,
  type KeywordGroup,
  type Leadership,
} from '@tailorit/shared';
import { getSkillLibrary } from '../../core/skills-vocabulary';
import { emptySections, extractSections, mergeSections, type PostingSections } from './sections';

// The free analysis every posting gets at ingest (docs/ARCHITECTURE.md §9, job-analysis policy 1): the summary
// sections from its headings and lists, keywords from the skill library's vocabulary, and the level, leadership,
// years and category rules. No AI. Bump DETERMINISTIC_VERSION when the output for the same posting would change.

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
  };
}
