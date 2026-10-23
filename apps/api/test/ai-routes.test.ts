import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Router } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiHealthSchema, AiTaskAcceptedSchema, AiTaskViewSchema } from '@tailorit/shared';
import { requireAi, sendAccepted, type PromptModule } from '../src/ai/index';
import { userOf } from '../src/core/auth/guards';
import type { SessionUser } from '../src/core/context';
import type { Feature } from '../src/core/feature';
import { adminAiFeature } from '../src/features/admin-ai/index';
import { aiTasksFeature } from '../src/features/ai-tasks/index';
import { createTestContext, ORIGIN, type TestContext } from './helpers';

const scenarios = mkdtempSync(join(tmpdir(), 'tailorit-fake-scenarios-'));
writeFileSync(join(scenarios, 'entry_bullets.json'), JSON.stringify({ answer: 'pong' }));
writeFileSync(join(scenarios, 'echo.json'), JSON.stringify({ answer: 'pong' }));
afterAll(() => rmSync(scenarios, { recursive: true, force: true }));

const USERS: Record<string, SessionUser> = {
  u1: { id: 'u1', email: 'u1@example.com', name: 'One', role: 'user' },
  u2: { id: 'u2', email: 'u2@example.com', name: 'Two', role: 'user' },
  boss: { id: 'boss', email: 'boss@example.com', name: 'Boss', role: 'admin' },
};

/** Test-only sign-in: the X-Test-User header names the account (the real session cookie is work package F3's). */
const testAuthFeature: Feature = {
  name: 'test-auth',
  routes: [
    {
      path: '/api',
      router: () =>
        Router().use((req, _res, next) => {
          const user = USERS[req.get('x-test-user') ?? ''];
          if (user) req.user = user;
          next();
        }),
    },
  ],
};

const wordModule: PromptModule<{ word: string }, { answer: string }> = {
  kind: 'entry_bullets',
  version: 1,
  system: () => 'Echo the word.',
  user: (input) => `Word: ${input.word}`,
  output: z.object({ answer: z.string() }),
};

/** What a feature package does: register a handler in `services`, answer 202 from its endpoint. */
const bulletsFeature: Feature = {
  name: 'test-bullets',
  services: (deps) => {
    const ai = requireAi(deps);
    ai.registerHandler('entry_bullets', (input, { runPrompt }) => runPrompt(wordModule, input as { word: string }));
    // A kind whose handler just waits for cancellation (no CLI process).
    ai.registerHandler('cover_letter', (_input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }));
  },
  routes: [
    {
      path: '/api/test-ai',
      router: (deps) =>
        Router().post('/bullets', (req, res) => {
          const accepted = requireAi(deps).enqueue({ kind: 'entry_bullets', userId: userOf(req).id, input: req.body });
          sendAccepted(res, accepted);
        }),
    },
  ],
};

