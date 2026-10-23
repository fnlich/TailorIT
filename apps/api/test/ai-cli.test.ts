import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiHealthSchema, type AiTaskKind } from '@tailorit/shared';
import { requireAi, type AiService, type PromptModule } from '../src/ai/index';
import { AI_ERROR_MESSAGES, AI_MESSAGES } from '../src/ai/errors';
import { BASE_SYSTEM_PROMPT } from '../src/ai/provider/argv';
import { aiTasksFeature } from '../src/features/ai-tasks/index';
import { createTestContext, TEST_NOW, type TestContext } from './helpers';

// Integration through tools/fake-claude/fake-claude.mjs: a real child process per call, real stream-json.

const scenarios = mkdtempSync(join(tmpdir(), 'tailorit-fake-scenarios-'));
writeFileSync(join(scenarios, 'entry_bullets.json'), JSON.stringify({ answer: 'pong' }));
writeFileSync(join(scenarios, 'cover_letter.json'), JSON.stringify({ answer: 'letter' }));
afterAll(() => rmSync(scenarios, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const wordModule: PromptModule<{ word: string }, { answer: string }> = {
  kind: 'entry_bullets',
  version: 1,
  system: () => 'Echo the word.',
  user: (input) => `Word: ${input.word}`,
  output: z.object({ answer: z.string() }),
};

interface CallRecord {
  argv: string[];
  stdin: string;
  cwd: string;
  kind: string | null;
  model: string;
  env: string[];
  pid: number;
}

let ctx: TestContext | null = null;
let recordFile = '';
const stateFiles: string[] = [];

beforeEach(() => {
  recordFile = join(tmpdir(), `tailorit-fake-record-${randomUUID()}.ndjson`);
  vi.stubEnv('FAKE_CLAUDE_SCENARIOS', scenarios);
  vi.stubEnv('FAKE_CLAUDE_RECORD', recordFile);
  vi.stubEnv('FAKE_CLAUDE_MODE', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  ctx?.cleanup();
  ctx = null;
  rmSync(recordFile, { force: true, maxRetries: 10, retryDelay: 100 });
  for (const file of stateFiles.splice(0)) rmSync(file, { force: true, maxRetries: 10, retryDelay: 100 });
});

const records = (): CallRecord[] =>
  existsSync(recordFile)
    ? readFileSync(recordFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CallRecord)
    : [];

function setup(env: Record<string, string> = {}): AiService {
  ctx = createTestContext({ features: [aiTasksFeature], env });
  const ai = requireAi(ctx.deps);
  for (const kind of ['entry_bullets', 'cover_letter'] as AiTaskKind[]) {
    ai.registerHandler(kind, (input, { runPrompt }) => runPrompt(wordModule, input as { word: string }, { kind }));
  }
  ctx.deps.db
    .prepare('INSERT INTO users(id, email, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('u1', 'u1@example.com', 'U', 'user', 'x', 'x');
  return ai;
}

async function run(ai: AiService, kind: AiTaskKind = 'entry_bullets', word = 'pong') {
  const { taskId } = ai.enqueue({ kind, userId: 'u1', input: { word } });
  return ai.waitFor(taskId, 20_000);
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected an error');
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('ClaudeCliProvider through the fake CLI', () => {
  it('answers with the documented argv, the prompt on stdin, its own work dir and a scrubbed env', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'token');
    vi.stubEnv('CLAUDECODE', '1');
    vi.stubEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    vi.stubEnv('MAX_THINKING_TOKENS', '4000');
    vi.stubEnv('CLAUDE_CONFIG_DIR', join(tmpdir(), 'tailorit-claude-config'));
    const ai = setup();
    const task = await run(ai);
    expect(task).toMatchObject({ status: 'succeeded', result: { answer: 'pong' }, error: null });

    const [call] = records();
    expect(call!.argv.slice(0, -1)).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--model',
      'claude-sonnet-5-5',
      '--effort',
      'low',
      '--tools',
      '',
      '--safe-mode',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--permission-prompts',
      'none',
      '--no-session-persistence',
      '--system-prompt',
    ]);
    expect(call!.argv.at(-1)).toMatch(/^Echo the word\.\n\nReply with JSON only[\s\S]*\[feature:entry_bullets\]$/);
    expect(call!.stdin).toBe('Word: pong');
    expect(call!.kind).toBe('entry_bullets');
    expect(call!.cwd.toLowerCase()).toBe(join(ctx!.dataDir, 'claude-cli-work').toLowerCase());
    expect(call!.env).toContain('CLAUDE_CONFIG_DIR');
    const scrubbed = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'];
    scrubbed.push('MAX_THINKING_TOKENS');
    for (const name of scrubbed) expect(call!.env).not.toContain(name);
    expect(call!.env.filter((name) => name.toUpperCase().startsWith('CLAUDE'))).toEqual(['CLAUDE_CONFIG_DIR']);
    const row = ctx!.deps.db.prepare('SELECT model, attempts FROM ai_tasks WHERE id = ?').get(task.id);
    expect(row).toEqual({ model: 'claude-sonnet-5-5', attempts: 1 });
  });

  it('uses the per-feature model and effort, and the fallback model', async () => {
    const ai = setup({
      AI_MODEL_COVER_LETTER: 'claude-opus-5',
      AI_EFFORT_COVER_LETTER: 'high',
      AI_CLI_FALLBACK_MODEL: 'claude-haiku-5-5',
    });
    expect((await run(ai, 'cover_letter')).result).toEqual({ answer: 'letter' });
    const { argv } = records()[0]!;
    expect(argv[argv.indexOf('--model') + 1]).toBe('claude-opus-5');
    expect(argv[argv.indexOf('--effort') + 1]).toBe('high');
    expect(argv[argv.indexOf('--fallback-model') + 1]).toBe('claude-haiku-5-5');
  });

  it('retries once with the problems when the first reply is malformed JSON', async () => {
    const key = `tailorit-${randomUUID()}`;
    stateFiles.push(join(tmpdir(), `fake-claude-${key}.json`));
    vi.stubEnv('FAKE_CLAUDE_MODE', 'badjson-once');
    vi.stubEnv('FAKE_CLAUDE_STATE', key);
    const ai = setup();
    const task = await run(ai);
    expect(task).toMatchObject({ status: 'succeeded', result: { answer: 'pong' } });
    const calls = records();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.stdin).toMatch(/^Word: pong\n\nYour previous reply did not match the required JSON\. Problems: /);
    expect(calls[1]!.argv.at(-1)).toBe(calls[0]!.argv.at(-1));
    expect(ctx!.deps.db.prepare('SELECT attempts FROM ai_tasks WHERE id = ?').get(task.id)).toEqual({ attempts: 2 });
  });

  it('reports a signed-out CLI as ai_unavailable with a sentence for people', async () => {
    vi.stubEnv('FAKE_CLAUDE_MODE', 'auth');
    const task = await run(setup());
    const error = { code: 'ai_unavailable', message: AI_ERROR_MESSAGES.auth };
    expect(task).toMatchObject({ status: 'failed', error });
  });

  it('kills a stalled CLI after the first-event timeout and pauses that feature for 10 minutes', async () => {
    vi.stubEnv('FAKE_CLAUDE_MODE', 'stall');
    const ai = setup({ AI_CLI_FIRST_EVENT_MS: '1000', AI_CLI_TIMEOUT_MS: '5000' });
    const startedAt = Date.now();
    const task = await run(ai);
    expect(Date.now() - startedAt).toBeLessThan(4000);
    const error = { code: 'ai_unavailable', message: AI_ERROR_MESSAGES.stalled };
    expect(task).toMatchObject({ status: 'failed', error });
    const { pid } = records()[0]!;
    await until(() => !alive(pid));

    // The same feature now fails fast, before any process is started.
    const paused = thrown(() => ai.enqueue({ kind: 'entry_bullets', userId: 'u1', input: { word: 'again' } }));
    expect(paused).toMatchObject({
      code: 'ai_unavailable',
      status: 503,
      message: 'AI is temporarily unavailable. Please try again in about 10 minutes.',
      retryAfterSeconds: 600,
    });
    expect(records()).toHaveLength(1);

    // Other features still run, and the pause ends on its own.
    vi.stubEnv('FAKE_CLAUDE_MODE', '');
    expect((await run(ai, 'cover_letter')).status).toBe('succeeded');
    ctx!.setNow(new Date(TEST_NOW.getTime() + 11 * 60_000));
    expect((await run(ai)).status).toBe('succeeded');
  });

  it('fails a rate-limited call and pauses every feature until the window resets', async () => {
    vi.stubEnv('FAKE_CLAUDE_MODE', 'ratelimit');
    const ai = setup();
    const task = await run(ai);
    expect(task).toMatchObject({
      status: 'failed',
      error: { code: 'ai_unavailable', message: AI_ERROR_MESSAGES.rateLimited },
    });
    const paused = thrown(() => ai.enqueue({ kind: 'cover_letter', userId: 'u1', input: { word: 'x' } }));
    expect(paused).toMatchObject({ code: 'ai_unavailable', retryAfterSeconds: expect.any(Number) });
    const message = (paused as Error).message;
    expect(message).toMatch(/^The AI usage limit has been reached\. Please try again in about \d+ minutes\.$/);
  });

  it('stops a call at system/init when the CLI reports API-key billing, and pauses all AI', async () => {
    vi.stubEnv('FAKE_CLAUDE_MODE', 'apikey');
    vi.stubEnv('FAKE_CLAUDE_SLOW_MS', '6000');
    const ai = setup();
    const startedAt = Date.now();
    const task = await run(ai);
    expect(Date.now() - startedAt).toBeLessThan(4000); // did not wait for the (billed) answer
    expect(task).toMatchObject({ status: 'failed', error: { code: 'ai_unavailable', message: AI_MESSAGES.apiKey } });
    await until(() => !alive(records()[0]!.pid));
    const paused = thrown(() => ai.enqueue({ kind: 'cover_letter', userId: 'u1', input: { word: 'x' } }));
    expect(paused).toMatchObject({ code: 'ai_unavailable', message: AI_MESSAGES.apiKey });
  });

  it('fails a call that runs past the deadline', async () => {
    vi.stubEnv('FAKE_CLAUDE_MODE', 'slow');
    vi.stubEnv('FAKE_CLAUDE_SLOW_MS', '4000');
    const task = await run(setup({ AI_CLI_TIMEOUT_MS: '1000' }));
    expect(task).toMatchObject({ status: 'failed', error: { code: 'ai_failed', message: AI_ERROR_MESSAGES.timeout } });
  });

  it('cancelling a running task kills its CLI process', async () => {
    vi.stubEnv('FAKE_CLAUDE_MODE', 'slow');
    vi.stubEnv('FAKE_CLAUDE_SLOW_MS', '8000');
    const ai = setup();
    const { taskId } = ai.enqueue({ kind: 'entry_bullets', userId: 'u1', input: { word: 'x' } });
    await until(() => records().length === 1);
    expect(ai.getTask(taskId, 'u1')!.status).toBe('running');
    expect(ai.cancel(taskId, 'u1')).toBe(true);
    expect((await ai.waitFor(taskId, 2000)).status).toBe('cancelled');
    await until(() => !alive(records()[0]!.pid), 5000);
  });

  it('reports a missing CLI binary clearly', async () => {
    const ai = setup({ AI_CLI_BIN: join(tmpdir(), 'tailorit-no-such-claude', 'claude.exe') });
    expect(await run(ai)).toMatchObject({
      status: 'failed',
      error: { code: 'ai_unavailable', message: AI_MESSAGES.binaryMissing },
    });
    const health = await ai.health();
    expect(health).toMatchObject({ enabled: true, available: false, cliVersion: null, loggedIn: false });
    expect(health.message).toMatch(/Claude CLI was not found/);
  });

  it('sends a system prompt too long for the command line at the head of stdin', async () => {
    const ai = setup();
    const big = 'Follow every rule. '.repeat(6000); // ~114,000 characters: over both platforms' limits
    ai.registerHandler('template_fill', (input, { runPrompt }) =>
      runPrompt({ ...wordModule, kind: 'template_fill', system: () => big }, input as { word: string }, {
        kind: 'entry_bullets',
      }),
    );
    expect((await run(ai, 'template_fill')).status).toBe('succeeded');
    const [call] = records();
    expect(call!.argv.at(-1)).toBe(BASE_SYSTEM_PROMPT);
    expect(call!.stdin.startsWith(big.trim())).toBe(true);
    expect(call!.stdin).toContain('[feature:entry_bullets]');
    expect(call!.stdin.endsWith('\n\nWord: pong')).toBe(true);
  });
});

