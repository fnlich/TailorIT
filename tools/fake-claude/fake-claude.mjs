#!/usr/bin/env node
/* global process, Buffer, setTimeout */
// Deterministic stand-in for the `claude` CLI (AI_CLI_BIN in API tests and verify:e2e). Plain Node ESM, no deps.
//
//   fake-claude --version                 prints a version line
//   fake-claude auth status [--json]      prints sign-in JSON (claude.ai subscription, apiKeySource "none")
//   fake-claude -p ...flags < prompt      asserts the provider's argv contract (exit 2 on a missing or unknown flag,
//                                         e.g. --bare), then streams stream-json events like the real CLI. The reply
//                                         comes from scenarios/<kind>.mjs|.json, where <kind> is the [feature:<kind>]
//                                         tag in --system-prompt (or at the head of stdin); default {"ok":true}.
//
// Environment:
//   FAKE_CLAUDE_MODE       stall | auth | ratelimit | badjson-once | apikey | slow   (unset: answer normally)
//   FAKE_CLAUDE_STATE      key of the call counter for badjson-once (a file in the OS temp dir)
//   FAKE_CLAUDE_SLOW_MS    delay for "slow" and "apikey" (default 2000)
//   FAKE_CLAUDE_SCENARIOS  directory to read scenarios from instead of ./scenarios
//   FAKE_CLAUDE_RECORD     append one JSON line per -p call (argv, stdin, cwd, kind, pid, Claude/Anthropic env NAMES)
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION = '2.1.263-fake (Claude Code test double)';
const here = dirname(fileURLToPath(import.meta.url));
const mode = (process.env.FAKE_CLAUDE_MODE ?? '').trim().toLowerCase();
const slowMs = Number(process.env.FAKE_CLAUDE_SLOW_MS) || 2000;
const session = randomUUID();

class UsageError extends Error {}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/;
/** Options that take a value, with the value the provider must send. */
const VALUE_OPTIONS = new Map([
  ['--output-format', (v) => (v === 'stream-json' ? null : 'must be "stream-json"')],
  ['--model', (v) => (MODEL.test(v) ? null : 'must be a model name')],
  ['--effort', (v) => (EFFORTS.includes(v) ? null : `must be one of ${EFFORTS.join(', ')}`)],
  ['--tools', (v) => (v === '' ? null : 'must be "" (no tools)')],
  ['--permission-prompts', (v) => (v === 'none' ? null : 'must be "none"')],
  ['--system-prompt', (v) => (v.trim() ? null : 'must not be empty')],
  ['--fallback-model', (v) => (MODEL.test(v) ? null : 'must be a model name')],
]);
const REQUIRED_VALUES = [
  '--output-format',
  '--model',
  '--effort',
  '--tools',
  '--permission-prompts',
  '--system-prompt',
];
const REQUIRED_SWITCHES = [
  '-p',
  '--include-partial-messages',
  '--verbose',
  '--safe-mode',
  '--strict-mcp-config',
  '--disable-slash-commands',
  '--no-session-persistence',
];

