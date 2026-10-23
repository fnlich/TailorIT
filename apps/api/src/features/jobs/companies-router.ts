import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireUser, userOf } from '../../core/auth/guards';
import type { AppDeps } from '../../core/context';
import { notFound } from '../../core/http/errors';
import { requireCompany, setCompanyHidden } from './store';

const CompanyIdParam = z.coerce.number().int().positive();

function companyIdOf(req: Request): number {
  const parsed = CompanyIdParam.safeParse(req.params.id);
  if (!parsed.success) throw notFound('That company');
  return parsed.data;
}

/** Mounted at /api/companies: "Hide jobs from {company}" and its undo. */
export function createCompaniesRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireUser);

  router.post('/:id/hide', (req, res) => {
    const user = userOf(req);
    const companyId = companyIdOf(req);
    requireCompany(deps, companyId);
    setCompanyHidden(deps, user.id, companyId, true);
    res.json({ hidden: true });
  });

  router.delete('/:id/hide', (req, res) => {
    const user = userOf(req);
    const companyId = companyIdOf(req);
    requireCompany(deps, companyId);
    setCompanyHidden(deps, user.id, companyId, false);
    res.json({ hidden: false });
  });

  return router;
}