let ctx: TestContext | null = null;
beforeEach(() => {
  vi.stubEnv('FAKE_CLAUDE_SCENARIOS', scenarios);
  vi.stubEnv('FAKE_CLAUDE_MODE', '');
  ctx = createTestContext({ features: [testAuthFeature, aiTasksFeature, adminAiFeature, bulletsFeature] });
  for (const user of Object.values(USERS)) {
    ctx.deps.db
      .prepare('INSERT INTO users(id, email, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, user.email, user.name, user.role, 'x', 'x');
  }
});
afterEach(async () => {
  vi.unstubAllEnvs();
  ctx?.cleanup();
  ctx = null;
});

const as = (user: string | null) => (req: request.Test) => (user ? req.set('X-Test-User', user) : req);

describe('/api/ai/tasks', () => {
  it('202 then poll: the endpoint answers {taskId} and the owner polls the task until it succeeds', async () => {
    const app = ctx!.app;
    const accepted = await as('u1')(
      request(app).post('/api/test-ai/bullets').set('Origin', ORIGIN).send({ word: 'pong' }),
    );
    expect(accepted.status).toBe(202);
    const { taskId } = AiTaskAcceptedSchema.parse(accepted.body);
    await requireAi(ctx!.deps).waitFor(taskId, 20_000);
    const polled = await as('u1')(request(app).get(`/api/ai/tasks/${taskId}`));
    expect(polled.status).toBe(200);
    expect(AiTaskViewSchema.parse(polled.body)).toMatchObject({
      id: taskId,
      kind: 'entry_bullets',
      status: 'succeeded',
      result: { answer: 'pong' },
      error: null,
    });
  });

  it('is owner-only: signed out is 401; another account and unknown ids are the same 404', async () => {
    const { taskId } = requireAi(ctx!.deps).enqueue({ kind: 'cover_letter', userId: 'u1', input: {} });
    const app = ctx!.app;
    expect((await request(app).get(`/api/ai/tasks/${taskId}`)).body.error.code).toBe('not_signed_in');
    const other = await as('u2')(request(app).get(`/api/ai/tasks/${taskId}`));
    expect(other.status).toBe(404);
    expect(other.body.error).toMatchObject({ code: 'not_found', message: 'That AI task was not found.' });
    const unknown = await as('u1')(request(app).get('/api/ai/tasks/does-not-exist'));
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.message).toBe(other.body.error.message);
    expect((await as('u1')(request(app).get(`/api/ai/tasks/${taskId}`))).body.status).toBe('running');
    // Admins get no special view of other people's tasks either.
    expect((await as('boss')(request(app).get(`/api/ai/tasks/${taskId}`))).status).toBe(404);
    requireAi(ctx!.deps).cancel(taskId, null);
  });

  it('DELETE cancels the owner\'s task and leaves other people\'s alone', async () => {
    const ai = requireAi(ctx!.deps);
    const { taskId } = ai.enqueue({ kind: 'cover_letter', userId: 'u1', input: {} });
    const app = ctx!.app;
    const denied = await as('u2')(request(app).delete(`/api/ai/tasks/${taskId}`).set('Origin', ORIGIN));
    expect(denied.status).toBe(404);
    expect(ai.getTask(taskId, null)!.status).toBe('running');
    const cancelled = await as('u1')(request(app).delete(`/api/ai/tasks/${taskId}`).set('Origin', ORIGIN));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ id: taskId, status: 'cancelled', error: { code: 'cancelled' } });
    // Idempotent: a finished task comes back unchanged.
    const again = await as('u1')(request(app).delete(`/api/ai/tasks/${taskId}`).set('Origin', ORIGIN));
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('cancelled');
  });

  it('answers a busy 409 from the enqueuing endpoint', async () => {
    const ai = requireAi(ctx!.deps);
    // Hold both of u1's entry_bullets slots with tasks that wait in the queue behind four running ones.
    for (let i = 0; i < 4; i += 1) ai.enqueue({ kind: 'cover_letter', userId: i % 2 ? 'u2' : 'boss', input: {} });
    const post = () =>
      as('u1')(request(ctx!.app).post('/api/test-ai/bullets').set('Origin', ORIGIN).send({ word: 'x' }));
    expect((await post()).status).toBe(202);
    expect((await post()).status).toBe(202);
    const third = await post();
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('ai_busy');
    for (const user of ['u1', 'u2', 'boss']) {
      const ids = ctx!.deps.db
        .prepare("SELECT id FROM ai_tasks WHERE user_id = ? AND status IN ('queued', 'running')")
        .all(user);
      for (const { id } of ids as { id: string }[]) ai.cancel(id, null);
    }
  });
});

describe('/api/admin/ai', () => {
  it('is for administrators only', async () => {
    const app = ctx!.app;
    expect((await request(app).get('/api/admin/ai/health')).status).toBe(401);
    const user = await as('u1')(request(app).get('/api/admin/ai/health'));
    expect(user.status).toBe(403);
    const forbidden = { code: 'forbidden', message: 'That is an administrator-only part of TailorIT.' };
    expect(user.body.error).toMatchObject(forbidden);
    expect((await as('u1')(request(app).post('/api/admin/ai/test').set('Origin', ORIGIN).send({}))).status).toBe(403);
  });

  it('GET /health reports the CLI', async () => {
    const res = await as('boss')(request(ctx!.app).get('/api/admin/ai/health?force=1'));
    expect(res.status).toBe(200);
    expect(AiHealthSchema.parse(res.body)).toMatchObject({ enabled: true, available: true, loggedIn: true });
  });

  it('POST /test runs the echo prompt, optionally on another model, and validates the model name', async () => {
    const app = ctx!.app;
    const ok = await as('boss')(request(app).post('/api/admin/ai/test').set('Origin', ORIGIN).send({}));
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, model: 'claude-sonnet-5-5', ms: expect.any(Number), answer: 'pong' });
    const other = await as('boss')(
      request(app).post('/api/admin/ai/test').set('Origin', ORIGIN).send({ model: 'claude-haiku-5-5' }),
    );
    expect(other.body.model).toBe('claude-haiku-5-5');
    const bad = await as('boss')(
      request(app).post('/api/admin/ai/test').set('Origin', ORIGIN).send({ model: '--dangerously-skip-permissions' }),
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_failed');
    vi.stubEnv('FAKE_CLAUDE_MODE', 'auth');
    const failed = await as('boss')(request(app).post('/api/admin/ai/test').set('Origin', ORIGIN).send({}));
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ ok: false, answer: null, error: { code: 'ai_unavailable' } });
  });
});
