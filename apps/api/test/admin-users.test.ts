import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AdminUserSchema } from '../src/features/admin-users/router';
import { signIn } from './auth-helpers';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';

let ctx: TestContext | null = null;
afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

function use(env: Record<string, string> = {}): TestContext {
  ctx = createTestContext({ env });
  return ctx;
}

describe('/api/admin/users', () => {
  it('is for administrators only', async () => {
    const c = use();
    const signedOut = await request(c.app).get('/api/admin/users');
    expect(signedOut.status).toBe(401);
    expect(signedOut.body.error.code).toBe('not_signed_in');

    const user = await signIn(c, 'user@example.com');
    const listed = await user.agent.get('/api/admin/users');
    expect(listed.status).toBe(403);
    expect(listed.body.error).toMatchObject({
      code: 'forbidden',
      message: 'That is an administrator-only part of TailorIT.',
    });
    const patched = await user.agent.patch(`/api/admin/users/${user.account.id}`).set('Origin', ORIGIN).send({
      role: 'admin',
    });
    expect(patched.status).toBe(403);
    expect((await user.agent.get('/api/auth/me')).body.account.role).toBe('user');
  });

  it('lists every account, newest first', async () => {
    const c = use();
    const admin = await signIn(c, 'admin@example.com', { admin: true });
    c.setNow(new Date(TEST_NOW.getTime() + 60_000));
    const user = await signIn(c, 'user@example.com', { name: 'Uma User' });
    c.deps.db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(TEST_NOW.toISOString(), user.account.id);

    const res = await admin.agent.get('/api/admin/users');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const items = res.body.items.map((item: unknown) => AdminUserSchema.parse(item));
    expect(items).toEqual([
      {
        id: user.account.id,
        email: 'user@example.com',
        name: 'Uma User',
        role: 'user',
        disabled: true,
        createdAt: new Date(TEST_NOW.getTime() + 60_000).toISOString(),
        lastSignInAt: new Date(TEST_NOW.getTime() + 60_000).toISOString(),
      },
      {
        id: admin.account.id,
        email: 'admin@example.com',
        name: 'admin',
        role: 'admin',
        disabled: false,
        createdAt: TEST_NOW.toISOString(),
        lastSignInAt: TEST_NOW.toISOString(),
      },
    ]);
  });

  it('changes roles, and disabling ends the account’s sessions', async () => {
    const c = use();
    const admin = await signIn(c, 'admin@example.com', { admin: true });
    const user = await signIn(c, 'user@example.com');
    const patch = (body: object) =>
      admin.agent.patch(`/api/admin/users/${user.account.id}`).set('Origin', ORIGIN).send(body);

    const promoted = await patch({ role: 'admin' });
    expect(promoted.status).toBe(200);
    expect(AdminUserSchema.parse(promoted.body)).toMatchObject({ role: 'admin', disabled: false });
    expect((await user.agent.get('/api/admin/users')).status).toBe(200);
    expect((await patch({ role: 'user' })).body.role).toBe('user');
    expect((await user.agent.get('/api/admin/users')).status).toBe(403);

    const disabled = await patch({ disabled: true });
    expect(disabled.body).toMatchObject({ disabled: true });
    expect(c.deps.db.prepare('SELECT count(*) AS n FROM user_sessions WHERE user_id = ?').get(user.account.id)).toEqual({
      n: 0,
    });
    expect((await user.agent.get('/api/auth/me')).body.account).toBeNull();
    const refused = await user.agent
      .post('/api/auth/email/verify')
      .set('Origin', ORIGIN)
      .send({ email: 'user@example.com', code: '000000' });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('account_disabled');

    expect((await patch({ disabled: false })).body).toMatchObject({ disabled: false });
    expect((await signIn(c, 'user@example.com')).account.id).toBe(user.account.id);
  });

  it('does not let an administrator demote or disable the account they are signed in with', async () => {
    const c = use();
    const admin = await signIn(c, 'admin@example.com', { admin: true });
    const patch = (body: object) =>
      admin.agent.patch(`/api/admin/users/${admin.account.id}`).set('Origin', ORIGIN).send(body);

    const disable = await patch({ disabled: true });
    expect(disable.status).toBe(409);
    expect(disable.body.error).toMatchObject({
      code: 'conflict',
      message:
        'You cannot disable the account you are signed in with. Another administrator can, if it is really meant.',
    });
    const demote = await patch({ role: 'user' });
    expect(demote.status).toBe(409);
    expect(demote.body.error.message).toBe(
      'You cannot remove the administrator role from the account you are signed in with. ' +
        'Another administrator can, if it is really meant.',
    );
    // Harmless changes to yourself are fine.
    expect((await patch({ role: 'admin', disabled: false })).status).toBe(200);
    expect((await admin.agent.get('/api/auth/me')).body.account.role).toBe('admin');
  });

  it('validates the change and the target', async () => {
    const c = use();
    const admin = await signIn(c, 'admin@example.com', { admin: true });
    const user = await signIn(c, 'user@example.com');
    const patch = (id: string, body: object) =>
      admin.agent.patch(`/api/admin/users/${id}`).set('Origin', ORIGIN).send(body);

    const missing = await patch('nobody', { role: 'admin' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toBe('That account was not found.');
    const nothing = await patch(user.account.id, {});
    expect(nothing.status).toBe(400);
    expect(nothing.body.error.message).toBe('There is nothing to change.');
    const badRole = await patch(user.account.id, { role: 'owner' });
    expect(badRole.status).toBe(400);
    expect(badRole.body.error.fields).toEqual({ role: 'The role must be one of user, admin.' });
    expect((await patch(user.account.id, { disabled: 'yes' })).status).toBe(400);
  });

  it('warns that demoting an ADMIN_EMAILS address does not last', async () => {
    const c = use({ ADMIN_EMAILS: 'listed@example.com' });
    const admin = await signIn(c, 'admin@example.com', { admin: true });
    const listed = await signIn(c, 'listed@example.com');
    expect(listed.account.role).toBe('admin');
    const res = await admin.agent
      .patch(`/api/admin/users/${listed.account.id}`)
      .set('Origin', ORIGIN)
      .send({ role: 'user' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('user');
    expect(res.body.note).toBe(
      'listed@example.com is listed in ADMIN_EMAILS, so it becomes an administrator again the next time it signs in ' +
        'or the server restarts. Remove it from ADMIN_EMAILS to make this change last.',
    );
    expect((await signIn(c, 'listed@example.com')).account.role).toBe('admin');
  });
});