describe('AI health and the admin test through the fake CLI', () => {
  it('reads --version and auth status, caches for 60 s, and re-checks on force', async () => {
    const ai = setup();
    const health = AiHealthSchema.parse(await ai.health());
    expect(health).toMatchObject({
      enabled: true,
      available: true,
      cliVersion: '2.1.263-fake (Claude Code test double)',
      loggedIn: true,
      authMethod: 'claude.ai',
      subscriptionType: 'max',
      defaultModel: 'claude-sonnet-5-5',
      message: 'Claude CLI 2.1.263-fake (Claude Code test double) is signed in on a Claude Max subscription.',
      checkedAt: TEST_NOW.toISOString(),
    });
    vi.stubEnv('FAKE_CLAUDE_MODE', 'auth');
    expect((await ai.health()).available).toBe(true); // cached
    const signedOut = await ai.health(true);
    expect(signedOut).toMatchObject({ available: false, loggedIn: false });
    expect(signedOut.message).toMatch(/not signed in/);
    vi.stubEnv('FAKE_CLAUDE_MODE', 'apikey');
    ctx!.setNow(new Date(TEST_NOW.getTime() + 61_000)); // the cache expires
    const keyed = await ai.health();
    expect(keyed).toMatchObject({ available: false, loggedIn: true, authMethod: 'api_key' });
    expect(keyed.message).toMatch(/billed per request/);
  });

  it('says when AI is turned off', async () => {
    const ai = setup({ AI_ENABLED: 'false' });
    expect(await ai.health()).toMatchObject({ enabled: false, available: false });
    expect(await ai.test()).toMatchObject({ ok: false, error: { code: 'ai_unavailable' } });
  });

  it('runs the admin echo test with the shipped scenario, and lifts pauses when it works', async () => {
    vi.stubEnv('FAKE_CLAUDE_SCENARIOS', '');
    const ai = setup();
    expect(await ai.test()).toEqual({ ok: true, model: 'claude-sonnet-5-5', ms: expect.any(Number), answer: 'pong' });
    expect(records()[0]!.kind).toBe('echo');
    expect((await ai.test({ model: 'claude-opus-5' })).model).toBe('claude-opus-5');

    vi.stubEnv('FAKE_CLAUDE_MODE', 'auth');
    const failed = await ai.test();
    expect(failed).toMatchObject({ ok: false, answer: null, error: { code: 'ai_unavailable' } });
    expect(failed.error!.detail).toMatch(/Please run \/login/);

    vi.stubEnv('FAKE_CLAUDE_MODE', 'ratelimit');
    await run(ai);
    expect(ai.provider.activeHolds()).toHaveLength(1);
    vi.stubEnv('FAKE_CLAUDE_MODE', '');
    expect((await ai.test()).ok).toBe(true); // runs despite the pause...
    expect(ai.provider.activeHolds()).toEqual([]); // ...and lifts it
    vi.stubEnv('FAKE_CLAUDE_SCENARIOS', scenarios);
    expect((await run(ai)).status).toBe('succeeded');
  });
});
