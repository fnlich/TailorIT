import request from 'supertest';
import type { Account } from '@tailorit/shared';
import { SESSION_COOKIE } from '../src/core/auth/session';
import { ORIGIN, type TestContext } from './helpers';

export type TestAgent = ReturnType<typeof request.agent>;

export interface SignedIn {
  /** A cookie-keeping client signed in as the account. */
  agent: TestAgent;
  account: Account;
  /** `ti_session=<token>`, for one-off requests: `request(ctx.app).get(url).set('Cookie', cookie)`. */
  cookie: string;
}

/**
 * Signs `email` in through the real endpoint with the development fixed code (createTestContext sets
 * AUTH_DEV_FIXED_CODE=000000), creating the account on first use. Each call returns a NEW agent unless `agent` is
 * given (pass `ctx.agent` to sign in the context's shared client), so two users never share cookies by accident.
 * `admin` makes the account an administrator; `name` sets its display name.
 */
export async function signIn(
  ctx: TestContext,
  email: string,
  options: { admin?: boolean; name?: string; agent?: TestAgent } = {},
): Promise<SignedIn> {
  const code = ctx.deps.config.auth.devFixedCode;
  if (!code) throw new Error('signIn() needs AUTH_DEV_FIXED_CODE; do not clear it in createTestContext({ env }).');

  const agent = options.agent ?? request.agent(ctx.app);
  const res = await agent.post('/api/auth/email/verify').set('Origin', ORIGIN).send({ email, code });
  if (res.status !== 200) throw new Error(`signIn(${email}) failed: ${res.status} ${JSON.stringify(res.body)}`);

  let account = res.body.account as Account;
  if (options.admin && account.role !== 'admin') {
    ctx.deps.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(account.id);
    account = { ...account, role: 'admin' };
  }
  if (options.name !== undefined) {
    ctx.deps.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(options.name, account.id);
    account = { ...account, name: options.name };
  }

  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = setCookie.find((line) => line.startsWith(`${SESSION_COOKIE}=`))?.split(';')[0];
  if (!cookie) throw new Error(`signIn(${email}) got no ${SESSION_COOKIE} cookie`);
  return { agent, account, cookie };
}
