import {
  EXPERIENCE_LEVELS,
  JobKeywordsSchema,
  decodeHtmlEntities,
  extractKeywords,
  htmlToText,
  type ExperienceLevel,
  type JobAnalysisSource,
  type JobAnalysisView,
  type JobKeywords,
  type JobTerms,
} from '@tailorit/shared';
import type { AppDeps } from '../../core/context';
import { getSkillLibrary } from '../../core/skills-vocabulary';
import { jobFacetsOf } from '../job-analysis/deterministic';
import type { EnsuredAnalysis, JobAnalysisService } from '../job-analysis/types';
import { experienceLevelsOf, jsonStrings } from './rows';

// The job analysis the page shows ("About the job" summary, the keywords the match uses, and the posting's facets:
// soft skills, certifications and industries, required years). Work package J1's service decides which analysis is
// best (and, in lazy mode, queues the AI one); while that service is absent (or fails) the analysis stored on the job
// is used, and failing that one is computed here, deterministically, from the posting. Nothing here writes.

interface JobForAnalysis {
  id: number;
  title: string;
  description_html: string;
  description_text: string;
  content_hash: string;
  experience_levels: string;
  category_id: string | null;
  subcategory_ids: string;
  analysis_id: number | null;
}

interface AnalysisRow {
  source: string;
  requirements: string;
  responsibilities: string;
  desired: string;
  keywords: string;
  experience_levels: string;
  category_id: string | null;
  subcategory_ids: string;
  /** NULL: not read (a row from before the facets were); then they are computed from the row's sections. */
  soft_skills: string | null;
  terms: string | null;
  required_years: number | null;
}

type ViewFacets = Required<Pick<JobAnalysisView, 'softSkills' | 'terms' | 'requiredYears'>>;

const MAX_SOFT_SKILLS = 40;
/** JobTermsSchema's bounds. */
const MAX_CERTIFICATIONS = 10;
const MAX_DOMAINS = 6;

/** The text a posting's facets and keywords are read from: its plain text, else its HTML as text. */
function postingText(job: Pick<JobForAnalysis, 'description_html' | 'description_text'>): string {
  return job.description_text?.trim() ? job.description_text : htmlToText(job.description_html ?? '');
}

/** A posting's facets, read from its sections (the whole text when it has none): the job-analysis rule itself. */
function facetsOfPosting(job: JobForAnalysis, sections: PostingSections): ViewFacets {
  return jobFacetsOf({ title: job.title, text: postingText(job), ...sections });
}

/** Terms in the shared contract's bounds, whatever the value holds. */
function conformTerms(value: unknown): JobTerms {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const list = (items: unknown, maxLength: number, max: number) =>
    strings(items)
      .filter((item) => item.length <= maxLength)
      .slice(0, max);
  return { certifications: list(record.certifications, 120, MAX_CERTIFICATIONS), domains: list(record.domains, 40, MAX_DOMAINS) };
}

/** Required years in the contract's bounds (a whole number 0 to 30), else null. */
function yearsOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 30 ? value : null;
}

