import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AccountSchema, AuthOptionsSchema } from '@tailorit/shared';
import type { GoogleTokenPayload } from '../src/core/auth/google';
import type { MailMessage } from '../src/core/mail/mailer';
import { SIGN_IN_GLOBAL_LIMIT, signInRateLimit } from '../src/core/rate-limit';
import { startAuth } from '../src/features/auth/index';
import { signIn, type TestAgent } from './auth-helpers';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';

let ctx: TestContext | null = null;
afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

/** Real random codes, printed to the (memory) log instead of emailed; no fixed code. */
const CODES_IN_LOG = { AUTH_DEV_FIXED_CODE: '', AUTH_DEV_LOG_CODES: 'true' };
const SMTP = { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'signin@example.com', SMTP_PASS: 'secret', AUTH_DEV_FIXED_CODE: '' };
const at = (ms: number) => new Date(TEST_NOW.getTime() + ms);
const MINUTE = 60_000;
const DAY = 86_400_000;

function use(options: Parameters<typeof createTestContext>[0] = {}): TestContext {
  ctx = createTestContext(options);
  return ctx;
}

function post(c: TestContext, path: string, body: object, agent: TestAgent = c.agent) {
  return agent.post(path).set('Origin', ORIGIN).send(body);
}

function requestCode(c: TestContext, email: string, agent?: TestAgent) {
  return post(c, '/api/auth/email/request', { email }, agent);
}

function verifyCode(c: TestContext, email: string, code: string, agent?: TestAgent) {
  return post(c, '/api/auth/email/verify', { email, code }, agent);
}

/** The last code the API printed for an address (AUTH_DEV_LOG_CODES). */
function loggedCode(c: TestContext, email: string): string {
  const lines = (c.deps.log as unknown as { lines: string[] }).lines;
  const prefix = `[auth] sign-in code for ${email}: `;
  const line = [...lines].reverse().find((l) => l.startsWith(prefix));
  if (!line) throw new Error(`no code was logged for ${email}`);
  return line.slice(prefix.length);
}

function otherCode(code: string): string {
  return code === '111111' ? '222222' : '111111';
}

function sessionCookie(res: request.Response): string {
  const line = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((l) => l.startsWith('ti_session='));
  if (!line) throw new Error('no session cookie was set');
  return line;
}

const count = (c: TestContext, sql: string, ...params: unknown[]) =>
  (c.deps.db.prepare(sql).get(...params) as { n: number }).n;

describe('GET /api/auth/options', () => {
  it('offers the email code when only the test fixed code is configured', async () => {
    const c = use();
    const res = await request(c.app).get('/api/auth/options');
    expect(res.status).toBe(200);
    expect(AuthOptionsSchema.parse(res.body)).toEqual({
      google: { available: false, clientId: null },
      email: { available: true, devCodesInConsole: false },
      contactEmail: null,
    });
  });

  it('reflects Google, printed codes and the contact address', async () => {
    const c = use({
      env: { ...CODES_IN_LOG, GOOGLE_CLIENT_ID: 'client-1.apps.googleusercontent.com', CONTACT_EMAIL: 'help@x.com' },
    });
    const res = await request(c.app).get('/api/auth/options');
    expect(res.body).toEqual({
      google: { available: true, clientId: 'client-1.apps.googleusercontent.com' },
      email: { available: true, devCodesInConsole: true },
      contactEmail: 'help@x.com',
    });
  });

  it('does not call codes printed when SMTP sends them', async () => {
    const c = use({ env: { ...SMTP, AUTH_DEV_LOG_CODES: 'true' } });
    const res = await request(c.app).get('/api/auth/options');
    expect(res.body.email).toEqual({ available: true, devCodesInConsole: false });
  });

  it('offers nothing, and refuses code requests, when no method is configured', async () => {
    const c = use({ env: { AUTH_DEV_FIXED_CODE: '' } });
    const options = await request(c.app).get('/api/auth/options');
    expect(options.body.google.available).toBe(false);
    expect(options.body.email.available).toBe(false);
    const res = await requestCode(c, 'a@example.com');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({
      code: 'sign_in_unavailable',
      message: "Sign-in isn't available right now. Please contact your administrator.",
    });
    const google = await post(c, '/api/auth/google', { credential: 'x' });
    expect(google.status).toBe(503);
    expect(google.body.error.code).toBe('sign_in_unavailable');
  });
});

