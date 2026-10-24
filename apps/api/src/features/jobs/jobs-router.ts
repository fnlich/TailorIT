import { Router, type Request } from 'express';
import {
  JOB_FACETS,
  JobFacetQuerySchema,
  JobIdParam,
  JobReportBodySchema,
  levelMatch,
  matchResult,
  noResumeMatch,
  searchParamsToJobsQuery,
  type JobAnalysisView,
  type JobFacetResponse,
  type LevelMatch,
  type MatchResult,
} from '@tailorit/shared';
import { z } from 'zod';
import { requireUser, userOf } from '../../core/auth/guards';
import type { AppDeps } from '../../core/context';
import { AppError, notFound } from '../../core/http/errors';
import { parseInput } from '../../core/http/validate';
import { getResumeEvidence } from '../resumes/evidence';
import { analysisForJob, jobLevels } from './analysis';
import { facetItems, facetsSummary } from './facets';
import { sanitizeDescription } from './html';
import { experienceLevelsOf, toJobDetail } from './rows';
import { countJobs, searchJobs } from './search';
import {
  hiddenState,
  loadDetailRow,
  loadLocations,
  markViewed,
  preferredLevels,
  reportJob,
  requireJob,
  setJobHidden,
} from './store';

/** GET /api/jobs/:id/match: the job analysis card, plus the facts grid's experience-level check. */
export type JobMatchWithLevel = MatchResult & { levelMatch: LevelMatch };

/**
 * GET /api/jobs/:id/insights: the analysis and the match computed from that very analysis, so the page's summary and
 * keyword card change together when the AI analysis lands. `match` is null when it could not be computed.
 */
export interface JobInsights {
  analysis: JobAnalysisView;
  match: JobMatchWithLevel | null;
}

/**
 * The resume linked to the viewer's application for a job the Jobs page shows as tracked (saved, or applied and on,
 * archived or not), or null. An un-saved job (an archived application that never got past Saved) is not tracked.
 */
function linkedResumeOf(deps: AppDeps, userId: string, jobId: number): string | null {
  const row = deps.db
    .prepare(
      `SELECT resume_id FROM applications WHERE user_id = ? AND job_id = ? AND resume_id IS NOT NULL
         AND (archived_at IS NULL OR current_status >= 2)`,
    )
    .get(userId, jobId) as { resume_id: string } | undefined;
  return row?.resume_id ?? null;
}

/**
 * The card's match, with the experience-level check: a tracked job scores the resume linked to its application (the
 * one Resume Score and the tracker's picker score, so the three agree), any other job the default resume. With
 * `nameResume` the answer also names the resume it scored ("Scored with {label}") and which of the two it was.
 */
function matchFor(
  deps: AppDeps,
  userId: string,
  job: { id: number; experience_levels: string },
  analysis: JobAnalysisView | null,
  options: { nameResume?: boolean } = {},
): JobMatchWithLevel {
  const keywords = analysis?.keywords ?? { high: [], low: [] };
  const linkedId = linkedResumeOf(deps, userId, job.id);
  const linked = linkedId ? getResumeEvidence(deps, userId, linkedId) : null;
  const evidence = linked ?? getResumeEvidence(deps, userId);
  let match: MatchResult = noResumeMatch(keywords);
  if (evidence) {
    match = matchResult(evidence.text, keywords, evidence.resumeId);
    if (options.nameResume) match = { ...match, resumeLabel: evidence.label, resumeBasis: linked ? 'linked' : 'default' };
  }
  return {
    ...match,
    levelMatch: levelMatch(jobLevels(experienceLevelsOf(job.experience_levels), analysis), preferredLevels(deps, userId)),
  };
}

/** A job id from the path; anything that is not one is a job that does not exist. */
export function jobIdOf(req: Request): number {
  const parsed = JobIdParam.safeParse(req.params.id);
  if (!parsed.success) throw notFound('That job');
  return parsed.data;
}

const FacetParam = z.enum(JOB_FACETS);