function parsed(text: string | null): unknown {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

const SOURCES: readonly JobAnalysisSource[] = ['deterministic', 'ft_lake', 'ai'];

function serviceOf(deps: AppDeps): JobAnalysisService | undefined {
  const service = deps.services.jobAnalysis;
  return service && typeof service.ensure === 'function' && typeof service.get === 'function' ? service : undefined;
}

const MAX_TERM = 120;
const MAX_SYNONYMS = 20;
const MAX_GROUPS = 40;

/**
 * Keyword groups in the shared contract's bounds, read leniently: a group with an unusable term is dropped, synonyms
 * are trimmed, deduplicated and capped, instead of one bad group emptying the whole list.
 */
export function conformKeywords(value: unknown): JobKeywords {
  const strict = JobKeywordsSchema.safeParse(value);
  if (strict.success) return strict.data;
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const groups = (list: unknown) => {
    if (!Array.isArray(list)) return [];
    const out: JobKeywords['high'] = [];
    for (const item of list) {
      const raw = typeof item === 'string' ? { term: item } : item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
      const term = typeof raw?.term === 'string' ? raw.term.replace(/\s+/g, ' ').trim() : '';
      if (!term || term.length > MAX_TERM) continue;
      const synonyms = Array.isArray(raw?.synonyms)
        ? [
            ...new Set(
              (raw.synonyms as unknown[])
                .filter((synonym): synonym is string => typeof synonym === 'string')
                .map((synonym) => synonym.replace(/\s+/g, ' ').trim())
                .filter((synonym) => synonym && synonym.length <= MAX_TERM && synonym !== term),
            ),
          ].slice(0, MAX_SYNONYMS)
        : [];
      out.push({ term, synonyms });
      if (out.length >= MAX_GROUPS) break;
    }
    return out;
  };
  return { high: groups(record.high), low: groups(record.low) };
}

function keywordsOf(text: string | null | undefined): JobKeywords {
  try {
    return conformKeywords(JSON.parse(text ?? ''));
  } catch {
    return { high: [], low: [] };
  }
}

const MAX_BULLETS = 12;
const MAX_BULLET_LENGTH = 400;

function bullets(text: string | null | undefined): string[] {
  return jsonStrings(text)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 30);
}

function fromRow(row: AnalysisRow, job: JobForAnalysis): JobAnalysisView {
  const levels = experienceLevelsOf(row.experience_levels);
  const sections = { requirements: bullets(row.requirements), responsibilities: bullets(row.responsibilities), desired: bullets(row.desired) };
  // A row read before facets were stored (or a lake row, which has none) gets them computed from its sections.
  const facets: ViewFacets =
    row.soft_skills === null
      ? facetsOfPosting(job, sections)
      : {
          softSkills: strings(parsed(row.soft_skills)).slice(0, MAX_SOFT_SKILLS),
          terms: conformTerms(parsed(row.terms)),
          requiredYears: yearsOrNull(row.required_years),
        };
  return {
    source: SOURCES.includes(row.source as JobAnalysisSource) ? (row.source as JobAnalysisSource) : 'deterministic',
    refining: false,
    ...sections,
    keywords: keywordsOf(row.keywords),
    experienceLevels: levels.length > 0 ? levels : experienceLevelsOf(job.experience_levels),
    categoryId: row.category_id ?? job.category_id,
    subcategoryIds: (() => {
      const ids = jsonStrings(row.subcategory_ids);
      return ids.length > 0 ? ids : jsonStrings(job.subcategory_ids);
    })(),
    ...facets,
  };
}

// ------------------------------------------------------------------------------------------- posting sections

export interface PostingSections {
  requirements: string[];
  responsibilities: string[];
  desired: string[];
}

type SectionKey = keyof PostingSections;

const DESIRED_HEADING =
  /\b(?:preferred|nice[\s-]to[\s-]haves?|bonus(?:\s+points)?|desired|desirable|good[\s-]to[\s-]have|pluses|extra\s+credit|ideally)\b/i;