describe('email code sign-in', () => {
  it('signs in with the fixed test code, sets the session cookie and keeps the session', async () => {
    const c = use();
    const res = await verifyCode(c, ' New.Person@Example.COM ', '000000');
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
    expect(AccountSchema.parse(res.body.account)).toEqual({
      id: expect.any(String),
      email: 'new.person@example.com',
      name: 'new.person',
      avatarUrl: null,
      role: 'user',
      defaultResumeId: null,
      createdAt: TEST_NOW.toISOString(),
    });

    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/^ti_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(cookie).toMatch(/; Path=\//);
    expect(cookie).toMatch(/; Max-Age=2592000/);
    expect(cookie).not.toMatch(/Secure/);

    const me = await c.agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.account).toEqual(res.body.account);

    // Only the token's hash is stored.
    const token = cookie.slice('ti_session='.length, cookie.indexOf(';'));
    const stored = c.deps.db.prepare('SELECT token_hash, user_id, expires_at FROM user_sessions').all() as {
      token_hash: string;
      expires_at: string;
    }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(stored[0]!.expires_at).toBe(at(30 * DAY).toISOString());
    const user = c.deps.db.prepare('SELECT last_sign_in_at FROM users').get() as { last_sign_in_at: string };
    expect(user.last_sign_in_at).toBe(TEST_NOW.toISOString());

    const again = await verifyCode(c, 'new.person@example.com', '000000', request.agent(c.app));
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.account.id).toBe(res.body.account.id);
  });

  it('answers 200 with account null when signed out', async () => {
    const c = use();
    const res = await request(c.app).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ account: null });
  });

  it('marks the cookie Secure when the request came over https through the proxy', async () => {
    const c = use();
    const res = await request(c.app)
      .post('/api/auth/email/verify')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-Proto', 'https')
      .send({ email: 'secure@example.com', code: '000000' });
    expect(sessionCookie(res)).toMatch(/; Secure/);
  });

  it('follows SESSION_TTL_DAYS for the cookie and the row', async () => {
    const c = use({ env: { SESSION_TTL_DAYS: '2' } });
    const res = await verifyCode(c, 'ttl@example.com', '000000');
    expect(sessionCookie(res)).toMatch(/; Max-Age=172800/);
    const row = c.deps.db.prepare('SELECT expires_at FROM user_sessions').get() as { expires_at: string };
    expect(row.expires_at).toBe(at(2 * DAY).toISOString());
  });

  it('sends a real code, accepts it once, and answers the same for new and existing addresses', async () => {
    const c = use({ env: CODES_IN_LOG });
    const res = await requestCode(c, 'Ann@Example.com');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sent: true,
      email: 'ann@example.com',
      expiresInMinutes: 10,
      message: 'A six-digit code is on its way to ann@example.com. It expires in 10 minutes.',
    });
    const code = loggedCode(c, 'ann@example.com');
    expect(code).toMatch(/^\d{6}$/);
    expect(c.deps.db.prepare('SELECT code_hash FROM login_codes').get()).toEqual({
      code_hash: createHash('sha256').update(code).digest('hex'),
    });

    const verified = await verifyCode(c, 'ANN@example.com', code);
    expect(verified.status).toBe(200);
    expect(verified.body.created).toBe(true);
    expect(count(c, 'SELECT count(*) AS n FROM login_codes')).toBe(0);

    const reused = await verifyCode(c, 'ann@example.com', code, request.agent(c.app));
    expect(reused.status).toBe(401);
    expect(reused.body.error).toMatchObject({
      code: 'validation_failed',
      message: 'That code has already been used, or none was sent to this address. Ask for a new one.',
    });

    // An address with an account and one without get the same answer.
    const existing = await requestCode(c, 'ann@example.com');
    const unknown = await requestCode(c, 'nobody@example.com');
    expect(existing.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual({
      ...existing.body,
      email: 'nobody@example.com',
      message: existing.body.message.replace('ann@example.com', 'nobody@example.com'),
    });
    expect(count(c, 'SELECT count(*) AS n FROM users')).toBe(1);
  });

  it('refuses things that are not email addresses or six digits', async () => {
    const c = use({ env: CODES_IN_LOG });
    for (const email of ['not-an-email', 'a@b', '', 'two words@example.com', `${'x'.repeat(250)}@example.com`]) {
      const res = await requestCode(c, email);
      expect(res.status, email).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'validation_failed',
        message: 'That does not look like an email address.',
        fields: { email: 'That does not look like an email address.' },
      });
    }
    const noBody = await c.agent.post('/api/auth/email/request').set('Origin', ORIGIN);
    expect(noBody.status).toBe(400);

    for (const code of ['12345', '1234567', 'abcdef', '']) {
      const res = await verifyCode(c, 'a@example.com', code);
      expect(res.status, code).toBe(400);
      expect(res.body.error.message).toBe('A sign-in code is six digits.');
    }
  });

  it('counts wrong codes and burns the code on the fifth', async () => {
    const c = use({ env: CODES_IN_LOG });
    await requestCode(c, 'guess@example.com');
    const code = loggedCode(c, 'guess@example.com');
    const wrong = otherCode(code);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const res = await verifyCode(c, 'guess@example.com', wrong);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('That code is not right. Check the email and try again.');
    }
    expect(c.deps.db.prepare('SELECT attempts FROM login_codes').get()).toEqual({ attempts: 4 });

    const fifth = await verifyCode(c, 'guess@example.com', wrong);
    expect(fifth.status).toBe(401);
    expect(fifth.body.error.message).toBe(
      'That code was entered wrongly 5 times and is no longer valid. Ask for a new one.',
    );
    const right = await verifyCode(c, 'guess@example.com', code);
    expect(right.status).toBe(401);
    expect(right.body.error.message).toBe(
      'That code has already been used, or none was sent to this address. Ask for a new one.',
    );
    expect(count(c, 'SELECT count(*) AS n FROM users')).toBe(0);
  });

  it('expires a code after ten minutes', async () => {
    const c = use({ env: CODES_IN_LOG });
    await requestCode(c, 'late@example.com');
    const code = loggedCode(c, 'late@example.com');
    c.setNow(at(10 * MINUTE));
    const res = await verifyCode(c, 'late@example.com', code);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('That code has expired. Ask for a new one.');
    expect(count(c, 'SELECT count(*) AS n FROM login_codes')).toBe(0);
  });

  it('still accepts a code just inside its ten minutes', async () => {
    const c = use({ env: CODES_IN_LOG });
    await requestCode(c, 'ontime@example.com');
    c.setNow(at(10 * MINUTE - 1000));
    const res = await verifyCode(c, 'ontime@example.com', loggedCode(c, 'ontime@example.com'));
    expect(res.status).toBe(200);
  });

  it('makes a second request for the same address wait 60 seconds, then replaces the code', async () => {
    const c = use({ env: CODES_IN_LOG });
    expect((await requestCode(c, 'wait@example.com')).status).toBe(200);
    const first = loggedCode(c, 'wait@example.com');

    c.setNow(at(15_000));
    const early = await requestCode(c, 'wait@example.com');
    expect(early.status).toBe(429);
    expect(early.headers['retry-after']).toBe('45');
    expect(early.body.error).toMatchObject({
      code: 'cooldown',
      retryAfterSeconds: 45,
      message:
        'A code was just sent to that address. Wait 45 more seconds before asking for another, and check the spam ' +
        'folder in the meantime.',
    });

    c.setNow(at(59_500));
    const almost = await requestCode(c, 'wait@example.com');
    expect(almost.status).toBe(429);
    expect(almost.body.error.message).toContain('Wait 1 more second before');

    c.setNow(at(60_000));
    expect((await requestCode(c, 'wait@example.com')).status).toBe(200);
    const second = loggedCode(c, 'wait@example.com');
    // One live code per address: the first one is gone (unless the two happen to be equal).
    if (second !== first) expect((await verifyCode(c, 'wait@example.com', first)).status).toBe(401);
    expect((await verifyCode(c, 'wait@example.com', second)).status).toBe(200);
  });

  it('emails the code over SMTP before storing it', async () => {
    const c = use({ env: SMTP });
    const sent: MailMessage[] = [];
    const storedWhenSent: number[] = [];
    c.deps.services.auth!.mailer = {
      async send(message) {
        storedWhenSent.push(count(c, 'SELECT count(*) AS n FROM login_codes'));
        sent.push(message);
      },
      close() {},
    };
    const res = await requestCode(c, 'bea@example.com');
    expect(res.status).toBe(200);
    expect(storedWhenSent).toEqual([0]);
    expect(count(c, 'SELECT count(*) AS n FROM login_codes')).toBe(1);

    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.to).toBe('bea@example.com');
    const code = /^(\d{6}) is your TailorIT sign-in code$/.exec(mail.subject)?.[1];
    expect(code).toBeDefined();
    expect(mail.text).toContain(`Your TailorIT sign-in code is ${code}.`);
    expect(mail.text).toContain('It expires in 10 minutes and can be used once.');
    expect(mail.html).toContain(code!);
    expect(mail.html).toMatch(/font-size:28px/);
    expect(mail.html).toMatch(/letter-spacing:6px/);
    expect(mail.html).toMatch(/font-weight:700/);
    // Emailed, so never printed.
    expect((c.deps.log as unknown as { lines: string[] }).lines.join('\n')).not.toContain(code!);

    expect((await verifyCode(c, 'bea@example.com', code!)).status).toBe(200);
  });

  it('answers 502 and stores no code when the email cannot be sent', async () => {
    const c = use({ env: SMTP });
    let fail = true;
    c.deps.services.auth!.mailer = {
      async send() {
        if (fail) throw new Error('connect ECONNREFUSED');
      },
      close() {},
    };
    const res = await requestCode(c, 'down@example.com');
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({
      code: 'sign_in_unavailable',
      message:
        'We could not send the sign-in email right now. Please try again in a few minutes, or contact your ' +
        'administrator.',
    });
    expect(count(c, 'SELECT count(*) AS n FROM login_codes')).toBe(0);
    // No cooldown for a code that never went out.
    fail = false;
    expect((await requestCode(c, 'down@example.com')).status).toBe(200);
  });

  it('refuses a state-changing sign-in from another origin', async () => {
    const c = use();
    const res = await request(c.app)
      .post('/api/auth/email/verify')
      .set('Origin', 'https://evil.example')
      .send({ email: 'a@example.com', code: '000000' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('bad_origin');
  });
});

