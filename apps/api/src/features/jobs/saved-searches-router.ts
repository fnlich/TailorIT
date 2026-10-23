import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { normalizeJobsQuery, type JobsQuery, type SavedSearch } from '@tailorit/shared';
import { z } from 'zod';
import { requireUser, userOf } from '../../core/auth/guards';
import { nowIso, type AppDeps } from '../../core/context';
import { conflict, notFound } from '../../core/http/errors';
import { parseInput } from '../../core/http/validate';
import { isoTimestamp } from './rows';

// Saved searches (the toolbar's bookmark): a name and the page's filters. The query is stored in its canonical form
// (`normalizeJobsQuery`) without a cursor, and normalized again on the way out, so a value the taxonomy no longer has
// quietly drops out instead of breaking the list.

const MAX_SAVED_SEARCHES = 50;

const NameSchema = z.string().trim().min(1, 'Give the search a name').max(100, 'Use at most 100 characters');
const CreateBodySchema = z.object({ name: NameSchema, query: z.unknown().optional() });
const RenameBodySchema = z.object({ name: NameSchema });
const IdParam = z.string().min(1).max(64);

interface SavedSearchRow {
  id: string;
  name: string;
  query: string;
  created_at: string;
}

/** The stored filters without a cursor (a saved search always starts at the top). */
export function savedQueryOf(input: unknown): JobsQuery {
  const { cursor: _cursor, ...query } = normalizeJobsQuery(input);
  return { ...query, cursor: undefined };
}

function toSavedSearch(row: SavedSearchRow): SavedSearch {
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(row.query);
  } catch {
    parsed = {};
  }
  return {
    id: row.id,
    name: row.name,
    query: savedQueryOf(parsed),
    createdAt: isoTimestamp(row.created_at) ?? row.created_at,
  };
}

function storedJson(query: JobsQuery): string {
  const { cursor: _cursor, ...rest } = query;
  return JSON.stringify(rest);
}

/** Mounted at /api/saved-searches. */
export function createSavedSearchesRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireUser);

  const load = (userId: string, id: string): SavedSearchRow => {
    const row = deps.db
      .prepare('SELECT id, name, query, created_at FROM saved_searches WHERE id = ? AND user_id = ?')
      .get(id, userId) as SavedSearchRow | undefined;
    if (!row) throw notFound('That saved search');
    return row;
  };

  router.get('/', (req, res) => {
    const user = userOf(req);
    const rows = deps.db
      .prepare('SELECT id, name, query, created_at FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC, id')
      .all(user.id) as SavedSearchRow[];
    res.json({ items: rows.map(toSavedSearch), total: rows.length });
  });

  router.post('/', (req, res) => {
    const user = userOf(req);
    const body = parseInput(CreateBodySchema, req.body, 'saved search');
    const count = (deps.db.prepare('SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?').get(user.id) as { n: number }).n;
    if (count >= MAX_SAVED_SEARCHES) {
      throw conflict(`You can keep up to ${MAX_SAVED_SEARCHES} saved searches. Delete one to save this search.`);
    }
    const row: SavedSearchRow = {
      id: randomUUID(),
      name: body.name,
      query: storedJson(savedQueryOf(body.query ?? {})),
      created_at: nowIso(deps),
    };
    deps.db
      .prepare('INSERT INTO saved_searches(id, user_id, name, query, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, user.id, row.name, row.query, row.created_at);
    res.status(201).json(toSavedSearch(row));
  });

  router.patch('/:id', (req, res) => {
    const user = userOf(req);
    const id = IdParam.safeParse(req.params.id);
    if (!id.success) throw notFound('That saved search');
    const body = parseInput(RenameBodySchema, req.body, 'saved search');
    load(user.id, id.data);
    deps.db.prepare('UPDATE saved_searches SET name = ? WHERE id = ? AND user_id = ?').run(body.name, id.data, user.id);
    res.json(toSavedSearch(load(user.id, id.data)));
  });

  router.delete('/:id', (req, res) => {
    const user = userOf(req);
    const id = IdParam.safeParse(req.params.id);
    if (!id.success) throw notFound('That saved search');
    load(user.id, id.data);
    deps.db.prepare('DELETE FROM saved_searches WHERE id = ? AND user_id = ?').run(id.data, user.id);
    res.status(204).end();
  });

  return router;
}
