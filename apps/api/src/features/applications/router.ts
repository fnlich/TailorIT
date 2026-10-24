import { Router, type Request } from 'express';
import {
  ApplicationExportQuerySchema,
  ApplicationListQuerySchema,
  BoardQuerySchema,
  BulkApplicationsBodySchema,
  CreateApplicationBodySchema,
  CreateQuestionBodySchema,
  EventDateBodySchema,
  EventStatusParam,
  IdParam,
  PatchApplicationBodySchema,
  PatchQuestionBodySchema,
  STATUS,
  StatusChangeBodySchema,
  TrackerImportBodySchema,
  booleanParam,
  firstParam,
  type ApplicationCounts,
  type ApplicationListResponse,
  type BoardResponse,
} from '@tailorit/shared';
import { z } from 'zod';
import { requireUser, userOf } from '../../core/auth/guards';
import { todayIso, type AppDeps } from '../../core/context';
import { asyncHandler, validationFailed } from '../../core/http/errors';
import { parseInput } from '../../core/http/validate';
import { boardColumns, countApplications, filterClause, pageOfApplications, type ApplicationFilter } from './query';
import {
  companyNames,
  exportCsv,
  exportFileName,
  insightsReport,
  knownCompanies,
  lettersForApplication,
  resumeScore,
  sankeyReport,
} from './reports';
import { bestResumes, SINGLE_SAVE_MATCH_BUDGET_MS } from './resume-choice';
import {
  archiveAll,
  assertValidDate,
  bulkApplications,
  changeStatus,
  clearStatusDate,
  createApplication,
  createQuestion,
  deleteApplication,
  deleteQuestion,
  importApplications,
  patchApplication,
  patchQuestion,
  setArchived,
  setStatusDate,
  wantsResumeMatch,
  type CreateOptions,
} from './service';
import { emptyStatusCounts, getDetail, loadOwnedRow, loadQuestions } from './store';

// Job tracker applications (/api/applications). Owned by work package T (see docs/ARCHITECTURE.md §6).
//
// Saving a job (POST / with a jobId and no resumeId, at Saved) links TailorIT's best resume. It is chosen first,
// read-only and within SINGLE_SAVE_MATCH_BUDGET_MS, then written with the save. When the choice is not ready, or a
// restore or a move back to Saved leaves an application due, the match worker is woken to choose within seconds.

function idOf(req: Request, name = 'id'): string {
  return parseInput(IdParam, req.params[name], 'link');
}

/**
 * POST /api/applications/import/companies: up to 1,000 company names of an import file (the wizard asks in batches).
 * Answer: `{ known: { [name]: name TailorIT knows it by } }`. Only the wizard reads it, so the contract lives here.
 */
const KnownCompaniesBodySchema = z.object({
  names: z.array(z.string().max(500)).min(1).max(1000),
});

/**
 * The import contract caps each cell; a spreadsheet cell longer than that is cut to the cap rather than failing the
 * whole batch (the service keeps 200 characters of titles, companies and locations anyway).
 */
const IMPORT_CELL_LIMITS: Record<string, number> = {
  title: 500,
  companyName: 500,
  location: 500,
  employmentType: 100,
  status: 100,
  notes: 20_000,
  postingUrl: 2_000,
  appliedOn: 100,
};

function clipImportCells(body: unknown): unknown {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { rows?: unknown }).rows)) return body;
  const rows = (body as { rows: unknown[] }).rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
    for (const [field, max] of Object.entries(IMPORT_CELL_LIMITS)) {
      const value = out[field];
      if (typeof value === 'string' && value.length > max) out[field] = value.slice(0, max);
    }
    return out;
  });
  return { ...(body as Record<string, unknown>), rows };
}

function filterOf(query: {
  q?: string;
  statuses: ApplicationFilter['statuses'];
  jobType?: ApplicationFilter['jobType'];
  favorites?: boolean;
  from?: string;
  until?: string;
}): Omit<ApplicationFilter, 'tab'> {
  if (query.from && query.until && query.from > query.until) {
    throw validationFailed('"Applied from" must be on or before "Applied until".', { from: 'Check the dates' });
  }
  return {
    q: query.q,
    statuses: query.statuses,
    jobType: query.jobType,
    favorites: query.favorites,
    from: query.from,
    until: query.until,
  };
}

