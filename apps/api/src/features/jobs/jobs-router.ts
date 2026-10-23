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

/** The viewer's default resume scored against an analysis's keywords, with the experience-level check. */
function matchFor(
  deps: AppDeps,
  userId: string,
  job: { experience_levels: string },
  analysis: JobAnalysisView | null,
): JobMatchWithLevel {
  const keywords = analysis?.keywords ?? { high: [], low: [] };
  const evidence = getResumeEvidence(deps, userId);
  const match = evidence ? matchResult(evidence.text, keywords, evidence.resumeId) : noResumeMatch(keywords);
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

  // Opening a job is what starts its AI analysis (J1's service queues it); meanwhile the best one so far is shown.
  router.get('/:id/analysis', (req, res) => {
    const jobId = jobIdOf(req);
    requireJob(deps, jobId);
    const analysis = analysisForJob(deps, jobId, { queue: true, userId: userOf(req).id });
    if (!analysis) throw notFound('That job');
    res.json(analysis);
  });

  router.get('/:id/match', (req, res) => {
    const user = userOf(req);
    const jobId = jobIdOf(req);
    const job = requireJob(deps, jobId);
    const body: JobMatchWithLevel = matchFor(deps, user.id, job, analysisForJob(deps, jobId, { queue: false }));
    res.json(body);
  });

  // What the job page polls: the analysis (opening a job starts the AI one, as /analysis does) and the match read off
  // that same analysis. A match that fails leaves the summary standing.
  router.get('/:id/insights', (req, res) => {
    const user = userOf(req);
    const jobId = jobIdOf(req);
    const job = requireJob(deps, jobId);
    const analysis = analysisForJob(deps, jobId, { queue: true, userId: user.id });
    if (!analysis) throw notFound('That job');
    let match: JobMatchWithLevel | null = null;
    try {
      match = matchFor(deps, user.id, job, analysis);
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