function parsePrintArgs(args) {
  const values = new Map();
  const switches = new Set();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const flag = arg === '--print' ? '-p' : arg;
    if (REQUIRED_SWITCHES.includes(flag)) {
      switches.add(flag);
    } else if (VALUE_OPTIONS.has(arg)) {
      const value = args[i + 1];
      if (value === undefined) throw new UsageError(`option '${arg}' needs a value`);
      const problem = VALUE_OPTIONS.get(arg)(value);
      if (problem) throw new UsageError(`${arg} ${problem} (got ${JSON.stringify(value.slice(0, 60))})`);
      values.set(arg, value);
      i += 1;
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option '${arg}': the TailorIT provider must not pass it`);
    } else {
      throw new UsageError(`unexpected argument ${JSON.stringify(arg.slice(0, 40))}: the prompt must come on stdin`);
    }
  }
  for (const flag of [...REQUIRED_SWITCHES, ...REQUIRED_VALUES]) {
    if (!switches.has(flag) && !values.has(flag)) throw new UsageError(`missing required option ${flag}`);
  }
  if (values.get('--fallback-model') === values.get('--model')) {
    throw new UsageError('Fallback model cannot be the same as the main model');
  }
  return { model: values.get('--model'), system: values.get('--system-prompt') };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function emit(event) {
  process.stdout.write(`${JSON.stringify({ ...event, session_id: session, uuid: randomUUID() })}\n`);
}

const usage = (output) => ({
  input_tokens: 120,
  output_tokens: output,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
});

function emitInit(model, apiKeySource = 'none') {
  emit({
    type: 'system',
    subtype: 'init',
    cwd: process.cwd(),
    tools: [],
    mcp_servers: [],
    model,
    permissionMode: 'default',
    slash_commands: [],
    apiKeySource,
    claude_code_version: '2.1.263',
    output_style: 'default',
  });
  emit({ type: 'system', subtype: 'status', status: 'requesting' });
}

function emitAnswer(model, text) {
  const id = `msg_fake_${session.slice(0, 8)}`;
  emit({
    type: 'stream_event',
    event: { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [] } },
    parent_tool_use_id: null,
  });
  const block = { type: 'text', text: '' };
  emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: block } });
  for (let i = 0; i < text.length; i += 48) {
    const delta = { type: 'text_delta', text: text.slice(i, i + 48) };
    emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta }, parent_tool_use_id: null });
  }
  emit({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
  emit({
    type: 'assistant',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text }],
      stop_reason: null,
      usage: usage(40),
    },
    parent_tool_use_id: null,
  });
  const end = { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } };
  emit({ type: 'stream_event', event: end });
  emit({ type: 'stream_event', event: { type: 'message_stop' } });
  emit({
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed',
      resetsAt: Math.floor(Date.now() / 1000) + 3600,
      rateLimitType: 'five_hour',
      overageStatus: 'rejected',
      isUsingOverage: false,
    },
  });
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 420,
    duration_api_ms: 400,
    num_turns: 1,
    result: text,
    stop_reason: 'end_turn',
    total_cost_usd: 0,
    usage: usage(40),
    modelUsage: { [model]: { inputTokens: 120, outputTokens: 40 } },
    permission_denials: [],
    terminal_reason: 'completed',
    api_error_status: null,
  });
}

function emitFailure(model, status, message, extra = {}) {
  emit({
    type: 'assistant',
    message: {
      id: `msg_err_${session.slice(0, 8)}`,
      type: 'message',
      role: 'assistant',
      model: '<synthetic>',
      content: [{ type: 'text', text: message }],
      stop_reason: 'stop_sequence',
      usage: usage(0),
    },
    error: extra.error,
    is_api_error_message: true,
  });
  emit({
    type: 'result',
    subtype: 'success',
    is_error: true,
    duration_ms: 120,
    duration_api_ms: 100,
    num_turns: 1,
    result: message,
    stop_reason: 'stop_sequence',
    total_cost_usd: 0,
    usage: usage(0),
    modelUsage: { [model]: { inputTokens: 0, outputTokens: 0 } },
    permission_denials: [],
    terminal_reason: 'api_error',
    api_error_status: status,
  });
  process.exitCode = 1;
}

const wrap = (value) => `@@BEGIN_JSON@@\n${JSON.stringify(value, null, 2)}\n@@END_JSON@@`;

/** The reply text for a kind: scenarios/<kind>.mjs (default export (ctx) => value | reply string), else
 *  scenarios/<kind>.json (the JSON value itself), else {"ok":true}. */
async function scenarioReply(kind, ctx) {
  const dir = process.env.FAKE_CLAUDE_SCENARIOS || join(here, 'scenarios');
  if (kind) {
    const script = join(dir, `${kind}.mjs`);
    if (existsSync(script)) {
      const out = await (await import(pathToFileURL(script).href)).default(ctx);
      return typeof out === 'string' ? out : wrap(out);
    }
    const data = join(dir, `${kind}.json`);
    if (existsSync(data)) return wrap(JSON.parse(readFileSync(data, 'utf8')));
  }
  return wrap({ ok: true });
}

/** Counts calls per FAKE_CLAUDE_STATE key; returns this call's number (1 for the first). */
function nextCall() {
  const key = (process.env.FAKE_CLAUDE_STATE || 'default').replace(/[^A-Za-z0-9_-]/g, '_');
  const file = join(tmpdir(), `fake-claude-${key}.json`);
  let calls = 0;
  try {
    calls = JSON.parse(readFileSync(file, 'utf8')).calls ?? 0;
  } catch {
    calls = 0;
  }
  writeFileSync(file, JSON.stringify({ calls: calls + 1 }));
  return calls + 1;
}

function authStatus() {
  const status =
    mode === 'auth'
      ? { loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' }
      : mode === 'apikey'
        ? { loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty', apiKeySource: 'ANTHROPIC_API_KEY' }
        : {
            loggedIn: true,
            authMethod: 'claude.ai',
            apiProvider: 'firstParty',
            subscriptionType: 'max',
            apiKeySource: 'none',
          };
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  if (!status.loggedIn) process.exitCode = 1;
}

async function print(args) {
  const { model, system } = parsePrintArgs(args);
  const stdin = await readStdin();
  if (!stdin.trim()) {
    throw new UsageError('Input must be provided either through stdin or as a prompt argument when using --print');
  }
  const TAG = /\[feature:([A-Za-z0-9_-]+)\]/;
  const tag = TAG.exec(system) ?? TAG.exec(stdin.slice(0, 200_000));
  const kind = tag?.[1] ?? null;
  if (process.env.FAKE_CLAUDE_RECORD) {
    const env = Object.keys(process.env).filter((name) => /^(ANTHROPIC_|CLAUDE|MAX_THINKING_TOKENS)/i.test(name));
    const record = { argv: args, stdin, cwd: process.cwd(), kind, model, env, pid: process.pid };
    appendFileSync(process.env.FAKE_CLAUDE_RECORD, `${JSON.stringify(record)}\n`);
  }

  if (mode === 'stall') {
    // Never answers, like the CLI at a spent usage window; exits by itself after 10 minutes if nobody kills it.
    setTimeout(() => process.exit(3), 600_000);
    return;
  }
  if (mode === 'apikey') {
    emitInit(model, 'ANTHROPIC_API_KEY');
    await sleep(slowMs);
    emitAnswer(model, wrap({ billed: true }));
    return;
  }
  emitInit(model);
  if (mode === 'auth') {
    const message = 'Invalid authentication credentials. Please run /login';
    emitFailure(model, 401, message, { error: 'authentication_failed' });
    return;
  }
  if (mode === 'ratelimit') {
    const resetsAt = Math.floor(Date.now() / 1000) + 1800;
    emit({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'rejected',
        resetsAt,
        rateLimitType: 'five_hour',
        overageStatus: 'rejected',
        isUsingOverage: false,
      },
    });
    emitFailure(model, 429, `Claude AI usage limit reached|${resetsAt}`, { error: 'rate_limit' });
    return;
  }
  if (mode === 'slow') await sleep(slowMs);
  if (mode === 'badjson-once' && nextCall() === 1) {
    emitAnswer(model, '@@BEGIN_JSON@@\n{"answer": "pong" "this reply is missing a comma"\n@@END_JSON@@');
    return;
  }
  emitAnswer(model, await scenarioReply(kind, { kind, system, user: stdin, model }));
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--version' || args[0] === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (args[0] === 'auth' && args[1] === 'status') {
    authStatus();
    return;
  }
  if (args.includes('-p') || args.includes('--print')) {
    await print(args);
    return;
  }
  const got = JSON.stringify(args.slice(0, 3));
  throw new UsageError(`fake-claude only supports --version, auth status and -p (got ${got})`);
}

main().catch((error) => {
  process.stderr.write(`fake-claude: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