describe('sessions', () => {
  it('logs out: deletes the session and clears the cookie', async () => {
    const c = use();
    const { agent, cookie } = await signIn(c, 'out@example.com');
    const res = await post(c, '/api/auth/logout', {}, agent);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(sessionCookie(res)).toMatch(/^ti_session=;.*Expires=Thu, 01 Jan 1970/);
    expect(count(c, 'SELECT count(*) AS n FROM user_sessions')).toBe(0);
    expect((await agent.get('/api/auth/me')).body).toEqual({ account: null });
    expect((await request(c.app).get('/api/auth/me').set('Cookie', cookie)).body).toEqual({ account: null });
    // Signed out already: still fine.
    expect((await post(c, '/api/auth/logout', {}, request.agent(c.app))).status).toBe(200);
  });

  it('ends a session at its fixed expiry and deletes the row', async () => {
    const c = use();
    const { agent } = await signIn(c, 'old@example.com');
    c.setNow(at(30 * DAY - 1000));
    expect((await agent.get('/api/auth/me')).body.account.email).toBe('old@example.com');
    c.setNow(at(30 * DAY));
    expect((await agent.get('/api/auth/me')).body).toEqual({ account: null });
    expect(count(c, 'SELECT count(*) AS n FROM user_sessions')).toBe(0);
    const guarded = await agent.get('/api/me/preferences');
    expect(guarded.status).toBe(401);
    expect(guarded.body.error).toMatchObject({ code: 'not_signed_in', message: 'Sign in to do that.' });
  });

  it('records last_seen_at at most once a minute', async () => {
    const c = use();
    const { agent } = await signIn(c, 'seen@example.com');
    const lastSeen = () => (c.deps.db.prepare('SELECT last_seen_at FROM user_sessions').get() as { last_seen_at: string })
      .last_seen_at;
    expect(lastSeen()).toBe(TEST_NOW.toISOString());
    c.setNow(at(30_000));
    await agent.get('/api/auth/me');
    expect(lastSeen()).toBe(TEST_NOW.toISOString());
    c.setNow(at(61_000));
    await agent.get('/api/auth/me');
    expect(lastSeen()).toBe(at(61_000).toISOString());
  });

  it('replaces the session a browser had when it signs in again', async () => {
    const c = use();
    const first = await signIn(c, 'again@example.com');
    const res = await verifyCode(c, 'again@example.com', '000000', first.agent);
    expect(res.status).toBe(200);
    expect(count(c, 'SELECT count(*) AS n FROM user_sessions')).toBe(1);
    expect((await request(c.app).get('/api/auth/me').set('Cookie', first.cookie)).body.account).toBeNull();
    expect((await first.agent.get('/api/auth/me')).body.account.email).toBe('again@example.com');
  });

  it('ignores cookies that are not session tokens', async () => {
    const c = use();
    for (const cookie of ['ti_session=short', 'ti_session=j%3A%7B%22a%22%3A1%7D', `ti_session=${'a'.repeat(43)}`]) {
      const res = await request(c.app).get('/api/auth/me').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ account: null });
    }
  });

  it('warns loudly at startup while the development fixed code is on, and only then', () => {
    const lines = (c: TestContext) => (c.deps.log as unknown as { lines: string[] }).lines;
    const fixed = use();
    startAuth(fixed.deps)();
    const warning = lines(fixed).filter((line) => line.startsWith('warn [auth]') && /AUTH_DEV_FIXED_CODE/.test(line));
    expect(warning.join('\n')).toMatch(/anyone who can reach this server can sign in as any address/);
    fixed.cleanup();
    const quiet = use({ env: CODES_IN_LOG });
    startAuth(quiet.deps)();
    expect(lines(quiet).some((line) => /AUTH_DEV_FIXED_CODE/.test(line))).toBe(false);
  });

  it('prunes expired sessions and codes at startup', async () => {
    const c = use();
    const { account } = await signIn(c, 'prune@example.com');
    c.deps.db
      .prepare("INSERT INTO user_sessions(token_hash, user_id, created_at, expires_at) VALUES ('old', ?, ?, ?)")
      .run(account.id, at(-40 * DAY).toISOString(), at(-10 * DAY).toISOString());
    c.deps.db
      .prepare("INSERT INTO login_codes(email, code_hash, created_at, expires_at) VALUES ('x@example.com', 'h', ?, ?)")
      .run(at(-20 * MINUTE).toISOString(), at(-10 * MINUTE).toISOString());
    const stop = startAuth(c.deps);
    stop();
    expect(count(c, 'SELECT count(*) AS n FROM user_sessions')).toBe(1);
    expect(count(c, 'SELECT count(*) AS n FROM login_codes')).toBe(0);
  });
});

