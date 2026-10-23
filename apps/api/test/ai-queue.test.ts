import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AiTaskViewSchema, type AiTaskKind } from '@tailorit/shared';
import { createAiService, type AiService } from '../src/ai/queue';
import { AiError } from '../src/ai/errors';
import type { CliStatus } from '../src/ai/provider/health';
import type { AiProvider, CompletionRequest, ProviderHold } from '../src/ai/provider/types';
import type { PromptModule } from '../src/ai/runPrompt';
import { PrioritySemaphore } from '../src/ai/semaphore';
import { AppError } from '../src/core/http/errors';
import { createTestContext, type TestContext } from './helpers';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('PrioritySemaphore', () => {
  it('caps the total and the background share', async () => {
    const semaphore = new PrioritySemaphore(2, 1);
    const releaseA = await semaphore.acquire('background');
    let gotB = false;
    void semaphore.acquire('background').then(() => (gotB = true));
    await tick();
    expect(gotB).toBe(false); // the one background slot is taken
    const releaseC = await semaphore.acquire('interactive'); // the other slot is free for interactive work
    expect(semaphore.stats).toEqual({ active: 2, activeBackground: 1, waitingInteractive: 0, waitingBackground: 1 });
    releaseA();
    await tick();
    expect(gotB).toBe(true);
    releaseC();
  });

  it('lets background work wait while interactive work is queued, FIFO within each priority', async () => {
    const semaphore = new PrioritySemaphore(1, 1);
    const order: string[] = [];
    const first = await semaphore.acquire('interactive');
    const take = (name: string, priority: 'interactive' | 'background') =>
      semaphore.acquire(priority).then((release) => {
        order.push(name);
        return release;
      });
    const bg1 = take('bg1', 'background');
    const in1 = take('in1', 'interactive');
    const bg2 = take('bg2', 'background');
    const in2 = take('in2', 'interactive');
    first();
    (await in1)();
    (await in2)();
    (await bg1)();
    (await bg2)();
    expect(order).toEqual(['in1', 'in2', 'bg1', 'bg2']);
    expect(semaphore.stats.active).toBe(0);
  });

  it('removes an aborted waiter and unblocks background work behind it', async () => {
    const semaphore = new PrioritySemaphore(2, 1);
    const hold = await semaphore.acquire('interactive');
    const hold2 = await semaphore.acquire('interactive');
    const controller = new AbortController();
    const waiting = semaphore.acquire('interactive', controller.signal);
    let bgGranted = false;
    void semaphore.acquire('background').then(() => (bgGranted = true));
    controller.abort();
    await expect(waiting).rejects.toThrow();
    hold();
    await tick();
    expect(bgGranted).toBe(true);
    hold2();
    await expect(semaphore.acquire('interactive', AbortSignal.abort())).rejects.toThrow();
  });

  it('ignores a second release', async () => {
    const semaphore = new PrioritySemaphore(1, 0);
    const release = await semaphore.acquire('interactive');
    release();
    release();
    expect(semaphore.stats.active).toBe(0);
  });
});

interface Gate {
  request: CompletionRequest;
  answer(value: unknown): void;
  fail(error: Error): void;
}

/** A provider whose calls wait until the test answers them (or their signal aborts). */
function gatedProvider() {
  const gates: Gate[] = [];
  const holds = new Map<string, ProviderHold>();
  const provider: AiProvider = {
    name: 'gated',
    complete(request) {
      return new Promise((resolve, reject) => {
        const gate: Gate = {
          request,
          answer: (value) =>
            resolve({ text: `@@BEGIN_JSON@@${JSON.stringify(value)}@@END_JSON@@`, model: null, ms: 1 }),
          fail: reject,
        };
        request.signal?.addEventListener('abort', () => reject(new AiError('cancelled')), { once: true });
        gates.push(gate);
      });
    },
    async status(): Promise<CliStatus> {
      return {
        found: true,
        version: '9.9.9',
        loggedIn: true,
        authMethod: 'claude.ai',
        subscriptionType: 'max',
        apiKeySource: null,
        problem: null,
        checkedAt: '2026-10-22T12:00:00.000Z',
      };
    },
    holdFor: (tag) => holds.get(tag) ?? holds.get('*') ?? null,
    activeHolds: () => [...holds.values()],
    clearHolds: () => holds.clear(),
  };
  return { provider, gates, holds };
}

