import { extractKeywords, htmlToText, prepareFitJob, type JobKeywords, type PreparedFitJob } from '@tailorit/shared';
import type { AppDeps } from '../../core/context';
import { getSkillLibrary } from '../../core/skills-vocabulary';
import { jobFacetsOf } from '../job-analysis/deterministic';
import { extractSections, peekAnalysisForJob } from '../jobs/analysis';

// The job side of a match (work package WP5): the analysis the Jobs card scores, read without a single write or AI
// task (`peekAnalysisForJob`: the job analysis service's `peek`, the same answer as the card's), with the posting's
// title and industry. An application with no job (added by hand, or its job is gone) is matched on its own
// description, read exactly as Resume Score reads it, so the picker and Resume Score agree there too.

export interface MatchJob {
  /** What the resumes are compared with: the job's analysis, or the application's own description. */
  readonly basis: 'job' | 'description';
  readonly prepared: PreparedFitJob;
  /** Claude's analysis of the posting is under way (its keywords may change). */
  readonly refining: boolean;
  /** The years of experience it asks for, when it says (a whole number 0 to 30). */
  readonly requiredYears: number | null;
}

function yearsOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 30 ? value : null;
}

/** A job of the Jobs page as the matcher reads it; null when it does not exist. Writes nothing, queues nothing. */
export function postingJob(deps: AppDeps, jobId: number): MatchJob | null {
  const analysis = peekAnalysisForJob(deps, jobId);
  if (!analysis) return null;
  const job = deps.db
    .prepare(
      `SELECT j.title, COALESCE(NULLIF(trim(j.industry), ''), c.industry) AS industry
       FROM jobs j LEFT JOIN companies c ON c.id = j.company_id WHERE j.id = ?`,
    )
    .get(jobId) as { title: string; industry: string | null } | undefined;
  if (!job) return null;
  const requiredYears = yearsOrNull(analysis.requiredYears);
  return {
    basis: 'job',
    refining: analysis.refining,
    requiredYears,
    prepared: prepareFitJob({
      title: job.title,
      keywords: analysis.keywords,
      softSkills: analysis.softSkills ?? null,
      terms: analysis.terms ?? null,
      industry: job.industry,
      requiredYears,
      categoryId: analysis.categoryId,
      subcategoryIds: analysis.subcategoryIds,
    }),
  };
}

/**
 * An application's own description as the matcher reads it: its keywords exactly as Resume Score reads them (the skill
 * vocabulary over its text, the title making one high priority), and its facets as a posting's are read.
 */
export function descriptionJob(row: { title: string; description_html: string }): MatchJob {
  const text = htmlToText(row.description_html ?? '');
  const readable = text.trim() !== '';
  const keywords: JobKeywords = readable
    ? extractKeywords(text, getSkillLibrary().vocabulary, { title: row.title })
    : { high: [], low: [] };
  const facets = readable
    ? jobFacetsOf({ title: row.title, text, ...extractSections(row.description_html ?? '', text) })
    : { softSkills: [], terms: { certifications: [], domains: [] }, requiredYears: null };
  const requiredYears = yearsOrNull(facets.requiredYears);
  return {
    basis: 'description',
    refining: false,
    requiredYears,
    prepared: prepareFitJob({
      title: row.title,
      keywords,
      softSkills: facets.softSkills,
      terms: facets.terms,
      requiredYears,
    }),
  };
}