describe('accounts', () => {
  it('refuses a disabled account, including the sessions it already had', async () => {
    const c = use();
    const alice = await signIn(c, 'alice@example.com');
    c.deps.db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(TEST_NOW.toISOString(), alice.account.id);
    expect((await alice.agent.get('/api/auth/me')).body).toEqual({ account: null });

    const res = await verifyCode(c, 'alice@example.com', '000000');
    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({
      code: 'account_disabled',
      message: 'That account has been disabled. Ask an administrator of this installation to re-enable it.',
      requestId: expect.any(String),
    });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(count(c, 'SELECT count(*) AS n FROM user_sessions')).toBe(1);
  });

  it('makes ADMIN_EMAILS administrators at creation, at sign-in and at startup, and never demotes', async () => {
    const c = use({ env: { ADMIN_EMAILS: 'Boss@Example.com, other@example.com not-an-address' } });
    expect((await signIn(c, 'boss@example.com')).account.role).toBe('admin');
    expect((await signIn(c, 'worker@example.com')).account.role).toBe('user');

    // Demoted by hand: promoted again on the way in.
    c.deps.db.prepare("UPDATE users SET role = 'user' WHERE email = 'boss@example.com'").run();
    expect((await signIn(c, 'boss@example.com')).account.role).toBe('admin');

    // An account that existed before it was listed is promoted at startup.
    c.deps.db
      .prepare(
        `INSERT INTO users(id, email, name, role, created_at, updated_at)
         VALUES ('u-other', 'other@example.com', 'Other', 'user', ?, ?)`,
      )
      .run(TEST_NOW.toISOString(), TEST_NOW.toISOString());
    // An administrator who is not listed stays one.
    c.deps.db.prepare("UPDATE users SET role = 'admin' WHERE email = 'worker@example.com'").run();
    startAuth(c.deps)();
    const roles = Object.fromEntries(
      (c.deps.db.prepare('SELECT email, role FROM users').all() as { email: string; role: string }[]).map((r) => [
        r.email,
        r.role,
      ]),
    );
    expect(roles).toEqual({ 'boss@example.com': 'admin', 'worker@example.com': 'admin', 'other@example.com': 'admin' });
    expect((await signIn(c, 'worker@example.com')).account.role).toBe('admin');
  });
});