const wordModule: PromptModule<{ word: string }, { answer: string }> = {
  kind: 'entry_bullets',
  version: 1,
  system: () => 'Echo the word.',
  user: (input) => `Word: ${input.word}`,
  output: z.object({ answer: z.string() }),
};

let ctx: TestContext | null = null;
afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

function setup(env: Record<string, string> = {}) {
  ctx = createTestContext({ features: [], env: { AI_CLI_CONCURRENCY: '1', ...env } });
  const { provider, gates, holds } = gatedProvider();
  const ai = createAiService(ctx.deps, { provider });
  ctx.deps.services.ai = ai;
  for (const kind of ['entry_bullets', 'cover_letter', 'job_analysis'] as AiTaskKind[]) {
    ai.registerHandler(kind, (input, { runPrompt }) => runPrompt(wordModule, input as { word: string }, { kind }));
  }
  const db = ctx.deps.db;
  for (const id of ['u1', 'u2']) {
    db.prepare(
      "INSERT INTO users(id, email, name, role, created_at, updated_at) VALUES (?, ?, ?, 'user', 'x', 'x')",
    ).run(id, `${id}@example.com`, id);
  }
  const row = (id: string) => db.prepare('SELECT * FROM ai_tasks WHERE id = ?').get(id) as Record<string, unknown>;
  return { ai, gates, holds, db, row, deps: ctx.deps };
}

const busy = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected an error');
};