const REQUIRED_HEADING =
  /\b(?:requirements?|qualifications?|what\s+you(?:['’]ll|\s+will)\s+need|what\s+we['’]?re\s+looking\s+for|who\s+you\s+are|about\s+you|you\s+have|must[\s-]haves?|what\s+you\s+bring|you\s+bring|skills|minimum|basic)\b/i;
const RESPONSIBILITY_HEADING =
  /\b(?:responsibilit(?:y|ies)|what\s+you(?:['’]ll|\s+will)\s+(?:do|be\s+doing|work\s+on)|the\s+role|your\s+role|duties|day[\s-]to[\s-]day|in\s+this\s+role|your\s+impact|you\s+will|key\s+tasks)\b/i;

/** Which section a heading opens, or null for one the summary leaves out (benefits, about us, ...). */
export function sectionOfHeading(heading: string): SectionKey | null {
  const text = heading.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 80) return null;
  if (DESIRED_HEADING.test(text)) return 'desired';
  if (RESPONSIBILITY_HEADING.test(text)) return 'responsibilities';
  if (REQUIRED_HEADING.test(text)) return 'requirements';
  return null;
}

const HEADING_MARK = '\u0001H ';
const BULLET_MARK = '\u0001B ';

/**
 * The posting's Requirements / Responsibilities / Desired Qualifications bullets, read from its headings (`<h3>`,
 * a bold-only paragraph, a short line ending in ":") and the list items under each. Plain text works too ("- ",
 * "• " lines).
 */
export function extractSections(html: string, plainText = ''): PostingSections {
  const out: PostingSections = { requirements: [], responsibilities: [], desired: [] };
  const source = html.trim() ? html : plainText.replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
  const marked = source
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi, (_m, inner: string) => `\n${HEADING_MARK}${inner}\n`)
    .replace(
      /<(p|div)\b[^>]*>\s*<(strong|b)\b[^>]*>([\s\S]{1,120}?)<\/\2\s*>\s*:?\s*<\/\1\s*>/gi,
      (_m, _block: string, _tag: string, inner: string) => `\n${HEADING_MARK}${inner}\n`,
    )
    .replace(/<li\b[^>]*>/gi, `\n${BULLET_MARK}`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|ul|ol|section|tr|table|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  const lines = decodeHtmlEntities(marked)
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter(Boolean);

  let current: SectionKey | null = null;
  for (const line of lines) {
    let text = line;
    let kind: 'heading' | 'bullet' | 'line' = 'line';
    if (text.startsWith(HEADING_MARK.trim())) {
      kind = 'heading';
      text = text.slice(HEADING_MARK.trim().length).trim();
    } else if (text.startsWith(BULLET_MARK.trim())) {
      kind = 'bullet';
      text = text.slice(BULLET_MARK.trim().length).trim();
    } else if (/^[-*•·▪◦]\s+/.test(text)) {
      kind = 'bullet';
      text = text.replace(/^[-*•·▪◦]\s+/, '');
    } else if (/:$/.test(text) && text.length <= 80 && text.split(/\s+/).length <= 10) {
      kind = 'heading';
    }
    if (!text) continue;
    if (kind === 'heading') {
      current = sectionOfHeading(text.replace(/:$/, ''));
      continue;
    }
    if (kind === 'bullet' && current) {
      const list = out[current];
      const item = text.length > MAX_BULLET_LENGTH ? `${text.slice(0, MAX_BULLET_LENGTH - 3).trimEnd()}...` : text;
      if (list.length < MAX_BULLETS && !list.includes(item)) list.push(item);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the view

/** Computed analyses by job id + content hash, so the analysis and match calls for one view compute once. */
const computed = new Map<string, JobAnalysisView>();
const COMPUTED_MAX = 200;

/** The deterministic analysis of a posting, computed now (nothing is stored). */
export function computeAnalysis(job: JobForAnalysis): JobAnalysisView {
  const key = `${job.id}:${job.content_hash}`;
  const cached = computed.get(key);
  if (cached) return cached;
  const sections = extractSections(job.description_html, job.description_text);
  const text = postingText(job);
  const keywords = extractKeywords(text, getSkillLibrary().vocabulary, {
    title: job.title,
    requirementsText: sections.requirements.join('\n'),
  });
  const view: JobAnalysisView = {
    source: 'deterministic',
    refining: false,
    ...sections,
    keywords,
    experienceLevels: experienceLevelsOf(job.experience_levels),
    categoryId: job.category_id,
    subcategoryIds: jsonStrings(job.subcategory_ids),
    ...facetsOfPosting(job, sections),
  };
  if (computed.size >= COMPUTED_MAX) computed.delete(computed.keys().next().value as string);
  computed.set(key, view);
  return view;
}

function loadJob(deps: Pick<AppDeps, 'db'>, jobId: number): JobForAnalysis | undefined {
  return deps.db
    .prepare(
      `SELECT id, title, description_html, description_text, content_hash, experience_levels, category_id,
              subcategory_ids, analysis_id
       FROM jobs WHERE id = ?`,
    )
    .get(jobId) as JobForAnalysis | undefined;
}

/** The analysis stored on the job (whatever ingestion wrote), else one computed from the posting. */
export function fallbackAnalysis(deps: Pick<AppDeps, 'db'>, jobId: number): JobAnalysisView | null {
  const job = loadJob(deps, jobId);
  if (!job) return null;
  if (job.analysis_id !== null) {
    const row = deps.db
      .prepare(
        `SELECT source, requirements, responsibilities, desired, keywords, experience_levels, category_id, subcategory_ids,
                soft_skills, terms, required_years
         FROM job_analyses WHERE id = ?`,
      )
      .get(job.analysis_id) as AnalysisRow | undefined;
    if (row) return fromRow(row, job);
  }
  return computeAnalysis(job);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : [];
}

/**
 * The service's answer in the contract's shape whatever it holds (it is another package's data). Facets it leaves out
 * stay out (the contract's fields are optional).
 */
function fromService(result: EnsuredAnalysis): JobAnalysisView {
  const analysis = result.analysis;
  const levels = new Set(strings(analysis.experienceLevels));
  return {
    source: SOURCES.includes(analysis.source) ? analysis.source : 'deterministic',
    refining: Boolean(result.refining),
    requirements: strings(analysis.requirements),
    responsibilities: strings(analysis.responsibilities),
    desired: strings(analysis.desired),
    keywords: conformKeywords(analysis.keywords),
    experienceLevels: EXPERIENCE_LEVELS.filter((level) => levels.has(level)),
    categoryId: typeof analysis.categoryId === 'string' && analysis.categoryId ? analysis.categoryId : null,
    subcategoryIds: strings(analysis.subcategoryIds),
    ...(Array.isArray(analysis.softSkills) ? { softSkills: strings(analysis.softSkills).slice(0, MAX_SOFT_SKILLS) } : {}),
    ...(analysis.terms !== undefined ? { terms: conformTerms(analysis.terms) } : {}),
    ...(analysis.requiredYears !== undefined ? { requiredYears: yearsOrNull(analysis.requiredYears) } : {}),
  };
}

/**
 * The analysis to show for a job: the job-analysis service's, else the fallback. Null when the job does not exist.
 * `queue` is what a person opening the job asks for: in lazy mode the service may start the AI analysis then, on the
 * background slot (people's own AI requests come first) and against `userId`'s hourly budget of new analyses; in the
 * other modes it never queues (the add-time backlog has Claude read each added job).
 */
export function analysisForJob(
  deps: AppDeps,
  jobId: number,
  options: { queue: true; userId: string } | { queue: false },
): JobAnalysisView | null {
  const service = serviceOf(deps);
  if (service) {
    try {
      const result = options.queue
        ? service.ensure(jobId, { interactive: false, requestedBy: options.userId })
        : service.get(jobId);
      if (result) return fromService(result);
    } catch (error) {
      deps.log.warn(`[jobs] the job analysis service failed for job ${jobId}; using the stored analysis`, error);
    }
  }
  return fallbackAnalysis(deps, jobId);
}

/**
 * `analysisForJob` without a single write or AI task: the service's `peek` (the same answer as `get`), else the
 * stored or computed fallback. For passes over many jobs (the resume chooser, Save all). Null when the job does not
 * exist.
 */
export function peekAnalysisForJob(deps: AppDeps, jobId: number): JobAnalysisView | null {
  const service = serviceOf(deps);
  if (service && typeof service.peek === 'function') {
    try {
      const result = service.peek(jobId);
      if (result) return fromService(result);
    } catch (error) {
      deps.log.warn(`[jobs] the job analysis service failed for job ${jobId}; using the stored analysis`, error);
    }
  }
  return fallbackAnalysis(deps, jobId);
}

/** The levels a job asks for: its own, else its analysis's. */
export function jobLevels(own: readonly ExperienceLevel[], analysis: JobAnalysisView | null): ExperienceLevel[] {
  if (own.length > 0) return [...own];
  const set = new Set(analysis?.experienceLevels ?? []);
  return EXPERIENCE_LEVELS.filter((level) => set.has(level));
}