describe('Google sign-in', () => {
  const CLIENT_ID = 'test-client.apps.googleusercontent.com';

  function google(payload: () => GoogleTokenPayload | undefined) {
    const c = use({ env: { GOOGLE_CLIENT_ID: CLIENT_ID } });
    const calls: Array<[string, string]> = [];
    c.deps.services.auth!.verifyGoogleToken = async (idToken, clientId) => {
      calls.push([idToken, clientId]);
      return payload();
    };
    return { c, calls };
  }

  it('creates the account from a verified token and refreshes Google details on later sign-ins', async () => {
    let payload: GoogleTokenPayload = {
      sub: 'google-sub-1',
      email: 'Gina@Example.com',
      email_verified: true,
      name: 'Gina Lane',
      picture: 'https://lh3.googleusercontent.com/a/photo-1',
    };
    const { c, calls } = google(() => payload);
    const res = await post(c, '/api/auth/google', { credential: 'id-token-1' });
    expect(res.status).toBe(200);
    expect(calls).toEqual([['id-token-1', CLIENT_ID]]);
    expect(res.body.created).toBe(true);
    expect(res.body.account).toMatchObject({
      email: 'gina@example.com',
      name: 'Gina Lane',
      avatarUrl: 'https://lh3.googleusercontent.com/a/photo-1',
      role: 'user',
    });
    sessionCookie(res);
    expect((await c.agent.get('/api/auth/me')).body.account.email).toBe('gina@example.com');
    expect(c.deps.db.prepare('SELECT google_sub FROM users').get()).toEqual({ google_sub: 'google-sub-1' });

    payload = { ...payload, name: 'Gina Lane-Smith', picture: 'https://lh3.googleusercontent.com/a/photo-2' };
    const again = await post(c, '/api/auth/google', { credential: 'id-token-2' }, request.agent(c.app));
    expect(again.body.created).toBe(false);
    expect(again.body.account).toMatchObject({
      id: res.body.account.id,
      name: 'Gina Lane-Smith',
      avatarUrl: 'https://lh3.googleusercontent.com/a/photo-2',
    });

    // The emailed code reaches the same account and leaves Google's details alone.
    const byCode = await signIn(c, 'gina@example.com');
    expect(byCode.account).toMatchObject({ id: res.body.account.id, name: 'Gina Lane-Smith' });
  });

  it('refuses tokens Google cannot vouch for, with free_tailor sentences', async () => {
    let payload: GoogleTokenPayload | undefined;
    let throws = false;
    const c = use({ env: { GOOGLE_CLIENT_ID: CLIENT_ID } });
    c.deps.services.auth!.verifyGoogleToken = async () => {
      if (throws) throw new Error('Wrong recipient, payload audience != requiredAudience');
      return payload;
    };
    const attempt = async (body: object) => {
      const res = await post(c, '/api/auth/google', body);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('validation_failed');
      return res.body.error.message as string;
    };

    expect(await attempt({})).toBe('No Google credential was sent.');
    throws = true;
    expect(await attempt({ credential: 'forged' })).toBe('That Google sign-in could not be verified. Please try again.');
    throws = false;
    payload = undefined;
    expect(await attempt({ credential: 't' })).toBe('Google returned a sign-in with no account details.');
    payload = { sub: 's-1' };
    expect(await attempt({ credential: 't' })).toBe('That Google account has no email address.');
    payload = { sub: 's-1', email: 'unverified@example.com', email_verified: false };
    expect(await attempt({ credential: 't' })).toBe(
      'That Google account has not verified its email address, so it cannot be used to sign in.',
    );
    expect(count(c, 'SELECT count(*) AS n FROM users')).toBe(0);
    expect(count(c, 'SELECT count(*) AS n FROM user_sessions')).toBe(0);
  });

  it('moves a Google account to its new address instead of failing on the unique id', async () => {
    let payload: GoogleTokenPayload = { sub: 'moving-sub', email: 'first@example.com', email_verified: true };
    const { c } = google(() => payload);
    expect((await post(c, '/api/auth/google', { credential: 't' })).status).toBe(200);
    payload = { ...payload, email: 'second@example.com' };
    const res = await post(c, '/api/auth/google', { credential: 't' }, request.agent(c.app));
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
    const subs = c.deps.db.prepare('SELECT email, google_sub FROM users ORDER BY email').all();
    expect(subs).toEqual([
      { email: 'first@example.com', google_sub: null },
      { email: 'second@example.com', google_sub: 'moving-sub' },
    ]);
  });
});

