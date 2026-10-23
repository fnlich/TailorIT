import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BASE_SYSTEM_PROMPT,
  buildClaudeArgv,
  FORBIDDEN_FLAGS,
  normalizeEffort,
  WINDOWS_COMMAND_LINE_BUDGET,
  windowsCommandLineCost,
} from '../src/ai/provider/argv';
import { classifyFailure, interpretTurn, rateLimited, STALL_HOLD_MS } from '../src/ai/provider/classify';
import { buildChildEnv } from '../src/ai/provider/env';
import { billedToKey, createTurnState, reduceEvent, turnText, type TurnState } from '../src/ai/provider/events';
import { CliNotFoundError, resolveCliCommand, type ResolveHost } from '../src/ai/provider/resolve';
import type { CliRunOutcome } from '../src/ai/provider/spawn';
import { lastLines, NdjsonSplitter, TailBuffer } from '../src/ai/provider/stream';
import { AI_ERROR_MESSAGES, AI_MESSAGES } from '../src/ai/errors';

describe('buildClaudeArgv', () => {
  const base = {
    model: 'claude-sonnet-5-5',
    effort: 'low' as const,
    systemPrompt: 'Be brief.',
    platform: 'win32' as const,
  };

  it('builds exactly the documented flag set, with the system prompt as the last argument', () => {
    const { argv, stdinPrefix } = buildClaudeArgv(base);
    expect(argv).toEqual([
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
      'Be brief.',
    ]);
    expect(stdinPrefix).toBe('');
    for (const flag of FORBIDDEN_FLAGS) expect(argv).not.toContain(flag);
  });

  it('adds --fallback-model only when it differs from the model', () => {
    expect(buildClaudeArgv({ ...base, fallbackModel: 'claude-haiku-5-5' }).argv.slice(-2)).toEqual([
      '--fallback-model',
      'claude-haiku-5-5',
    ]);
    expect(buildClaudeArgv({ ...base, fallbackModel: 'claude-sonnet-5-5' }).argv).not.toContain('--fallback-model');
    expect(buildClaudeArgv({ ...base, fallbackModel: '  ' }).argv).not.toContain('--fallback-model');
  });

  it('refuses model names that could be read as flags, and keeps a leading dash out of the system prompt', () => {
    expect(() => buildClaudeArgv({ ...base, model: '--dangerously-skip-permissions' })).toThrow(/not a Claude model/);
    expect(() => buildClaudeArgv({ ...base, model: 'claude sonnet' })).toThrow();
    const { argv } = buildClaudeArgv({ ...base, systemPrompt: '- rule one' });
    expect(argv.at(-1)).toBe('Instructions:\n- rule one');
    expect(buildClaudeArgv({ ...base, systemPrompt: '   ' }).argv.at(-1)).toBe(BASE_SYSTEM_PROMPT);
  });

  it('moves the system text to the head of stdin when the Windows command line would be too long', () => {
    const fits = 'x'.repeat(WINDOWS_COMMAND_LINE_BUDGET - 400);
    expect(buildClaudeArgv({ ...base, systemPrompt: fits }).stdinPrefix).toBe('');
    // Quotes and backslashes are escaped by Node on Windows, so they cost double.
    const quoted = '"\\'.repeat(15_500);
    const moved = buildClaudeArgv({ ...base, systemPrompt: quoted });
    expect(moved.stdinPrefix).toBe(quoted);
    expect(moved.argv.at(-1)).toBe(BASE_SYSTEM_PROMPT);
  });

  it('uses the per-argument byte limit on POSIX', () => {
    const big = 'y'.repeat(40_000);
    expect(buildClaudeArgv({ ...base, systemPrompt: big, platform: 'linux' }).stdinPrefix).toBe('');
    expect(buildClaudeArgv({ ...base, systemPrompt: big, platform: 'win32' }).stdinPrefix).toBe(big);
    const huge = 'é'.repeat(60_000); // 120,000 bytes
    expect(buildClaudeArgv({ ...base, systemPrompt: huge, platform: 'linux' }).stdinPrefix).toBe(huge);
  });

  it('counts the Windows command line like Node quotes it', () => {
    expect(windowsCommandLineCost(['ab'])).toBe(5);
    expect(windowsCommandLineCost(['a"b\\'])).toBe(9);
    expect(windowsCommandLineCost(['', 'x'])).toBe(7);
  });

  it('accepts only the CLI effort levels', () => {
    expect(normalizeEffort(' Medium ')).toBe('medium');
    expect(normalizeEffort('xhigh')).toBe('xhigh');
    expect(normalizeEffort('extreme')).toBeNull();
  });
});

