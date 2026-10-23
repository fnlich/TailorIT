import { Router } from 'express';
import { z } from 'zod';
import { IsoDateTime, ROLES } from '@tailorit/shared';
import { requireAdmin, userOf } from '../../core/auth/guards';
import { destroySessionsForUser } from '../../core/auth/session';
import { getUserById, isConfiguredAdmin, type UserRow } from '../../core/auth/users';
import { nowIso, type AppDeps } from '../../core/context';
import { transaction } from '../../core/db/connection';
import { conflict, notFound, validationFailed } from '../../core/http/errors';
import { parseInput } from '../../core/http/validate';

// Administrator: list accounts, change role, disable. Owned by work package F3 (see docs/ARCHITECTURE.md).

/** One row of Admin > Users. */
export const AdminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(ROLES),
  disabled: z.boolean(),
  createdAt: IsoDateTime,
  lastSignInAt: IsoDateTime.nullable(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

/** PATCH /api/admin/users/:id answers the changed row, plus a `note` when the change will not last. */
export type AdminUserPatchResponse = AdminUser & { note?: string };

export const AdminUserPatchBodySchema = z.object({
  role: z.enum(ROLES, { error: `The role must be one of ${ROLES.join(', ')}.` }).optional(),
  disabled: z.boolean({ error: 'Disabled is true or false.' }).optional(),
});

function toAdminUser(row: UserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    disabled: row.disabled_at !== null,
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at,
  };
}

const ANOTHER_ADMIN = 'Another administrator can, if it is really meant.';

/** Mounted at /api/admin/users. */
export function createAdminUsersRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAdmin);

  router.get('/', (_req, res) => {
    const rows = deps.db.prepare('SELECT * FROM users ORDER BY created_at DESC, email').all() as UserRow[];
    res.json({ items: rows.map(toAdminUser), total: rows.length });
  });

  router.patch('/:id', (req, res) => {
    const target = getUserById(deps, req.params.id ?? '');
    if (!target) throw notFound('That account');
    const change = parseInput(AdminUserPatchBodySchema, req.body ?? {}, 'change');
    if (change.role === undefined && change.disabled === undefined) {
      throw validationFailed('There is nothing to change.');
    }

    // Nobody demotes or disables the account they are signed in with: the one person who made that mistake would be
    // the one person who could no longer undo it. Another administrator can.
    if (target.id === userOf(req).id) {
      if (change.disabled === true) {
        throw conflict(`You cannot disable the account you are signed in with. ${ANOTHER_ADMIN}`);
      }
      if (change.role !== undefined && change.role !== 'admin') {
        throw conflict(
          `You cannot remove the administrator role from the account you are signed in with. ${ANOTHER_ADMIN}`,
        );
      }
    }

    const updated = transaction(deps.db, () => {
      const now = nowIso(deps);
      if (change.role !== undefined && change.role !== target.role) {
        deps.db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(change.role, now, target.id);
      }
      if (change.disabled !== undefined && change.disabled !== (target.disabled_at !== null)) {
        deps.db
          .prepare('UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?')
          .run(change.disabled ? now : null, now, target.id);
      }
      // A disabled account's sessions end now (the session check refuses them anyway; this removes the rows).
      if (change.disabled === true) destroySessionsForUser(deps, target.id);
      return getUserById(deps, target.id)!;
    });

    const body: AdminUserPatchResponse = toAdminUser(updated);
    if (change.role === 'user' && isConfiguredAdmin(deps, target.email)) {
      body.note =
        `${target.email} is listed in ADMIN_EMAILS, so it becomes an administrator again the next time it signs in ` +
        'or the server restarts. Remove it from ADMIN_EMAILS to make this change last.';
    }
    res.json(body);
  });

  return router;
}