describe('sign-in rate limit', () => {
  // Keyed by the address a request names, never by IP: behind Next's /api rewrite every browser arrives from
  // 127.0.0.1, and a client-supplied X-Forwarded-For passes straight through.
  const send = (c: ReturnType<typeof use>, path: string, body: object, forwardedFor = '203.0.113.7') =>
    request(c.app).post(path).set('Origin', ORIGIN).set('X-Forwarded-For', forwardedFor).send(body);

  it('stops an address after 10 failed attempts in 10 minutes, whatever network they come from', async () => {
    const c = use({ env: CODES_IN_LOG });
    for (let i = 0; i < 10; i += 1) {
      // A different forged X-Forwarded-For on every attempt must not reset the count.
      const res = await send(c, '/api/auth/email/verify', { email: 'victim@example.com', code: '123456' }, `203.0.113.${i}`);
      expect(res.status).toBe(401);
    }
    const blocked = await send(c, '/api/auth/email/verify', { email: 'Victim@Example.com ', code: '123456' }, '198.51.100.9');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
    expect(blocked.body.error.message).toMatch(/^There have been too many sign-in attempts for this address\./);
    expect(blocked.body.error.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.body.error.retryAfterSeconds).toBeLessThanOrEqual(600);
    expect(Number(blocked.headers['retry-after'])).toBe(blocked.body.error.retryAfterSeconds);
    expect((await send(c, '/api/auth/email/request', { email: 'victim@example.com' })).status).toBe(429);

    // Another address, from the same "network", is unaffected; so is Google, which names no address.
    expect((await send(c, '/api/auth/email/request', { email: 'neighbour@example.com' })).status).toBe(200);
    expect((await send(c, '/api/auth/google', { credential: 'x' })).status).not.toBe(429);
  });

  it('counts every code request but not a sign-in that worked', async () => {
    const c = use({ env: CODES_IN_LOG });
    const fail = () => send(c, '/api/auth/email/verify', { email: 'real@example.com', code: '000001' });
    for (let i = 0; i < 8; i += 1) expect((await fail()).status).toBe(401);
    expect((await send(c, '/api/auth/email/request', { email: 'real@example.com' })).status).toBe(200); // 9
    const code = loggedCode(c, 'real@example.com');
    expect((await send(c, '/api/auth/email/verify', { email: 'real@example.com', code })).status).toBe(200); // not kept
    expect((await fail()).status).toBe(401); // 10
    expect((await fail()).status).toBe(429); // 11
  });

  it('has a global backstop on code emails across all addresses, which never holds back signing in', async () => {
    const c = use({ env: CODES_IN_LOG });
    for (let i = 0; i < SIGN_IN_GLOBAL_LIMIT; i += 1) {
      const res = await send(c, '/api/auth/email/request', { email: `person${i}@example.com` });
      expect(res.status).toBe(200);
    }
    const blocked = await send(c, '/api/auth/email/request', { email: 'fresh@example.com' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toMatch(/^There have been too many sign-in attempts\. Please wait/);
    // It protects the mail account: codes already sent still sign in, and Google is not affected.
    const code = loggedCode(c, 'person0@example.com');
    expect((await send(c, '/api/auth/email/verify', { email: 'person0@example.com', code })).status).toBe(200);
    expect((await send(c, '/api/auth/google', { credential: 'x' })).status).not.toBe(429);
  });

  it('does not let a flood of junk sign-in requests lock everyone out', async () => {
    const c = use({ env: CODES_IN_LOG });
    const junk = [
      (i: number) => send(c, '/api/auth/email/request', i % 8 === 0 ? {} : { email: `not an address ${i}` }),
      () => send(c, '/api/auth/email/verify', {}),
      (i: number) => send(c, '/api/auth/email/verify', { email: `nobody${i}@example.com`, code: '123456' }),
      () => send(c, '/api/auth/google', { credential: 'x' }),
    ];
    for (let i = 0; i < SIGN_IN_GLOBAL_LIMIT + 40; i += 1) {
      const res = await junk[i % junk.length]!(i);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).not.toBe(429);
    }
    const real = await send(c, '/api/auth/email/request', { email: 'owner@example.com' });
    expect(real.status).toBe(200);
    const code = loggedCode(c, 'owner@example.com');
    expect((await send(c, '/api/auth/email/verify', { email: 'owner@example.com', code })).status).toBe(200);
  });

  it('counts abandoned code requests that may be sending an email, never abandoned refusals', () => {
    const c = use({ env: CODES_IN_LOG });
    const [backstop] = signInRateLimit(c.deps);
    /** One code request through the backstop, its answer's status already decided, and how next() was called. */
    const start = (status: number) => {
      const req = { originalUrl: '/api/auth/email/request', body: {} } as unknown as Request;
      const res = Object.assign(new EventEmitter(), { statusCode: status }) as unknown as Response;
      let passed: unknown = 'next was not called';
      backstop!(req, res, (error?: unknown) => {
        passed = error;
      });
      return { res, passed: () => passed };
    };
    // Refused, then the client went away: costs nothing, however many.
    for (let i = 0; i < SIGN_IN_GLOBAL_LIMIT + 10; i += 1) start(400).res.emit('close');
    // Requests still running hold a place...
    const running = Array.from({ length: SIGN_IN_GLOBAL_LIMIT }, () => start(200));
    expect(running.every((one) => one.passed() === undefined)).toBe(true);
    expect(start(200).passed()).toMatchObject({ code: 'rate_limited' });
    // ...and give it back when they end refused.
    running[0]!.res.statusCode = 422;
    running[0]!.res.emit('close');
    expect(start(200).passed()).toBeUndefined();
    // Abandoned while the code was on its way (status still 200): counted, so the backstop stays shut.
    for (const one of running.slice(1)) one.res.emit('close');
    expect(start(200).passed()).toMatchObject({ code: 'rate_limited' });
  });

  it('is off while the development fixed code is configured', async () => {
    const c = use();
    for (let i = 0; i < 25; i += 1) {
      expect((await verifyCode(c, 'x@example.com', '123456')).status).toBe(401);
    }
  });
});