describe('AI task queue', () => {
  it('persists the input, runs the handler and stores the result', async () => {
    const { ai, gates, row } = setup();
    const { taskId, deduped } = ai.enqueue({ kind: 'entry_bullets', userId: 'u1', input: { word: 'pong' } });
    expect(deduped).toBe(false);
    await until(() => gates.length === 1);
    expect(ai.getTask(taskId, 'u1')!.status).toBe('running');
    expect(gates[0]!.request.user).toBe('Word: pong');
    gates[0]!.answer({ answer: 'pong' });
    const view = await ai.waitFor(taskId, 2000);
    expect(AiTaskViewSchema.parse(view)).toEqual({
      id: taskId,
      kind: 'entry_bullets',
      status: 'succeeded',
      result: { answer: 'pong' },
      error: null,
      createdAt: '2026-10-22T12:00:00.000Z',
      startedAt: '2026-10-22T12:00:00.000Z',
      finishedAt: '2026-10-22T12:00:00.000Z',
    });
    expect(row(taskId)).toMatchObject({
      user_id: 'u1',
      priority: 1,
      input: '{"word":"pong"}',
      result: '{"answer":"pong"}',
      model: 'claude-sonnet-5-5',
      attempts: 1,
      dedupe_key: null,
    });
  });

  it('shows a task to its owner only (null = internal callers)', () => {
    const { ai } = setup();
    const { taskId } = ai.enqueue({ kind: 'entry_bullets', userId: 'u1', input: { word: 'a' } });
    expect(ai.getTask(taskId, 'u2')).toBeNull();
    expect(ai.getTask(taskId, null)?.id).toBe(taskId);
    expect(ai.getTask('missing', null)).toBeNull();
    const system = ai.enqueue({ kind: 'job_analysis', userId: null, input: { word: 'b' }, priority: 'background' });
    expect(ai.getTask(system.taskId, 'u1')).toBeNull();
  });

  it('allows at most two queued/running tasks per user and kind', () => {
    const { ai } = setup();
    ai.enqueue({ kind: 'entry_bullets', userId: 'u1', input: { word: '1' } });
    ai.enqueue({ kind: 'entry_bullets', userId: 'u1', input: { word: '2' } });
    const error = busy(() => ai.enqueue({ kind: 'entry_bullets', userId: 'u1', input: { word: '3' } }));
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: 'ai_busy',
      status: 409,
      message: 'An AI request of this kind is already running for your account. Wait for it to finish, then try again.',
    });
    // Another kind, another account and system work are not limited by it.
    expect(() => ai.enqueue({ kind: 'cover_letter', userId: 'u1', input: { word: '4' } })).not.toThrow();
    expect(() => ai.enqueue({ kind: 'entry_bullets', userId: 'u2', input: { word: '5' } })).not.toThrow();
    for (let i = 0; i < 3; i += 1) ai.enqueue({ kind: 'job_analysis', userId: null, input: { word: `${i}` } });
  });

  it('returns the queued or running task with the same dedupe key and owner', async () => {
    const { ai, gates, row } = setup();
    const first = ai.enqueue({ kind: 'entry_bullets', userId: 'u1', input: { word: 'a' }, dedupeKey: 'k1' });
    const again = ai.enqueue({ kind: 'entry_bullets', userId: 'u1', input: { word: 'b' }, dedupeKey: 'k1' });
    expect(again).toEqual({ taskId: first.taskId, deduped: true });
    const other = ai.enqueue({ kind: 'entry_bullets', userId: 'u2', input: { word: 'c' }, dedupeKey: 'k1' });
    expect(other.deduped).toBe(false);
    expect(row(first.taskId).dedupe_key).toBe('u1:k1');
    await until(() => gates.length === 1);
    gates[0]!.answer({ answer: 'a' });
    await ai.waitFor(first.taskId, 2000);
    // Finished: the key is free again.
    const later = ai.enqueue({ kind: 'entry_bullets', userId: 'u1', input: { word: 'd' }, dedupeKey: 'k1' });
    expect(later.deduped).toBe(false);
  });

  it('runs interactive work before queued background work, FIFO within each priority', async () => {
    const { ai, gates } = setup({ AI_CLI_CONCURRENCY: '1', AI_CLI_BACKGROUND_SLOTS: '1' });
    const words: string[] = [];
    const first = ai.enqueue({ kind: 'entry_bullets', userId: 'u1', input: { word: 'i1' } });
    ai.enqueue({ kind: 'job_analysis', userId: null, input: { word: 'b1' }, priority: 'background' });
    ai.enqueue({ kind: 'job_analysis', userId: null, input: { word: 'b2' }, priority: 'background' });
    ai.enqueue({ kind: 'entry_bullets', userId: 'u2', input: { word: 'i2' } });
    ai.enqueue({ kind: 'cover_letter', userId: 'u1', input: { word: 'i3' } });
    for (let n = 1; n <= 5; n += 1) {
      await until(() => gates.length === n);
      words.push(gates[n - 1]!.request.user.replace('Word: ', ''));
      gates[n - 1]!.answer({ answer: 'x' });
    }
    expect(words).toEqual(['i1', 'i2', 'i3', 'b1', 'b2']);
    expect((await ai.waitFor(first.taskId, 2000)).status).toBe('succeeded');
  });

  it('cancels a queued task before it runs, and a running one by aborting its call', async () => {
    const { ai, gates } = setup();
    const running = ai.enqueue({ kind: 'entry_bullets', userId: 'u1', input: { word: 'run' } });
    const queued = ai.enqueue({ kind: 'cover_letter', userId: 'u1', input: { word: 'wait' } });
    await until(() => gates.length === 1);
    expect(ai.cancel(queued.taskId, 'u2')).toBe(false); // not the owner
    expect(ai.cancel(queued.taskId, 'u1')).toBe(true);
    expect(ai.getTask(queued.taskId, 'u1')).toMatchObject({
      status: 'cancelled',
      error: { code: 'cancelled', message: 'This AI request was cancelled.' },
    });
    const signal = gates[0]!.request.signal!;
    expect(signal.aborted).toBe(false);
    expect(ai.cancel(running.taskId, 'u1')).toBe(true);
    expect(signal.aborted).toBe(true);
    expect((await ai.waitFor(running.taskId, 2000)).status).toBe('cancelled');
    expect(ai.cancel(running.taskId, 'u1')).toBe(false); // already finished
    await tick();
    expect(gates).toHaveLength(1); // the cancelled queued task never reached the provider
  });

  it('records failures as the AppError code and sentence', async () => {
    const { ai, gates } = setup();
    const { taskId } = ai.enqueue({ kind: 'entry_bullets', userId: 'u1', input: { word: 'x' } });
    await until(() => gates.length === 1);
    gates[0]!.fail(new AiError('auth', { detail: 'Please run /login' }));
    expect(await ai.waitFor(taskId, 2000)).toMatchObject({
      status: 'failed',
      result: null,
      error: { code: 'ai_unavailable', message: expect.stringContaining('Claude sign-in') },
    });
    ai.registerHandler('template_fill', async () => {
      throw new TypeError('a bug');
    });
    const buggy = ai.enqueue({ kind: 'template_fill', userId: 'u1', input: null });
    expect((await ai.waitFor(buggy.taskId, 2000)).error).toEqual({
      code: 'ai_failed',
      message: 'The AI request failed. Please try again.',
    });
  });

  it('refuses work when AI is off, when no handler exists, or while the kind is paused', () => {
    const off = setup({ AI_ENABLED: 'false' });
    expect(busy(() => off.ai.enqueue({ kind: 'entry_bullets', userId: 'u1', input: {} }))).toMatchObject({
      code: 'ai_unavailable',
      status: 503,
      message: 'AI features are turned off on this server.',
    });
    ctx!.cleanup();
    const { ai, holds, deps } = setup();
    expect(busy(() => ai.enqueue({ kind: 'resume_import', userId: 'u1', input: {} }))).toMatchObject({
      code: 'ai_unavailable',
      message: 'This AI feature is not available on this server.',
    });
    holds.set('entry_bullets', {
      scope: 'entry_bullets',
      until: deps.now().getTime() + 5 * 60_000,
      kind: 'stalled',
      reason: 'the CLI gave no output',
    });
    expect(busy(() => ai.enqueue({ kind: 'entry_bullets', userId: 'u1', input: {} }))).toMatchObject({
      code: 'ai_unavailable',
      message: 'AI is temporarily unavailable. Please try again in about 5 minutes.',
      retryAfterSeconds: 300,
    });
    expect(() => ai.registerHandler('entry_bullets', async () => null)).toThrow(/already registered/);
  });

  it('refuses background work when there are no background slots', () => {
    const { ai } = setup({ AI_CLI_BACKGROUND_SLOTS: '0' });
    expect(
      busy(() => ai.enqueue({ kind: 'job_analysis', userId: null, input: {}, priority: 'background' })),
    ).toMatchObject({ code: 'ai_unavailable', message: expect.stringContaining('AI_CLI_BACKGROUND_SLOTS=0') });
  });

  it('on start marks tasks a previous run left running as interrupted and resumes queued ones', async () => {
    const { db, deps, gates, row } = setup();
    const insert = db.prepare(
      'INSERT INTO ai_tasks(id, user_id, kind, status, priority, input, created_at, started_at, finished_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run('left-running', 'u1', 'entry_bullets', 'running', 1, '{"word":"old"}', 'x', 'x', null);
    insert.run('left-queued', 'u1', 'entry_bullets', 'queued', 1, '{"word":"resume me"}', 'x', null, null);
    const longAgo = '2026-01-01T00:00:00.000Z';
    insert.run('ancient', 'u1', 'entry_bullets', 'succeeded', 1, '{}', longAgo, null, longAgo);
    // A new process: a fresh service over the same database.
    const restarted: AiService = createAiService(deps, { provider: gatedProvider().provider });
    restarted.registerHandler('entry_bullets', (input, { runPrompt }) =>
      runPrompt(wordModule, input as { word: string }),
    );
    expect(gates).toHaveLength(0);
    const stop = restarted.start();
    expect(restarted.getTask('left-running', null)).toMatchObject({
      status: 'failed',
      error: {
        code: 'interrupted',
        message: 'The server restarted while this AI request was running. Please try again.',
      },
    });
    expect(row('ancient')).toBeUndefined(); // finished tasks older than 30 days are pruned
    await until(() => restarted.getTask('left-queued', null)!.status === 'running');
    await stop();
    expect(restarted.getTask('left-queued', null)).toMatchObject({ status: 'failed', error: { code: 'interrupted' } });
    expect(busy(() => restarted.enqueue({ kind: 'entry_bullets', userId: 'u1', input: {} }))).toMatchObject({
      code: 'ai_unavailable',
    });
  });

  it('waitFor rejects after its timeout and for unknown tasks', async () => {
    const { ai } = setup();
    const { taskId } = ai.enqueue({ kind: 'entry_bullets', userId: 'u1', input: { word: 'slow' } });
    await expect(ai.waitFor(taskId, 30)).rejects.toThrow(/did not finish within 30 ms/);
    await expect(ai.waitFor('nope', 30)).rejects.toThrow(/does not exist/);
  });

  it('reports health with the per-feature models', async () => {
    const { ai } = setup({ AI_MODEL_JOB_ANALYSIS: 'claude-haiku-5-5' });
    const health = await ai.health();
    expect(health).toMatchObject({
      enabled: true,
      available: true,
      cliVersion: '9.9.9',
      loggedIn: true,
      authMethod: 'claude.ai',
      subscriptionType: 'max',
      defaultModel: 'claude-sonnet-5-5',
      message: 'Claude CLI 9.9.9 is signed in on a Claude Max subscription.',
    });
    expect(health.models).toMatchObject({ job_analysis: 'claude-haiku-5-5', cover_letter: 'claude-sonnet-5-5' });
  });
});
