import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { AppConfig } from '../../config/env';
import type { Logger } from '../../core/log';
import { aboutMinutes, AI_MESSAGES, AiError, holdError } from '../errors';
import { buildClaudeArgv, isCliModelName, normalizeEffort } from './argv';
import { interpretTurn, type HoldRequest } from './classify';
import { buildChildEnv } from './env';
import { billedToKey, createTurnState, reduceEvent } from './events';
import { probeCli, type CliStatus } from './health';
import { defaultResolveHost, resolveCliCommand, type CliCommand, type ResolveHost } from './resolve';
import { runCli } from './spawn';
import type { AiProvider, CompletionRequest, CompletionResult, ProviderHold } from './types';

export const HEALTH_TIMEOUT_MS = 20_000;
export const HEALTH_CACHE_MS = 60_000;

export interface ClaudeCliProviderOptions {
  ai: AppConfig['ai'];
  dataDir: string;
  log: Logger;
  /** The clock for holds and the health cache (tests freeze it). */
  now: () => Date;
  /** The environment the child's is derived from, read at every call. Default: process.env. */
  parentEnv?: () => NodeJS.ProcessEnv;
  resolveHost?: () => ResolveHost;
}

/**
 * Runs completions through the locally installed, signed-in `claude` on the operator's subscription seat: one
 * process per call, the prompt on stdin, the answer read from stream-json. Every failure is an AiError.
 */
