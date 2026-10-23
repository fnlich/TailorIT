import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AccountSchema, EMPTY_PREFERENCES, PreferencesSchema, type Preferences } from '@tailorit/shared';
import { signIn } from './auth-helpers';
import { createTestContext, ORIGIN, TEST_NOW, type TestContext } from './helpers';

let ctx: TestContext | null = null;
afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

function use(): TestContext {
  ctx = createTestContext();
  return ctx;
}

function insertResume(c: TestContext, id: string, userId: string): void {
  c.deps.db
    .prepare("INSERT INTO resumes(id, user_id, kind, created_at, updated_at) VALUES (?, ?, 'built', ?, ?)")
    .run(id, userId, TEST_NOW.toISOString(), TEST_NOW.toISOString());
}

describe('/api/me', () => {
  it('is for signed-in accounts only', async () => {
    const c = use();
    const calls = [
      request(c.app).patch('/api/me').set('Origin', ORIGIN).send({ name: 'X' }),
      request(c.app).get('/api/me/preferences'),
      request(c.app).put('/api/me/preferences').set('Origin', ORIGIN).send(EMPTY_PREFERENCES),
      request(c.app).put('/api/me/default-resume').set('Origin', ORIGIN).send({ resumeId: null }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('not_signed_in');
    }
  });

  it('renames the account with free_tailor rules and sentences', async () => {
    const c = use();
    const { agent } = await signIn(c, 'dana@example.com');
    const patch = (body: object) => agent.patch('/api/me').set('Origin', ORIGIN).send(body);

    const res = await patch({ name: '  Dana Scully  ' });
    expect(res.status).toBe(200);
    expect(AccountSchema.parse(res.body)).toMatchObject({ email: 'dana@example.com', name: 'Dana Scully' });
    expect((await agent.get('/api/auth/me')).body.account.name).toBe('Dana Scully');

    for (const name of ['', '   ', 'x'.repeat(121)]) {
      const bad = await patch({ name });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toMatchObject({
        code: 'validation_failed',
        message: 'A display name is between 1 and 120 characters.',
        fields: { name: 'A display name is between 1 and 120 characters.' },
      });
    }
    expect((await patch({ name: 'x'.repeat(120) })).status).toBe(200);
    for (const body of [{}, { name: 7 }, { other: 'x' }]) {
      const nothing = await patch(body);
      expect(nothing.status).toBe(400);
      expect(nothing.body.error.message).toBe('There is nothing to change.');
    }
  });

  it('starts with empty preferences and saves them round trip', async () => {
    const c = use();
    const { agent } = await signIn(c, 'prefs@example.com');
    const empty = await agent.get('/api/me/preferences');
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual(EMPTY_PREFERENCES);

    const wanted: Preferences = {
      experienceLevels: ['senior', 'mid'],
      jobTypes: ['full_time'],
      workArrangements: ['remote', 'hybrid'],
      categories: ['software-engineering'],
      locations: ['Fremont, CA', ' Fremont, CA ', 'Remote in USA', ''],
      minSalary: 150000,
      phone: ' (555) 010-2000 ',
      linkedinUrl: 'https://www.linkedin.com/in/prefs',
      location: 'Fremont, CA',
      portfolioUrl: '',
    };
    const saved = await agent.put('/api/me/preferences').set('Origin', ORIGIN).send({ ...wanted, unknown: true });
    expect(saved.status).toBe(200);
    const expected = { ...wanted, locations: ['Fremont, CA', 'Remote in USA'], phone: '(555) 010-2000' };
    expect(PreferencesSchema.parse(saved.body)).toEqual(expected);
    expect((await agent.get('/api/me/preferences')).body).toEqual(expected);

    // A second save replaces the row.
    const cleared = await agent.put('/api/me/preferences').set('Origin', ORIGIN).send(EMPTY_PREFERENCES);
    expect(cleared.body).toEqual(EMPTY_PREFERENCES);
    expect(c.deps.db.prepare('SELECT count(*) AS n FROM user_preferences').get()).toEqual({ n: 1 });

    // Preferences are per account.
    const other = await signIn(c, 'someone-else@example.com');
    expect((await other.agent.get('/api/me/preferences')).body).toEqual(EMPTY_PREFERENCES);
  });

  it('refuses preferences outside the contract', async () => {
    const c = use();
    const { agent } = await signIn(c, 'strict@example.com');
    const put = (body: object) => agent.put('/api/me/preferences').set('Origin', ORIGIN).send(body);
    const bad = await put({ ...EMPTY_PREFERENCES, experienceLevels: ['wizard'] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_failed');
    expect(bad.body.error.fields).toHaveProperty(['experienceLevels.0']);
    expect((await put({ ...EMPTY_PREFERENCES, minSalary: -1 })).status).toBe(400);
    expect((await put({ jobTypes: [] })).status).toBe(400);
    const tooMany = await put({ ...EMPTY_PREFERENCES, locations: Array.from({ length: 101 }, (_, i) => `City ${i}`) });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.fields).toHaveProperty('locations');
    expect((await put({ ...EMPTY_PREFERENCES, phone: '1'.repeat(501) })).status).toBe(400);
  });

  it('sets the default resume to one of the caller’s own resumes only', async () => {
    const c = use();
    const me = await signIn(c, 'owner@example.com');
    const other = await signIn(c, 'other@example.com');
    insertResume(c, 'r-mine', me.account.id);
    insertResume(c, 'r-theirs', other.account.id);
    const put = (resumeId: string | null) =>
      me.agent.put('/api/me/default-resume').set('Origin', ORIGIN).send({ resumeId });

    const res = await put('r-mine');
    expect(res.status).toBe(200);
    expect(AccountSchema.parse(res.body).defaultResumeId).toBe('r-mine');
    expect((await me.agent.get('/api/auth/me')).body.account.defaultResumeId).toBe('r-mine');

    for (const id of ['r-theirs', 'r-missing']) {
      const refused = await put(id);
      expect(refused.status).toBe(404);
      expect(refused.body.error).toMatchObject({ code: 'not_found', message: 'That resume was not found.' });
    }
    expect((await me.agent.get('/api/auth/me')).body.account.defaultResumeId).toBe('r-mine');

    const cleared = await put(null);
    expect(cleared.body.defaultResumeId).toBeNull();
    const malformed = await me.agent.put('/api/me/default-resume').set('Origin', ORIGIN).send({});
    expect(malformed.status).toBe(400);

    // Deleting the resume clears the default (ON DELETE SET NULL).
    await put('r-mine');
    c.deps.db.prepare("DELETE FROM resumes WHERE id = 'r-mine'").run();
    expect((await me.agent.get('/api/auth/me')).body.account.defaultResumeId).toBeNull();
  });
});
