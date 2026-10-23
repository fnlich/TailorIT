import {
  categorizeTitle,
  extractKeywords,
  inferExperienceLevels,
  inferLeadership,
  inferMinYears,
  OTHER_CATEGORY_ID,
  type ExperienceLevel,
  type JobKeywords,
  type Leadership,
} from '@tailorit/shared';
import { getSkillLibrary } from '../../core/skills-vocabulary';
import { emptySections, extractSections, mergeSections, type PostingSections } from './sections';

// The free analysis every posting gets at ingest (docs/ARCHITECTURE.md §9, job-analysis policy 1): the summary
// sections from its headings and lists, keywords from the skill library's vocabulary, and the level, leadership,
// years and category rules. No AI. Bump DETERMINISTIC_VERSION when the output for the same posting would change.

export const DETERMINISTIC_VERSION = 1;

/** Keyword caps, as the AI analysis's. */
export const MAX_HIGH_KEYWORDS = 15;
export const MAX_LOW_KEYWORDS = 15;

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
  const keywords = extractKeywords(input.text, vocabulary, {
    title: input.title,
    requirementsText: sections.requirements.join('\n'),
    maxHigh: MAX_HIGH_KEYWORDS,
    maxLow: MAX_LOW_KEYWORDS,
  });
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