/** Mounted at /api/jobs. Every route needs a signed-in account. */
export function createJobsRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireUser);

  // The list: every filter of the page (the URL's own keys), 21 per page, "Found N jobs".
  router.get('/', (req, res) => {
    const user = userOf(req);
    const query = searchParamsToJobsQuery(req.query as Record<string, unknown>);
    res.json(searchJobs(deps.db, query, { userId: user.id, now: deps.now() }));
  });

  router.get('/count', (req, res) => {
    const user = userOf(req);
    const query = searchParamsToJobsQuery(req.query as Record<string, unknown>);
    res.json({ total: countJobs(deps.db, query, { userId: user.id, now: deps.now() }) });
  });

  router.get('/facets/summary', (_req, res) => {
    res.json(facetsSummary(deps.db));
  });

  router.get('/facets/:facet', (req, res) => {
    const facet = FacetParam.safeParse(req.params.facet);
    if (!facet.success) throw new AppError('not_found', 'There is no such filter list.');
    const { q, limit } = parseInput(JobFacetQuerySchema, req.query, 'filter search');
    const body: JobFacetResponse = { facet: facet.data, items: facetItems(deps.db, facet.data, q || undefined, limit) };
    res.json(body);
  });

  router.get('/:id', (req, res) => {
    const user = userOf(req);
    const jobId = jobIdOf(req);
    const row = loadDetailRow(deps, user.id, jobId);
    const detail = toJobDetail(
      row,
      loadLocations(deps, jobId),
      sanitizeDescription(row.description_html),
      hiddenState(deps, user.id, jobId, row.company_id),
    );
    markViewed(deps, user.id, jobId);
    res.json(detail);
  });

  // The best analysis of the job so far. Opening a job queues Claude's analysis only with AI_JOB_ANALYSIS=lazy (J1's
  // service decides); by default the add-time backlog has Claude read every added job, and opening one queues nothing.
  router.get('/:id/analysis', (req, res) => {
    const jobId = jobIdOf(req);
    requireJob(deps, jobId);
    const analysis = analysisForJob(deps, jobId, { queue: true, userId: userOf(req).id });
    if (!analysis) throw notFound('That job');
    res.json(analysis);
  });

  // The card's match on its own, in its original shape (the tracker's Resume Score answers the same for a tracked job).
  router.get('/:id/match', (req, res) => {
    const user = userOf(req);
    const jobId = jobIdOf(req);
    const job = requireJob(deps, jobId);
    const body: JobMatchWithLevel = matchFor(deps, user.id, job, analysisForJob(deps, jobId, { queue: false }));
    res.json(body);
  });

  // What the job page polls: the analysis (asked for as /analysis asks) and the match read off that same analysis. A
  // match that fails leaves the summary standing.
  router.get('/:id/insights', (req, res) => {
    const user = userOf(req);
    const jobId = jobIdOf(req);
    const job = requireJob(deps, jobId);
    const analysis = analysisForJob(deps, jobId, { queue: true, userId: user.id });
    if (!analysis) throw notFound('That job');
    let match: JobMatchWithLevel | null = null;
    try {
      match = matchFor(deps, user.id, job, analysis, { nameResume: true });
    } catch (error) {
      deps.log.warn(`[jobs] the keyword match failed for job ${jobId}`, error);
    }
    const body: JobInsights = { analysis, match };
    res.json(body);
  });

  router.post('/:id/hide', (req, res) => {
    const user = userOf(req);
    const jobId = jobIdOf(req);
    requireJob(deps, jobId);
    setJobHidden(deps, user.id, jobId, true);
    res.json({ hidden: true });
  });

  router.delete('/:id/hide', (req, res) => {
    const user = userOf(req);
    const jobId = jobIdOf(req);
    requireJob(deps, jobId);
    setJobHidden(deps, user.id, jobId, false);
    res.json({ hidden: false });
  });

  router.post('/:id/report', (req, res) => {
    const user = userOf(req);
    const jobId = jobIdOf(req);
    const body = parseInput(JobReportBodySchema, req.body, 'report');
    requireJob(deps, jobId);
    res.status(201).json(reportJob(deps, user.id, jobId, body));
  });

  return router;
}