describe('buildChildEnv', () => {
  it('drops API keys, Claude Code session variables and the thinking budget, keeping the config dir', () => {
    const child = buildChildEnv({
      PATH: '/bin',
      HOME: '/home/a',
      ANTHROPIC_API_KEY: 'sk-ant',
      anthropic_api_key: 'sk-lower',
      ANTHROPIC_AUTH_TOKEN: 'tok',
      ANTHROPIC_BASE_URL: 'https://proxy.example',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
      Claude_Code_Session: 'x',
      CLAUDE_CONFIG_DIR: 'C:\\cfg',
      MAX_THINKING_TOKENS: '9000',
      FAKE_CLAUDE_MODE: 'stall',
      UNDEFINED_ONE: undefined,
    });
    expect(child).toEqual({
      PATH: '/bin',
      HOME: '/home/a',
      ANTHROPIC_BASE_URL: 'https://proxy.example',
      CLAUDE_CONFIG_DIR: 'C:\\cfg',
      FAKE_CLAUDE_MODE: 'stall',
    });
  });
});

describe('resolveCliCommand', () => {
  const npm = 'C:\\Users\\k\\AppData\\Roaming\\npm';
  function host(files: Record<string, string>, overrides: Partial<ResolveHost> = {}): ResolveHost {
    const lower = new Map(Object.entries(files).map(([file, text]) => [file.toLowerCase(), text]));
    return {
      platform: 'win32',
      pathEnv: `C:\\Windows\\system32;${npm}`,
      pathExt: '.COM;.EXE;.BAT;.CMD;.JS',
      execPath: 'C:\\node\\node.exe',
      cwd: 'F:\\repo\\apps\\api',
      rootDir: 'F:\\repo',
      isFile: (file) => lower.has(file.toLowerCase()),
      readText: (file) => lower.get(file.toLowerCase()) ?? '',
      ...overrides,
    };
  }
  const nativeShim =
    '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n' +
    '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n';
  const exe = `${npm}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;

  it('unwraps the npm .cmd shim of a native claude.exe (never a shell)', () => {
    const cli = resolveCliCommand('claude', host({ [`${npm}\\claude.cmd`]: nativeShim, [exe]: 'MZ' }));
    expect(cli).toEqual({ command: exe, prefixArgs: [], resolvedFrom: `${npm}\\claude.cmd` });
  });

  it('runs a JS shim target under this Node, not the node.exe beside it', () => {
    const script = `${npm}\\node_modules\\pkg\\cli.js`;
    const jsShim =
      '@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\node_modules\\pkg\\cli.js" %*\r\n) ELSE (\r\n' +
      '  node  "%~dp0\\node_modules\\pkg\\cli.js" %*\r\n)';
    const cli = resolveCliCommand(
      'claude',
      host({ [`${npm}\\claude.cmd`]: jsShim, [script]: '', [`${npm}\\node.exe`]: 'MZ' }),
    );
    expect(cli.command).toBe('C:\\node\\node.exe');
    expect(cli.prefixArgs).toEqual([script]);
  });

  it('prefers a real .exe found on PATH and honours PATHEXT order', () => {
    const cli = resolveCliCommand('claude', host({ [`${npm}\\claude.exe`]: 'MZ', [`${npm}\\claude.cmd`]: nativeShim }));
    expect(cli.command).toBe(`${npm}\\claude.exe`);
  });

  it('runs a .mjs script (the fake CLI) under process.execPath, resolving relative paths against the repo root', () => {
    const fake = 'F:\\repo\\tools\\fake-claude\\fake-claude.mjs';
    const cli = resolveCliCommand('tools/fake-claude/fake-claude.mjs', host({ [fake]: '' }));
    expect(cli).toEqual({ command: 'C:\\node\\node.exe', prefixArgs: [fake], resolvedFrom: fake });
    const posix = resolveCliCommand('/opt/fake.mjs', {
      ...host({}),
      platform: 'linux',
      execPath: '/usr/bin/node',
      isFile: (f) => f === '/opt/fake.mjs',
    });
    expect(posix).toEqual({ command: '/usr/bin/node', prefixArgs: ['/opt/fake.mjs'], resolvedFrom: '/opt/fake.mjs' });
  });

  it('explains what is missing, and refuses a shim it cannot read rather than using a shell', () => {
    expect(() => resolveCliCommand('claude', host({}))).toThrow(CliNotFoundError);
    expect(() => resolveCliCommand('claude', host({ [`${npm}\\claude.cmd`]: '@echo off\r\nclaude-real %*' }))).toThrow(
      /will not be run through a shell/,
    );
  });

  it('leaves a bare name to spawn on POSIX', () => {
    expect(resolveCliCommand('claude', { ...host({}), platform: 'linux' })).toEqual({
      command: 'claude',
      prefixArgs: [],
      resolvedFrom: 'claude',
    });
  });

  it('finds the real fake-claude script from this repository', () => {
    const cli = resolveCliCommand(path.join('tools', 'fake-claude', 'fake-claude.mjs'));
    expect(cli.command).toBe(process.execPath);
    expect(cli.prefixArgs[0]).toMatch(/fake-claude\.mjs$/);
  });
});

describe('NdjsonSplitter', () => {
  it('reassembles lines split across chunks, including a multi-byte character', () => {
    const splitter = new NdjsonSplitter();
    const line = JSON.stringify({ text: 'café — ✓' });
    const bytes = Buffer.from(`${line}\n{"b":2}\r\n{"c"`, 'utf8');
    const cut = bytes.indexOf(Buffer.from('é')) + 1; // inside the two-byte é
    expect(splitter.push(bytes.subarray(0, cut))).toEqual([]);
    expect(splitter.push(bytes.subarray(cut, cut + 3))).toEqual([]);
    expect(splitter.push(bytes.subarray(cut + 3))).toEqual([line, '{"b":2}']);
    expect(splitter.push(Buffer.from(':3}'))).toEqual([]);
    expect(splitter.flush()).toBe('{"c":3}');
    expect(splitter.flush()).toBeNull();
  });

  it('handles several lines in one chunk and empty chunks', () => {
    const splitter = new NdjsonSplitter();
    expect(splitter.push(Buffer.alloc(0))).toEqual([]);
    expect(splitter.push(Buffer.from('a\nb\n\nc\n'))).toEqual(['a', 'b', '', 'c']);
    expect(splitter.flush()).toBeNull();
  });
});

describe('TailBuffer and lastLines', () => {
  it('keeps only the last bytes', () => {
    const tail = new TailBuffer(10);
    tail.push(Buffer.from('0123456789'));
    tail.push(Buffer.from('abcdef'));
    expect(tail.text()).toBe('6789abcdef');
  });

  it('summarises the end of some output', () => {
    expect(lastLines('one\n\n two \nthree\n')).toBe('one | two | three');
    expect(lastLines('a'.repeat(10) + '\n' + 'b'.repeat(10), 15)).toBe('b'.repeat(10));
  });
});

const line = (event: object) => JSON.stringify(event);
const delta = (text: string) =>
  line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
const assistant = (text: string, model?: string) =>
  line({ type: 'assistant', message: { model, content: [{ type: 'text', text }] } });

function reduceAll(lines: string[]): TurnState {
  const state = createTurnState();
  for (const l of lines) reduceEvent(state, l);
  return state;
}

describe('reduceEvent / turnText', () => {
  const init = line({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5', apiKeySource: 'none' });

  it('prefers result.result over the deltas when the turn succeeded', () => {
    const state = reduceAll([
      init,
      delta('{"a":'),
      delta('1}'),
      assistant('{"a":1}', 'claude-sonnet-5-5-20261001'),
      line({ type: 'result', is_error: false, result: '{"a":1} final' }),
    ]);
    expect(state.deltaText).toBe('{"a":1}');
    expect(turnText(state)).toBe('{"a":1} final');
    expect(state.model).toBe('claude-sonnet-5-5-20261001');
    expect(state.apiKeySource).toBe('none');
    expect(billedToKey(state)).toBe(false);
  });

  it('falls back to the deltas when the result is an error, and to the assistant text after that', () => {
    const failed = reduceAll([init, delta('partial'), line({ type: 'result', is_error: true, result: 'Error: 500' })]);
    expect(turnText(failed)).toBe('partial');
    const noDeltas = reduceAll([init, assistant('whole')]);
    expect(turnText(noDeltas)).toBe('whole');
  });

  it('drops the streamed text when the CLI retries the request', () => {
    const state = reduceAll([
      init,
      delta('DISCARD'),
      line({ type: 'system', subtype: 'api_retry', attempt: 1, error_status: 529 }),
      delta('kept'),
    ]);
    expect(state.retries).toBe(1);
    expect(turnText(state)).toBe('kept');
  });

  it('records the credential, rate limits, stop reason and error marks; ignores noise', () => {
    const state = reduceAll([
      'Warning: something cosmetic',
      '[1,2]',
      line({ type: 'active_goal', value: null }),
      line({ type: 'system', subtype: 'init', model: 'm', apiKeySource: 'ANTHROPIC_API_KEY' }),
      line({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 100 } }),
      line({ type: 'assistant', message: { model: '<synthetic>', stop_reason: 'max_tokens' }, error: 'rate_limit' }),
      line({ type: 'result', is_error: true, api_error_status: 429, result: 'limit', errors: ['e1', 3] }),
    ]);
    expect(state.events).toBe(5); // the banner and the bare array are not events
    expect(billedToKey(state)).toBe(true);
    expect(state.model).toBe('m');
    expect(state.rateLimit).toEqual({ status: 'rejected', resetsAt: 100 });
    expect(state.stopReason).toBe('max_tokens');
    expect(state.errors).toEqual(['rate_limit', 'e1']);
    expect(state.apiErrorStatus).toBe(429);
  });
});

describe('classifyFailure', () => {
  const none = { apiErrorStatus: null, isError: false, exitCode: 0, stderr: '', resultText: '', errors: [] };

  it('uses the API status first', () => {
    expect(classifyFailure({ ...none, apiErrorStatus: 401 })).toBe('auth');
    expect(classifyFailure({ ...none, apiErrorStatus: 429 })).toBe('rateLimited');
    expect(classifyFailure({ ...none, apiErrorStatus: 404 })).toBe('modelUnavailable');
    expect(classifyFailure({ ...none, apiErrorStatus: 529 })).toBe('unavailable');
    expect(classifyFailure({ ...none, apiErrorStatus: 400 })).toBe('failed');
  });

  it('reads the CLI wording', () => {
    expect(classifyFailure({ ...none, isError: true, resultText: 'Invalid API key. Please run /login' })).toBe('auth');
    expect(classifyFailure({ ...none, exitCode: 1, stderr: 'Claude AI usage limit reached|1790000000' })).toBe(
      'rateLimited',
    );
    expect(
      classifyFailure({ ...none, isError: true, resultText: "There's an issue with the selected model (x)." }),
    ).toBe('modelUnavailable');
    expect(classifyFailure({ ...none, exitCode: 1, stderr: 'Error: Overloaded' })).toBe('unavailable');
    expect(classifyFailure({ ...none, exitCode: 1, stderr: 'request failed with status 503' })).toBe('unavailable');
    expect(classifyFailure({ ...none, exitCode: 1, errors: ['authentication_failed'] })).toBe('auth');
  });

  it('does not read stack columns or durations as statuses, and ignores the result text of a success', () => {
    expect(classifyFailure({ ...none, exitCode: 1, stderr: 'at cli.js:512:401 took 503 ms' })).toBe('failed');
    expect(classifyFailure({ ...none, resultText: 'rate limit is a topic of this essay' })).toBeNull();
    expect(classifyFailure(none)).toBeNull();
    expect(classifyFailure({ ...none, exitCode: null })).toBeNull();
  });
});

describe('interpretTurn', () => {
  const ok: CliRunOutcome = {
    exitCode: 0,
    spawnError: null,
    timedOut: false,
    stalled: false,
    aborted: false,
    overflow: false,
    stderr: '',
    ms: 10,
  };
  const context = { nowMs: 1_000_000, firstEventMs: 30_000, timeoutMs: 300_000 };
  const answered = () =>
    reduceAll([
      line({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5', apiKeySource: 'none' }),
      delta('{"a":1}'),
      line({ type: 'result', is_error: false, result: '{"a":1}', stop_reason: 'end_turn' }),
    ]);

  it('answers a clean turn', () => {
    expect(interpretTurn(ok, answered(), context)).toEqual({ ok: true, text: '{"a":1}', model: 'claude-sonnet-5-5' });
  });

  it('stops a turn billed to an API key before anything else, holding every feature', () => {
    const state = reduceAll([line({ type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY' })]);
    const verdict = interpretTurn({ ...ok, aborted: true, exitCode: null }, state, context);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.error.kind).toBe('auth');
    expect(verdict.error.message).toBe(AI_MESSAGES.apiKey);
    expect(verdict.error.code).toBe('ai_unavailable');
    expect(verdict.hold).toMatchObject({ scope: '*', kind: 'auth' });
  });

  it('maps process-level outcomes', () => {
    const enoent = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    const missing = interpretTurn({ ...ok, spawnError: enoent }, createTurnState(), context);
    expect(!missing.ok && missing.error.message).toBe(AI_MESSAGES.binaryMissing);
    const cancelled = interpretTurn({ ...ok, aborted: true }, createTurnState(), context);
    expect(!cancelled.ok && cancelled.error.kind).toBe('cancelled');
    const stalled = interpretTurn({ ...ok, stalled: true, exitCode: null }, createTurnState(), context);
    expect(stalled.ok).toBe(false);
    if (stalled.ok) return;
    expect(stalled.error.kind).toBe('stalled');
    expect(stalled.error.message).toBe(AI_ERROR_MESSAGES.stalled);
    expect(stalled.hold).toEqual({ scope: 'tag', ms: STALL_HOLD_MS, kind: 'stalled', reason: expect.any(String) });
    const timedOut = interpretTurn({ ...ok, timedOut: true, exitCode: null }, reduceAll([delta('{"a"')]), context);
    expect(!timedOut.ok && timedOut.error.kind).toBe('timeout');
  });

  it('fails a rate-limited turn without an answer and holds the seat until the reset (clamped)', () => {
    const state = reduceAll([
      line({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1000 + 600 } }),
      line({ type: 'result', is_error: true, api_error_status: 429, result: '' }),
    ]);
    const verdict = interpretTurn({ ...ok, exitCode: 1 }, state, context);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.error.kind).toBe('rateLimited');
    expect(verdict.hold).toMatchObject({ scope: '*', ms: 600_000 });
    expect(verdict.error.retryAfterSeconds).toBe(600);
  });

  it('keeps an answer that arrived as the window filled, but still holds the seat', () => {
    const state = answered();
    const overage = { status: 'allowed', isUsingOverage: true };
    reduceEvent(state, line({ type: 'rate_limit_event', rate_limit_info: overage }));
    const verdict = interpretTurn(ok, state, context);
    expect(verdict.ok).toBe(true);
    expect(verdict.hold).toMatchObject({ scope: '*', kind: 'rateLimited' });
    expect(rateLimited({ status: 'allowed_warning' })).toBe(false);
  });

  it('classifies an error result, a truncated answer and an empty one', () => {
    const auth = reduceAll([
      line({ type: 'result', is_error: true, api_error_status: 401, result: 'Please run /login' }),
    ]);
    const verdict = interpretTurn({ ...ok, exitCode: 1 }, auth, context);
    expect(!verdict.ok && verdict.error.kind).toBe('auth');
    expect(!verdict.ok && verdict.error.detail).toBe('Please run /login');
    const truncated = answered();
    truncated.stopReason = 'max_tokens';
    expect(interpretTurn(ok, truncated, context)).toMatchObject({ ok: false, error: { kind: 'truncated' } });
    const empty = reduceAll([line({ type: 'result', is_error: false, result: '' })]);
    expect(interpretTurn(ok, empty, context)).toMatchObject({ ok: false, error: { kind: 'malformed' } });
    const crashed = interpretTurn({ ...ok, exitCode: 1, stderr: 'boom' }, createTurnState(), context);
    expect(crashed).toMatchObject({ ok: false, error: { kind: 'failed', code: 'ai_failed', detail: 'boom' } });
  });
});