/** Mounted at /api/applications. */
export function createApplicationsRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireUser);
  /** Wakes the resume match worker: an application may be due (it does nothing before the worker starts). */
  const wakeMatcher = () => deps.services.resumeMatch?.nudge();

  // ---------------------------------------------------------------------------------------------- collections

  // The board: every status column (or one, from a cursor) under the filters. Archived applications have no board
  // in the UI (that tab is a list), but `tab=archived` / `archived=1` is honoured for completeness.
  router.get('/board', (req, res) => {
    const user = userOf(req);
    const query = parseInput(BoardQuerySchema, req.query, 'board filter');
    const archived = booleanParam(req.query.archived) === true || firstParam(req.query.tab) === 'archived';
    const filter: ApplicationFilter = { ...filterOf(query), tab: archived ? 'archived' : 'active' };
    const columns = boardColumns(
      deps.db,
      user.id,
      filter,
      { sort: query.sort, order: query.order },
      query.limit,
      query.status !== undefined ? { status: query.status, cursor: query.cursor } : undefined,
    );
    const body: BoardResponse = { columns };
    res.json(body);
  });

  router.get('/counts', (req, res) => {
    const user = userOf(req);
    const rows = deps.db
      .prepare(
        `SELECT (archived_at IS NULL) AS active, current_status AS status, COUNT(*) AS n
         FROM applications WHERE user_id = ? GROUP BY 1, 2`,
      )
      .all(user.id) as Array<{ active: number; status: number; n: number }>;
    const counts: ApplicationCounts = { active: 0, archived: 0, byStatus: emptyStatusCounts() };
    for (const row of rows) {
      if (row.active) {
        counts.active += row.n;
        counts.byStatus[String(row.status)] = (counts.byStatus[String(row.status)] ?? 0) + row.n;
      } else {
        counts.archived += row.n;
      }
    }
    res.json(counts);
  });

  router.get('/companies', (req, res) => {
    res.json({ items: companyNames(deps, userOf(req).id, firstParam(req.query.q)) });
  });

  router.get('/export.csv', (req, res) => {
    const user = userOf(req);
    const query = parseInput(ApplicationExportQuerySchema, req.query, 'export filter');
    const csv = exportCsv(deps, user.id, { ...filterOf(query), tab: query.tab }, { sort: query.sort, order: query.order });
    const name = exportFileName(todayIso(deps));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(csv);
  });

  router.get('/sankey', (req, res) => {
    res.json(sankeyReport(deps, userOf(req).id));
  });

  router.get('/insights', (req, res) => {
    res.json(insightsReport(deps, userOf(req).id));
  });

  router.post('/import', (req, res) => {
    const body = parseInput(TrackerImportBodySchema, clipImportCells(req.body), 'import');
    res.json(importApplications(deps, userOf(req).id, body));
  });

  // The import wizard's "Review companies": the file's company names TailorIT already knows.
  router.post('/import/companies', (req, res) => {
    const { names } = parseInput(KnownCompaniesBodySchema, req.body, 'company list');
    res.json({ known: knownCompanies(deps, userOf(req).id, names) });
  });

  router.post('/bulk', (req, res) => {
    const body = parseInput(BulkApplicationsBodySchema, req.body, 'request');
    const affected = bulkApplications(deps, userOf(req).id, body);
    if (body.action === 'unarchive' || (body.action === 'status' && body.status === STATUS.saved)) wakeMatcher();
    res.json({ affected });
  });

  router.post('/archive-all', (req, res) => {
    res.json({ archived: archiveAll(deps, userOf(req).id) });
  });

  // The list view (Active or Archived), searched, filtered and sorted, a page at a time.
  router.get('/', (req, res) => {
    const user = userOf(req);
    const query = parseInput(ApplicationListQuerySchema, req.query, 'list filter');
    const where = filterClause(user.id, { ...filterOf(query), tab: query.tab });
    const page = pageOfApplications(deps.db, where, { sort: query.sort, order: query.order }, query.cursor, query.limit);
    const body: ApplicationListResponse = { ...page, total: countApplications(deps.db, where) };
    res.json(body);
  });

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const user = userOf(req);
      const body = parseInput(CreateApplicationBodySchema, req.body, 'application');
      const options: CreateOptions = {};
      if (body.jobId !== undefined && wantsResumeMatch(deps.db, user.id, body)) {
        // A date the save would refuse is refused before choosing.
        assertValidDate(deps, body.occurredOn ?? todayIso(deps));
        const { choices, unfinished } = await bestResumes(deps, user.id, [body.jobId], SINGLE_SAVE_MATCH_BUDGET_MS);
        options.matchedResume = choices.get(body.jobId) ?? null;
        options.matchPending = unfinished.includes(body.jobId);
      }
      const { detail, created } = createApplication(deps, user.id, body, options);
      if (detail.resumeMatchPending) wakeMatcher();
      res.status(created ? 201 : 200).json(detail);
    }),
  );

  // ------------------------------------------------------------------------------------------- one application

  router.get('/:id', (req, res) => {
    res.json(getDetail(deps.db, userOf(req).id, idOf(req)));
  });

  router.patch('/:id', (req, res) => {
    const body = parseInput(PatchApplicationBodySchema, req.body, 'application');
    res.json(patchApplication(deps, userOf(req).id, idOf(req), body));
  });

  router.delete('/:id', (req, res) => {
    deleteApplication(deps, userOf(req).id, idOf(req));
    res.status(204).end();
  });

  router.put('/:id/status', (req, res) => {
    const body = parseInput(StatusChangeBodySchema, req.body, 'status');
    const result = changeStatus(deps, userOf(req).id, idOf(req), body.status, body.occurredOn);
    if (result.currentStatus === STATUS.saved) wakeMatcher();
    res.json(result);
  });

  router.put('/:id/events/:status', (req, res) => {
    const status = parseInput(EventStatusParam, req.params.status, 'status');
    const body = parseInput(EventDateBodySchema, req.body, 'date');
    res.json(setStatusDate(deps, userOf(req).id, idOf(req), status, body.occurredOn));
  });

  router.delete('/:id/events/:status', (req, res) => {
    const status = parseInput(EventStatusParam, req.params.status, 'status');
    const result = clearStatusDate(deps, userOf(req).id, idOf(req), status);
    if (result.currentStatus === STATUS.saved) wakeMatcher();
    res.json(result);
  });

  router.post('/:id/archive', (req, res) => {
    res.json(setArchived(deps, userOf(req).id, idOf(req), true));
  });

  router.post('/:id/restore', (req, res) => {
    const detail = setArchived(deps, userOf(req).id, idOf(req), false);
    if (detail.resumeMatchPending) wakeMatcher();
    res.json(detail);
  });

  router.get('/:id/cover-letters', (req, res) => {
    res.json({ items: lettersForApplication(deps, userOf(req).id, idOf(req)) });
  });

  router.get('/:id/resume-score', (req, res) => {
    res.json(resumeScore(deps, userOf(req).id, idOf(req)));
  });

  router.get('/:id/questions', (req, res) => {
    const user = userOf(req);
    const id = idOf(req);
    loadOwnedRow(deps.db, user.id, id);
    res.json({ items: loadQuestions(deps.db, id) });
  });

  router.post('/:id/questions', (req, res) => {
    const body = parseInput(CreateQuestionBodySchema, req.body, 'question');
    res.status(201).json(createQuestion(deps, userOf(req).id, idOf(req), body));
  });

  router.patch('/:id/questions/:questionId', (req, res) => {
    const body = parseInput(PatchQuestionBodySchema, req.body, 'question');
    res.json(patchQuestion(deps, userOf(req).id, idOf(req), idOf(req, 'questionId'), body));
  });

  router.delete('/:id/questions/:questionId', (req, res) => {
    deleteQuestion(deps, userOf(req).id, idOf(req), idOf(req, 'questionId'));
    res.status(204).end();
  });

  return router;
}