export function createClaudeCliProvider(options: ClaudeCliProviderOptions): AiProvider {
  const { ai, log } = options;
  const workdir = join(options.dataDir, 'claude-cli-work');
  const nowMs = () => options.now().getTime();
  const parentEnv = options.parentEnv ?? (() => process.env);
  const holds = new Map<string, ProviderHold>();
  const warned = new Set<string>();
  let workdirReady = false;
  let resolved: { key: string; cli: CliCommand } | null = null;
  let statusCache: { at: number; value: CliStatus } | null = null;
  let probing: Promise<CliStatus> | null = null;

  const warnOnce = (key: string, message: string) => {
    if (warned.has(key)) return;
    warned.add(key);
    log.warn(message);
  };

  /** Resolved once per (AI_CLI_BIN, PATH); re-resolved when the file it runs has gone (an upgrade, an uninstall). */
  function resolveCli(): CliCommand {
    const host = (options.resolveHost ?? defaultResolveHost)();
    const key = [ai.cliBin, host.pathEnv, host.pathExt].join('\u0000');
    const target = resolved && (resolved.cli.prefixArgs[0] ?? resolved.cli.command);
    if (resolved && resolved.key === key && target && (!isAbsolute(target) || host.isFile(target))) return resolved.cli;
    resolved = { key, cli: resolveCliCommand(ai.cliBin, host) };
    return resolved.cli;
  }

  /** One fixed, empty directory: the CLI keys per-project state on the working directory, and finds no CLAUDE.md. */
  function ensureWorkdir(): void {
    if (workdirReady) return;
    mkdirSync(workdir, { recursive: true });
    workdirReady = true;
  }

  function holdFor(tag: string): ProviderHold | null {
    let longest: ProviderHold | null = null;
    for (const scope of ['*', tag]) {
      const hold = holds.get(scope);
      if (!hold) continue;
      if (hold.until <= nowMs()) holds.delete(scope);
      else if (!longest || hold.until > longest.until) longest = hold;
    }
    return longest;
  }

  function setHold(request: HoldRequest, tag: string): void {
    const scope = request.scope === '*' ? '*' : tag;
    const until = nowMs() + request.ms;
    const existing = holds.get(scope);
    if (existing && existing.until >= until) return;
    holds.set(scope, { scope, until, kind: request.kind, reason: request.reason });
    const what = scope === '*' ? 'all AI calls' : `AI calls for "${scope}"`;
    log.warn(`[ai] pausing ${what} for ${aboutMinutes(request.ms)}: ${request.reason}`);
  }

  async function complete(request: CompletionRequest): Promise<CompletionResult> {
    if (!request.ignoreHolds) {
      const hold = holdFor(request.tag);
      if (hold) throw holdError(hold, nowMs());
    }
    if (!isCliModelName(request.model)) {
      throw new AiError('modelUnavailable', { detail: `"${request.model}" is not a valid Claude model name.` });
    }
    let effort = normalizeEffort(request.effort);
    if (!effort) {
      const why = `[ai] effort "${request.effort}" is not low/medium/high/xhigh/max; using low.`;
      warnOnce(`effort:${request.effort}`, why);
      effort = 'low';
    }
    let cli: CliCommand;
    try {
      cli = resolveCli();
    } catch (error) {
      throw new AiError('unavailable', { message: AI_MESSAGES.binaryMissing, detail: (error as Error).message });
    }
    ensureWorkdir();

    const invocation = buildClaudeArgv({
      model: request.model,
      effort,
      systemPrompt: request.system,
      fallbackModel: ai.fallbackModel,
    });
    if (invocation.stdinPrefix) {
      warnOnce('stdin-system', '[ai] a system prompt is too long for the command line; it goes at the head of stdin.');
    }
    // The CLI refuses an empty prompt in print mode.
    const user = request.user.trim() ? request.user : 'Follow the instructions.';
    const stdin = invocation.stdinPrefix ? `${invocation.stdinPrefix}\n\n${user}` : user;
    const timeoutMs = Math.min(ai.timeoutMs, request.timeoutMs ?? ai.timeoutMs);

    // The turn's own stop switch, so an API key named in system/init ends the child before the model answers; the
    // caller's cancellation is forwarded to it.
    const state = createTurnState();
    const stop = new AbortController();
    const forward = () => stop.abort();
    if (request.signal?.aborted) stop.abort();
    else request.signal?.addEventListener('abort', forward, { once: true });
    let outcome;
    try {
      outcome = await runCli({
        command: cli.command,
        args: [...cli.prefixArgs, ...invocation.argv],
        env: buildChildEnv(parentEnv()),
        cwd: workdir,
        stdin,
        timeoutMs,
        firstEventMs: ai.firstEventMs,
        signal: stop.signal,
        onLine: (line) => {
          reduceEvent(state, line);
          if (billedToKey(state)) stop.abort();
        },
      });
    } finally {
      request.signal?.removeEventListener('abort', forward);
    }

    const verdict = interpretTurn(outcome, state, { nowMs: nowMs(), firstEventMs: ai.firstEventMs, timeoutMs });
    if (verdict.hold) setHold(verdict.hold, request.tag);
    if (!verdict.ok) {
      const line = `[ai] ${request.tag} failed after ${outcome.ms} ms (${verdict.error.kind}): ${verdict.error.detail}`;
      if (verdict.error.kind === 'cancelled') log.debug(line);
      else log.warn(line);
      throw verdict.error;
    }
    // An answer proves the seat works: lift a seat-wide hold (not one this very turn just set).
    if (!verdict.hold) holds.delete('*');
    const model = verdict.model ?? request.model;
    log.debug(`[ai] ${request.tag} answered in ${outcome.ms} ms by ${model}`);
    return { text: verdict.text, model: verdict.model, ms: outcome.ms };
  }

  function status(force = false): Promise<CliStatus> {
    if (!force && statusCache && nowMs() - statusCache.at < HEALTH_CACHE_MS) return Promise.resolve(statusCache.value);
    probing ??= (async (): Promise<CliStatus> => {
      const checkedAt = options.now().toISOString();
      let cli: CliCommand;
      try {
        cli = resolveCli();
      } catch (error) {
        return {
          found: false,
          version: null,
          loggedIn: false,
          authMethod: null,
          subscriptionType: null,
          apiKeySource: null,
          problem:
            `The Claude CLI was not found (AI_CLI_BIN="${ai.cliBin}"): ${(error as Error).message} ` +
            'Install Claude Code and sign in, or set AI_CLI_BIN to its full path.',
          checkedAt,
        };
      }
      ensureWorkdir();
      return probeCli({ cli, env: buildChildEnv(parentEnv()), cwd: workdir, timeoutMs: HEALTH_TIMEOUT_MS, checkedAt });
    })()
      .then((value) => {
        statusCache = { at: nowMs(), value };
        return value;
      })
      .finally(() => {
        probing = null;
      });
    return probing;
  }

  return {
    name: 'claude-cli',
    complete,
    status,
    holdFor,
    activeHolds: () => [...holds.values()].filter((hold) => hold.until > nowMs()),
    clearHolds: () => holds.clear(),
  };
}
